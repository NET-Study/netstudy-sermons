import {
  api,
  index as indexApi,
  local,
  parseReference,
  clock,
  compactNumber,
  durationSeconds,
  mediaLabel,
  type Book,
  type IndexItem,
  type Sermon,
  type Stats,
} from "./api";
import { Player, type PlayerState } from "./player";
import { listen } from "@tauri-apps/api/event";

// ---- types -----------------------------------------------------------------

type View =
  | { name: "home" }
  | { name: "scripture"; testament?: "OT" | "NT" }
  | { name: "book"; bookId: string }
  | { name: "chapter"; bookId: string; chapter: number; verse?: number }
  | { name: "topics" }
  | { name: "topic"; slug: string }
  | { name: "speakers" }
  | { name: "speaker"; slug: string; page?: number }
  | { name: "search"; query: string }
  | { name: "recent" }
  | { name: "sermon"; id: string };

interface Recent {
  id: string;
  title: string;
  speaker: string;
  speakerSlug: string;
  image: string;
  mediaType: string;
  duration: string;
  position: number;
  total: number;
  at: number;
}

interface Persisted {
  recents: Recent[];
  prefs: { theme: "auto" | "light" | "dark"; rate: number };
}

// ---- dom -------------------------------------------------------------------

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const content = $("#content");
const sidebar = $("#sidebar");
const crumbs = $("#crumbs");
const searchInput = $<HTMLInputElement>("#search");
const backBtn = $<HTMLButtonElement>("#back-btn");
const playerBar = $("#player");
const videoOverlay = $("#video-overlay");
const queuePop = $("#queue-pop");
const toastEl = $("#toast");

// ---- state -----------------------------------------------------------------

let view: View = { name: "home" };
let stack: View[] = [];
let books: Book[] = [];
let stats: Stats | null = null;
let topicIndex: IndexItem[] = [];
let speakerIndex: IndexItem[] = [];
let recents: Recent[] = [];
let prefs: Persisted["prefs"] = { theme: "auto", rate: 1 };
let sermonMap = new Map<string, Sermon>();
let playable: Sermon[] = [];
let limits: Record<string, number> = {};
let indexesReady = false;
let epoch = 0;

const player: Player = new Player($<HTMLAudioElement>("#audio"), $<HTMLVideoElement>("#video"), videoOverlay, {
  onChange: renderPlayer,
  getResume: (id) => recents.find((r) => r.id === id)?.position ?? 0,
  saveProgress: (sermon, position, total) => {
    if (!sermon) return;
    const entry: Recent = {
      id: sermon.id,
      title: sermon.title,
      speaker: sermon.speaker,
      speakerSlug: sermon.speakerSlug,
      image: sermon.thumbnailUrl || sermon.speakerImage || sermon.image || "",
      mediaType: sermon.mediaType,
      duration: sermon.duration,
      position,
      total,
      at: Date.now(),
    };
    recents = [entry, ...recents.filter((r) => r.id !== sermon.id)].slice(0, 80);
    scheduleSave();
    updateResumeUI(entry);
  },
});

// ---- persistence -----------------------------------------------------------

let saveTimer: number | undefined;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    local.save({ recents, prefs }).catch(() => undefined);
  }, 400);
}

async function loadState() {
  try {
    const state = (await local.load()) as Persisted | null;
    if (state) {
      recents = Array.isArray(state.recents) ? state.recents : [];
      if (state.prefs) prefs = { ...prefs, ...state.prefs };
    }
  } catch {
    /* first run */
  }
  applyTheme();
  player.setRate(prefs.rate || 1);
}

// ---- theme -----------------------------------------------------------------

