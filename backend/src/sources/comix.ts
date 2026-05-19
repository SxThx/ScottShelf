import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ChapterPages,
  ChapterSummary,
  CommentItem,
  CommentPage,
  CommentSort,
  MangaDetail,
  MangaSource,
  MangaSummary,
  SearchOptions
} from "./types";

const SITE_BASE = "https://comix.to";
const API_BASE = "https://comix.to/api/v1";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ScottShelf/0.1";
const CHAPTER_LIST_LIMIT = 20;
const CHAPTER_PAGE_CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.COMIX_CHAPTER_PAGE_CONCURRENCY ?? 12) || 12));
const SIGNED_URL_TTL_MS = 1000 * 60 * 45;
const execFileAsync = promisify(execFile);

type ComixTerm = {
  title?: string;
};

type ComixManga = {
  id?: number;
  hid?: string;
  manga_id?: number;
  hash_id?: string;
  title: string;
  altTitles?: string[];
  alt_titles?: string[];
  synopsis?: string;
  synopsisHtml?: string;
  slug?: string;
  url?: string;
  type?: string;
  poster?: {
    small?: string;
    medium?: string;
    large?: string;
  };
  status?: string;
  latestChapter?: number;
  latest_chapter?: number;
  chapterUpdatedAt?: number;
  chapterUpdatedAtFormatted?: string;
  chapter_updated_at?: number;
  startDate?: string | number;
  start_date?: number;
  year?: number;
  followsTotal?: number;
  follows_total?: number;
  links?: Record<string, string | null>;
  is_nsfw?: boolean;
  contentRating?: string;
  demographics?: ComixTerm[];
  genres?: ComixTerm[];
  formats?: ComixTerm[];
  tags?: ComixTerm[];
  authors?: ComixTerm[];
  artists?: ComixTerm[];
  publishers?: ComixTerm[];
  demographic?: ComixTerm[];
  genre?: ComixTerm[];
  theme?: ComixTerm[];
  author?: ComixTerm[];
  artist?: ComixTerm[];
  publisher?: ComixTerm[];
};

type ComixChapter = {
  id?: number;
  chapter_id?: number;
  mangaId?: number;
  manga_id?: number;
  scanlation_group_id?: number;
  isOfficial?: boolean;
  is_official?: number | boolean;
  number: number;
  name?: string;
  language?: string;
  volume?: number;
  votes?: number;
  created_at?: number;
  createdAt?: number;
  createdAtFormatted?: string;
  updated_at?: number;
  url?: string;
  group?: {
    name?: string;
  } | null;
  scanlation_group?: {
    name?: string;
  };
};

type ComixPage = {
  url: string;
};

type ComixCommentUser = {
  id?: number | string;
  name?: string;
  username?: string;
  avatar?: string;
  avatarUrl?: string;
  avatar_url?: string;
};

type ComixComment = {
  id?: number | string;
  parentId?: number | string;
  parent_id?: number | string;
  user?: ComixCommentUser;
  contentHtml?: string;
  content_html?: string;
  likeCount?: number;
  like_count?: number;
  dislikeCount?: number;
  dislike_count?: number;
  replyCount?: number;
  reply_count?: number;
  isPinned?: boolean;
  is_pinned?: boolean;
  isEdited?: boolean;
  is_edited?: boolean;
  createdAt?: string;
  created_at?: string;
  createdAtFormatted?: string;
  created_at_formatted?: string;
  replies?: ComixComment[];
};

type ComixThread = {
  id?: number | string;
  pageIdentifier?: string;
  page_identifier?: string;
  pageUrl?: string;
  page_url?: string;
  pageTitle?: string;
  page_title?: string;
  commentCount?: number;
  comment_count?: number;
  mainCommentCount?: number;
  main_comment_count?: number;
  isClosed?: boolean;
  is_closed?: boolean;
};

type ComixThreadLookup = {
  thread?: ComixThread;
};

type ComixCommentList = {
  thread?: ComixThread;
  count?: number;
  items?: ComixComment[];
  cursor?: string;
};

function comixPageUrls(value: unknown): string[] {
  const pageUrl = (page: unknown, baseUrl?: string) => {
    const raw =
      typeof page === "string"
        ? page
        : page && typeof page === "object"
          ? String(
              (page as Record<string, unknown>).url ??
                (page as Record<string, unknown>).src ??
                (page as Record<string, unknown>).image ??
                (page as Record<string, unknown>).image_url ??
                (page as Record<string, unknown>).imageUrl ??
                ""
            )
          : "";
    if (!raw) return "";
    if (!baseUrl || /^https?:\/\//i.test(raw)) return raw;
    try {
      return new URL(raw, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
    } catch {
      return raw;
    }
  };

  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((page) => pageUrl(page)).filter(Boolean);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl : typeof record.base_url === "string" ? record.base_url : undefined;
    const nested = record.items ?? record.data ?? record.pages;
    if (Array.isArray(nested)) return nested.map((page) => pageUrl(page, baseUrl)).filter(Boolean);
    return comixPageUrls(record.items ?? record.data ?? record.pages ?? Object.values(record));
  }
  return [];
}

type RenderedComixChapter = {
  href?: string;
  chapterId?: string;
  chapter?: string;
  title?: string;
  volume?: string;
  group?: string;
  time?: string;
  isOfficial?: boolean;
};

type RenderedChapterState = {
  rows: RenderedComixChapter[];
  total: number;
  activePage: number;
  firstHref: string;
  hasNext: boolean;
};

type ComixList<T> = {
  items: T[];
  pagination?: {
    current_page?: number;
    last_page?: number;
  };
  meta?: {
    total?: number;
    perPage?: number;
    page?: number;
    lastPage?: number;
    hasNext?: boolean;
  };
};

type ComixResponse<T> = {
  status: number | "ok" | "error";
  result?: T;
  data?: T;
  message?: string;
  messages?: string[];
};

function unwrapComixResponse<T>(body: ComixResponse<T> | T): T {
  let current: unknown = body;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") break;
    const record = current as Record<string, unknown>;
    if (record.result !== undefined) {
      current = record.result;
      continue;
    }
    if (record.data !== undefined && !Array.isArray(record.items)) {
      current = record.data;
      continue;
    }
    break;
  }
  return current as T;
}

function comixListItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter(Boolean) as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items.filter(Boolean) as T[];
  if (Array.isArray(record.data)) return record.data.filter(Boolean) as T[];
  return comixListItems<T>(record.result ?? record.data);
}

function comixLastPage(value: unknown) {
  if (!value || typeof value !== "object") return 1;
  const record = value as Record<string, unknown>;
  const meta = (record.meta ?? (record.data as Record<string, unknown> | undefined)?.meta) as Record<string, unknown> | undefined;
  const pagination = (record.pagination ?? (record.data as Record<string, unknown> | undefined)?.pagination) as Record<string, unknown> | undefined;
  const page = Number(meta?.lastPage ?? pagination?.last_page ?? 1);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function isEncryptedPayload(value: unknown) {
  return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).e === "string");
}

type TurbopackModule = (runtime: TurbopackRuntime, exports: Record<string, unknown>, module: Record<string, unknown>) => void;

type TurbopackRuntime = {
  i: (id: number) => Record<string, unknown>;
  r: (id: number) => Record<string, unknown>;
  s: (exports: unknown[]) => void;
};

type SignedComixApi = {
  apiClient: {
    get<T>(path: string, options?: unknown): Promise<T>;
  };
  withCache(options?: Record<string, unknown>): unknown;
};

