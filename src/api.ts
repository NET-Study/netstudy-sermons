import { invoke } from "@tauri-apps/api/core";

export interface Sermon {
  id: string;
  slug: string;
  title: string;
  url: string;
  apiUrl: string;
  speaker: string;
  speakerSlug: string;
  speakerUrl: string;
  speakerImage: string;
  summary: string;
  description: string;
  sermonType: string;
  mediaType: "AUDIO" | "VIDEO" | "TEXT" | string;
  hasAudio: boolean;
  hasTranscript: boolean;
  duration: string;
  videoUrl: string;
  mp3Url: string;
  mp4Url: string;
  cdnMp3Url: string;
  cdnMp4Url: string;
  archiveAudioUrl: string;
  archiveVideoUrl: string;
  srtUrl: string;
  vttUrl: string;
  pdfUrl: string;
  txtUrl: string;
  thumbnailUrl: string;
  image: string;
  topics: { name: string; slug: string }[];
  scripture: { text?: string; bookId: string; book?: string; chapter: number; verse: number }[];
}

export interface Book {
  bookId: string;
  name: string;
  testament: "OT" | "NT";
  order: number;
  chapters: number;
  sermonCount: number;
}

export interface SermonListResponse {
  sermons: Sermon[];
}

export interface TopicDetail {
  slug: string;
  name: string;
  description: string;
  sermonCount: number;
  topScriptures?: { text: string; bookId: string; chapter: number; verse: number; count: number }[];
  sermons: Sermon[];
}

export interface SpeakerDetail {
  slug: string;
  name: string;
  bio: string;
  image: string;
  url: string;
  sermonCount: number;
  sermons: Sermon[];
}

export interface SpeakerPage {
  page: number;
  totalPages: number;
  total: number;
  sermons: Sermon[];
}

export interface IndexItem {
  slug: string;
  name: string;
  count: number;
  image?: string;
}

export interface Stats {
  sermons: number;
  speakers: number;
  topics: number;
  verseReferences: number;
  generated?: string;
}

const cachedGet = <T>(path: string, maxAge?: number) =>
  invoke<T>("api_get", { path, maxAge });

export const api = {
  stats: () => cachedGet<Stats>("stats", 3600),
  books: () => cachedGet<{ books: Book[] }>("scripture", 86400 * 7),
  book: (bookId: string) =>
    cachedGet<{ bookId: string; name: string; chaptersWithSermons: { chapter: number; sermonCount: number }[] }>(
      `scripture/${bookId}`,
      86400 * 7,
    ),
  chapter: (bookId: string, chapter: number) =>
    cachedGet<{
      reference: string;
      sermonCount: number;
      verses: { verse: number; sermonCount: number }[];
      sermons: Sermon[];
    }>(`scripture/${bookId}/${chapter}`, 86400 * 3),
  verse: (bookId: string, chapter: number, verse: number) =>
    cachedGet<{ reference: string; sermonCount: number; sermons: Sermon[] }>(
      `scripture/${bookId}/${chapter}/${verse}`,
      86400 * 3,
    ),
  topic: (slug: string) => cachedGet<TopicDetail>(`topics/${slug}`, 86400 * 7),
  speaker: (slug: string) => cachedGet<SpeakerDetail>(`speakers/${slug}`, 86400 * 7),
  speakerPage: (slug: string, page: number) =>
    cachedGet<SpeakerPage>(`speakers/${slug}/page/${page}`, 86400 * 3),
  popular: () => cachedGet<{ sermons: Sermon[] }>("sermons/popular", 86400),
  sermon: (id: string) => cachedGet<Sermon & { transcriptText?: string; outline?: unknown }>(`sermons/${id}`, 86400 * 7),
};