const mq = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const dark = prefs.theme === "dark" || (prefs.theme === "auto" && mq.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
mq.addEventListener("change", () => {
  if (prefs.theme === "auto") applyTheme();
});

// ---- helpers ---------------------------------------------------------------

const esc = (text: string) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const plain = (html: string) =>
  String(html ?? "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function updateResumeUI(entry: Recent) {
  document.querySelectorAll<HTMLElement>(`[data-resume="${entry.id}"] .resume-track span`).forEach((bar) => {
    bar.style.width = `${entry.total ? Math.min(100, (entry.position / entry.total) * 100) : 0}%`;
  });
  const row = document.querySelector<HTMLElement>(`[data-resume="${entry.id}"] .resume-time`);
  if (row) row.textContent = `${clock(entry.position)}${entry.total ? ` / ${clock(entry.total)}` : ""}`;
}

function toast(message: string) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  window.setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function imageFor(sermon: Sermon): string {
  return sermon.thumbnailUrl || sermon.speakerImage || sermon.image || "";
}

function mediaBadge(sermon: Sermon): string {
  const type = sermon.mediaType === "VIDEO" ? "video" : sermon.mediaType === "TEXT" ? "text" : "audio";
  const glyph = type === "video" ? "▣" : type === "text" ? "¶" : "♪";
  return `<span class="badge ${type}">${glyph} ${mediaLabel(sermon)}</span>`;
}

function scriptureChips(sermon: Sermon): string {
  return (sermon.scripture || [])
    .slice(0, 4)
    .map((s) => {
      const text = s.text || `${s.book || s.bookId} ${s.chapter}:${s.verse}`;
      return `<button class="chip ghost" data-ref="${esc(text)}">${esc(text)}</button>`;
    })
    .join("");
}

function topicChips(sermon: Sermon): string {
  return (sermon.topics || [])
    .slice(0, 3)
    .map((t) => `<button class="chip" data-topic="${esc(t.slug)}">${esc(t.name)}</button>`)
    .join("");
}

function sermonRow(s: Sermon, compact = false): string {
  sermonMap.set(s.id, s);
  const img = imageFor(s);
  const playableRow = s.mediaType !== "TEXT";
  return `
  <article class="row${compact ? " compact" : ""}" data-id="${s.id}">
    <button class="row-play${playableRow ? "" : " disabled"}" data-play="${s.id}" title="${playableRow ? "Play" : "Text sermon"}">
      ${playableRow ? "▶" : "¶"}
    </button>
    ${img ? `<img class="row-art" src="${esc(img)}" alt="" loading="lazy" />` : `<div class="row-art placeholder">✧</div>`}
    <div class="row-body" data-sermon="${s.id}">
      <div class="row-top">
        <span class="row-title">${esc(s.title)}</span>
        ${mediaBadge(s)}
        ${s.duration ? `<span class="row-dur">${esc(s.duration)}</span>` : ""}
      </div>
      <div class="row-meta">
        <button class="link" data-speaker="${esc(s.speakerSlug)}">${esc(s.speaker)}</button>
        ${s.sermonType ? `<span class="dot">·</span><span>${esc(s.sermonType)}</span>` : ""}
      </div>
      ${s.summary ? `<p class="row-summary">${esc(s.summary)}</p>` : ""}
      <div class="row-chips">${topicChips(s)}${scriptureChips(s)}</div>
    </div>
  </article>`;
}

function cardGrid(sermons: Sermon[]): string {
  return `<div class="card-grid">${sermons
    .map((s) => {
      sermonMap.set(s.id, s);
      const img = imageFor(s);
      const playableCard = s.mediaType !== "TEXT";
      return `
      <article class="card">
        <button class="card-art" data-play="${s.id}">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" />` : `<span class="placeholder">✧</span>`}
          <span class="card-play">${playableCard ? "▶" : "¶"}</span>
          ${s.duration ? `<span class="card-dur">${esc(s.duration)}</span>` : ""}
        </button>
        <div class="card-body" data-sermon="${s.id}">
          <div class="card-title">${esc(s.title)}</div>
          <div class="card-speaker">${esc(s.speaker)}</div>
          <div class="card-foot">${mediaBadge(s)}${topicChips(s)}</div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function listBlock(key: string, sermons: Sermon[], step = 80): string {
  const shown = limits[key] ?? step;
  return `<div class="list">${sermons.slice(0, shown).map((s) => sermonRow(s)).join("")}</div>
    ${
      sermons.length > shown
        ? `<button class="load-more" data-more="${key}">Show ${Math.min(step, sermons.length - shown)} more <span>${sermons.length - shown} remaining</span></button>`
        : sermons.length
          ? `<div class="list-end">End of ${sermons.length.toLocaleString()} ${sermons.length === 1 ? "sermon" : "sermons"}</div>`
          : ""
    }`;
}

function skeleton(count = 6): string {
  return `<div class="list">${Array.from({ length: count })
    .map(
      () => `<div class="row skeleton-row"><div class="skeleton sq"></div><div class="sk-body"><div class="skeleton line w60"></div><div class="skeleton line w30"></div><div class="skeleton line w80"></div></div></div>`,
    )
    .join("")}</div>`;
}

function errorBlock(message: string, retry = true): string {
  return `<div class="error-block"><div class="error-mark">✕</div><h3>That did not come through</h3><p>${esc(message)}</p>${
    retry ? `<button class="soft-btn" data-retry="1">Try again</button>` : ""
  }</div>`;
}

// ---- routing ---------------------------------------------------------------

function navigate(next: View) {
  stack.push(view);
  view = next;
  limits = {};
  render(true);
}

function goBack() {
  const prev = stack.pop();
  if (!prev) return;
  view = prev;
  render(true);
}

function setCrumbs(parts: { label: string; view?: View }[]) {
  crumbs.innerHTML = parts
    .map((p) =>
      p.view
        ? `<button class="crumb" data-goto='${JSON.stringify(p.view)}'>${esc(p.label)}</button>`
        : `<span class="crumb current">${esc(p.label)}</span>`,
    )
    .join(`<span class="crumb-sep">/</span>`);
}

function setActiveNav(name: string) {
  sidebar.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === name);
  });
}

// ---- views -----------------------------------------------------------------

async function render(scroll = false) {
  const myEpoch = ++epoch;
  backBtn.disabled = stack.length === 0;
  if (scroll) content.scrollTop = 0;

  const navFor: Record<string, string> = {
    home: "home",
    scripture: "scripture",
    book: "scripture",
    chapter: "scripture",
    topics: "topics",
    topic: "topics",
    speakers: "speakers",
    speaker: "speakers",
    search: "home",
    recent: "recent",
    sermon: "",
  };
  setActiveNav(navFor[view.name] ?? "");

  try {
    switch (view.name) {
      case "home":
        setCrumbs([{ label: "Home" }]);
        await viewHome(myEpoch);
        break;
      case "scripture":
        setCrumbs([{ label: "Scripture" }]);
        await viewScripture(myEpoch);
        break;
      case "book":
        setCrumbs([{ label: "Scripture", view: { name: "scripture" } }, { label: bookName(view.bookId) }]);
        await viewBook(myEpoch);
        break;
      case "chapter": {
        const ref = `${bookName(view.bookId)} ${view.chapter}${view.verse ? `:${view.verse}` : ""}`;
        setCrumbs([
          { label: "Scripture", view: { name: "scripture" } },
          { label: bookName(view.bookId), view: { name: "book", bookId: view.bookId } },
          { label: ref },
        ]);
        await viewChapter(myEpoch);
        break;
      }
      case "topics":
        setCrumbs([{ label: "Topics" }]);
        await viewTopics(myEpoch);
        break;
      case "topic":
        setCrumbs([{ label: "Topics", view: { name: "topics" } }, { label: view.slug.replace(/-/g, " ") }]);
        await viewTopic(myEpoch);
        break;
      case "speakers":
        setCrumbs([{ label: "Preachers" }]);
        await viewSpeakers(myEpoch);
        break;
      case "speaker":
        setCrumbs([{ label: "Preachers", view: { name: "speakers" } }, { label: view.slug.replace(/-/g, " ") }]);
        await viewSpeaker(myEpoch);
        break;
      case "search":
        setCrumbs([{ label: "Search", view: { name: "home" } }, { label: `“${view.query}”` }]);
        await viewSearch(myEpoch);
        break;
      case "recent":
        setCrumbs([{ label: "Recently played" }]);
        viewRecent();
        break;
      case "sermon":
        setCrumbs([{ label: "Sermon" }]);
        await viewSermon(myEpoch);
        break;
    }
  } catch (err) {
    if (myEpoch !== epoch) return;
    content.innerHTML = errorBlock(String(err));
  }
}

