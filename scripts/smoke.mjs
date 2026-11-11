// Headless smoke test: serves the built frontend, shims the Tauri bridge with
// recorded API responses, and drives the real UI in Chrome.
//
//   npm run smoke

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const BASE = "https://api.sermonindex.net/v2";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const get = async (p) => {
  const res = await fetch(`${BASE}/${p}`);
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`);
  return res.json();
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      if (url.pathname === "/" || !path.extname(file)) file = path.join(DIST, "index.html");
      if (!file.startsWith(DIST) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function fixtures() {
  const [stats, books, gen, gen1, jhn3, jhn316, popular] = await Promise.all([
    get("stats"),
    get("scripture"),
    get("scripture/GEN"),
    get("scripture/GEN/1"),
    get("scripture/JHN/3"),
    get("scripture/JHN/3/16"),
    get("sermons/popular"),
  ]);
  const first = popular.sermons[0];
  const detail = await get(`sermons/${first.id}`);
  const revival = await get("topics/revival");
  const speakerPage = await get("speakers/leonard-ravenhill/page/1");
  const speakerFull = await get("speakers/leonard-ravenhill");

  const topics = Array.from({ length: 60 }, (_, i) => ({
    slug: i === 0 ? "revival" : `sample-theme-${i}`,
    name: i === 0 ? "Revival" : `Sample Theme ${i}`,
    count: 1200 - i * 10,
  }));

  const speakers = speakerFull.sermons.length
    ? [
        { slug: "leonard-ravenhill", name: "Leonard Ravenhill", image: speakerFull.image, count: 873 },
        ...Array.from({ length: 30 }, (_, i) => ({
          slug: `sample-preacher-${i}`,
          name: `Sample Preacher ${i}`,
          image: "",
          count: 400 - i,
        })),
      ]
    : [];

  const byId = {};
  const record = (list) => {
    for (const sermon of list || []) byId[sermon.id] = sermon;
  };
  record(popular.sermons);
  record(jhn316.sermons);
  record(jhn3.sermons);
  record(gen1.sermons);
  record(revival.sermons);
  record(speakerFull.sermons);

  return {
    byId,
    api: {
      stats,
      scripture: books,
      "scripture/GEN": gen,
      "scripture/GEN/1": gen1,
      "scripture/JHN/3": jhn3,
      "scripture/JHN/3/16": jhn316,
      "sermons/popular": popular,
      [`sermons/${first.id}`]: detail,
      "topics/revival": revival,
      "speakers/leonard-ravenhill": speakerFull,
      "speakers/leonard-ravenhill/page/1": speakerPage,
    },
    topics,
    speakers,
    expect: {
      popularTitle: first.title,
      secondTitle: popular.sermons[1].title,
      verseCount: jhn316.sermonCount,
      otBooks: books.books.filter((b) => b.testament === "OT").length,
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error("dist/ is missing. Run `npm run build` first.");
    process.exit(1);
  }
  const data = await fixtures();
  const server = await serve();
  const port = server.address().port;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 840, deviceScaleFactor: 1 });

  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!/Failed to load resource|net::ERR|MEDIA_ELEMENT_ERROR/i.test(text)) errors.push(text);
    }
  });

  await page.evaluateOnNewDocument((payload) => {
    window.__FIXTURES__ = payload;
    window.__OPENED__ = null;
    window.__STATE__ = null;
    const callbacks = new Map();
    let nextId = 1;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => {
        const id = nextId++;
        callbacks.set(id, cb);
        return id;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      convertFileSrc: (p) => p,
      invoke: async (cmd, args = {}) => {
        const f = window.__FIXTURES__;
        switch (cmd) {
          case "api_get": {
            const key = String(args.path).replace(/^v2\//, "");
            if (!(key in f.api)) {
              if (key.startsWith("speakers/")) {
                const parts = key.split("/");
                const slug = parts[1];
                const list = Object.values(f.byId).filter((sermon) => sermon.speakerSlug === slug);
                if (list.length) {
                  const base = {
                    slug,
                    name: list[0].speaker,
                    bio: "",
                    image: list[0].speakerImage,
                    url: list[0].speakerUrl,
                    sermonCount: list.length,
                    sermons: list,
                  };
                  if (parts[2] === "page") {
                    return { page: Number(parts[3]), pageSize: 50, totalPages: 1, total: list.length, sermons: list.slice(0, 50) };
                  }
                  return base;
                }
              }
              if (key.startsWith("sermons/")) {
                const sermon = f.byId[key.slice(8)];
                if (sermon) return { ...sermon, transcriptText: "", hasTranscript: !!sermon.hasTranscript };
              }
              throw new Error(`mocked 404: ${key}`);
            }
            return f.api[key];
          }
          case "state_load":
            return window.__STATE__;
          case "state_save":
            window.__STATE__ = args.state;
            return null;
          case "index_state":
            return { topics: f.topics.length, speakers: f.speakers.length, ready: true, builtAt: 1 };
          case "get_index":
            return { builtAt: 1, items: args.name === "topics" ? f.topics : f.speakers };
          case "build_indexes":
            return { topics: f.topics.length, speakers: f.speakers.length, ready: true };
          case "open_url":
            window.__OPENED__ = args.url;
            return null;
          case "plugin:event|listen":
            return 1;
          case "plugin:event|unlisten":
            return null;
          default:
            throw new Error(`unmocked command: ${cmd}`);
        }
      },
    };
  }, data);

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".hero");

  let pass = 0;
  const failures = [];
  const check = async (name, fn) => {
    try {
      await fn();
      pass += 1;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
      failures.push(name);
      console.log(`  \x1b[31m✗\x1b[0m ${name} — ${err.message}`);
    }
  };
  const assert = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  const text = (sel) => page.$eval(sel, (el) => el.textContent.trim());

  console.log("\nNET Study Sermons · smoke\n");

  await check("home renders the hero and live counts", async () => {
    assert((await text(".hero-stats strong")) === data.api.stats.sermons.toLocaleString(), "sermon count mismatch");
    assert((await page.$$(".card")).length >= 12, "not enough popular cards");
  });

  await check("most-listened cards carry title and preacher", async () => {
    const title = await text(".card-title");
    assert(title === data.expect.popularTitle, `expected “${data.expect.popularTitle}”, got “${title}”`);
  });

  await check("search parses a verse reference", async () => {
    await page.click("#search");
    await page.type("#search", "john 3:16");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".verse-strip, .list", { timeout: 8000 });
    await page.waitForFunction(
      (n) => document.querySelector(".head-stat strong")?.textContent.replace(/,/g, "") === String(n),
      { timeout: 10000 },
      data.expect.verseCount,
    );
    const h1 = await text(".page-head h1");
    assert(h1 === "John 3:16", `heading was “${h1}”`);
    assert((await page.$$(".row")).length > 5, "no sermon rows");
  });

  await check("playing a row fills the player bar", async () => {
    const row = await page.$(".row");
    const expected = await row.$eval(".row-title", (el) => el.textContent.trim());
    await row.$eval(".row-play", (el) => el.click());
    await page.waitForSelector("#player:not(.hidden)", { timeout: 5000 });
    const np = await text("#np-title");
    assert(np === expected, `player shows “${np}”, row was “${expected}”`);
    const src = await page.$eval("#audio", (el) => el.getAttribute("src") || "");
    assert(/^https:\/\//.test(src), `audio src not set (${src})`);
    assert(!(await page.$eval("#player", (el) => el.classList.contains("hidden"))), "player hidden");
  });

  await check("next advances the queue", async () => {
    const before = await text("#np-title");
    await page.click("#next-btn");
    await sleep(150);
    const after = await text("#np-title");
    assert(after !== before, "queue did not advance");
    assert(after === data.expect.secondTitle || after.length > 0, "unexpected title");
  });

  await check("previous steps back", async () => {
    await page.click("#prev-btn");
    await page.click("#prev-btn");
    await sleep(200);
    const back = await text("#np-title");
    assert(back.length > 0, "no title after previous");
  });

  await check("sermon rows open the detail view", async () => {
    await page.$eval(".row .row-body", (el) => el.click());
    await page.waitForSelector(".sermon-detail", { timeout: 8000 });
    const h1 = await text(".sermon-detail h1");
    assert(h1.length > 3, "empty title");
    assert((await page.$$(".detail-chips .chip")).length > 0, "no topic/scripture chips");
  });

  await check("preacher link opens the preacher page", async () => {
    await page.$eval(".detail-meta .link", (el) => el.click());
    await page.waitForSelector(".speaker-hero", { timeout: 8000 });
    const name = await text(".speaker-hero h1");
    assert(name.length > 2, `preacher name was “${name}”`);
    assert((await page.$$(".row")).length > 5, "no sermons listed");
  });

  await check("back returns to the sermon", async () => {
    await page.click("#back-btn");
    await page.waitForSelector(".sermon-detail", { timeout: 5000 });
  });

  await check("scripture browser lists the Old Testament", async () => {
    await page.click('[data-nav="scripture"]');
    await page.waitForSelector(".book-grid", { timeout: 8000 });
    const count = (await page.$$(".book-tile")).length;
    assert(count === data.expect.otBooks, `expected ${data.expect.otBooks} books, got ${count}`);
  });

  await check("a book opens its chapter grid", async () => {
    await page.click('[data-book="GEN"]');
    await page.waitForSelector(".chapter-grid", { timeout: 8000 });
    const h1 = await text(".page-head h1");
    assert(h1 === "Genesis", `heading was “${h1}”`);
    assert((await page.$$(".chapter-tile")).length >= 50, "chapters missing");
  });

  await check("a chapter opens its sermons", async () => {
    await page.click('[data-chapter="1"]');
    await page.waitForSelector(".verse-strip", { timeout: 8000 });
    assert((await page.$$(".row")).length > 3, "no rows for Genesis 1");
  });

  await check("topics list loads from the index", async () => {
    await page.click('[data-nav="topics"]');
    await page.waitForSelector(".pill-grid .pill", { timeout: 8000 });
    assert((await page.$$(".pill")).length >= 50, "topic pills missing");
  });

  await check("topic filter narrows the list", async () => {
    await page.type("#topic-filter", "revival");
    await sleep(300);
    const pills = await page.$$eval(".pill span", (els) => els.map((e) => e.textContent));
    assert(pills.length === 1 && pills[0] === "Revival", `filter returned ${JSON.stringify(pills)}`);
  });

  await check("topic page opens with its description and sermons", async () => {
    await page.click(".pill");
    await page.waitForSelector(".topic-desc", { timeout: 8000 });
    const h1 = await text(".page-head h1");
    assert(h1 === "Revival", `topic was “${h1}”`);
    assert((await page.$$(".row")).length > 5, "no sermons on the topic");
  });

  await check("preachers list shows portraits", async () => {
    await page.click('[data-nav="speakers"]');
    await page.waitForSelector(".speaker-grid .speaker-card", { timeout: 8000 });
    assert((await page.$$(".speaker-card")).length >= 20, "speaker cards missing");
  });

  await check("sidebar marks exactly one section active", async () => {
    const active = await page.$$eval(".nav-item.active", (els) => els.map((e) => e.dataset.nav));
    assert(active.length === 1, `active items: ${JSON.stringify(active)}`);
    assert(active[0] === "speakers", `active was ${active[0]}`);
  });

  await check("theme toggle switches to dark", async () => {
    await page.click("#theme-btn");
    await sleep(120);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(theme === "dark", `theme was ${theme}`);
  });

  await check("recently played recorded the sermon", async () => {
    await page.click('[data-nav="recent"]');
    await page.waitForSelector(".recent-row", { timeout: 5000 });
    assert((await page.$$(".recent-row")).length >= 1, "no recent rows");
  });

  await check("searching an unknown theme offers guidance", async () => {
    await page.click("#search");
    await page.type("#search", "zzzzunknown");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".note-card", { timeout: 8000 });
    const body = await text(".note-card");
    assert(/No theme or preacher matches/.test(body), "no fallback note");
    const active = await page.$$eval(".nav-item.active", (els) => els.map((e) => e.dataset.nav));
    assert(active.length === 1 && active[0] === "home", `active after search: ${JSON.stringify(active)}`);
  });

  await check("video overlay sizes to the window", async () => {
    const width = await page.evaluate(() => {
      document.querySelector("#video-overlay").classList.remove("hidden");
      const video = document.querySelector("#video");
      return parseFloat(getComputedStyle(video).width);
    });
    assert(width > 900, `video rendered ${width}px wide`);
    await page.evaluate(() => document.querySelector("#video-overlay").classList.add("hidden"));
  });

  await check("no console or page errors", async () => {
    assert(errors.length === 0, errors.slice(0, 3).join(" | "));
  });

  await page.screenshot({ path: path.join(process.env.TMPDIR || "/tmp", "netstudy-sermons-smoke.png") });

  await browser.close();
  server.close();

  console.log(`\n${pass} passed, ${failures.length} failed\n`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