export const index = {
  state: () => invoke<{ topics: number; speakers: number; ready: boolean; builtAt: number }>("index_state"),
  build: (force = false) => invoke<{ topics: number; speakers: number; ready: boolean }>("build_indexes", { force }),
  get: (name: "topics" | "speakers") =>
    invoke<{ builtAt: number; items: IndexItem[] }>("get_index", { name }),
};

export const local = {
  load: () => invoke<unknown>("state_load"),
  save: (state: unknown) => invoke<void>("state_save", { state }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
};

// ---- Scripture reference parsing -------------------------------------------

const BOOKS: [string, string, string][] = [
  ["GEN", "Genesis", "gen ge gn"],
  ["EXO", "Exodus", "exo ex exod"],
  ["LEV", "Leviticus", "lev lv"],
  ["NUM", "Numbers", "num nu nm"],
  ["DEU", "Deuteronomy", "deu deut dt"],
  ["JOS", "Joshua", "jos josh"],
  ["JDG", "Judges", "jdg judg jg"],
  ["RUT", "Ruth", "rut ru"],
  ["1SA", "1 Samuel", "1sa 1sam 1 samuel"],
  ["2SA", "2 Samuel", "2sa 2sam 2 samuel"],
  ["1KI", "1 Kings", "1ki 1kgs 1 kings"],
  ["2KI", "2 Kings", "2ki 2kgs 2 kings"],
  ["1CH", "1 Chronicles", "1ch 1chr 1 chronicles"],
  ["2CH", "2 Chronicles", "2ch 2chr 2 chronicles"],
  ["EZR", "Ezra", "ezr"],
  ["NEH", "Nehemiah", "neh"],
  ["EST", "Esther", "est"],
  ["JOB", "Job", "job"],
  ["PSA", "Psalms", "psa psa. ps psalm psalms ps"],
  ["PRO", "Proverbs", "pro prov pr"],
  ["ECC", "Ecclesiastes", "ecc eccl ec"],
  ["SNG", "Song of Solomon", "sng song songs songofsolomon song of solomon canticles"],
  ["ISA", "Isaiah", "isa is"],
  ["JER", "Jeremiah", "jer je"],
  ["LAM", "Lamentations", "lam"],
  ["EZK", "Ezekiel", "ezk ezek eze"],
  ["DAN", "Daniel", "dan dn"],
  ["HOS", "Hosea", "hos ho"],
  ["JOL", "Joel", "jol joel jl"],
  ["AMO", "Amos", "amo am"],
  ["OBA", "Obadiah", "oba ob"],
  ["JON", "Jonah", "jon jonah"],
  ["MIC", "Micah", "mic mi"],
  ["NAM", "Nahum", "nam nah"],
  ["HAB", "Habakkuk", "hab"],
  ["ZEP", "Zephaniah", "zep zeph"],
  ["HAG", "Haggai", "hag"],
  ["ZEC", "Zechariah", "zec zech zc"],
  ["MAL", "Malachi", "mal ml"],
  ["MAT", "Matthew", "mat matt mt"],
  ["MRK", "Mark", "mrk mark mk"],
  ["LUK", "Luke", "luk lk"],
  ["JHN", "John", "jhn john jn"],
  ["ACT", "Acts", "act ac"],
  ["ROM", "Romans", "rom ro rm"],
  ["1CO", "1 Corinthians", "1co 1cor 1 corinthians"],
  ["2CO", "2 Corinthians", "2co 2cor 2 corinthians"],
  ["GAL", "Galatians", "gal ga"],
  ["EPH", "Ephesians", "eph"],
  ["PHP", "Philippians", "php phil philippians"],
  ["COL", "Colossians", "col"],
  ["1TH", "1 Thessalonians", "1th 1thess 1 thessalonians"],
  ["2TH", "2 Thessalonians", "2th 2thess 2 thessalonians"],
  ["1TI", "1 Timothy", "1ti 1tim 1 timothy"],
  ["2TI", "2 Timothy", "2ti 2tim 2 timothy"],
  ["TIT", "Titus", "tit"],
  ["PHM", "Philemon", "phm philem"],
  ["HEB", "Hebrews", "heb"],
  ["JAS", "James", "jas jam"],
  ["1PE", "1 Peter", "1pe 1pet 1 peter"],
  ["2PE", "2 Peter", "2pe 2pet 2 peter"],
  ["1JN", "1 John", "1jn 1john 1 john"],
  ["2JN", "2 John", "2jn 2john 2 john"],
  ["3JN", "3 John", "3jn 3john 3 john"],
  ["JUD", "Jude", "jud jude"],
  ["REV", "Revelation", "rev re revelation revelations"],
];

const ALIAS = new Map<string, string>();
for (const [osis, name, aliases] of BOOKS) {
  ALIAS.set(name.toLowerCase(), osis);
  for (const alias of aliases.split(" ")) ALIAS.set(alias, osis);
}

export interface Ref {
  bookId: string;
  book: string;
  chapter?: number;
  verse?: number;
}

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", first: "1", second: "2", third: "3" };

export function parseReference(query: string): Ref | null {
  let q = query
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return null;
  q = q.replace(/^(i|ii|iii|first|second|third)\s+/, (m) => `${ROMAN[m.trim().split(" ")[0]] ?? ""} `);
  q = q.replace(/^(1st|2nd|3rd)\s+/, (m) => `${m[0]} `);

  // Split the leading book name from the numbers that follow.
  const m = q.match(/^([1-3]?\s?[a-z][a-z' ]*?)\s*(?:(\d{1,3})(?:\s*[:.\s]\s*(\d{1,3}))?(?:\s*[-–]\s*\d{1,3})?)?$/);
  if (!m) return null;
  const rawBook = m[1].trim().replace(/\s+/g, " ");
  if (!rawBook) return null;

  // Prefer the longest alias that the string starts with ("1 john" before "john").
  let match: { osis: string; name: string; len: number } | null = null;
  for (const [osis, name] of BOOKS) {
    const candidates = [name.toLowerCase()];
    if (rawBook === name.toLowerCase() || rawBook.startsWith(name.toLowerCase() + " ")) {
      candidates.push(name.toLowerCase());
    }
    for (const candidate of candidates) {
      if (rawBook === candidate || rawBook.startsWith(candidate + " ")) {
        if (!match || candidate.length > match.len) match = { osis, name, len: candidate.length };
      }
    }
  }

  // Fall back to an exact single-word alias ("rom", "psalm", "jn").
  if (!match) {
    const exact = ALIAS.get(rawBook.replace(/\s+/g, " "));
    if (!exact) return null;
    const book = BOOKS.find((b) => b[0] === exact)!;
    match = { osis: exact, name: book[1], len: rawBook.length };
    if (m[2]) return { bookId: exact, book: book[1], chapter: Number(m[2]), verse: m[3] ? Number(m[3]) : undefined };
    return { bookId: exact, book: book[1] };
  }

  const rest = rawBook.slice(match.len).trim();
  // "1 corinthians" style aliases where the number and name were split apart
  const chapter = m[2] ? Number(m[2]) : undefined;
  const verse = m[3] ? Number(m[3]) : undefined;
  if (rest && !chapter) {
    // Unknown trailing words; treat as no match rather than guess.
    const fallback = ALIAS.get(rawBook);
    if (!fallback) return null;
    return { bookId: fallback, book: BOOKS.find((b) => b[0] === fallback)![1] };
  }
  return { bookId: match.osis, book: match.name, chapter, verse };
}

// ---- formatting ------------------------------------------------------------

export function durationSeconds(text: string): number {
  if (!text) return 0;
  const parts = text.split(":").map((p) => Number(p) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function compactNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function mediaLabel(sermon: Sermon): string {
  if (sermon.mediaType === "VIDEO") return "Video";
  if (sermon.mediaType === "TEXT") return "Text";
  return "Audio";
}