function bookName(bookId: string): string {
  return books.find((b) => b.bookId === bookId)?.name ?? bookId;
}

async function ensureBooks() {
  if (books.length) return books;
  const data = await api.books();
  books = data.books.slice().sort((a, b) => a.order - b.order);
  return books;
}

async function viewHome(myEpoch: number) {
  if (!stats) {
    stats = await api.stats().catch(() => null);
  }
  if (myEpoch !== epoch) return;
  if (stats) {
    const counts = document.querySelector("#library-counts");
    if (counts) counts.textContent = `${stats.sermons.toLocaleString()} sermons · ${stats.speakers.toLocaleString()} preachers`;
  }
  const popular = await api.popular().catch(() => ({ sermons: [] as Sermon[] }));
  if (myEpoch !== epoch) return;

  const resume = recents.slice(0, 5);
  content.innerHTML = `
    <section class="hero">
      <div class="hero-glow"></div>
      <svg class="hero-rings" viewBox="0 0 300 300" fill="none" aria-hidden="true">
        <g stroke="#C9A227" stroke-linecap="round">
          <circle cx="150" cy="150" r="112" stroke-width="1" opacity="0.22" />
          <circle cx="150" cy="150" r="86" stroke-width="1" opacity="0.28" />
          <circle cx="150" cy="150" r="60" stroke-width="1.6" opacity="0.4" />
          <circle cx="150" cy="150" r="34" stroke-width="2" opacity="0.55" />
        </g>
        <path d="M150 128 L172 150 L150 172 Z" fill="#C9A227" opacity="0.75" />
        <g stroke="#C9A227" stroke-linecap="round" opacity="0.35">
          <path d="M62 96 a96 96 0 0 0 0 108" stroke-width="1.5" />
          <path d="M238 96 a96 96 0 0 1 0 108" stroke-width="1.5" />
        </g>
      </svg>
      <div class="hero-inner">
        <div class="eyebrow">Trusted preaching, freely given</div>
        <h1>The whole archive,<br/><em>one quiet room.</em></h1>
        <p class="hero-copy">Search ${stats ? stats.sermons.toLocaleString() : "seventy thousand"} sermons by verse, theme or preacher, and listen without leaving the page.</p>
        <div class="hero-stats">
          <div><strong>${stats ? stats.sermons.toLocaleString() : "70,419"}</strong><span>sermons</span></div>
          <div><strong>${stats ? stats.speakers.toLocaleString() : "2,211"}</strong><span>preachers</span></div>
          <div><strong>${stats ? stats.topics.toLocaleString() : "14,087"}</strong><span>themes</span></div>
        </div>
        <div class="hero-suggest">
          <span>Try</span>
          <button class="chip" data-ref="John 3:16">John 3:16</button>
          <button class="chip" data-ref="Romans 8">Romans 8</button>
          <button class="chip" data-topic="revival">Revival</button>
          <button class="chip" data-speaker="leonard-ravenhill">Leonard Ravenhill</button>
        </div>
      </div>
    </section>

    ${
      resume.length
        ? `<section class="block">
            <div class="block-head"><h2>Continue listening</h2><button class="link" data-goto='{"name":"recent"}'>All recent</button></div>
            ${resume
              .map(
                (r) => `
              <button class="resume-row" data-resume="${r.id}">
                ${r.image ? `<img src="${esc(r.image)}" alt=""/>` : `<span class="placeholder">✧</span>`}
                <div class="resume-body">
                  <div class="resume-title">${esc(r.title)}</div>
                  <div class="resume-sub">${esc(r.speaker)}</div>
                  ${r.position > 1 ? `<div class="resume-track"><span style="width:${r.total ? Math.min(100, (r.position / r.total) * 100) : 0}%"></span></div>` : ""}
                </div>
                <div class="resume-time">${clock(r.position)}${r.total ? ` / ${clock(r.total)}` : ""}</div>
              </button>`,
              )
              .join("")}
          </section>`
        : ""
    }

    <section class="block">
      <div class="block-head"><h2>Most listened</h2><span class="block-sub">The 500 most played in the library</span></div>
      ${popular.sermons.length ? cardGrid(popular.sermons.slice(0, 18)) : skeleton(4)}
      ${popular.sermons.length ? `<button class="load-more" data-popular-more="1">Show more from the top 500</button>` : ""}
    </section>

    <section class="block browse">
      <div class="tile" data-goto='{"name":"scripture"}'>
        <div class="tile-glyph">✧</div>
        <h3>By scripture</h3>
        <p>Every book, chapter and verse, with the sermons that open it.</p>
      </div>
      <div class="tile" data-goto='{"name":"topics"}'>
        <div class="tile-glyph">❖</div>
        <h3>By theme</h3>
        <p>${stats ? stats.topics.toLocaleString() : "14,087"} topics from prayer to revival.</p>
      </div>
      <div class="tile" data-goto='{"name":"speakers"}'>
        <div class="tile-glyph">☗</div>
        <h3>By preacher</h3>
        <p>${stats ? stats.speakers.toLocaleString() : "2,211"} men and their full catalogues.</p>
      </div>
    </section>
  `;
  playable = popular.sermons;
}

