use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufReader, Read};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://api.sermonindex.net/v2";
const DOWNLOADS: &str = "https://api.sermonindex.net/downloads";
const UA: &str = "NETStudySermons/1.0 (macOS; +https://net-study.github.io)";
const INDEX_TTL: u64 = 60 * 60 * 24 * 14;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("client: {e}"))
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("responses");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn digest(key: &str) -> String {
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn write_atomic(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn clean_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_start_matches('/');
    let trimmed = trimmed.strip_prefix("v2/").unwrap_or(trimmed);
    if trimmed.is_empty() || trimmed.contains("..") {
        return Err("bad path".into());
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/-_.?=&".contains(c));
    if !ok {
        return Err("bad path".into());
    }
    Ok(trimmed.to_string())
}

fn fetch_json(client: &reqwest::blocking::Client, url: &str) -> Result<(Value, String), String> {
    let resp = client.get(url).send().map_err(|e| format!("{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let text = resp.text().map_err(|e| format!("{e}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("json: {e}"))?;
    Ok((value, text))
}

/// GET a v2 API path, served from a disk cache when it is fresh enough.
#[tauri::command]
async fn api_get(app: AppHandle, path: String, max_age: Option<u64>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || api_get_blocking(&app, &path, max_age))
        .await
        .map_err(|e| e.to_string())?
}

fn api_get_blocking(app: &AppHandle, path: &str, max_age: Option<u64>) -> Result<Value, String> {
    let clean = clean_path(path)?;
    let dir = cache_dir(app)?;
    let file = dir.join(format!("{}.json", digest(&clean)));
    let ttl = max_age.unwrap_or(60 * 60 * 24 * 7);

    if let Ok(meta) = fs::metadata(&file) {
        let fresh = meta
            .modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .map(|age| age.as_secs() < ttl)
            .unwrap_or(false);
        if fresh {
            if let Ok(text) = fs::read_to_string(&file) {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    return Ok(value);
                }
            }
        }
    }

    let url = format!("{BASE}/{clean}");
    let result = fetch_json(&client()?, &url);
    match result {
        Ok((value, text)) => {
            let _ = write_atomic(&file, text.as_bytes());
            Ok(value)
        }
        Err(err) => {
            // A stale copy beats no copy when the network is down.
            if let Ok(text) = fs::read_to_string(&file) {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    return Ok(value);
                }
            }
            Err(err)
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct LocalState {
    #[serde(default)]
    value: Value,
}

#[tauri::command]
fn state_load(app: AppHandle) -> Result<Value, String> {
    let file = data_dir(&app)?.join("state.json");
    match fs::read_to_string(&file) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
fn state_save(app: AppHandle, state: Value) -> Result<(), String> {
    let file = data_dir(&app)?.join("state.json");
    let text = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    write_atomic(&file, text.as_bytes())
}

fn num(value: &Value) -> u64 {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

fn index_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("index");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

fn index_status(app: &AppHandle) -> Result<Value, String> {
    let mut out = json!({ "topics": 0, "speakers": 0, "builtAt": 0, "ready": false });
    let topics = index_path(app, "topics")?;
    let speakers = index_path(app, "speakers")?;
    if let Ok(text) = fs::read_to_string(&topics) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            out["topics"] = json!(v["items"].as_array().map(|a| a.len()).unwrap_or(0));
            out["builtAt"] = v["builtAt"].clone();
        }
    }
    if let Ok(text) = fs::read_to_string(&speakers) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            out["speakers"] = json!(v["items"].as_array().map(|a| a.len()).unwrap_or(0));
        }
    }
    out["ready"] = json!(out["topics"].as_u64().unwrap_or(0) > 0 && out["speakers"].as_u64().unwrap_or(0) > 0);
    Ok(out)
}

#[tauri::command]
fn get_index(app: AppHandle, name: String) -> Result<Value, String> {
    if name != "topics" && name != "speakers" {
        return Err("unknown index".into());
    }
    let file = index_path(&app, &name)?;
    let text = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn build_indexes(app: AppHandle, force: Option<bool>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || build_indexes_blocking(&app, force.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

fn index_fresh(app: &AppHandle, name: &str) -> bool {
    let Ok(path) = index_path(app, name) else { return false };
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|m| m.elapsed().ok())
        .map(|age| age.as_secs() < INDEX_TTL)
        .unwrap_or(false)
}

fn build_indexes_blocking(app: &AppHandle, force: bool) -> Result<Value, String> {
    let http = client()?;
    if force || !index_fresh(app, "speakers") {
        build_speaker_index(app, &http)?;
    }
    if force || !index_fresh(app, "topics") {
        build_topic_index(app, &http)?;
    }
    index_status(app)
}

fn stream_index<F>(
    app: &AppHandle,
    url: &str,
    stage: &str,
    mut pick: F,
) -> Result<usize, String>
where
    F: FnMut(&Value) -> Option<Value>,
{
    let _ = app.emit("index-progress", json!({ "stage": stage, "count": 0, "done": false }));
    let resp = client()?
        .get(url)
        .send()
        .map_err(|e| format!("{stage}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{stage}: HTTP {}", resp.status()));
    }
    let decoder = GzDecoder::new(BufReader::new(resp));
    let stream = serde_json::Deserializer::from_reader(decoder).into_iter::<Value>();
    let mut items = Vec::new();
    for (i, value) in stream.enumerate() {
        let value = value.map_err(|e| format!("{stage}: {e}"))?;
        if let Some(item) = pick(&value) {
            items.push(item);
        }
        if i % 250 == 0 {
            let _ = app.emit(
                "index-progress",
                json!({ "stage": stage, "count": items.len(), "done": false }),
            );
        }
    }
    let payload = json!({ "builtAt": now_secs(), "items": items });
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let file = index_path(app, stage)?;
    write_atomic(&file, &bytes)?;
    let _ = app.emit(
        "index-progress",
        json!({ "stage": stage, "count": payload["items"].as_array().map(|a| a.len()).unwrap_or(0), "done": true }),
    );
    Ok(payload["items"].as_array().map(|a| a.len()).unwrap_or(0))
}

fn build_speaker_index(app: &AppHandle, _http: &reqwest::blocking::Client) -> Result<(), String> {
    stream_index(app, &format!("{DOWNLOADS}/speakers.json.gz"), "speakers", |v| {
        let slug = v["slug"].as_str()?;
        Some(json!({
            "slug": slug,
            "name": v["name"].as_str().unwrap_or(slug),
            "image": v["image"].as_str().unwrap_or(""),
            "count": num(&v["sermonCount"]),
        }))
    })
    .map(|_| ())
}

fn build_topic_index(app: &AppHandle, _http: &reqwest::blocking::Client) -> Result<(), String> {
    stream_index(app, &format!("{DOWNLOADS}/topics.json.gz"), "topics", |v| {
        let slug = v["slug"].as_str()?;
        Some(json!({
            "slug": slug,
            "name": v["name"].as_str().unwrap_or(slug),
            "count": num(&v["sermonCount"]),
        }))
    })
    .map(|_| ())
}

#[tauri::command]
async fn index_state(app: AppHandle) -> Result<Value, String> {
    index_status(&app)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("bad url".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).status();
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cache_size(app: AppHandle) -> Result<u64, String> {
    let dir = cache_dir(&app)?;
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

#[tauri::command]
fn clear_cache(app: AppHandle) -> Result<(), String> {
    let dir = cache_dir(&app)?;
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            api_get,
            state_load,
            state_save,
            build_indexes,
            index_state,
            get_index,
            open_url,
            cache_size,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running NET Study Sermons");
}