function decodeHtml(value?: string) {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function slugFromUrl(url?: string) {
  if (!url) return undefined;
  const match = url.match(/\/title\/([^/?#]+)/);
  return match?.[1]?.split("-").slice(1).join("-");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function titleFromId(id: string) {
  const parts = id.split("-").filter(Boolean);
  if (parts.length <= 1) return id.replace(/-/g, " ");
  return parts.slice(1).join(" ");
}

function slugFromId(id: string) {
  const parts = id.split("-").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join("-") : slugify(id);
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && /\(404\)|code['"]?\s*:\s*404|not found/i.test(error.message);
}

function mangaIncludeParams() {
  const params = new URLSearchParams();
  for (const include of ["demographic", "genre", "theme", "author", "artist", "publisher"]) {
    params.append("includes[]", include);
  }
  return params;
}

function sourceId(manga: ComixManga) {
  const hash = manga.hid ?? manga.hash_id ?? String(manga.id ?? manga.manga_id ?? "");
  const slug = manga.slug ?? slugFromUrl(manga.url) ?? slugify(manga.title);
  return slug ? `${hash}-${slug}` : hash;
}

function hashFromId(id: string) {
  return id.split("-")[0] || id;
}

function titleUrl(id: string) {
  return `${SITE_BASE}/title/${id}`;
}

function chapterPageUrl(mangaId: string, chapterId: string, chapterNumber: string) {
  return `${SITE_BASE}/title/${mangaId}/${chapterId}-chapter-${encodeURIComponent(chapterNumber)}`;
}

function relativeComixUrl(url: string) {
  try {
    const parsed = new URL(url, SITE_BASE);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

function normalizedCommentSort(value?: CommentSort): CommentSort {
  return value === "newest" || value === "oldest" ? value : "best";
}

function normalizedCommentLimit(value?: number) {
  const limit = Math.floor(Number(value ?? 20));
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 20;
}

function commentUser(user?: ComixCommentUser) {
  if (!user) return undefined;
  return {
    id: user.id === undefined ? undefined : String(user.id),
    name: user.name ?? user.username,
    avatarUrl: user.avatarUrl ?? user.avatar_url ?? user.avatar
  };
}

function commentItem(comment: ComixComment): CommentItem {
  return {
    id: String(comment.id ?? ""),
    parentId: comment.parentId === undefined && comment.parent_id === undefined ? undefined : String(comment.parentId ?? comment.parent_id),
    user: commentUser(comment.user),
    contentHtml: comment.contentHtml ?? comment.content_html ?? "",
    likeCount: comment.likeCount ?? comment.like_count,
    dislikeCount: comment.dislikeCount ?? comment.dislike_count,
    replyCount: comment.replyCount ?? comment.reply_count,
    isPinned: comment.isPinned ?? comment.is_pinned,
    isEdited: comment.isEdited ?? comment.is_edited,
    createdAt: comment.createdAt ?? comment.created_at,
    createdAtFormatted: comment.createdAtFormatted ?? comment.created_at_formatted,
    replies: (comment.replies ?? []).map(commentItem).filter((item) => item.id)
  };
}

function commentThreadKey(thread: ComixThread | undefined, fallback: string) {
  return String(thread?.pageIdentifier ?? thread?.page_identifier ?? fallback);
}

function commentThreadId(thread: ComixThread | undefined) {
  return String(thread?.id ?? "");
}

function commentPageUrl(thread: ComixThread | undefined) {
  return thread?.pageUrl ?? thread?.page_url;
}

function commentPageTitle(thread: ComixThread | undefined) {
  return thread?.pageTitle ?? thread?.page_title;
}

function commentCount(thread: ComixThread | undefined) {
  return thread?.commentCount ?? thread?.comment_count;
}

function mainCommentCount(thread: ComixThread | undefined) {
  return thread?.mainCommentCount ?? thread?.main_comment_count;
}

function isCommentThreadClosed(thread: ComixThread | undefined) {
  return thread?.isClosed ?? thread?.is_closed;
}

async function comixMangaForId(id: string) {
  const currentId = await resolveCurrentMangaId(id);
  return request<ComixManga>(`/manga/${hashFromId(currentId)}`, mangaIncludeParams());
}

async function lookupCommentThread(pageIdentifier: string, pageUrl: string) {
  const params = new URLSearchParams({
    page_identifier: pageIdentifier,
    page_url: relativeComixUrl(pageUrl)
  });
  const result = await request<ComixThreadLookup>("/threads/lookup", params);
  const thread = result.thread;
  if (!commentThreadId(thread)) throw new Error("Comix.to comment thread was not found.");
  return thread;
}

async function loadThreadComments(
  threadId: string,
  referer: string,
  options: { sort?: CommentSort; limit?: number; all?: boolean } = {}
) {
  const sort = normalizedCommentSort(options.sort);
  const limit = normalizedCommentLimit(options.limit);
  const maxComments = options.all
    ? Math.max(limit, Math.min(Number(process.env.COMIX_COMMENT_MAX_COMMENTS_PER_THREAD ?? 200) || 200, 1000))
    : limit;
  const comments: CommentItem[] = [];
  let cursor: string | undefined;
  let thread: ComixThread | undefined;

  while (comments.length < maxComments) {
    const params = new URLSearchParams({
      sort,
      limit: String(Math.min(limit, maxComments - comments.length))
    });
    if (cursor) params.set("cursor", cursor);
    const page = await request<ComixCommentList>(`/threads/${threadId}/comments`, params);
    thread ??= page.thread;
    const items = (page.items ?? []).map(commentItem).filter((item) => item.id);
    comments.push(...items);
    cursor = page.cursor;
    if (!options.all || !cursor || !items.length) break;
  }

  return { comments, cursor, sort, thread };
}

async function getComixTitleComments(
  mangaId: string,
  options: { sort?: CommentSort; limit?: number; all?: boolean } = {}
): Promise<CommentPage> {
  const manga = await comixMangaForId(mangaId);
  const currentId = sourceId(manga);
  const numericId = String(manga.id ?? manga.manga_id ?? "");
  if (!numericId) throw new Error("Comix.to numeric manga id was not found for comments.");
  const pageIdentifier = `manga${numericId}`;
  const pageUrl = manga.url ?? `/title/${currentId}`;
  const lookupThread = await lookupCommentThread(pageIdentifier, pageUrl);
  const threadId = commentThreadId(lookupThread);
  const loaded = await loadThreadComments(threadId, `${SITE_BASE}${relativeComixUrl(pageUrl)}`, options);
  const thread = loaded.thread ?? lookupThread;
  return {
    source: "comix",
    targetType: "title",
    mangaId: currentId,
    thread: {
      id: threadId,
      key: commentThreadKey(thread, pageIdentifier),
      pageUrl: commentPageUrl(thread) ?? relativeComixUrl(pageUrl),
      pageTitle: commentPageTitle(thread),
      commentCount: commentCount(thread),
      mainCommentCount: mainCommentCount(thread),
      isClosed: isCommentThreadClosed(thread)
    },
    comments: loaded.comments,
    sort: loaded.sort,
    cursor: loaded.cursor
  };
}

async function getComixChapterComments(
  mangaId: string,
  chapterNumber: string,
  options: { volume?: string; sort?: CommentSort; limit?: number; all?: boolean } = {}
): Promise<CommentPage> {
  const manga = await comixMangaForId(mangaId);
  const currentId = sourceId(manga);
  const numericId = String(manga.id ?? manga.manga_id ?? "");
  if (!numericId) throw new Error("Comix.to numeric manga id was not found for comments.");
  const volume = options.volume ?? "0";
  const pageIdentifier = `manga${numericId}_chap${chapterNumber}_vol${volume || "0"}`;
  const pageUrl = `/title/${currentId}`;
  const lookupThread = await lookupCommentThread(pageIdentifier, pageUrl);
  const threadId = commentThreadId(lookupThread);
  const loaded = await loadThreadComments(threadId, `${SITE_BASE}${relativeComixUrl(pageUrl)}`, options);
  const thread = loaded.thread ?? lookupThread;
  return {
    source: "comix",
    targetType: "chapter",
    mangaId: currentId,
    chapterNumber,
    volume,
    thread: {
      id: threadId,
      key: commentThreadKey(thread, pageIdentifier),
      pageUrl: commentPageUrl(thread) ?? relativeComixUrl(pageUrl),
      pageTitle: commentPageTitle(thread),
      commentCount: commentCount(thread),
      mainCommentCount: mainCommentCount(thread),
      isClosed: isCommentThreadClosed(thread)
    },
    comments: loaded.comments,
    sort: loaded.sort,
    cursor: loaded.cursor
  };
}

function tags(manga: ComixManga) {
  return [
    ...(manga.demographics ?? manga.demographic ?? []),
    ...(manga.genres ?? manga.genre ?? []),
    ...(manga.formats ?? []),
    ...(manga.tags ?? manga.theme ?? [])
  ]
    .map((term) => term.title)
    .filter((term): term is string => Boolean(term))
    .slice(0, 10);
}

function termTitles(terms?: ComixTerm[]) {
  return terms?.map((term) => term.title).filter((term): term is string => Boolean(term)) ?? [];
}

function coverUrl(manga: ComixManga) {
  return manga.poster?.large ?? manga.poster?.medium ?? manga.poster?.small;
}

function relativeTimeToIso(value?: string) {
  const match = value
    ?.trim()
    .match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|yr|year|years)(?:\s+ago)?$/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;

  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    mo: 30 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000
  };

  const multiplier = multipliers[unit];
  return multiplier ? new Date(Date.now() - amount * multiplier).toISOString() : undefined;
}

function timestampToIso(value?: number) {
  return value ? new Date(value * 1000).toISOString() : undefined;
}

function chapterNumericId(chapter: ComixChapter) {
  return String(chapter.id ?? chapter.chapter_id ?? "");
}

function isOfficialChapter(chapter: ComixChapter) {
  return chapter.isOfficial || chapter.is_official === true || chapter.is_official === 1;
}

function encodeChapterId(chapterId: string, mangaId: string, chapterNumber: string) {
  return [chapterId, mangaId, encodeURIComponent(chapterNumber)].join("~");
}

function decodeChapterId(id: string) {
  const [chapterId, mangaId, encodedNumber] = id.split("~");
  return {
    chapterId: chapterId || id,
    mangaId,
    chapterNumber: encodedNumber ? decodeURIComponent(encodedNumber) : undefined
  };
}

function toSummary(manga: ComixManga): MangaSummary {
  const startDate = typeof manga.startDate === "number" ? manga.startDate : Number(manga.startDate);
  const latestChapter = manga.latestChapter ?? manga.latest_chapter;
  const chapterUpdatedAt = manga.chapterUpdatedAt ?? manga.chapter_updated_at;

  return {
    source: "comix",
    id: sourceId(manga),
    title: manga.title,
    description: decodeHtml(manga.synopsisHtml ?? manga.synopsis),
    coverUrl: coverUrl(manga),
    status: manga.status,
    contentRating: manga.contentRating ?? (manga.is_nsfw ? "erotica" : "safe"),
    demographic: manga.type,
    year: manga.year ?? (Number.isFinite(startDate) ? startDate : manga.start_date),
    latestChapter: latestChapter ? String(latestChapter) : undefined,
    latestChapterReleasedAt: timestampToIso(chapterUpdatedAt) ?? relativeTimeToIso(manga.chapterUpdatedAtFormatted),
    tags: tags(manga)
  };
}

function toDetail(manga: ComixManga): MangaDetail {
  const links = Object.fromEntries(Object.entries(manga.links ?? {}).filter(([, value]) => Boolean(value))) as Record<
    string,
    string
  >;
  return {
    ...toSummary(manga),
    altTitles: manga.altTitles ?? manga.alt_titles ?? [],
    artists: termTitles(manga.artists ?? manga.artist),
    authors: termTitles(manga.authors ?? manga.author),
    publishers: termTitles(manga.publishers ?? manga.publisher),
    language: "English",
    links: {
      ...links,
      website: titleUrl(sourceId(manga))
    }
  };
}

function toChapter(chapter: ComixChapter, mangaId: string): ChapterSummary {
  const number = String(chapter.number);
  const id = chapterNumericId(chapter);
  const group = isOfficialChapter(chapter)
    ? "Official"
    : chapter.group?.name ?? chapter.scanlation_group?.name ?? (chapter.scanlation_group_id ? `Group ${chapter.scanlation_group_id}` : "Comix.to");

  return {
    source: "comix",
    id: mangaId && id ? encodeChapterId(id, mangaId, number) : id,
    mangaId,
    title: chapter.name ? `Chapter ${number}: ${chapter.name}` : `Chapter ${number}`,
    chapter: number,
    volume: chapter.volume ? String(chapter.volume) : undefined,
    language: chapter.language ?? "en",
    publishedAt:
      timestampToIso(chapter.createdAt ?? chapter.created_at) ?? relativeTimeToIso(chapter.createdAtFormatted),
    groups: group ? [group] : [],
    externalUrl: chapter.url ?? (id ? chapterPageUrl(mangaId, id, number) : undefined)
  };
}

function toRenderedChapter(chapter: RenderedComixChapter, mangaId: string, language: string): ChapterSummary | undefined {
  const chapterId = chapter.chapterId;
  const number = chapter.chapter;
  if (!chapterId || !number) return undefined;

  const group = chapter.isOfficial ? "Official" : chapter.group || "Comix.to";
  return {
    source: "comix",
    id: encodeChapterId(chapterId, mangaId, number),
    mangaId,
    title: chapter.title ? `Chapter ${number}: ${chapter.title}` : `Chapter ${number}`,
    chapter: number,
    volume: chapter.volume,
    language: language || "en",
    publishedAt: relativeTimeToIso(chapter.time),
    groups: group ? [group] : [],
    externalUrl: chapter.href
  };
}

async function request<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  params?.forEach((value, key) => url.searchParams.append(key, value));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Referer: `${SITE_BASE}/`,
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Comix.to request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const body = (await response.json()) as ComixResponse<T>;
  if (body.status === "error" || (typeof body.status === "number" && body.status >= 400)) {
    throw new Error(body.messages?.[0] ?? body.message ?? "Comix.to request failed.");
  }

  return unwrapComixResponse<T>(body);
}

async function requestHtml(path: string) {
  const response = await fetch(`${SITE_BASE}${path}`, {
    headers: {
      Accept: "text/html",
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) throw new Error(`Comix.to page request failed (${response.status}).`);
  return response.text();
}

let chromePathPromise: Promise<string> | undefined;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const renderedBrowserQueue: Array<() => void> = [];
let activeRenderedBrowsers = 0;

async function acquireRenderedBrowserSlot() {
  const limit = Math.max(1, Math.min(16, Number(process.env.COMIX_RENDERED_BROWSER_CONCURRENCY ?? 1) || 1));
  if (activeRenderedBrowsers < limit) {
    activeRenderedBrowsers += 1;
    return () => releaseRenderedBrowserSlot();
  }

  await new Promise<void>((resolve) => renderedBrowserQueue.push(resolve));
  activeRenderedBrowsers += 1;
  return () => releaseRenderedBrowserSlot();
}

function releaseRenderedBrowserSlot() {
  activeRenderedBrowsers = Math.max(0, activeRenderedBrowsers - 1);
  renderedBrowserQueue.shift()?.();
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function chromePath() {
  if (!chromePathPromise) {
    chromePathPromise = (async () => {
      const candidates = [
        process.env.CHROME_PATH,
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
        "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
        "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const candidate of candidates) {
        if (await fileExists(candidate)) return candidate;
      }
      throw new Error("Chromium is required for Comix.to signed chapter endpoints. Set CHROME_PATH if it is installed elsewhere.");
    })();
  }
  return chromePathPromise;
}

async function pathForBrowser(filePath: string, browserPath: string) {
  if (!browserPath.startsWith("/mnt/")) return filePath;
  try {
    const { stdout } = await execFileAsync("wslpath", ["-w", filePath], { timeout: 2000, maxBuffer: 4096 });
    return stdout.trim();
  } catch {
    return filePath;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function collectUrls(value: unknown) {
  const urls = new Set<string>();
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url === "string") urls.add(record.url);
    for (const child of Object.values(record)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return [...urls];
}

class CdpWebSocket {
  private socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private connected = false;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private fragments: Buffer[] = [];
  private onHandshake?: () => void;
  private eventHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.on("data", (chunk) => this.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    this.socket.on("error", (error) => this.rejectAll(error));
    this.socket.on("close", () => this.rejectAll(new Error("Chrome DevTools connection closed.")));
  }

  static connect(endpoint: string) {
    return new Promise<CdpWebSocket>((resolve, reject) => {
      const url = new URL(endpoint);
      const key = crypto.randomBytes(16).toString("base64");
      const socket = net.connect(Number(url.port), url.hostname);
      const client = new CdpWebSocket(socket);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Chrome DevTools websocket connection timed out."));
      }, 5000);

      const onError = (error: Error) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      };

      client.onHandshake = () => {
        clearTimeout(timeout);
        socket.off("error", onError);
        resolve(client);
      };

      socket.once("error", onError);
      socket.once("connect", () => {
        socket.write(
          [
            `GET ${url.pathname}${url.search} HTTP/1.1`,
            `Host: ${url.host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "\r\n"
          ].join("\r\n")
        );
      });
    });
  }

  close() {
    this.socket.destroy();
  }

  on(eventName: string, handler: (params: Record<string, unknown>) => void) {
    const handlers = this.eventHandlers.get(eventName) ?? new Set<(params: Record<string, unknown>) => void>();
    handlers.add(handler);
    this.eventHandlers.set(eventName, handlers);
  }

  off(eventName: string, handler: (params: Record<string, unknown>) => void) {
    const handlers = this.eventHandlers.get(eventName);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) this.eventHandlers.delete(eventName);
  }

  command<T>(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      this.socket.write(this.frame(Buffer.from(payload)));
    });
  }

  private frame(data: Buffer, opcode = 1) {
    const length = data.length;
    const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
    const header = Buffer.alloc(headerLength + 4);
    header[0] = 0x80 | opcode;

    if (length < 126) {
      header[1] = 0x80 | length;
    } else if (length <= 0xffff) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    const maskOffset = headerLength;
    const mask = crypto.randomBytes(4);
    mask.copy(header, maskOffset);

    const masked = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      masked[index] = data[index] ^ mask[index % 4];
    }
    return Buffer.concat([header, masked]);
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (!this.connected) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.1 101/i.test(header)) {
        this.rejectAll(new Error("Chrome DevTools websocket handshake failed."));
        this.socket.destroy();
        return;
      }
      this.connected = true;
      this.buffer = this.buffer.slice(headerEnd + 4);
      this.onHandshake?.();
    }

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const fin = Boolean(first & 0x80);
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;

      let payload = this.buffer.slice(offset, offset + length);
      if (masked) {
        const mask = this.buffer.slice(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.buffer = this.buffer.slice(offset + length);

      if (opcode === 0x8) {
        this.socket.destroy();
        return;
      }
      if (opcode === 0x9) {
        this.socket.write(this.frame(payload, 0x0a));
        continue;
      }
      if (opcode !== 0x1 && opcode !== 0x0) continue;

      this.fragments.push(payload);
      if (!fin) continue;

      const message = Buffer.concat(this.fragments).toString("utf8");
      this.fragments = [];
      this.handleMessage(message);
    }
  }

  private handleMessage(message: string) {
    const parsed = JSON.parse(message) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: unknown;
    };
    if (parsed.id === undefined) {
      if (parsed.method) {
        const params = parsed.params && typeof parsed.params === "object" ? (parsed.params as Record<string, unknown>) : {};
        for (const handler of this.eventHandlers.get(parsed.method) ?? []) handler(params);
      }
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? "Chrome DevTools command failed."));
    } else {
      pending.resolve(parsed.result);
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

async function waitForChromeBrowserEndpoint(browser: ChildProcessWithoutNullStreams) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Chrome DevTools endpoint was not opened."));
    }, 10000);

    const finish = (error?: Error, endpoint?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(endpoint as string);
    };

    browser.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(undefined, match[1]);
    });
    browser.once("exit", (code) => finish(new Error(`Chrome exited before DevTools was ready (${code ?? "unknown"}).`)));
    browser.once("error", (error) => finish(error));
  });
}

async function waitForPageWebSocket(browserEndpoint: string, pageUrl: string) {
  const endpoint = new URL(browserEndpoint);
  const listUrl = `http://${endpoint.hostname}:${endpoint.port}/json`;
  const startedAt = Date.now();
  let fallback: string | undefined;
  while (Date.now() - startedAt < 10000) {
    try {
      const response = await fetch(listUrl);
      const targets = (await response.json()) as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
      const exact = targets.find(
        (target) => target.type === "page" && target.webSocketDebuggerUrl && target.url && target.url.startsWith(pageUrl)
      );
      if (exact?.webSocketDebuggerUrl) return exact.webSocketDebuggerUrl;
      fallback ??= targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    } catch {
      // Chrome can take a moment after printing the browser endpoint before /json is ready.
    }
    await sleep(200);
  }
  if (fallback) return fallback;
  throw new Error("Chrome page DevTools endpoint was not found.");
}

function chromiumArgs(browserTempDir: string, pageUrl: string) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-crash-reporter",
    "--disable-crashpad",
    "--disable-breakpad",
    "--noerrdialogs",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-zygote",
    "--renderer-process-limit=1",
    ...(process.env.CHROME_SINGLE_PROCESS === "0" ? [] : ["--single-process"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${browserTempDir}`,
    pageUrl
  ];
}

async function evaluateInBrowser<T>(client: CdpWebSocket, expression: string, timeoutMs = 30000): Promise<T> {
  const response = await client.command<{
    result?: { value?: T; unserializableValue?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true
    },
    timeoutMs
  );
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Browser evaluation failed.");
  }
  return response.result?.value as T;
}

const renderedChapterExtractExpression = String.raw`
(() => {
  const text = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();
  const rows = [...document.querySelectorAll(".mchap-list .mchap-item")].map((row) => {
    const primary = row.querySelector(".mchap-row__primary");
    const href = primary?.href || primary?.getAttribute("href") || "";
    const chapterFromHref = decodeURIComponent(href.match(/-chapter-([^/?#]+)/)?.[1] || "");
    const chapterFromText = text(row.querySelector(".mchap-row__ch")).replace(/^Ch\.\s*/i, "");
    const chapterId = href.match(/\/title\/[^/]+\/(\d+)-chapter-/)?.[1] || "";
    const groupNode = row.querySelector(".mchap-row__group span");
    const officialNode = row.querySelector(".mchap-row__official");
    return {
      href,
      chapterId,
      chapter: chapterFromHref || chapterFromText,
      title: text(row.querySelector(".mchap-row__title")),
      volume: text(row.querySelector(".mchap-row__vol")).replace(/^Vol\.\s*/i, ""),
      group: text(groupNode || officialNode),
      time: text(row.querySelector(".mchap-row__time")),
      isOfficial: Boolean(officialNode)
    };
  }).filter((row) => row.chapterId && row.chapter);
  const hint = text(document.querySelector(".mchap-foot__hint"));
  const total = Number((hint.match(/of\s+([\d,]+)\s+items/i)?.[1] || "").replace(/,/g, ""));
  const activePage = Number(text(document.querySelector(".npager__num.is-active")) || "1");
  const nextButton = document.querySelector('button[aria-label="Next page"]');
  return {
    rows,
    total: Number.isFinite(total) ? total : rows.length,
    activePage: Number.isFinite(activePage) && activePage > 0 ? activePage : 1,
    firstHref: rows[0]?.href || "",
    hasNext: Boolean(nextButton && !nextButton.disabled)
  };
})()
`;

function browserChapterApiExpression(hid: string, maxPages = 75) {
  return String.raw`
(async () => {
  if (document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  const waitForMainScript = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const mainScript = [...document.querySelectorAll('script[src]')]
        .map((script) => script.src)
        .find((src) => src.includes("/assets/build/") && src.includes("/dist/main-"));
      if (mainScript) return mainScript;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return "";
  };
  const mainScript = await waitForMainScript();
  if (!mainScript) throw new Error("Comix.to app module was not found.");

  const app = await import(mainScript);
  const api = app.L?.get ? app.L : app.M?.get ? app.M : app.N?.get ? { get: async (...args) => (await app.N.get(...args)).data } : undefined;
  if (!api?.get) throw new Error("Comix.to app API client was not found.");

  const hid = ${JSON.stringify(hid)};
  const limit = ${CHAPTER_LIST_LIMIT};
  const concurrency = ${CHAPTER_PAGE_CONCURRENCY};
  const query = (page) => ({
    page,
    limit,
    "order[number]": "desc"
  });
  const unwrap = (value) => {
    let current = value;
    for (let depth = 0; depth < 5; depth += 1) {
      if (!current || typeof current !== "object") break;
      if ("result" in current) {
        current = current.result;
        continue;
      }
      if ("data" in current && !Array.isArray(current.items)) {
        current = current.data;
        continue;
      }
      break;
    }
    return current;
  };
  const itemList = (value) => {
    const current = unwrap(value);
    if (Array.isArray(current)) return current;
    if (Array.isArray(current?.items)) return current.items;
    if (Array.isArray(current?.data)) return current.data;
    return [];
  };
  const lastPage = (value) => {
    const current = unwrap(value);
    const meta = current?.meta || current?.data?.meta;
    const pagination = current?.pagination || current?.data?.pagination;
    const total = Number(meta?.total || pagination?.total || 0);
    const page = Number(meta?.lastPage || pagination?.last_page || (total ? Math.ceil(total / limit) : 1));
    return Number.isFinite(page) && page > 0 ? page : 1;
  };
  const mapWithConcurrency = async (items, mapper) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  };

  const load = (page) => api.get("/manga/" + hid + "/chapters", { params: query(page) });
  const first = await load(1);
  const pageCount = Math.min(lastPage(first), ${maxPages});
  const pageNumbers = Array.from({ length: Math.max(0, pageCount - 1) }, (_value, index) => index + 2);
  const pages = [first, ...(await mapWithConcurrency(pageNumbers, (page) => load(page)))];
  return pages.flatMap(itemList);
})()
`;
}

function browserChapterPreviewExpression(hid: string, targetChapter?: string) {
  return String.raw`
(async () => {
  if (document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  const waitForMainScript = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const mainScript = [...document.querySelectorAll('script[src]')]
        .map((script) => script.src)
        .find((src) => src.includes("/assets/build/") && src.includes("/dist/main-"));
      if (mainScript) return mainScript;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return "";
  };
  const mainScript = await waitForMainScript();
  if (!mainScript) throw new Error("Comix.to app module was not found.");

  const app = await import(mainScript);
  const api = app.L?.get ? app.L : app.M?.get ? app.M : app.N?.get ? { get: async (...args) => (await app.N.get(...args)).data } : undefined;
  if (!api?.get) throw new Error("Comix.to app API client was not found.");

  const hid = ${JSON.stringify(hid)};
  const target = Number(${JSON.stringify(targetChapter ?? "")});
  const limit = ${CHAPTER_LIST_LIMIT};
  const unwrap = (value) => {
    let current = value;
    for (let depth = 0; depth < 5; depth += 1) {
      if (!current || typeof current !== "object") break;
      if ("result" in current) {
        current = current.result;
        continue;
      }
      if ("data" in current && !Array.isArray(current.items)) {
        current = current.data;
        continue;
      }
      break;
    }
    return current;
  };
  const itemList = (value) => {
    const current = unwrap(value);
    if (Array.isArray(current)) return current;
    if (Array.isArray(current?.items)) return current.items;
    if (Array.isArray(current?.data)) return current.data;
    return [];
  };
  const load = (page, order) => api.get("/manga/" + hid + "/chapters", {
    params: { page, limit, "order[number]": order }
  });
  const pages = await Promise.all([load(1, "desc"), load(1, "asc")]);
  const newest = itemList(pages[0]);
  if (Number.isFinite(target) && target > 0 && !pages.flatMap(itemList).some((chapter) => Number(chapter?.number) === target)) {
    const latest = Math.max(0, ...newest.map((chapter) => Number(chapter?.number)).filter(Number.isFinite));
    const uniqueNewestChapters = new Set(newest.map((chapter) => Number(chapter?.number)).filter(Number.isFinite)).size;
    const chaptersPerPage = uniqueNewestChapters || limit;
    const targetPage = latest > 0 ? Math.floor(Math.max(0, latest - target) / chaptersPerPage) + 1 : 0;
    const targetPages = [targetPage, targetPage + 1].filter((page) => page > 1);
    pages.push(...(await Promise.all([...new Set(targetPages)].map((page) => load(page, "desc")))));
  }

  const seen = new Set();
  return pages.flatMap(itemList).filter((chapter) => {
    const key = String(chapter?.id ?? chapter?.chapter_id ?? chapter?.number ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})()
`;
}

function browserChapterPagesExpression(chapterId: string) {
  return String.raw`
(async () => {
  if (document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pageNumber = (button) => Number((button.getAttribute("aria-label") || "").match(/page\s+(\d+)/i)?.[1] || "0");
  const pageImage = (page) => [...document.querySelectorAll("img.rpage-page__img, img[alt]")]
    .find((img) => (img.getAttribute("alt") || "").trim().toLowerCase() === "page " + page && img.src);

  const renderedPages = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000 && !document.querySelector('button[aria-label^="Go to page"]')) {
      await wait(250);
    }

    const buttons = [...document.querySelectorAll('button[aria-label^="Go to page"]')]
      .map((button) => ({ button, page: pageNumber(button) }))
      .filter((item) => item.page > 0)
      .sort((left, right) => left.page - right.page);
    const urls = new Map();

    for (const { button, page } of buttons) {
      button.click();
      const pageStartedAt = Date.now();
      while (Date.now() - pageStartedAt < 3000) {
        const img = pageImage(page);
        if (img?.src) {
          urls.set(page, img.src);
          break;
        }
        await wait(100);
      }
    }

    return [...urls.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, url]) => url)
      .filter(Boolean);
  };

  const waitForMainScript = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const mainScript = [...document.querySelectorAll('script[src]')]
        .map((script) => script.src)
        .find((src) => src.includes("/assets/build/") && src.includes("/dist/main-"));
      if (mainScript) return mainScript;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return "";
  };

  try {
    const mainScript = await waitForMainScript();
    if (mainScript) {
      const app = await import(mainScript);
      const api = app.L?.get ? app.L : app.M?.get ? app.M : app.N?.get ? { get: async (...args) => (await app.N.get(...args)).data } : undefined;
      if (api?.get) {
        const unwrap = (value) => {
          let current = value;
          for (let depth = 0; depth < 5; depth += 1) {
            if (!current || typeof current !== "object") break;
            if ("result" in current) {
              current = current.result;
              continue;
            }
            if ("data" in current && !Array.isArray(current.pages)) {
              current = current.data;
              continue;
            }
            break;
          }
          return current;
        };

        const result = unwrap(await api.get("/chapters/" + ${JSON.stringify(chapterId)}));
        const pageUrl = (page, baseUrl = "") => {
          const raw = typeof page === "string" ? page : page?.url ?? page?.src ?? page?.image ?? page?.image_url ?? page?.imageUrl ?? "";
          if (!raw) return "";
          if (!baseUrl || raw.startsWith("http://") || raw.startsWith("https://")) return raw;
          try {
            return new URL(raw, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").toString();
          } catch {
            return raw;
          }
        };
        if (result?.pages && !Array.isArray(result.pages) && Array.isArray(result.pages.items)) {
          const pages = result.pages.items.map((page) => pageUrl(page, result.pages.baseUrl ?? result.pages.base_url)).filter(Boolean);
          if (pages.length) return pages;
        }
        if (Array.isArray(result?.pages)) {
          const pages = result.pages.map((page) => pageUrl(page)).filter(Boolean);
          if (pages.length) return pages;
        }
        if (Array.isArray(result)) {
          const pages = result.map((page) => pageUrl(page)).filter(Boolean);
          if (pages.length) return pages;
        }
      }
    }
  } catch {
    // Fall back to the rendered reader controls below.
  }

  return renderedPages();
})()
`;
}

async function launchRenderedComixPage(pageUrl: string) {
  const releaseBrowserSlot = await acquireRenderedBrowserSlot();
  const browserPath = await chromePath();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "scottshelf-comix-render-"));
  const browserTempDir = await pathForBrowser(tempDir, browserPath);
  const browser = spawn(browserPath, chromiumArgs(browserTempDir, pageUrl));
  browser.stdout.resume();

  try {
    const browserEndpoint = await waitForChromeBrowserEndpoint(browser);
    const pageEndpoint = await waitForPageWebSocket(browserEndpoint, pageUrl);
    const client = await CdpWebSocket.connect(pageEndpoint);
    await client.command("Page.enable");
    await client.command("Runtime.enable");
    await client.command("Page.navigate", { url: pageUrl }).catch(() => undefined);
    return { browser, client, tempDir, releaseBrowserSlot };
  } catch (error) {
    browser.kill();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    releaseBrowserSlot();
    throw error;
  }
}

async function waitForRenderedChapters(client: CdpWebSocket, previousFirstHref?: string): Promise<RenderedChapterState> {
  const startedAt = Date.now();
  let latest: RenderedChapterState = { rows: [], total: 0, activePage: 1, firstHref: "", hasNext: false };
  while (Date.now() - startedAt < 15000) {
    latest = (await evaluateInBrowser<RenderedChapterState>(client, renderedChapterExtractExpression, 15000)) ?? latest;
    if (latest.rows.length && (!previousFirstHref || latest.firstHref !== previousFirstHref)) return latest;
    await sleep(250);
  }
  return latest;
}

async function getRenderedChapters(mangaId: string, language: string): Promise<ChapterSummary[]> {
  const timingEnabled = process.env.CHAPTER_TIMING === "1";
  const startedAt = Date.now();
  const logTiming = (step: string, extra = "") => {
    if (!timingEnabled) return;
    console.log(`[comix-rendered-chapter-timing] ${mangaId}:${language} ${step} ${Date.now() - startedAt}ms${extra ? ` ${extra}` : ""}`);
  };

  const pageUrl = titleUrl(mangaId);
  const { browser, client, tempDir, releaseBrowserSlot } = await launchRenderedComixPage(pageUrl);
  logTiming("launch");
  try {
    const browserApiChapters = await evaluateInBrowser<ComixChapter[]>(
      client,
      browserChapterApiExpression(hashFromId(mangaId)),
      45000
    ).catch((error) => {
      logTiming("browser-api-error", error instanceof Error ? error.message : String(error));
      return [];
    });
    logTiming("browser-api", `chapters=${browserApiChapters.length}`);
    if (browserApiChapters.length) {
      return browserApiChapters
        .filter((chapter) => !language || chapter.language === language)
        .map((chapter) => toChapter(chapter, mangaId));
    }

    const chapters = new Map<string, ChapterSummary>();
    let current = await waitForRenderedChapters(client);
    const pageCount = Math.min(Math.max(1, Math.ceil((current.total || current.rows.length) / CHAPTER_LIST_LIMIT)), 75);
    logTiming("dom-page-1", `rows=${current.rows.length} total=${current.total} pages=${pageCount}`);

    for (let page = 1; page <= pageCount; page += 1) {
      for (const row of current.rows) {
        const chapter = toRenderedChapter(row, mangaId, language);
        if (chapter) chapters.set(chapter.id, chapter);
      }
      if (page >= pageCount || !current.hasNext) break;

      const previousFirstHref = current.firstHref;
      const clicked = await evaluateInBrowser<boolean>(
        client,
        `(() => { const button = document.querySelector('button[aria-label="Next page"]'); if (!button || button.disabled) return false; button.click(); return true; })()`
      );
      if (!clicked) break;
      current = await waitForRenderedChapters(client, previousFirstHref);
      logTiming(`dom-page-${page + 1}`, `rows=${current.rows.length}`);
      if (!current.rows.length) break;
    }

    logTiming("dom-done", `chapters=${chapters.size}`);
    return [...chapters.values()];
  } finally {
    client.close();
    browser.kill();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    releaseBrowserSlot();
  }
}

async function getRenderedChapterPreview(mangaId: string, language: string, targetChapter?: string): Promise<ChapterSummary[]> {
  const pageUrl = titleUrl(mangaId);
  const { browser, client, tempDir, releaseBrowserSlot } = await launchRenderedComixPage(pageUrl);
  try {
    const browserApiChapters = await evaluateInBrowser<ComixChapter[]>(
      client,
      browserChapterPreviewExpression(hashFromId(mangaId), targetChapter),
      20000
    ).catch(() => []);
    if (browserApiChapters.length) {
      return browserApiChapters
        .filter((chapter) => !language || chapter.language === language)
        .map((chapter) => toChapter(chapter, mangaId));
    }

    const current = await waitForRenderedChapters(client);
    return current.rows
      .map((row) => toRenderedChapter(row, mangaId, language))
      .filter((chapter): chapter is ChapterSummary => Boolean(chapter));
  } finally {
    client.close();
    browser.kill();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    releaseBrowserSlot();
  }
}

async function getBrowserChapterPages(id: string, mangaId: string, chapterId: string, chapterNumber: string): Promise<ChapterPages> {
  const pageUrl = chapterPageUrl(mangaId, chapterId, chapterNumber);
  const { browser, client, tempDir, releaseBrowserSlot } = await launchRenderedComixPage(pageUrl);
  try {
    const pages = await evaluateInBrowser<string[]>(client, browserChapterPagesExpression(chapterId), 45000);
    if (!pages.length) throw new Error("Comix.to did not return chapter pages.");
    return {
      source: "comix",
      id,
      pages
    };
  } finally {
    client.close();
    browser.kill();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    releaseBrowserSlot();
  }
}

async function captureSignedUrl(cacheKey: string, pageUrl: string, matcher: (url: string) => boolean) {
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { browser, client, tempDir, releaseBrowserSlot } = await launchRenderedComixPage(pageUrl);
  try {
    const inspectUrl = (url: unknown, resolve: (url: string) => void) => {
      if (typeof url === "string" && url.startsWith(API_BASE) && matcher(url)) resolve(url);
    };
    let requestHandler: ((params: Record<string, unknown>) => void) | undefined;
    let responseHandler: ((params: Record<string, unknown>) => void) | undefined;
    const signedUrl = await withTimeout(
      new Promise<string>((resolve, reject) => {
        requestHandler = (params: Record<string, unknown>) => {
          const request = params.request;
          if (request && typeof request === "object") inspectUrl((request as Record<string, unknown>).url, resolve);
        };
        responseHandler = (params: Record<string, unknown>) => {
          const response = params.response;
          if (response && typeof response === "object") inspectUrl((response as Record<string, unknown>).url, resolve);
        };

        client.on("Network.requestWillBeSent", requestHandler);
        client.on("Network.responseReceived", responseHandler);
        client
          .command("Network.enable", undefined, 10000)
          .then(() => client.command("Page.navigate", { url: pageUrl }, 10000))
          .catch(reject);
      }).finally(() => {
        if (requestHandler) client.off("Network.requestWillBeSent", requestHandler);
        if (responseHandler) client.off("Network.responseReceived", responseHandler);
      }),
      20000,
      "Comix.to browser capture"
    );
    if (!signedUrl) throw new Error("Comix.to signed API request was not captured.");

    signedUrlCache.set(cacheKey, { url: signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
    return signedUrl;
  } finally {
    client.close();
    browser.kill();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    releaseBrowserSlot();
  }
}

async function signedJson<T>(url: string, referer: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Referer: referer,
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Comix.to signed request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const body = (await response.json()) as ComixResponse<T>;
  if (body.status === "error" || (typeof body.status === "number" && body.status >= 400)) {
    throw new Error(body.messages?.[0] ?? body.message ?? "Comix.to signed request failed.");
  }
  return unwrapComixResponse<T>(body);
}

function signedChapterListUrl(signedUrl: string, hid: string, page: number) {
  const signed = new URL(signedUrl);
  const token = signed.searchParams.get("_");
  if (!token) throw new Error("Comix.to signed chapter-list token was not captured.");

  const url = new URL(`${API_BASE}/manga/${hid}/chapters`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(CHAPTER_LIST_LIMIT));
  url.searchParams.set("order[number]", "desc");
  url.searchParams.set("_", token);
  return url.toString();
}

function chapterListQuery(page: number) {
  return {
    page,
    limit: CHAPTER_LIST_LIMIT,
    "order[number]": "desc"
  };
}

const resolvedMangaIds = new Map<string, string>();

async function resolveCurrentMangaId(id: string) {
  const cached = resolvedMangaIds.get(id);
  if (cached) return cached;

  try {
    await request<ComixManga>(`/manga/${hashFromId(id)}`, mangaIncludeParams());
    resolvedMangaIds.set(id, id);
    return id;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const expectedSlug = slugFromId(id);
  const query = titleFromId(id);
  const params = new URLSearchParams({
    keyword: query,
    limit: "12",
    page: "1"
  });
  params.set("order[relevance]", "desc");

  const result = await request<ComixList<ComixManga>>("/manga", params);
  const candidates = result.items.map((item) => ({ item, id: sourceId(item) }));
  const exact =
    candidates.find((candidate) => candidate.id === id) ??
    candidates.find((candidate) => slugFromId(candidate.id) === expectedSlug) ??
    candidates.find((candidate) => slugify(candidate.item.title) === expectedSlug) ??
    candidates[0];

  if (!exact) throw new Error(`Comix.to title could not be rematched for "${query}".`);
  resolvedMangaIds.set(id, exact.id);
  return exact.id;
}

let signedApiPromise: Promise<SignedComixApi> | undefined;

async function loadSignedApi() {
  if (!signedApiPromise) signedApiPromise = createSignedApi();
  return signedApiPromise;
}

async function createSignedApi(): Promise<SignedComixApi> {
  const homeHtml = await requestHtml("/");
  const chunkPaths = Array.from(homeHtml.matchAll(/\/_next\/static\/chunks\/[^"'\s]+\.js/g), (match) => match[0]);

  const globalScope = globalThis as unknown as Record<string, unknown>;
  const previousTurbopack = globalScope.TURBOPACK;
  const previousSelf = globalScope.self;
  globalScope.TURBOPACK = [];
  globalScope.self = globalThis;

  // Comix signs chapter-list requests in its bundled client code. Load those public chunks once
  // so the local adapter can call the same public JSON endpoint as the site.
  let foundApiClient = false;
  for (const path of [...new Set(chunkPaths)]) {
    const response = await fetch(`${SITE_BASE}${path}`, {
      headers: {
        Accept: "application/javascript",
        Referer: `${SITE_BASE}/`,
        "User-Agent": USER_AGENT
      }
    });
    if (!response.ok) continue;

    const script = await response.text();
    foundApiClient ||= script.includes("https://comix.to/api/v2/") && script.includes("9165");
    try {
      (0, eval)(script);
    } catch {
      // Some presentation chunks can depend on browser-only globals; the API module does not.
    }
  }

  if (!foundApiClient) throw new Error("Comix.to signed API client was not found.");

  const modules = new Map<number, TurbopackModule>();
  const chunks = globalScope.TURBOPACK as unknown[][];
  for (const chunk of chunks) {
    for (let index = 1; index < chunk.length; index += 1) {
      if (typeof chunk[index] === "number" && typeof chunk[index + 1] === "function") {
        modules.set(chunk[index] as number, chunk[index + 1] as TurbopackModule);
        index += 1;
      } else if (
        typeof chunk[index] === "number" &&
        typeof chunk[index + 1] === "number" &&
        typeof chunk[index + 2] === "function"
      ) {
        modules.set(chunk[index + 1] as number, chunk[index + 2] as TurbopackModule);
        index += 2;
      }
    }
  }

  const cache = new Map<number, Record<string, unknown>>();
  const requireModule = (id: number): Record<string, unknown> => {
    if (id === 85696) return { default: { env: {} } };
    const cached = cache.get(id);
    if (cached) return cached;

    const module = modules.get(id);
    if (!module) return {};

    const exports: Record<string, unknown> = {};
    cache.set(id, exports);

    const runtime: TurbopackRuntime = {
      i: requireModule,
      r: requireModule,
      s(items) {
        for (let index = 0; index < items.length; ) {
          const name = String(items[index++]);
          const next = items[index++];
          if (next === 0) {
            exports[name] = items[index++];
          } else if (typeof next === "function") {
            Object.defineProperty(exports, name, { enumerable: true, get: next as () => unknown });
          } else {
            exports[name] = next;
          }
        }
      }
    };

    module(runtime, exports, exports);
    return exports;
  };

  const signedApi = requireModule(9165) as SignedComixApi;
  if (!signedApi.apiClient || !signedApi.withCache) throw new Error("Comix.to signed API client failed to load.");

  globalScope.TURBOPACK = previousTurbopack;
  if (previousSelf === undefined) {
    delete globalScope.self;
  } else {
    globalScope.self = previousSelf;
  }

  return signedApi;
}

async function signedRequest<T>(path: string, query: Record<string, unknown>) {
  const { apiClient, withCache } = await loadSignedApi();
  return apiClient.get<T>(path, withCache({ query }));
}

export const comixSource: MangaSource = {
  info: {
    id: "comix",
    name: "Comix.to",
    kind: "scraper",
    enabled: true,
    website: SITE_BASE,
    note: "Uses Comix.to public app metadata endpoints and discovers signed chapter endpoints through a cached headless browser capture."
  },

  async search(options: SearchOptions) {
    const limit = Math.min(options.limit ?? 24, 48);
    const offset = Math.max(options.offset ?? 0, 0);
    const browsingLatest = !options.query?.trim();
    const requestLimit = browsingLatest ? Math.min(Math.max(limit * 4, 48), 100) : limit;
    const page = browsingLatest ? Math.floor(offset / requestLimit) + 1 : Math.floor(offset / limit) + 1;
    const sliceStart = browsingLatest ? offset % requestLimit : 0;
    const params = new URLSearchParams({
      limit: String(requestLimit),
      page: String(page)
    });

    if (options.query?.trim()) {
      params.set("keyword", options.query.trim());
      params.set("order[relevance]", "desc");
    } else {
      params.set("order[chapter_updated_at]", "desc");
    }

    const result = await request<ComixList<ComixManga>>("/manga", params);
    const items = browsingLatest
      ? [...result.items].sort(
          (first, second) =>
            (second.followsTotal ?? second.follows_total ?? 0) - (first.followsTotal ?? first.follows_total ?? 0) ||
            (second.chapterUpdatedAt ?? second.chapter_updated_at ?? 0) -
              (first.chapterUpdatedAt ?? first.chapter_updated_at ?? 0)
      )
      : result.items;

    return items.slice(sliceStart, sliceStart + limit).map(toSummary);
  },

  async getManga(id: string) {
    const currentId = await resolveCurrentMangaId(id);
    const manga = await request<ComixManga>(`/manga/${hashFromId(currentId)}`, mangaIncludeParams());
    return toDetail(manga);
  },

  async getChapters(mangaId: string, language: string) {
    const timingEnabled = process.env.CHAPTER_TIMING === "1";
    const startedAt = Date.now();
    const logTiming = (step: string, extra = "") => {
      if (!timingEnabled) return;
      console.log(`[comix-chapter-timing] ${mangaId}:${language} ${step} ${Date.now() - startedAt}ms${extra ? ` ${extra}` : ""}`);
    };

    const currentMangaId = await resolveCurrentMangaId(mangaId);
    logTiming("resolve", `current=${currentMangaId}`);
    if (process.env.COMIX_CHAPTER_BROWSER_FIRST !== "0") {
      try {
        logTiming("browser-first");
        const chapters = await getRenderedChapters(currentMangaId, language);
        if (chapters.length) return chapters;
      } catch (error) {
        logTiming("browser-first-error", error instanceof Error ? error.message : String(error));
      }
    }

    const hid = hashFromId(currentMangaId);
    const referer = titleUrl(currentMangaId);
    const cacheKey = `chapters:${hid}`;
    const matcher = (url: string) => url.includes(`/api/v1/manga/${hid}/chapters?`);
    let signedUrl: string | undefined;
    let signedUrlPromise: Promise<string> | undefined;
    const capturedSignedUrl = async () => {
      if (signedUrl) return signedUrl;
      signedUrlPromise ??= captureSignedUrl(cacheKey, referer, matcher);
      signedUrl = await signedUrlPromise;
      return signedUrl;
    };
    const loadPage = async (page: number) => {
      const pageStartedAt = Date.now();
      try {
        const result = await signedRequest<ComixList<ComixChapter>>(`/manga/${hid}/chapters`, chapterListQuery(page));
        logTiming(`page-${page}`, `signed=${Date.now() - pageStartedAt}ms items=${comixListItems<ComixChapter>(result).length}`);
        return result;
      } catch (error) {
        const result = await signedJson<ComixList<ComixChapter>>(signedChapterListUrl(await capturedSignedUrl(), hid, page), referer);
        logTiming(`page-${page}`, `captured=${Date.now() - pageStartedAt}ms items=${comixListItems<ComixChapter>(result).length}`);
        return result;
      }
    };

    const firstPage = await loadPage(1);
    if (isEncryptedPayload(firstPage) || comixListItems<ComixChapter>(firstPage).length === 0) {
      logTiming("rendered-fallback");
      return getRenderedChapters(currentMangaId, language);
    }

    const lastPage = Math.min(comixLastPage(firstPage), 75);
    logTiming("page-count", `last=${lastPage}`);
    const pageNumbers = Array.from({ length: Math.max(0, lastPage - 1) }, (_value, index) => index + 2);
    const pages = [firstPage, ...(await mapWithConcurrency(pageNumbers, CHAPTER_PAGE_CONCURRENCY, (page) => loadPage(page)))];
    logTiming("pages-loaded", `pages=${pages.length}`);

    return pages
      .flatMap((page) => comixListItems<ComixChapter>(page))
      .filter((chapter): chapter is ComixChapter => Boolean(chapter))
      .filter((chapter) => !language || chapter.language === language)
      .map((chapter) => toChapter(chapter, currentMangaId));
  },

  async getChapterPreview(mangaId: string, language: string, targetChapter?: string) {
    const currentMangaId = await resolveCurrentMangaId(mangaId);
    return getRenderedChapterPreview(currentMangaId, language, targetChapter);
  },

  async getChapterPages(id: string): Promise<ChapterPages> {
    const decoded = decodeChapterId(id);
    if (!decoded.mangaId || !decoded.chapterNumber) {
      throw new Error("Comix.to chapter pages need a title id and chapter number.");
    }

    const browserPages = await getBrowserChapterPages(id, decoded.mangaId, decoded.chapterId, decoded.chapterNumber).catch((error) => {
      console.warn(`Comix.to browser chapter pages failed for ${decoded.chapterId}:`, error instanceof Error ? error.message : error);
      return undefined;
    });
    if (browserPages) return browserPages;

    const referer = chapterPageUrl(decoded.mangaId, decoded.chapterId, decoded.chapterNumber);
    const cacheKey = `chapter:${decoded.chapterId}`;
    const matcher = (url: string) => url.includes(`/api/v1/chapters/${decoded.chapterId}?`);
    const signedUrl = await captureSignedUrl(cacheKey, referer, matcher);
    const chapter = await signedJson<ComixChapter & { pages?: ComixPage[] | Record<string, unknown> }>(signedUrl, referer);
    const pages = comixPageUrls(chapter.pages);
    if (!pages.length) throw new Error("Comix.to did not return chapter pages.");
    return {
      source: "comix",
      id,
      pages
    };
  },

  async getTitleComments(mangaId: string, options?: { sort?: CommentSort; limit?: number; all?: boolean }) {
    return getComixTitleComments(mangaId, options);
  },

  async getChapterComments(
    mangaId: string,
    chapterNumber: string,
    options?: { volume?: string; sort?: CommentSort; limit?: number; all?: boolean }
  ) {
    return getComixChapterComments(mangaId, chapterNumber, options);
  }
};