async function viewScripture(myEpoch: number) {
  await ensureBooks();
  if (myEpoch !== epoch) return;
  const testament = (view as { testament?: "OT" | "NT" }).testament ?? "OT";
  const list = books.filter((b) => b.testament === testament);
  const max = Math.max(...books.map((b) => b.sermonCount), 1);

  content.innerHTML = `
    <div class="page-head">
      <h1>Scripture</h1>
      <div class="segmented">
        <button data-testament="OT" class="${testament === "OT" ? "on" : ""}">Old Testament</button>
        <button data-testament="NT" class="${testament === "NT" ? "on" : ""}">New Testament</button>
      </div>
    </div>
    <div class="book-grid">
      ${list
        .map(
          (b) => `
        <button class="book-tile" data-book="${b.bookId}">
          <span class="book-name">${esc(b.name)}</span>
          <span class="book-count">${compactNumber(b.sermonCount)}</span>
          <span class="book-heat" style="width:${Math.max(4, (b.sermonCount / max) * 100)}%"></span>
        </button>`,
        )
        .join("")}
    </div>
    <p class="foot-note">Counts are sermons that cite at least one verse in the book.</p>
  `;
}

async function viewBook(myEpoch: number) {
  const { bookId } = view as { bookId: string };
  const [data, all] = await Promise.all([api.book(bookId), ensureBooks()]);
  if (myEpoch !== epoch) return;
  const book = all.find((b) => b.bookId === bookId);
  const chapters = data.chaptersWithSermons || [];
  const max = Math.max(...chapters.map((c) => c.sermonCount), 1);
  content.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${book?.testament === "NT" ? "New Testament" : "Old Testament"}</div>
        <h1>${esc(data.name || book?.name || bookId)}</h1>
      </div>
      <div class="head-stat"><strong>${(book?.sermonCount ?? 0).toLocaleString()}</strong><span>sermons</span></div>
    </div>
    <div class="chapter-grid">
      ${chapters
        .map(
          (c) => `
        <button class="chapter-tile" data-chapter="${c.chapter}" style="--heat:${Math.max(0.06, c.sermonCount / max)}">
          <span class="chapter-num">${c.chapter}</span>
          <span class="chapter-count">${c.sermonCount.toLocaleString()}</span>
        </button>`,
        )
        .join("")}
    </div>
  `;
}

async function viewChapter(myEpoch: number) {
  const { bookId, chapter, verse } = view as { bookId: string; chapter: number; verse?: number };
  if (verse) {
    const data = await api.verse(bookId, chapter, verse);
    if (myEpoch !== epoch) return;
    playable = data.sermons;
    content.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Scripture</div><h1>${esc(data.reference)}</h1></div>
        <div class="head-stat"><strong>${data.sermonCount.toLocaleString()}</strong><span>sermons</span></div>
      </div>
      <div class="head-actions"><button class="soft-btn" data-chapter="${chapter}">All of ${esc(bookName(bookId))} ${chapter}</button></div>
      ${listBlock(`v-${bookId}-${chapter}-${verse}`, data.sermons)}
    `;
    return;
  }
  const data = await api.chapter(bookId, chapter);
  if (myEpoch !== epoch) return;
  playable = data.sermons;
  const verses = (data.verses || []).filter((v) => v.sermonCount > 0);
  const max = Math.max(...verses.map((v) => v.sermonCount), 1);
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Scripture</div><h1>${esc(data.reference)}</h1></div>
      <div class="head-stat"><strong>${data.sermonCount.toLocaleString()}</strong><span>sermons</span></div>
    </div>
    ${
      verses.length
        ? `<div class="verse-strip">${verses
            .map(
              (v) =>
                `<button class="verse-chip" data-verse="${v.verse}" style="--heat:${Math.max(0.08, v.sermonCount / max)}" title="${v.sermonCount} sermons"><span>${v.verse}</span><em>${compactNumber(v.sermonCount)}</em></button>`,
            )
            .join("")}</div>`
        : ""
    }
    ${listBlock(`c-${bookId}-${chapter}`, data.sermons)}
  `;
}

async function ensureIndexes(): Promise<boolean> {
  if (indexesReady) return true;
  const state = await indexApi.state();
  if (state.ready) {
    indexesReady = true;
  }
  return indexesReady;
}

async function loadIndex(name: "topics" | "speakers") {
  const data = await indexApi.get(name);
  return data.items;
}

async function viewTopics(myEpoch: number) {
  if (!topicIndex.length) {
    const ready = await ensureIndexes();
    if (ready) topicIndex = await loadIndex("topics");
  }
  if (myEpoch !== epoch) return;
  const top = topicIndex.length
    ? topicIndex.slice().sort((a, b) => b.count - a.count)
    : [];
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Themes</div><h1>Topics</h1></div>
      <div class="head-stat"><strong>${topicIndex.length ? topicIndex.length.toLocaleString() : "—"}</strong><span>themes</span></div>
    </div>
    <div class="filter-bar"><input id="topic-filter" placeholder="Filter ${topicIndex.length ? topicIndex.length.toLocaleString() : ""} themes…" spellcheck="false"/></div>
    <div id="topic-list" class="pill-grid">${top
      .slice(0, 300)
      .map(
        (t) => `<button class="pill" data-topic="${esc(t.slug)}"><span>${esc(t.name)}</span><em>${compactNumber(t.count)}</em></button>`,
      )
      .join("")}</div>
    ${!topicIndex.length ? `<div class="note-card">${indexesReady ? "The theme index is empty. Try rebuilding it from Settings." : "Building the theme index, one moment…"}</div>` : ""}
  `;
  const filter = $<HTMLInputElement>("#topic-filter");
  const list = $("#topic-list");
  if (!filter || !list) return;
  let timer: number | undefined;
  filter.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const q = filter.value.trim().toLowerCase();
      const results = q
        ? top.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 300)
        : top.slice(0, 300);
      list.innerHTML = results
        .map((t) => `<button class="pill" data-topic="${esc(t.slug)}"><span>${esc(t.name)}</span><em>${compactNumber(t.count)}</em></button>`)
        .join("");
      if (!results.length) list.innerHTML = `<div class="note-card">No theme matches “${esc(q)}”.</div>`;
    }, 120);
  });
}

async function viewSpeakers(myEpoch: number) {
  if (!speakerIndex.length) {
    const ready = await ensureIndexes();
    if (ready) speakerIndex = await loadIndex("speakers");
  }
  if (myEpoch !== epoch) return;
  const all = speakerIndex.slice().sort((a, b) => b.count - a.count);
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">The men behind the messages</div><h1>Preachers</h1></div>
      <div class="head-stat"><strong>${speakerIndex.length ? speakerIndex.length.toLocaleString() : "—"}</strong><span>preachers</span></div>
    </div>
    <div class="filter-bar"><input id="speaker-filter" placeholder="Filter preachers…" spellcheck="false"/></div>
    <div id="speaker-list" class="speaker-grid">${speakerCards(all.slice(0, 120))}</div>
  `;
  const filter = $<HTMLInputElement>("#speaker-filter");
  const list = $("#speaker-list");
  if (!filter || !list) return;
  let timer: number | undefined;
  filter.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const q = filter.value.trim().toLowerCase();
      const results = q ? all.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 200) : all.slice(0, 120);
      list.innerHTML = speakerCards(results);
    }, 120);
  });
}

function speakerCards(items: IndexItem[]): string {
  return items
    .map(
      (s) => `
    <button class="speaker-card" data-speaker="${esc(s.slug)}">
      ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy"/>` : `<span class="placeholder">✧</span>`}
      <div class="speaker-name">${esc(s.name)}</div>
      <div class="speaker-count">${s.count.toLocaleString()} sermons</div>
    </button>`,
    )
    .join("");
}

async function viewTopic(myEpoch: number) {
  const data = await api.topic((view as { slug: string }).slug);
  if (myEpoch !== epoch) return;
  playable = data.sermons || [];
  const count = Number(data.sermonCount) || playable.length;
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Theme</div><h1>${esc(data.name)}</h1></div>
      <div class="head-stat"><strong>${count.toLocaleString()}</strong><span>sermons</span></div>
    </div>
    ${data.description ? `<p class="topic-desc">${esc(plain(data.description))}</p>` : ""}
    ${
      data.topScriptures?.length
        ? `<div class="row-chips big">${data.topScriptures
            .slice(0, 8)
            .map((s) => `<button class="chip" data-ref="${esc(s.text)}">${esc(s.text)} <em>${s.count}</em></button>`)
            .join("")}</div>`
        : ""
    }
    <div class="head-actions">
      <button class="primary-btn" data-play="${playable[0]?.id ?? ""}" ${playable.length ? "" : "disabled"}>▶ Play the first</button>
    </div>
    ${listBlock(`t-${data.slug}`, playable)}
  `;
}

async function viewSpeaker(myEpoch: number) {
  const v = view as { slug: string; page?: number };
  if (v.page && v.page > 1) {
    const page = await api.speakerPage(v.slug, v.page);
    if (myEpoch !== epoch) return;
    playable = page.sermons;
    content.innerHTML = `
      <button class="crumb inline" data-speaker="${esc(v.slug)}">‹ Back to ${esc(v.slug.replace(/-/g, " "))}</button>
      <h2 class="section-title">Page ${page.page} of ${page.totalPages}</h2>
      ${listBlock(`s-${v.slug}-${v.page}`, page.sermons, 50)}
      <div class="pager">
        ${page.page > 1 ? `<button class="soft-btn" data-speaker-page="${page.page - 1}">Previous</button>` : ""}
        <span>${page.page} / ${page.totalPages}</span>
        ${page.page < page.totalPages ? `<button class="soft-btn" data-speaker-page="${page.page + 1}">Next</button>` : ""}
      </div>
    `;
    return;
  }

  const data = await api.speaker(v.slug);
  if (myEpoch !== epoch) return;
  let sermons = data.sermons || [];
  let total = Number(data.sermonCount) || sermons.length;
  if (total > sermons.length) {
    try {
      const first = await api.speakerPage(v.slug, 1);
      if (myEpoch !== epoch) return;
      sermons = first.sermons;
      total = Number(first.total) || total;
    } catch {
      /* the full response is still usable */
    }
  }
  playable = sermons;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  content.innerHTML = `
    <section class="speaker-hero">
      ${data.image ? `<img class="speaker-portrait" src="${esc(data.image)}" alt=""/>` : `<div class="speaker-portrait placeholder">✧</div>`}
      <div class="speaker-hero-body">
        <div class="eyebrow">Preacher</div>
        <h1>${esc(data.name)}</h1>
        <div class="speaker-meta">${total.toLocaleString()} sermons${data.bio ? "" : ""}</div>
        ${data.bio ? `<p class="speaker-bio">${esc(plain(data.bio))}</p>` : ""}
        <div class="head-actions">
          <button class="primary-btn" data-play="${sermons[0]?.id ?? ""}" ${sermons.length ? "" : "disabled"}>▶ Play the first</button>
          ${data.url ? `<button class="soft-btn" data-external="${esc(data.url)}">On SermonIndex</button>` : ""}
        </div>
      </div>
    </section>
    ${listBlock(`sp-${data.slug}`, sermons, 50)}
    ${
      totalPages > 1
        ? `<div class="pager"><span>Page 1 of ${totalPages}</span><button class="soft-btn" data-speaker-page="2">Next 50 →</button></div>`
        : ""
    }
  `;
}

async function viewSearch(myEpoch: number) {
  const query = (view as { query: string }).query.trim();
  const ref = parseReference(query);
  if (ref) {
    if (ref.chapter) {
      view = { name: "chapter", bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse };
      await render(true);
      return;
    }
    view = { name: "book", bookId: ref.bookId };
    await render(true);
    return;
  }

  const ready = await ensureIndexes();
  if (ready) {
    if (!topicIndex.length) topicIndex = await loadIndex("topics");
    if (!speakerIndex.length) speakerIndex = await loadIndex("speakers");
  }
  if (myEpoch !== epoch) return;

  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const score = (name: string) => {
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    if (tokens.every((t) => n.includes(t))) return 3;
    return 99;
  };

  const topics = topicIndex
    .map((t) => ({ t, s: score(t.name) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || b.t.count - a.t.count)
    .slice(0, 12)
    .map((x) => x.t);

  const speakers = speakerIndex
    .map((s) => ({ s, n: score(s.name) }))
    .filter((x) => x.n < 99)
    .sort((a, b) => a.n - b.n || b.s.count - a.s.count)
    .slice(0, 12)
    .map((x) => x.s);

  content.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Search</div><h1>“${esc(query)}”</h1></div></div>
    ${
      topics.length
        ? `<section class="block"><div class="block-head"><h2>Themes</h2></div><div class="pill-grid">${topics
            .map((t) => `<button class="pill" data-topic="${esc(t.slug)}"><span>${esc(t.name)}</span><em>${compactNumber(t.count)}</em></button>`)
            .join("")}</div></section>`
        : ""
    }
    ${
      speakers.length
        ? `<section class="block"><div class="block-head"><h2>Preachers</h2></div><div class="speaker-grid">${speakerCards(speakers)}</div></section>`
        : ""
    }
    ${
      !topics.length && !speakers.length
        ? `<div class="note-card">
            <h3>No theme or preacher matches that.</h3>
            <p>Scripture references work too, in almost any form: <button class="chip" data-ref="psalm 23">Psalm 23</button> <button class="chip" data-ref="1 cor 13">1 Corinthians 13</button> <button class="chip" data-ref="jn 3 16">John 3:16</button></p>
            <p class="muted">Sermon titles and transcripts are not full-text searchable here yet; SermonIndex does not expose a text search endpoint.</p>
          </div>`
        : ""
    }
  `;
}

function viewRecent() {
  const rows = recents
    .map((r) => {
      const pct = r.total ? Math.min(100, (r.position / r.total) * 100) : 0;
      return `
      <article class="row recent-row" data-id="${r.id}">
        <button class="row-play" data-resume="${r.id}">▶</button>
        ${r.image ? `<img class="row-art" src="${esc(r.image)}" alt="" loading="lazy"/>` : `<div class="row-art placeholder">✧</div>`}
        <div class="row-body">
          <div class="row-top"><span class="row-title">${esc(r.title)}</span><span class="row-dur">${clock(r.position)} / ${clock(r.total)}</span></div>
          <div class="row-meta"><button class="link" data-speaker="${esc(r.speakerSlug)}">${esc(r.speaker)}</button></div>
          <div class="resume-track"><span style="width:${pct}%"></span></div>
        </div>
      </article>`;
    })
    .join("");
  content.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Your history</div><h1>Recently played</h1></div>
      <div class="head-stat"><strong>${recents.length}</strong><span>messages</span></div></div>
    ${recents.length ? `<div class="list">${rows}</div>` : `<div class="note-card"><h3>Nothing played yet</h3><p>Start with <button class="chip" data-ref="Romans 8">Romans 8</button> or <button class="chip" data-topic="revival">Revival</button>.</p></div>`}
  `;
}

async function viewSermon(myEpoch: number) {
  const id = (view as { id: string }).id;
  const data = await api.sermon(id);
  if (myEpoch !== epoch) return;
  sermonMap.set(id, data);
  const transcript = plain((data as unknown as { transcriptText?: string }).transcriptText || "");
  playable = [data];

  content.innerHTML = `
    <article class="sermon-detail">
      <div class="eyebrow">${mediaLabel(data)} sermon</div>
      <h1>${esc(data.title)}</h1>
      <div class="detail-meta">
        <button class="link big" data-speaker="${esc(data.speakerSlug)}">${esc(data.speaker)}</button>
        ${data.duration ? `<span>·</span><span>${esc(data.duration)}</span>` : ""}
        ${data.sermonType ? `<span>·</span><span>${esc(data.sermonType)}</span>` : ""}
      </div>
      <div class="head-actions">
        ${data.mediaType !== "TEXT" ? `<button class="primary-btn" data-play="${data.id}">▶ Listen</button>` : ""}
        ${data.mp4Url || data.videoUrl ? `<button class="soft-btn" data-watch="${data.id}">▣ Watch</button>` : ""}
        ${data.pdfUrl ? `<button class="soft-btn" data-external="${esc(data.pdfUrl)}">PDF</button>` : ""}
        ${data.url ? `<button class="soft-btn" data-external="${esc(data.url)}">On SermonIndex</button>` : ""}
      </div>
      ${data.summary ? `<p class="detail-summary">${esc(data.summary)}</p>` : ""}
      ${
        data.description && data.description !== data.summary
          ? `<p class="detail-desc">${esc(plain(data.description))}</p>`
          : ""
      }
      <div class="detail-chips">${topicChips(data)}${scriptureChips(data)}</div>
      ${
        transcript
          ? `<details class="transcript"><summary>Transcript</summary><div class="transcript-body">${esc(transcript)
              .split(/\n{2,}/)
              .map((p) => `<p>${p}</p>`)
              .join("")}</div></details>`
          : data.hasTranscript
            ? `<p class="muted">A transcript exists on SermonIndex but was not included in this record.</p>`
            : ""
      }
    </article>
  `;
}

// ---- player bar ------------------------------------------------------------

let scrubbing = false;

function renderPlayer(state: PlayerState = player.state) {
  if (!state.sermon) {
    playerBar.classList.add("hidden");
    return;
  }
  playerBar.classList.remove("hidden");
  $("#np-title").textContent = state.sermon.title;
  $("#np-sub").textContent = `${state.sermon.speaker}${state.sermon.duration ? ` · ${state.sermon.duration}` : ""}`;
  const art = imageFor(state.sermon);
  const artBtn = $("#np-art");
  artBtn.innerHTML = art ? `<img src="${esc(art)}" alt=""/>` : `<span>✧</span>`;
  $<HTMLButtonElement>("#play-btn").textContent = state.playing ? "❙❙" : "▶";
  $("#cur-time").textContent = clock(state.position);
  $("#dur-time").textContent = clock(state.duration || durationSeconds(state.sermon.duration));
  const pct = state.duration ? (state.position / state.duration) * 100 : 0;
  $("#track-fill").setAttribute("style", `width:${Math.min(100, pct)}%`);
  $("#track-knob").setAttribute("style", `left:${Math.min(100, pct)}%`);
  $("#rate-btn").textContent = `${state.rate}×`;
  const videoBtn = $("#video-btn");
  const hasVideo = !!(state.sermon.mp4Url || state.sermon.videoUrl);
  videoBtn.classList.toggle("hidden", !hasVideo);
  videoBtn.classList.toggle("on", state.videoOpen);
  $("#player").classList.toggle("buffering", state.buffering);
  if (state.videoOpen && videoOverlay.classList.contains("hidden")) videoOverlay.classList.remove("hidden");
  if (!state.videoOpen && !videoOverlay.classList.contains("hidden")) videoOverlay.classList.add("hidden");
}

function renderQueue() {
  const state = player.state;
  if (!state.queue.length) {
    queuePop.innerHTML = `<div class="queue-empty">Nothing queued.</div>`;
    return;
  }
  queuePop.innerHTML = `
    <div class="queue-head">Queue · ${state.queueIndex + 1} of ${state.queue.length}</div>
    <div class="queue-list">
      ${state.queue
        .map(
          (s, i) => `
        <button class="queue-item ${i === state.queueIndex ? "on" : ""}" data-queue="${i}">
          <span class="queue-i">${i + 1}</span>
          <span class="queue-title">${esc(s.title)}</span>
          <span class="queue-speaker">${esc(s.speaker)}</span>
        </button>`,
        )
        .join("")}
    </div>`;
}

// ---- events ----------------------------------------------------------------

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-play],[data-sermon],[data-resume],[data-ref],[data-topic],[data-speaker],[data-book],[data-chapter],[data-verse],[data-goto],[data-external],[data-more],[data-testament],[data-speaker-page],[data-queue],[data-watch],[data-retry],[data-popular-more]",
  );
  if (!target) return;

  const d = target.dataset;

  if (d.ref !== undefined) {
    const ref = parseReference(d.ref);
    if (!ref) return;
    if (ref.chapter) navigate({ name: "chapter", bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse });
    else navigate({ name: "book", bookId: ref.bookId });
    return;
  }
  if (d.play !== undefined) {
    const sermon = sermonMap.get(d.play);
    if (!sermon) return;
    if (sermon.mediaType === "TEXT") {
      navigate({ name: "sermon", id: sermon.id });
      return;
    }
    player.playSermon(sermon, playable.length ? playable : undefined);
    return;
  }
  if (d.watch !== undefined) {
    const sermon = sermonMap.get(d.watch);
    if (!sermon) return;
    player.playSermon(sermon, playable.length ? playable : undefined);
    player.openVideo();
    return;
  }
  if (d.resume !== undefined) {
    const entry = recents.find((r) => r.id === d.resume);
    if (!entry) return;
    const sermon = sermonMap.get(entry.id);
    if (sermon) {
      player.playSermon(sermon);
      return;
    }
    api
      .sermon(entry.id)
      .then((s) => {
        sermonMap.set(s.id, s);
        player.playSermon(s);
      })
      .catch(() => toast("Could not load that sermon."));
    return;
  }
  if (d.sermon !== undefined) {
    navigate({ name: "sermon", id: d.sermon });
    return;
  }
  if (d.topic !== undefined) {
    navigate({ name: "topic", slug: d.topic });
    return;
  }
  if (d.speaker !== undefined) {
    navigate({ name: "speaker", slug: d.speaker });
    return;
  }
  if (d.book !== undefined) {
    navigate({ name: "book", bookId: d.book });
    return;
  }
  if (d.chapter !== undefined) {
    const bookId = (view as { bookId?: string }).bookId ?? "";
    navigate({ name: "chapter", bookId, chapter: Number(d.chapter) });
    return;
  }
  if (d.verse !== undefined) {
    const v = view as { bookId: string; chapter: number };
    navigate({ name: "chapter", bookId: v.bookId, chapter: v.chapter, verse: Number(d.verse) });
    return;
  }
  if (d.testament !== undefined) {
    (view as { testament?: string }).testament = d.testament as "OT" | "NT";
    render();
    return;
  }
  if (d.speakerPage !== undefined) {
    const v = view as { slug: string };
    navigate({ name: "speaker", slug: v.slug, page: Number(d.speakerPage) });
    return;
  }
  if (d.queue !== undefined) {
    player.jumpTo(Number(d.queue));
    queuePop.classList.add("hidden");
    return;
  }
  if (d.more !== undefined) {
    const key = d.more;
    limits[key] = (limits[key] ?? 80) + 80;
    render();
    return;
  }
  if (d.popularMore !== undefined) {
    const grid = content.querySelector(".card-grid");
    if (grid) {
      const more = (grid.children.length || 18) + 24;
      api.popular().then((data) => {
        playable = data.sermons;
        grid.outerHTML = cardGrid(data.sermons.slice(0, more));
        if (more >= data.sermons.length) (target as HTMLElement).remove();
      });
    }
    return;
  }
  if (d.goto !== undefined) {
    navigate(JSON.parse(d.goto) as View);
    return;
  }
  if (d.external !== undefined) {
    local.openUrl(d.external).catch(() => toast("Could not open the link."));
    return;
  }
  if (d.retry !== undefined) {
    render();
    return;
  }
});

backBtn.addEventListener("click", goBack);

const NAV_VIEWS: Record<string, View> = {
  home: { name: "home" },
  scripture: { name: "scripture" },
  topics: { name: "topics" },
  speakers: { name: "speakers" },
  recent: { name: "recent" },
};

sidebar.addEventListener("click", (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>("[data-nav]");
  if (!item?.dataset.nav) return;
  const target = NAV_VIEWS[item.dataset.nav];
  if (target) navigate(target);
});

$("#theme-btn").addEventListener("click", () => {
  prefs.theme = prefs.theme === "auto" ? "dark" : prefs.theme === "dark" ? "light" : "auto";
  applyTheme();
  scheduleSave();
  toast(`Appearance: ${prefs.theme}`);
});

$("#attribution").addEventListener("click", (e) => {
  e.preventDefault();
  local.openUrl("https://www.sermonindex.net").catch(() => undefined);
});

$("#play-btn").addEventListener("click", () => player.toggle());
$("#prev-btn").addEventListener("click", () => player.previous());
$("#next-btn").addEventListener("click", () => player.next());
$("#back15").addEventListener("click", () => player.seekBy(-15));
$("#fwd15").addEventListener("click", () => player.seekBy(30));
$("#video-btn").addEventListener("click", () => {
  if (player.state.videoOpen) player.closeVideo();
  else player.openVideo();
});
$("#video-close").addEventListener("click", () => player.closeVideo());
$("#np-art").addEventListener("click", () => {
  const s = player.currentSermon;
  if (s) navigate({ name: "sermon", id: s.id });
});
$("#rate-btn").addEventListener("click", () => {
  const steps = [1, 1.25, 1.5, 1.75, 2, 0.75, 0.5];
  const next = steps[(steps.indexOf(prefs.rate) + 1) % steps.length];
  prefs.rate = next;
  player.setRate(next);
  scheduleSave();
});
$("#queue-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  renderQueue();
  queuePop.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!queuePop.contains(e.target as Node) && !(e.target as HTMLElement).closest("#queue-btn")) {
    queuePop.classList.add("hidden");
  }
});

const track = $("#track");
function scrubFrom(event: MouseEvent) {
  const rect = track.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  player.seekTo(fraction);
}
track.addEventListener("pointerdown", (event) => {
  scrubbing = true;
  track.setPointerCapture(event.pointerId);
  scrubFrom(event);
});
track.addEventListener("pointermove", (event) => {
  if (scrubbing) scrubFrom(event);
});
track.addEventListener("pointerup", () => {
  scrubbing = false;
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const q = searchInput.value.trim();
    if (!q) return;
    navigate({ name: "search", query: q });
    searchInput.blur();
  }
  if (event.key === "Escape") {
    searchInput.blur();
    (searchInput as HTMLInputElement).value = "";
  }
});

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (typing) return;
  if (event.key === " ") {
    event.preventDefault();
    player.toggle();
  } else if (event.key === "ArrowRight" && event.metaKey) {
    player.next();
  } else if (event.key === "ArrowLeft" && event.metaKey) {
    player.previous();
  } else if (event.key === "Escape") {
    if (!videoOverlay.classList.contains("hidden")) player.closeVideo();
  }
});

// ---- boot ------------------------------------------------------------------

async function boot() {
  await loadState();
  render();

  // Books, stats and indexes are loaded in the background so the window is
  // usable straight away.
  ensureBooks().catch(() => undefined);

  try {
    const state = await indexApi.state();
    if (!state.ready) {
      await buildIndexesWithProgress();
    }
  } catch {
    /* offline on first run; the views explain what is missing */
  }
}

async function buildIndexesWithProgress() {
  toast("Indexing themes and preachers, one time only…");
  try {
    await indexApi.build(false);
    indexesReady = true;
    if (view.name === "topics" || view.name === "speakers" || view.name === "search") render();
  } catch {
    toast("Index build failed. Check your connection.");
  }
}

listen<{ stage: string; count: number; done: boolean }>("index-progress", (event) => {
  if (event.payload.done) {
    if (event.payload.stage === "topics") toast("Theme index ready.");
    return;
  }
});

boot();
