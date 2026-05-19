import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  authenticate,
  addInteractionBlock,
  adminDashboardStats,
  changePassword,
  addFavorite,
  claimBookmarkDownloadJobs,
  clearRecommendations,
  completeBookmarkDownloadJob,
  createUser,
  databaseLabel,
  databaseStatus,
  deleteRecommendation,
  deleteUser,
  destroySession,
  enqueueBookmarkCommentDownloadsForRef,
  enqueueBookmarkDownloadJob,
  enqueueBookmarkDownloadsForAll,
  enqueueBookmarkDownloadsForRef,
  enqueueChapterCommentDownloadJobsForChapters,
  enqueueChapterPageDownloadJobsForChapters,
  enqueueMissingChapterPageDownloadJobsForSavedChapterList,
  failBookmarkDownloadJob,
  getBookmarkUpdateLatest,
  getChapterPageCache,
  getCommentCacheByTarget,
  getUserByToken,
  getChapterListCache,
  importFavorites,
  listFavoriteRefs,
  listCachedBookmarkUpdates,
  initializeAccounts,
  listFavorites,
  listInteractionBlocks,
  listInboxRecommendations,
  listOutboxRecommendations,
  listReadingProgress,
  listShareUsers,
  listUsers,
  markAllRecommendationsRead,
  markRecommendationRead,
  removeFavorite,
  removeInteractionBlock,
  resetStaleBookmarkDownloadJobs,
  resetPassword,
  saveReadingProgress,
  sendRecommendation,
  setUserNsfwAllowed,
  titleCacheStatus,
  upsertChapterListCache,
  upsertChapterPageCache,
  upsertBookmarkUpdateCache,
  upsertCommentCache,
  unreadRecommendationCount,
  type AdminDashboardStats,
  type BookmarkDownloadJobRecord,
  type UserRole
} from "./accounts";
import { cached, cacheKey, cacheStats, cacheTtl, warmCache } from "./cache";
import {
  canonicalKeyForManga,
  cleanSynopsis,
  compiledTitleIsStale,
  enrichMangaMetadata,
  getCanonicalChapters,
  getCanonicalTitle,
  getCompiledTitle,
  getSavedMetadataTitle,
  getTaxonomyOptions,
  initializeMetadataTables,
  saveCompiledTitle,
  startMetadataRefreshCron,
  upsertCanonicalChapters
} from "./metadata";
import { defaultSource, enabledSources, fallbackSourceIds, getSource, listSources, sourceFallbackChain } from "./sources";
import { scraperSourceNotes } from "./sources/scraperTemplate";
import type { ChapterSummary, MangaDetail, MangaSource, MangaSummary, SearchOptions } from "./sources/types";

const app = express();
const port = Number(process.env.PORT ?? 4174);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const frontendRoot = path.resolve(projectRoot, "..", "frontend");
const BOOKMARK_LATEST_CHECK_PRIORITY = 200;
const BOOKMARK_LATEST_CHAPTERS_PRIORITY = 190;
const BOOKMARK_TITLE_COMMENTS_PRIORITY = 5;
const BOOKMARK_CHAPTER_COMMENTS_PRIORITY = 1;
const BOOKMARK_JOB_TYPES = [
  "title_detail",
  "latest_check",
  "chapter_list",
  "latest_chapters",
  "chapter_pages",
  "title_comments",
  "chapter_comments"
] as const;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function asyncRoute<TParams extends Record<string, string>>(
  handler: (req: express.Request<TParams>, res: express.Response) => Promise<void>
) {
  return (req: express.Request<TParams>, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };
}

function sourceOr404(sourceId?: string) {
  const source = getSource(sourceId || defaultSource());
  if (!source) {
    const error = new Error(`Unknown source: ${sourceId}`);
    error.name = "NotFound";
    throw error;
  }
  if (!source.info.enabled) {
    const error = new Error(source.info.disabledReason || `${source.info.name} is not enabled.`);
    error.name = "NotFound";
    throw error;
  }
  return source;
}

function bearerToken(req: express.Request) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

async function requireUser(req: express.Request, res: express.Response) {
  const user = await getUserByToken(bearerToken(req));
  if (!user) {
    res.status(401).json({ error: "Login required." });
    return undefined;
  }
  return user;
}

async function requireAdmin(req: express.Request, res: express.Response) {
  const user = await requireUser(req, res);
  if (!user) return undefined;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return undefined;
  }
  return user;
}

function requestString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalRequestString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function optionalRequestNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requestCommentSort(value: unknown) {
  return value === "newest" || value === "oldest" ? value : "best";
}

function countCommentItems(comments: Array<{ replies?: unknown[] }>) {
  let total = 0;
  for (const comment of comments) {
    total += 1;
    if (Array.isArray(comment.replies)) total += countCommentItems(comment.replies as Array<{ replies?: unknown[] }>);
  }
  return total;
}

function normalizeCommentPageCounts<T extends { comments: Array<{ replies?: unknown[] }>; thread: object }>(page: T): T {
  const mainCommentCount = page.comments.length;
  const commentCount = countCommentItems(page.comments);
  return {
    ...page,
    thread: {
      ...page.thread,
      commentCount,
      mainCommentCount
    }
  };
}

function cachedCommentThreadIsComplete(page: { cursor?: string }) {
  return !page.cursor;
}

function commentPreview(page: Awaited<ReturnType<typeof getCommentCacheByTarget>>, limit: number) {
  if (!page) return undefined;
  const normalized = normalizeCommentPageCounts(page);
  return {
    ...normalized,
    comments: normalized.comments.slice(0, limit)
  };
}

function requestLimit(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), max)) : fallback;
}

function bookmarkJobTypeFilter() {
  const raw = process.env.BOOKMARK_DOWNLOAD_JOB_TYPES?.trim();
  if (!raw) return undefined;
  const allowed = new Set<string>(BOOKMARK_JOB_TYPES);
  const jobTypes = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is BookmarkDownloadJobRecord["jobType"] => allowed.has(item));
  return jobTypes.length ? jobTypes : undefined;
}

function requestStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function prefetchChapterInput(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const sourceId = requestString(body.source);
  const id = requestString(body.id);
  return sourceId && id ? { sourceId, id } : undefined;
}

function favoriteInput(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  return {
    source: requestString(body.source),
    mangaId: requestString(body.id ?? body.mangaId),
    canonicalKey: optionalRequestString(body.canonicalKey),
    title: requestString(body.title),
    description: optionalRequestString(body.description),
    coverUrl: optionalRequestString(body.coverUrl),
    status: optionalRequestString(body.status),
    contentRating: optionalRequestString(body.contentRating),
    demographic: optionalRequestString(body.demographic),
    year: optionalRequestNumber(body.year),
    latestChapter: optionalRequestString(body.latestChapter),
    latestChapterReleasedAt: optionalRequestString(body.latestChapterReleasedAt),
    tags: requestStringArray(body.tags),
    addedAt: new Date().toISOString()
  };
}

function recommendationInput(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  return {
    toUserId: requestString(body.toUserId),
    source: requestString(body.source),
    mangaId: requestString(body.id ?? body.mangaId),
    title: requestString(body.title),
    coverUrl: optionalRequestString(body.coverUrl),
    contentRating: optionalRequestString(body.contentRating),
    demographic: optionalRequestString(body.demographic),
    tags: requestStringArray(body.tags),
    latestChapter: optionalRequestString(body.latestChapter),
    latestChapterReleasedAt: optionalRequestString(body.latestChapterReleasedAt)
  };
}

function cachedSearch(source: MangaSource, options: SearchOptions) {
  const query = options.query?.trim() ?? "";
  const ttl = query ? cacheTtl.search : cacheTtl.latestSearch;
  return cached(
    cacheKey("source.search", {
      source: source.info.id,
      query,
      language: options.language ?? "en",
      limit: options.limit ?? "",
      offset: options.offset ?? ""
    }),
    ttl,
    () => source.search(options)
  );
}

const titleRefreshes = new Set<string>();

async function loadSourceManga(source: MangaSource, id: string) {
  const sourceManga = await source.getManga(id);
  sourceManga.description = cleanSynopsis(sourceManga.description);
  const manga = await enrichMangaMetadata(sourceManga);
  await saveCompiledTitle(manga).catch((error: Error) =>
    console.warn(`Compiled title cache save failed for ${source.info.id}:${id}:`, error.message)
  );
  return manga;
}

function refreshCompiledTitle(source: MangaSource, id: string) {
  const key = `${source.info.id}:${id}`;
  if (titleRefreshes.has(key)) return;
  titleRefreshes.add(key);
  loadSourceManga(source, id)
    .catch((error: Error) => console.warn(`Compiled title refresh failed for ${key}:`, error.message))
    .finally(() => titleRefreshes.delete(key));
}

async function cachedManga(source: MangaSource, id: string) {
  const compiled = await getCompiledTitle(source.info.id, id).catch(() => undefined);
  if (compiled) {
    if (compiledTitleIsStale(compiled.updatedAt)) refreshCompiledTitle(source, id);
    return compiled.manga;
  }

  const savedMetadata = await getSavedMetadataTitle(source.info.id, id).catch(() => undefined);
  if (savedMetadata) {
    void saveCompiledTitle(savedMetadata).catch((error: Error) =>
      console.warn(`Compiled title metadata seed failed for ${source.info.id}:${id}:`, error.message)
    );
    refreshCompiledTitle(source, id);
    return savedMetadata;
  }

  return cached(cacheKey("source.manga", { source: source.info.id, id }), cacheTtl.mangaDetail, () => loadSourceManga(source, id));
}

const chapterListRefreshes = new Set<string>();

async function loadAndSaveChapters(source: MangaSource, id: string, language: string) {
  try {
    const chapters = await source.getChapters(id, language);
    await upsertCanonicalChapters(source.info.id, id, language, chapters).catch((error: Error) =>
      console.warn(`Canonical chapter save failed for ${source.info.id}:${id}:`, error.message)
    );
    await upsertChapterListCache({
      source: source.info.id,
      mangaId: id,
      language,
      chapters
    }).catch((error: Error) => console.warn(`Chapter list cache save failed for ${source.info.id}:${id}:`, error.message));
    return chapters;
  } catch (error) {
    await upsertChapterListCache({
      source: source.info.id,
      mangaId: id,
      language,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}

function refreshChapterListCache(source: MangaSource, id: string, language: string) {
  const key = `${source.info.id}:${id}:${language}`;
  if (chapterListRefreshes.has(key)) return;
  chapterListRefreshes.add(key);
  cached(cacheKey("source.chapters", { source: source.info.id, id, language }), cacheTtl.chapters, () =>
    loadAndSaveChapters(source, id, language)
  )
    .catch((error: Error) => console.warn(`Chapter list refresh failed for ${key}:`, error.message))
    .finally(() => chapterListRefreshes.delete(key));
}

function chapterListMissingReleaseDates(chapters: ChapterSummary[]) {
  return chapters.length > 0 && !chapters.some((chapter) => chapter.publishedAt || chapter.readableAt);
}

async function cachedChapters(source: MangaSource, id: string, language: string, targetChapter?: string) {
  const memoryKey = cacheKey("source.chapters", { source: source.info.id, id, language });
  const persistent = await getChapterListCache(source.info.id, id, language).catch(() => undefined);
  if (persistent?.chapters.length) {
    if (source.info.id === "comix" && chapterListMissingReleaseDates(persistent.chapters)) {
      try {
        return await loadAndSaveChapters(source, id, language);
      } catch (error) {
        console.warn(`Chapter list date repair failed for ${source.info.id}:${id}:`, error instanceof Error ? error.message : String(error));
        return persistent.chapters;
      }
    }

    const age = Date.now() - new Date(persistent.checkedAt).getTime();
    if (Number.isFinite(age) && age < cacheTtl.chapters) {
      return cached(memoryKey, cacheTtl.chapters, () => Promise.resolve(persistent.chapters));
    }
    refreshChapterListCache(source, id, language);
    return persistent.chapters;
  }

  if (source.getChapterPreview) {
    try {
      const preview = await source.getChapterPreview(id, language, targetChapter);
      refreshChapterListCache(source, id, language);
      return preview;
    } catch {
      return cached(memoryKey, cacheTtl.chapters, () => loadAndSaveChapters(source, id, language));
    }
  }

  return cached(memoryKey, cacheTtl.chapters, () => loadAndSaveChapters(source, id, language));
}

const chapterPageRefreshes = new Set<string>();
const chapterPagePersistentTtlMs = Number(process.env.CHAPTER_PAGE_CACHE_TTL_MS ?? 1000 * 60 * 60 * 24 * 7);

type ChapterPageCacheContext = {
  mangaId?: string;
  chapterNumber?: string;
  language?: string;
};

async function loadAndSaveChapterPages(source: MangaSource, id: string, context: ChapterPageCacheContext = {}) {
  try {
    const pages = await source.getChapterPages(id);
    await upsertChapterPageCache({
      source: source.info.id,
      chapterId: id,
      mangaId: context.mangaId,
      chapterNumber: context.chapterNumber,
      language: context.language ?? "en",
      pages: pages.pages
    }).catch((error: Error) => console.warn(`Chapter page cache save failed for ${source.info.id}:${id}:`, error.message));
    return pages;
  } catch (error) {
    await upsertChapterPageCache({
      source: source.info.id,
      chapterId: id,
      mangaId: context.mangaId,
      chapterNumber: context.chapterNumber,
      language: context.language ?? "en",
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}

function refreshChapterPageCache(source: MangaSource, id: string, context: ChapterPageCacheContext = {}) {
  const key = `${source.info.id}:${id}`;
  if (chapterPageRefreshes.has(key)) return;
  chapterPageRefreshes.add(key);
  cached(cacheKey("source.chapterPages", { source: source.info.id, id }), cacheTtl.chapterPages, () =>
    loadAndSaveChapterPages(source, id, context)
  )
    .catch((error: Error) => console.warn(`Chapter page refresh failed for ${key}:`, error.message))
    .finally(() => chapterPageRefreshes.delete(key));
}

async function cachedChapterPages(source: MangaSource, id: string, context: ChapterPageCacheContext = {}) {
  const memoryKey = cacheKey("source.chapterPages", { source: source.info.id, id });
  const persistent = await getChapterPageCache(source.info.id, id).catch(() => undefined);
  if (persistent?.pages.pages.length) {
    const age = Date.now() - new Date(persistent.checkedAt).getTime();
    if (Number.isFinite(age) && age < chapterPagePersistentTtlMs) {
      return cached(memoryKey, cacheTtl.chapterPages, () => Promise.resolve(persistent.pages));
    }
    refreshChapterPageCache(source, id, {
      mangaId: context.mangaId ?? persistent.mangaId,
      chapterNumber: context.chapterNumber ?? persistent.chapterNumber,
      language: context.language ?? persistent.language
    });
    return persistent.pages;
  }

  return cached(memoryKey, cacheTtl.chapterPages, () => loadAndSaveChapterPages(source, id, context));
}

function publicCache(res: express.Response, maxAgeSeconds: number) {
  res.set("Cache-Control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${Math.max(maxAgeSeconds * 4, 60)}`);
}

function revalidateCache(res: express.Response) {
  res.set("Cache-Control", "private, no-cache, must-revalidate");
}

function envMs(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function addMs(value: string | undefined, ms: number) {
  if (!value || ms <= 0) return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return undefined;
  return new Date(time + ms).toISOString();
}

function recentActivityValue(dashboard: AdminDashboardStats, label: string) {
  return dashboard.recentActivity.find((item) => item.label === label)?.value;
}

function buildRefreshSchedules(dashboard: AdminDashboardStats): NonNullable<AdminDashboardStats["refreshSchedules"]> {
  const cacheWarmIntervalMs = envMs("CACHE_WARM_INTERVAL_MS", 1000 * 60 * 10);
  const latestCheckIntervalMs = envMs("BOOKMARK_LATEST_CHECK_INTERVAL_MS", 1000 * 60 * 10);
  const workerIntervalMs = envMs("BOOKMARK_DOWNLOAD_INTERVAL_MS", 5000);
  const metadataRefreshIntervalMs = envMs("MANGAUPDATES_REFRESH_INTERVAL_MS", 1000 * 60 * 60);
  const commentRefreshIntervalMs = envMs("BOOKMARK_COMMENT_REFRESH_INTERVAL_MS", 1000 * 60 * 60 * 24);
  const compiledTitleTtlMs = envMs("COMPILED_TITLE_CACHE_TTL_MS", 1000 * 60 * 60 * 24);
  const metadataTtlMs = envMs("MANGAUPDATES_METADATA_TTL_MS", 1000 * 60 * 60 * 24);
  const chapterPageTtlMs = envMs("CHAPTER_PAGE_CACHE_TTL_MS", 1000 * 60 * 60 * 24 * 7);
  const workerEnabled = process.env.BOOKMARK_DOWNLOAD_WORKER !== "0";
  const runningJobs = dashboard.jobStatus.find((item) => item.status === "running")?.count ?? 0;
  const commentJobs = dashboard.jobTypes.filter((item) => item.jobType === "title_comments" || item.jobType === "chapter_comments");
  const commentPending = commentJobs.reduce((total, item) => total + item.pending, 0);
  const commentRunning = commentJobs.reduce((total, item) => total + item.running, 0);
  const commentFailed = commentJobs.reduce((total, item) => total + item.failed, 0);

  return [
    {
      key: "home-latest-warmer",
      label: "Home latest/search warmer",
      status: cacheWarmIntervalMs <= 0 ? "Disabled" : cacheWarmRunning ? "Running" : "Enabled",
      lastRefreshedAt: lastCacheWarmFinishedAt,
      nextRefreshAt: cacheWarmIntervalMs > 0 ? nextCacheWarmAt : undefined,
      intervalMs: cacheWarmIntervalMs > 0 ? cacheWarmIntervalMs : undefined,
      detail: lastCacheWarmError
        ? `Last error: ${lastCacheWarmError}`
        : "Warms Comix home/latest search results and bookmarked title details in memory."
    },
    {
      key: "bookmark-latest-check",
      label: "Bookmark latest checks",
      status: !workerEnabled
        ? "Disabled here"
        : latestCheckIntervalMs <= 0
          ? "Disabled"
          : bookmarkLatestCheckQueueRunning
            ? "Queueing"
            : bookmarkLatestCheckDrainRunning
              ? "Running"
              : "Enabled",
      lastRefreshedAt: dashboard.jobActivity.latestCheckLastCompletedAt ?? lastBookmarkLatestCheckQueuedAt,
      nextRefreshAt: workerEnabled && latestCheckIntervalMs > 0 ? dashboard.jobActivity.latestCheckNextQueuedAt ?? nextBookmarkLatestCheckAt : undefined,
      intervalMs: workerEnabled && latestCheckIntervalMs > 0 ? latestCheckIntervalMs : undefined,
      detail: lastBookmarkLatestCheckError
        ? `Last error: ${lastBookmarkLatestCheckError}`
        : "Checks only bookmarked titles for new latest chapters using a dedicated fast worker lane."
    },
    {
      key: "bookmark-download-worker",
      label: "Bookmark download worker",
      status: workerEnabled ? (runningJobs > 0 ? "Running" : "Enabled") : runningJobs > 0 ? "External worker" : "Disabled here",
      lastRefreshedAt: dashboard.jobActivity.workerLastCompletedAt,
      nextRefreshAt: workerEnabled && workerIntervalMs > 0 ? new Date(Date.now() + workerIntervalMs).toISOString() : undefined,
      intervalMs: workerEnabled && workerIntervalMs > 0 ? workerIntervalMs : undefined,
      detail: "Processes queued title detail, chapter list, latest chapter, and chapter page URL jobs."
    },
    {
      key: "bookmark-comment-refresh",
      label: "Bookmark comment refresh",
      status: commentRefreshIntervalMs <= 0
        ? "Disabled"
        : commentRunning > 0
          ? "Running"
          : commentPending > 0
            ? "Queued"
            : "Enabled",
      lastRefreshedAt: recentActivityValue(dashboard, "Comix comments"),
      nextRefreshAt: addMs(recentActivityValue(dashboard, "Comix comments"), commentRefreshIntervalMs),
      intervalMs: commentRefreshIntervalMs > 0 ? commentRefreshIntervalMs : undefined,
      detail: `Read-only Comix comments for bookmarked titles refresh daily at low priority. Pending: ${commentPending}, running: ${commentRunning}, failed: ${commentFailed}.`
    },
    {
      key: "mangaupdates-refresh",
      label: "Metadata refresh",
      status: metadataRefreshIntervalMs <= 0 ? "Disabled" : "Enabled",
      lastRefreshedAt: recentActivityValue(dashboard, "MangaUpdates metadata"),
      nextRefreshAt: addMs(recentActivityValue(dashboard, "MangaUpdates metadata"), metadataRefreshIntervalMs),
      intervalMs: metadataRefreshIntervalMs > 0 ? metadataRefreshIntervalMs : undefined,
      detail: `Scheduler scans stored title metadata rows older than ${Math.round(metadataTtlMs / (1000 * 60 * 60))} hours and enriches them with MangaUpdates, MyAnimeList, and AniList.`
    },
    {
      key: "title-detail-db",
      label: "Title detail DB storage",
      status: "On demand",
      lastRefreshedAt: recentActivityValue(dashboard, "Title detail cache"),
      nextRefreshAt: addMs(recentActivityValue(dashboard, "Title detail cache"), compiledTitleTtlMs),
      intervalMs: compiledTitleTtlMs,
      detail: "A stale title is returned immediately, then refreshed in the background when opened."
    },
    {
      key: "chapter-list-db",
      label: "Chapter list DB storage",
      status: "On demand",
      lastRefreshedAt: recentActivityValue(dashboard, "Chapter list cache"),
      nextRefreshAt: addMs(recentActivityValue(dashboard, "Chapter list cache"), cacheTtl.chapters),
      intervalMs: cacheTtl.chapters,
      detail: "A saved list older than this is returned first, then refreshed in the background."
    },
    {
      key: "chapter-page-db",
      label: "Chapter page URL DB storage",
      status: "On demand",
      lastRefreshedAt: recentActivityValue(dashboard, "Chapter page cache"),
      nextRefreshAt: addMs(recentActivityValue(dashboard, "Chapter page cache"), chapterPageTtlMs),
      intervalMs: chapterPageTtlMs,
      detail: "Stores image URLs for chapters. Old rows are served immediately and refreshed after this age."
    }
  ];
}

function sizeLimitStream(maxBytes: number) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += Buffer.byteLength(chunk);
      if (total > maxBytes) {
        callback(new Error("Image response exceeded size limit."));
        return;
      }
      callback(null, chunk);
    }
  });
}

const proxiedImageHosts = new Set(["uploads.mangadex.org", "projectsuki.com", "www.projectsuki.com"]);

function imageProxyUrl(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (!proxiedImageHosts.has(url.hostname) && !/^([a-z0-9-]+\.)?wowpic\d*\.store$/i.test(url.hostname))
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|of|to|with|in|on|my|i)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function mangadexIdFromLink(value?: string) {
  return value?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

async function directLinkedMirrors(base: MangaDetail) {
  const mirrors: MangaSummary[] = [];
  const mangadexId = mangadexIdFromLink(base.links?.md);
  if (mangadexId && base.source !== "mangadex") {
    const source = getSource("mangadex");
    if (source?.info.enabled) {
      const manga = await cachedManga(source, mangadexId).catch(() => undefined);
      if (manga) mirrors.push(manga);
    }
  }
  return mirrors;
}

function titleContainsLikelyMirror(left: string, right: string) {
  const shorter = Math.min(left.length, right.length);
  const longer = Math.max(left.length, right.length);
  return shorter >= 12 && shorter / longer >= 0.82 && (left.includes(right) || right.includes(left));
}

function isLikelyMirror(base: MangaDetail | MangaSummary, candidate: MangaSummary) {
  const baseTitles = [base.title, ...("altTitles" in base ? base.altTitles : [])].filter(Boolean);
  return baseTitles.some((title) => {
    const left = normalizeTitle(title);
    const right = normalizeTitle(candidate.title);
    if (!left || !right) return false;
    return left === right || titleContainsLikelyMirror(left, right) || titleSimilarity(title, candidate.title) >= 0.9;
  });
}

async function firstSuccessful<T>(tasks: Array<{ source: MangaSource; run: () => Promise<T> }>) {
  const errors: string[] = [];
  for (const task of tasks) {
    try {
      return { source: task.source, value: await task.run() };
    } catch (error) {
      errors.push(`${task.source.info.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join(" | ") || "No sources were available.");
}

async function searchWithFallback(preferredId: string, options: SearchOptions) {
  const chain = preferredId === "all" ? enabledSources() : sourceFallbackChain(preferredId);
  const query = options.query?.trim();

  if (preferredId === "all" || !query) {
    const results = await Promise.all(
      chain.map((source) => cachedSearch(source, options).catch(() => [] as MangaSummary[]))
    );
    const merged = new Map<string, MangaSummary>();
    for (const item of results.flat()) {
      const key = `${normalizeTitle(item.title)}:${item.latestChapter ?? ""}`;
      if (!merged.has(key)) merged.set(key, item);
    }
    return [...merged.values()].slice(0, options.limit ?? 24);
  }

  const result = await firstSuccessful(
    chain.map((source) => ({
      source,
      run: () => cachedSearch(source, options).then((items) => {
        if (!items.length) throw new Error("No results.");
        return items;
      })
    }))
  );
  return result.value;
}

async function discoverMirrors(base: MangaDetail, limit = 4) {
  const terms = [base.title, ...base.altTitles].filter(Boolean).slice(0, 4);
  const mirrors = new Map<string, MangaSummary>();

  const linkedMirrors = await directLinkedMirrors(base).catch(() => []);
  for (const mirror of linkedMirrors) {
    if (mirror.source !== base.source) {
      mirrors.set(`${mirror.source}:${mirror.id}`, mirror);
    }
  }

  for (const sourceId of fallbackSourceIds(base.source)) {
    if ([...mirrors.values()].some((mirror) => mirror.source === sourceId)) continue;
    const source = getSource(sourceId);
    if (!source?.info.enabled) continue;
    for (const term of terms) {
      const candidates = await cachedSearch(source, { query: term, language: "en", limit: 8, offset: 0 }).catch(() => []);
      for (const candidate of candidates) {
        if (candidate.source !== base.source && isLikelyMirror(base, candidate)) {
          mirrors.set(`${candidate.source}:${candidate.id}`, candidate);
        }
      }
      if ([...mirrors.values()].filter((item) => item.source === sourceId).length) break;
    }
    if (mirrors.size >= limit) break;
  }

  return [...mirrors.values()].slice(0, limit);
}

async function mangaWithMirrors(source: MangaSource, id: string) {
  const manga = await cachedManga(source, id);
  const mirrors = await discoverMirrors(manga).catch(() => []);
  return mirrors.length ? { ...manga, mirrors } : manga;
}

async function chaptersWithMirrors(source: MangaSource, id: string, language: string, targetChapter?: string) {
  const timingEnabled = process.env.CHAPTER_TIMING === "1";
  const startedAt = Date.now();
  const logTiming = (step: string, extra = "") => {
    if (!timingEnabled) return;
    console.log(`[chapter-timing] ${source.info.id}:${id}:${language} ${step} ${Date.now() - startedAt}ms${extra ? ` ${extra}` : ""}`);
  };

  const primaryError: unknown[] = [];
  const primaryChapters = await cachedChapters(source, id, language, targetChapter).catch((error) => {
    primaryError.push(error);
    return [] as ChapterSummary[];
  });
  logTiming("primary", `chapters=${primaryChapters.length}`);

  if (primaryChapters.length) {
    void upsertCanonicalChapters(source.info.id, id, language, primaryChapters).catch(() => undefined);
    logTiming("done", `chapters=${primaryChapters.length} mirrors=skipped`);
    return primaryChapters;
  }

  const base = await cachedManga(source, id).catch(() => undefined);
  logTiming("manga", base ? `title=${JSON.stringify(base.title)}` : "missing");
  if (!base) {
    const error = primaryError[0];
    if (error instanceof Error) throw error;
    return primaryChapters;
  }

  const mirrors = await discoverMirrors(base, 3).catch(() => []);
  logTiming("mirrors", `count=${mirrors.length} ids=${mirrors.map((mirror) => `${mirror.source}:${mirror.id}`).join(",")}`);
  const mirrorChapters = await Promise.all(
    mirrors.map(async (mirror) => {
      const mirrorSource = getSource(mirror.source);
      if (!mirrorSource?.info.enabled) return [];
      return cachedChapters(mirrorSource, mirror.id, language).catch(() => [] as ChapterSummary[]);
    })
  );
  logTiming("mirror-chapters", `chapters=${mirrorChapters.flat().length}`);

  const seen = new Set<string>();
  const mergedChapters = [...primaryChapters, ...mirrorChapters.flat()].filter((chapter) => {
    const key = `${chapter.source}:${chapter.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  logTiming("done", `chapters=${mergedChapters.length}`);
  if (mergedChapters.length) return mergedChapters;
  const error = primaryError[0];
  if (error instanceof Error) throw error;
  return mergedChapters;
}

async function fallbackChapterPages(
  preferredSource: MangaSource,
  mangaId: string | undefined,
  chapterNumber: string | undefined,
  language: string
) {
  if (!mangaId || !chapterNumber) return undefined;
  const base = await cachedManga(preferredSource, mangaId).catch(() => undefined);
  if (!base) return undefined;
  const mirrors = await discoverMirrors(base, 4).catch(() => []);
  for (const mirror of mirrors) {
    const source = getSource(mirror.source);
    if (!source?.info.enabled) continue;
    const chapters = await cachedChapters(source, mirror.id, language).catch(() => []);
    const match = chapters.find((chapter) => chapter.chapter === chapterNumber);
    if (!match) continue;
    const pages = await cachedChapterPages(source, match.id, {
      mangaId: match.mangaId,
      chapterNumber: match.chapter,
      language: match.language
    }).catch(() => undefined);
    if (pages?.pages.length) return pages;
  }
  return undefined;
}

async function sourceHealth() {
  return Promise.all(
    enabledSources().map(async (source) => {
      const startedAt = Date.now();
      try {
        const manga = await cachedSearch(source, { language: "en", limit: 1, offset: 0 });
        return {
          id: source.info.id,
          name: source.info.name,
          ok: true,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          sampleTitle: manga[0]?.title
        };
      } catch (error) {
        return {
          id: source.info.id,
          name: source.info.name,
          ok: false,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

function textTokens(value?: string) {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
}

function scoreSimilarTitle(base: MangaDetail, candidate: MangaSummary) {
  const baseGenres = new Set((base.genres ?? []).map((tag) => tag.toLowerCase()));
  const candidateGenres = new Set((candidate.genres ?? []).map((tag) => tag.toLowerCase()));
  const baseCategories = new Set((base.categories ?? base.tags).map((tag) => tag.toLowerCase()));
  const candidateCategories = new Set((candidate.categories ?? candidate.tags).map((tag) => tag.toLowerCase()));
  const baseTags = new Set(base.tags.map((tag) => tag.toLowerCase()));
  const candidateTags = new Set(candidate.tags.map((tag) => tag.toLowerCase()));
  let score = 0;

  for (const genre of candidateGenres) {
    if (baseGenres.has(genre)) score += 8;
  }

  for (const category of candidateCategories) {
    if (baseCategories.has(category)) score += 4;
  }

  for (const tag of candidateTags) {
    if (baseTags.has(tag)) score += 2;
  }

  if (base.demographic && candidate.demographic && base.demographic.toLowerCase() === candidate.demographic.toLowerCase()) score += 4;
  if (
    base.contentRating &&
    candidate.contentRating &&
    base.contentRating.toLowerCase() === candidate.contentRating.toLowerCase()
  ) {
    score += 2;
  }
  if (base.year && candidate.year) score += Math.max(0, 3 - Math.abs(base.year - candidate.year));

  const baseTokens = textTokens(`${base.title} ${base.altTitles.join(" ")}`);
  for (const token of textTokens(candidate.title)) {
    if (baseTokens.has(token)) score += 1;
  }

  if (candidate.latestChapterReleasedAt) {
    const ageDays = (Date.now() - new Date(candidate.latestChapterReleasedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(ageDays) && ageDays < 30) score += 1;
  }

  return score;
}

function isSameLogicalTitle(base: MangaDetail, candidate: MangaSummary) {
  if (candidate.source === base.source && candidate.id === base.id) return true;
  if (base.canonicalKey && candidate.canonicalKey && base.canonicalKey === candidate.canonicalKey) return true;
  return false;
}

async function getSimilarTitles(source: MangaSource, id: string) {
  return cached(cacheKey("source.similar", { source: source.info.id, id }), cacheTtl.similarTitles, async () => {
    const base = await cachedManga(source, id);
    const candidateMap = new Map<string, MangaSummary>();
    const searchTerms = [
      ...(base.genres ?? []).slice(0, 4),
      ...(base.categories ?? []).slice(0, 4),
      ...base.tags.slice(0, 3),
      base.demographic,
      ...base.altTitles.slice(0, 2)
    ]
      .filter((term): term is string => Boolean(term?.trim()))
      .slice(0, 8);

    for (const term of searchTerms) {
      const results = await cachedSearch(source, { query: term, language: "en", limit: 24, offset: 0 }).catch(() => []);
      for (const candidate of results) {
        if (candidate.source === source.info.id && !isSameLogicalTitle(base, candidate)) {
          candidateMap.set(`${candidate.source}:${candidate.id}`, candidate);
        }
      }
    }

    if (candidateMap.size < 12) {
      const latest = await cachedSearch(source, { language: "en", limit: 48, offset: 0 }).catch(() => []);
      for (const candidate of latest) {
        if (candidate.source === source.info.id && !isSameLogicalTitle(base, candidate)) {
          candidateMap.set(`${candidate.source}:${candidate.id}`, candidate);
        }
      }
    }

    return [...candidateMap.values()]
      .filter((candidate) => !isSameLogicalTitle(base, candidate))
      .map((candidate) => ({ candidate, score: scoreSimilarTitle(base, candidate) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return (
          (new Date(right.candidate.latestChapterReleasedAt ?? 0).getTime() || 0) -
          (new Date(left.candidate.latestChapterReleasedAt ?? 0).getTime() || 0)
        );
      })
      .slice(0, 24)
      .map(({ candidate }) => candidate);
  });
}

function chapterNumberValue(value?: string) {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function chapterDateValue(chapter: ChapterSummary) {
  const timestamp = new Date(chapter.publishedAt ?? chapter.readableAt ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestChapterFrom(chapters: ChapterSummary[]) {
  return [...chapters].sort((left, right) => {
    const rightNumber = chapterNumberValue(right.chapter);
    const leftNumber = chapterNumberValue(left.chapter);
    if (rightNumber !== undefined && leftNumber !== undefined && rightNumber !== leftNumber) return rightNumber - leftNumber;
    if (rightNumber !== undefined && leftNumber === undefined) return -1;
    if (rightNumber === undefined && leftNumber !== undefined) return 1;
    return chapterDateValue(right) - chapterDateValue(left);
  })[0];
}

function chapterSortValue(chapter: ChapterSummary) {
  return chapterNumberValue(chapter.chapter) ?? -1;
}

function maxChapterNumber(chapters: ChapterSummary[]) {
  const values = chapters.map((chapter) => chapterNumberValue(chapter.chapter)).filter((value): value is number => value !== undefined);
  return values.length ? Math.max(...values) : undefined;
}

function chapterCacheKey(chapter: ChapterSummary) {
  return chapter.id ? `${chapter.source}:${chapter.id}` : `${chapter.source}:${chapter.mangaId}:${chapter.chapter ?? chapter.title}`;
}

function sortChaptersForCache(chapters: ChapterSummary[]) {
  return [...chapters].sort((left, right) => {
    const rightNumber = chapterSortValue(right);
    const leftNumber = chapterSortValue(left);
    if (rightNumber !== leftNumber) return rightNumber - leftNumber;
    return chapterDateValue(right) - chapterDateValue(left);
  });
}

function mergeChapterLists(existing: ChapterSummary[], incoming: ChapterSummary[]) {
  const byKey = new Map<string, ChapterSummary>();
  for (const chapter of existing) {
    byKey.set(chapterCacheKey(chapter), chapter);
  }
  for (const chapter of incoming) {
    byKey.set(chapterCacheKey(chapter), chapter);
  }
  return sortChaptersForCache([...byKey.values()]);
}

function missingNewChapters(existing: ChapterSummary[], incoming: ChapterSummary[]) {
  const existingKeys = new Set(existing.map(chapterCacheKey));
  const existingMax = maxChapterNumber(existing);
  return incoming.filter((chapter) => {
    if (existingKeys.has(chapterCacheKey(chapter))) return false;
    const chapterNumber = chapterNumberValue(chapter.chapter);
    return existingMax === undefined || chapterNumber === undefined || chapterNumber > existingMax;
  });
}

function latestChapterFromManga(manga: MangaSummary): ChapterSummary | undefined {
  if (!manga.latestChapter) return undefined;
  return {
    source: manga.source,
    id: `${manga.source}:${manga.id}:latest:${manga.latestChapter}`,
    mangaId: manga.id,
    title: manga.latestChapter ? `Chapter ${manga.latestChapter}` : "",
    chapter: manga.latestChapter,
    language: "en",
    publishedAt: manga.latestChapterReleasedAt,
    groups: []
  };
}

function compactHomeManga(manga: MangaSummary, extra: Record<string, unknown> = {}) {
  return {
    source: manga.source,
    id: manga.id,
    canonicalKey: manga.canonicalKey,
    title: manga.title,
    coverUrl: manga.coverUrl,
    latestChapter: manga.latestChapter,
    latestChapterReleasedAt: manga.latestChapterReleasedAt,
    lastReadChapter: "lastReadChapter" in manga ? (manga as { lastReadChapter?: string }).lastReadChapter : undefined,
    contentRating: manga.contentRating,
    ...extra
  };
}

function compactFavoriteManga(favorite: Awaited<ReturnType<typeof listFavorites>>[number], extra: Record<string, unknown> = {}) {
  return compactHomeManga(
    {
      source: favorite.source,
      id: favorite.mangaId,
      canonicalKey: favorite.canonicalKey,
      title: favorite.title,
      coverUrl: favorite.coverUrl,
      latestChapter: favorite.latestChapter,
      latestChapterReleasedAt: favorite.latestChapterReleasedAt,
      contentRating: favorite.contentRating,
      tags: []
    },
    {
      lastReadChapter: favorite.lastReadChapter,
      ...extra
    }
  );
}

async function savedCompactManga(sourceId: string, id: string) {
  const compiled = await getCompiledTitle(sourceId, id).catch(() => undefined);
  if (compiled) return compactHomeManga(compiled.manga);
  const saved = await getSavedMetadataTitle(sourceId, id).catch(() => undefined);
  return saved ? compactHomeManga(saved) : undefined;
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

let cacheWarmRunning = false;
let lastCacheWarmStartedAt: string | undefined;
let lastCacheWarmFinishedAt: string | undefined;
let lastCacheWarmError: string | undefined;
let nextCacheWarmAt: string | undefined;

async function warmSourceCache() {
  const warmStartedAt = Date.now();
  let warmed = 0;
  const source = getSource("comix");

  if (source?.info.enabled) {
    for (const offset of [0, 24, 48]) {
      const options = { query: undefined, language: "en", limit: 24, offset };
      const ok = await warmCache(
        cacheKey("source.search", {
          source: source.info.id,
          query: "",
          language: options.language,
          limit: options.limit,
          offset: options.offset
        }),
        cacheTtl.latestSearch,
        () => source.search(options)
      );
      if (ok) warmed += 1;
    }
  }

  const refs = await listFavoriteRefs(Number(process.env.CACHE_WARM_BOOKMARK_LIMIT ?? 60));
  for (const ref of refs) {
    const favoriteSource = getSource(ref.source);
    if (!favoriteSource?.info.enabled) continue;

    const detailOk = await warmCache(
      cacheKey("source.manga", { source: favoriteSource.info.id, id: ref.mangaId }),
      cacheTtl.mangaDetail,
      () =>
        withTimeout(
          loadSourceManga(favoriteSource, ref.mangaId),
          Number(process.env.CACHE_WARM_DETAIL_TIMEOUT_MS ?? 15000),
          `${favoriteSource.info.name} title warm`
        )
    );
    if (detailOk) warmed += 1;

    if (favoriteSource.info.id === "comix" && process.env.CACHE_WARM_COMIX_CHAPTERS !== "1") {
      continue;
    }

    try {
      const chapters = await withTimeout(
        cachedChapters(favoriteSource, ref.mangaId, "en"),
        Number(process.env.CACHE_WARM_CHAPTER_TIMEOUT_MS ?? 15000),
        `${favoriteSource.info.name} chapter warm`
      );
      await upsertBookmarkUpdateCache({
        source: ref.source,
        mangaId: ref.mangaId,
        canonicalKey: ref.canonicalKey,
        latestChapter: latestChapterFrom(chapters)
      });
      warmed += 1;
    } catch (error) {
      await upsertBookmarkUpdateCache({
        source: ref.source,
        mangaId: ref.mangaId,
        canonicalKey: ref.canonicalKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  console.log(`Cache warm completed: ${warmed} entries in ${Date.now() - warmStartedAt}ms`);
}

function startCacheWarmer() {
  const intervalMs = Number(process.env.CACHE_WARM_INTERVAL_MS ?? 1000 * 60 * 10);
  if (intervalMs <= 0) return;

  nextCacheWarmAt = new Date(Date.now() + 2500).toISOString();
  const run = () => {
    if (cacheWarmRunning) return;
    cacheWarmRunning = true;
    lastCacheWarmStartedAt = new Date().toISOString();
    nextCacheWarmAt = undefined;
    warmSourceCache()
      .then(() => {
        lastCacheWarmError = undefined;
      })
      .catch((error: Error) => {
        lastCacheWarmError = error.message;
        console.warn("Cache warm failed:", error.message);
      })
      .finally(() => {
        cacheWarmRunning = false;
        lastCacheWarmFinishedAt = new Date().toISOString();
        nextCacheWarmAt = new Date(Date.now() + intervalMs).toISOString();
      });
  };

  setTimeout(run, 2500);
  setInterval(run, intervalMs);
}

async function enqueueLatestCheckJobs() {
  const refs = await listFavoriteRefs(Number(process.env.BOOKMARK_DOWNLOAD_BACKFILL_LIMIT ?? 500));
  for (const ref of refs) {
    await enqueueBookmarkDownloadJob({ jobType: "latest_check", ...ref, priority: BOOKMARK_LATEST_CHECK_PRIORITY });
  }
  return refs.length;
}

async function enqueueBookmarkCommentRefreshJobs(refreshExisting = true) {
  const refs = await listFavoriteRefs(Number(process.env.BOOKMARK_DOWNLOAD_BACKFILL_LIMIT ?? 500));
  let queued = 0;
  for (const ref of refs) {
    queued += await enqueueBookmarkCommentDownloadsForRef(ref, BOOKMARK_TITLE_COMMENTS_PRIORITY, refreshExisting);
  }
  return { titles: refs.length, jobs: queued };
}

let bookmarkLatestCheckQueueRunning = false;
let bookmarkLatestCheckDrainRunning = false;
let lastBookmarkLatestCheckQueuedAt: string | undefined;
let lastBookmarkLatestCheckError: string | undefined;
let nextBookmarkLatestCheckAt: string | undefined;
let bookmarkCommentQueueRunning = false;

async function runLatestCheckJob(source: MangaSource, job: BookmarkDownloadJobRecord) {
  const previous = await getBookmarkUpdateLatest(job.source, job.mangaId).catch(() => undefined);
  const manga = await withTimeout(
    loadSourceManga(source, job.mangaId),
    Number(process.env.BOOKMARK_LATEST_CHECK_TIMEOUT_MS ?? 15000),
    `${source.info.name} latest check`
  );
  const latestChapter = latestChapterFromManga(manga);
  if (!latestChapter) return;

  if (!previous || previous.chapter !== latestChapter.chapter) {
    await upsertBookmarkUpdateCache({
      source: job.source,
      mangaId: job.mangaId,
      canonicalKey: job.canonicalKey ?? manga.canonicalKey,
      latestChapter
    });
    await enqueueBookmarkDownloadJob({
      jobType: "latest_chapters",
      source: job.source,
      mangaId: job.mangaId,
      canonicalKey: job.canonicalKey ?? manga.canonicalKey,
      language: job.language,
      priority: BOOKMARK_LATEST_CHAPTERS_PRIORITY
    });
  }
}

async function runLatestChaptersJob(source: MangaSource, job: BookmarkDownloadJobRecord) {
  const persistent = await getChapterListCache(job.source, job.mangaId, job.language).catch(() => undefined);
  const existing = persistent?.chapters ?? [];
  if (!existing.length) {
    const chapters = await withTimeout(
      loadAndSaveChapters(source, job.mangaId, job.language),
      Number(process.env.BOOKMARK_DOWNLOAD_CHAPTER_LIST_TIMEOUT_MS ?? 120000),
      `${source.info.name} initial chapter list download`
    );
    await upsertBookmarkUpdateCache({
      source: job.source,
      mangaId: job.mangaId,
      canonicalKey: job.canonicalKey,
      latestChapter: latestChapterFrom(chapters)
    });
    await enqueueChapterPageDownloadJobsForChapters(
      { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
      chapters,
      Math.max(50, job.priority + 1)
    );
    await enqueueChapterCommentDownloadJobsForChapters(
      { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
      chapters,
      BOOKMARK_CHAPTER_COMMENTS_PRIORITY,
      false
    );
    return;
  }

  await enqueueMissingChapterPageDownloadJobsForSavedChapterList(
    { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
    Math.max(50, job.priority + 1)
  );

  if (!source.getChapterPreview) {
    const chapters = await withTimeout(
      loadAndSaveChapters(source, job.mangaId, job.language),
      Number(process.env.BOOKMARK_DOWNLOAD_CHAPTER_LIST_TIMEOUT_MS ?? 120000),
      `${source.info.name} chapter list refresh`
    );
    const newChapters = missingNewChapters(existing, chapters);
    await upsertBookmarkUpdateCache({
      source: job.source,
      mangaId: job.mangaId,
      canonicalKey: job.canonicalKey,
      latestChapter: latestChapterFrom(chapters)
    });
    if (newChapters.length) {
      await enqueueChapterPageDownloadJobsForChapters(
        { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
        newChapters,
        Math.max(50, job.priority + 1)
      );
      await enqueueChapterCommentDownloadJobsForChapters(
        { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
        newChapters,
        BOOKMARK_CHAPTER_COMMENTS_PRIORITY,
        false
      );
    }
    return;
  }

  const latestPreview = await withTimeout(
    source.getChapterPreview(job.mangaId, job.language),
    Number(process.env.BOOKMARK_LATEST_CHAPTERS_TIMEOUT_MS ?? 30000),
    `${source.info.name} latest chapters refresh`
  );
  const newChapters = missingNewChapters(existing, latestPreview);
  if (!newChapters.length) return;

  const merged = mergeChapterLists(existing, newChapters);
  await upsertCanonicalChapters(job.source, job.mangaId, job.language, newChapters).catch((error: Error) =>
    console.warn(`Canonical latest chapter save failed for ${job.source}:${job.mangaId}:`, error.message)
  );
  await upsertChapterListCache({
    source: job.source,
    mangaId: job.mangaId,
    language: job.language,
    chapters: merged
  });
  await upsertBookmarkUpdateCache({
    source: job.source,
    mangaId: job.mangaId,
    canonicalKey: job.canonicalKey,
    latestChapter: latestChapterFrom(merged)
  });
  await enqueueChapterPageDownloadJobsForChapters(
    { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
    newChapters,
    Math.max(50, job.priority + 1)
  );
  await enqueueChapterCommentDownloadJobsForChapters(
    { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
    newChapters,
    BOOKMARK_CHAPTER_COMMENTS_PRIORITY,
    false
  );
}

function commentJobVolume(chapterId?: string) {
  const match = chapterId?.match(/:vol:([^:]+)$/);
  if (!match) return "0";
  try {
    return decodeURIComponent(match[1]) || "0";
  } catch {
    return "0";
  }
}

async function runTitleCommentsJob(source: MangaSource, job: BookmarkDownloadJobRecord) {
  if (!source.getTitleComments) return;
  const page = await withTimeout(
    source.getTitleComments(job.mangaId, {
      sort: "newest",
      limit: Number(process.env.BOOKMARK_COMMENT_PAGE_LIMIT ?? 20),
      all: process.env.BOOKMARK_COMMENT_FETCH_ALL !== "0"
    }),
    Number(process.env.BOOKMARK_COMMENT_TIMEOUT_MS ?? 30000),
    `${source.info.name} title comments download`
  );
  await upsertCommentCache({ page });
  return { comments: page.comments.length };
}

async function runChapterCommentsJob(source: MangaSource, job: BookmarkDownloadJobRecord) {
  if (!source.getChapterComments) return;
  if (!job.chapterNumber) throw new Error("Chapter comment download job is missing chapter number.");
  const page = await withTimeout(
    source.getChapterComments(job.mangaId, job.chapterNumber, {
      volume: commentJobVolume(job.chapterId),
      sort: "newest",
      limit: Number(process.env.BOOKMARK_COMMENT_PAGE_LIMIT ?? 20),
      all: process.env.BOOKMARK_COMMENT_FETCH_ALL !== "0"
    }),
    Number(process.env.BOOKMARK_COMMENT_TIMEOUT_MS ?? 30000),
    `${source.info.name} chapter comments download`
  );
  await upsertCommentCache({ page });
  return { comments: page.comments.length };
}

async function processBookmarkDownloadJob(job: BookmarkDownloadJobRecord) {
  const source = getSource(job.source);
  if (!source?.info.enabled) throw new Error(`Source is unavailable: ${job.source}`);

  if (job.jobType === "latest_check") {
    await runLatestCheckJob(source, job);
    return;
  }

  if (job.jobType === "latest_chapters") {
    await runLatestChaptersJob(source, job);
    return;
  }

  if (job.jobType === "title_comments") {
    return runTitleCommentsJob(source, job);
  }

  if (job.jobType === "chapter_comments") {
    return runChapterCommentsJob(source, job);
  }

  if (job.jobType === "title_detail") {
    await withTimeout(
      loadSourceManga(source, job.mangaId),
      Number(process.env.BOOKMARK_DOWNLOAD_DETAIL_TIMEOUT_MS ?? 30000),
      `${source.info.name} title download`
    );
    return;
  }

  if (job.jobType === "chapter_list") {
    const persistent = await getChapterListCache(job.source, job.mangaId, job.language).catch(() => undefined);
    const chapters = persistent?.chapters?.length
      ? persistent.chapters
      : await withTimeout(
          loadAndSaveChapters(source, job.mangaId, job.language),
          Number(process.env.BOOKMARK_DOWNLOAD_CHAPTER_LIST_TIMEOUT_MS ?? 120000),
          `${source.info.name} chapter list download`
        );
    await upsertBookmarkUpdateCache({
      source: job.source,
      mangaId: job.mangaId,
      canonicalKey: job.canonicalKey,
      latestChapter: latestChapterFrom(chapters)
    });
    await enqueueChapterPageDownloadJobsForChapters(
      { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
      chapters,
      Math.max(50, job.priority + 1)
    );
    await enqueueChapterCommentDownloadJobsForChapters(
      { source: job.source, mangaId: job.mangaId, canonicalKey: job.canonicalKey, language: job.language },
      chapters,
      BOOKMARK_CHAPTER_COMMENTS_PRIORITY,
      false
    );
    return;
  }

  if (job.jobType === "chapter_pages") {
    if (!job.chapterId) throw new Error("Chapter page download job is missing chapter id.");
    const pages = await withTimeout(
      loadAndSaveChapterPages(source, job.chapterId, {
        mangaId: job.mangaId,
        chapterNumber: job.chapterNumber,
        language: job.language
      }),
      Number(process.env.BOOKMARK_DOWNLOAD_PAGES_TIMEOUT_MS ?? 60000),
      `${source.info.name} chapter page download`
    );
    return { pages: pages.pages.length };
  }

  return {};
}

function startBookmarkDownloadWorker() {
  if (process.env.BOOKMARK_DOWNLOAD_WORKER === "0") return;

  const workerId = `scottshelf-${process.pid}`;
  const batchSize = Number(process.env.BOOKMARK_DOWNLOAD_BATCH_SIZE ?? 1);
  const intervalMs = Number(process.env.BOOKMARK_DOWNLOAD_INTERVAL_MS ?? 5000);
  const workerConcurrency = Math.max(Math.min(Number(process.env.BOOKMARK_DOWNLOAD_WORKER_CONCURRENCY ?? 1) || 1, 16), 1);
  const backfillLimit = Number(process.env.BOOKMARK_DOWNLOAD_BACKFILL_LIMIT ?? 500);
  const latestIntervalMs = Number(process.env.BOOKMARK_LATEST_CHECK_INTERVAL_MS ?? 1000 * 60 * 10);
  const commentRefreshIntervalMs = Number(process.env.BOOKMARK_COMMENT_REFRESH_INTERVAL_MS ?? 1000 * 60 * 60 * 24);
  const latestCheckConcurrency = Math.max(Math.min(Number(process.env.BOOKMARK_LATEST_CHECK_WORKER_CONCURRENCY ?? 4) || 0, 16), 0);
  const latestCheckBatchSize = Math.max(
    Math.min(Number(process.env.BOOKMARK_LATEST_CHECK_BATCH_SIZE ?? latestCheckConcurrency) || latestCheckConcurrency, 25),
    1
  );
  const commentWorkerConcurrency = Math.max(Math.min(Number(process.env.BOOKMARK_COMMENT_WORKER_CONCURRENCY ?? 4) || 0, 16), 0);
  const commentWorkerBatchSize = Math.max(Math.min(Number(process.env.BOOKMARK_COMMENT_WORKER_BATCH_SIZE ?? 1) || 1, 25), 1);
  const commentWorkerIntervalMs = Math.max(Number(process.env.BOOKMARK_COMMENT_WORKER_INTERVAL_MS ?? 1000) || 1000, 250);
  const staleJobTimeoutMs = Number(process.env.BOOKMARK_DOWNLOAD_STALE_JOB_TIMEOUT_MS ?? 1000 * 60 * 20);
  const progressLog = process.env.BOOKMARK_DOWNLOAD_PROGRESS_LOG === "1";
  const progressIntervalMs = Number(process.env.BOOKMARK_DOWNLOAD_PROGRESS_INTERVAL_MS ?? 30000);
  const workerJobTypes = bookmarkJobTypeFilter();

  const jobLabel = (job: BookmarkDownloadJobRecord) =>
    `${job.jobType} ${job.source}:${job.mangaId}${job.chapterNumber ? ` ch.${job.chapterNumber}` : ""}${job.chapterId ? ` ${job.chapterId}` : ""}`;

  const processClaimedJob = async (job: BookmarkDownloadJobRecord, laneLabel: string) => {
    const startedAt = Date.now();
    try {
      const result = await processBookmarkDownloadJob(job);
      await completeBookmarkDownloadJob(job.id);
      if (progressLog) {
        const pages = result && "pages" in result && result.pages !== undefined ? ` pages=${result.pages}` : "";
        const comments = result && "comments" in result && result.comments !== undefined ? ` comments=${result.comments}` : "";
        console.log(`[bookmark-worker:${laneLabel}] done ${jobLabel(job)}${pages}${comments} in ${Date.now() - startedAt}ms`);
      }
    } catch (error) {
      await failBookmarkDownloadJob(job, error);
      if (progressLog) {
        console.warn(
          `[bookmark-worker:${laneLabel}] failed ${jobLabel(job)} in ${Date.now() - startedAt}ms: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  };

  const drainLatestCheckJobs = async (reason: string) => {
    if (latestCheckConcurrency <= 0 || bookmarkLatestCheckDrainRunning) return;
    bookmarkLatestCheckDrainRunning = true;
    const startedAt = Date.now();
    let drained = 0;
    try {
      while (true) {
        const jobs = await claimBookmarkDownloadJobs(
          Math.min(latestCheckBatchSize, latestCheckConcurrency),
          `${workerId}-latest-check`,
          ["latest_check"]
        );
        if (!jobs.length) break;
        drained += jobs.length;
        await Promise.all(jobs.map((job, index) => processClaimedJob(job, `latest:${index}`)));
      }
      if (drained) {
        console.log(`Bookmark latest checks drained ${drained} jobs in ${Date.now() - startedAt}ms${reason ? ` (${reason})` : ""}.`);
      }
    } catch (error) {
      console.warn("Bookmark latest check drain failed:", error instanceof Error ? error.message : String(error));
    } finally {
      bookmarkLatestCheckDrainRunning = false;
    }
  };

  const createWorkerRun = (lane: number) => {
    const laneWorkerId = workerConcurrency > 1 ? `${workerId}-${lane}` : workerId;
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      try {
        if (lane === 0) {
          const recovered = await resetStaleBookmarkDownloadJobs(staleJobTimeoutMs);
          if (recovered) console.log(`Bookmark download worker recovered ${recovered} stale jobs.`);
        }
        const jobs = await claimBookmarkDownloadJobs(batchSize, laneWorkerId, workerJobTypes);
        await Promise.all(jobs.map((job) => processClaimedJob(job, String(lane))));
      } catch (error) {
        console.warn("Bookmark download worker failed:", error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
      }
    };
  };

  const createCommentWorkerRun = (lane: number) => {
    const laneWorkerId = `${workerId}-comments-${lane}`;
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      try {
        const titleJobs = await claimBookmarkDownloadJobs(commentWorkerBatchSize, `${laneWorkerId}-titles`, ["title_comments"]);
        const remaining = commentWorkerBatchSize - titleJobs.length;
        const chapterJobs =
          remaining > 0
            ? await claimBookmarkDownloadJobs(remaining, `${laneWorkerId}-chapters`, ["chapter_comments"])
            : [];
        const jobs = [...titleJobs, ...chapterJobs];
        await Promise.all(jobs.map((job) => processClaimedJob(job, `comments:${lane}`)));
      } catch (error) {
        console.warn("Bookmark comment worker failed:", error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
      }
    };
  };

  const startWorkerLane = (lane: number) => {
    const run = createWorkerRun(lane);
    const staggerMs = Math.min(intervalMs, 1000) * lane;
    setTimeout(run, 8000 + staggerMs);
    setInterval(run, intervalMs);
  };

  for (let lane = 0; lane < workerConcurrency; lane += 1) {
    startWorkerLane(lane);
  }

  if (commentWorkerConcurrency > 0) {
    for (let lane = 0; lane < commentWorkerConcurrency; lane += 1) {
      const run = createCommentWorkerRun(lane);
      const staggerMs = Math.min(commentWorkerIntervalMs, 1000) * lane;
      setTimeout(run, 9000 + staggerMs);
      setInterval(run, commentWorkerIntervalMs);
    }
  }

  console.log(
    `Bookmark download worker started: concurrency=${workerConcurrency}, batchSize=${Math.max(Math.min(Math.floor(batchSize), 25), 1)}, intervalMs=${intervalMs}${
      workerJobTypes?.length ? `, jobTypes=${workerJobTypes.join(",")}` : ""
    }`
  );
  if (commentWorkerConcurrency > 0) {
    console.log(
      `Bookmark comment worker started: concurrency=${commentWorkerConcurrency}, batchSize=${commentWorkerBatchSize}, intervalMs=${commentWorkerIntervalMs}`
    );
  }
  if (latestCheckConcurrency > 0) {
    console.log(`Bookmark latest check fast worker started: concurrency=${latestCheckConcurrency}, batchSize=${latestCheckBatchSize}`);
    setTimeout(() => void drainLatestCheckJobs("startup"), 9000);
  }

  if (progressLog && progressIntervalMs > 0) {
    setInterval(() => {
      adminDashboardStats()
        .then((stats) => {
          const pages = stats.jobTypes.find((item) => item.jobType === "chapter_pages");
          console.log(
            `[bookmark-worker] progress chapter_pages pending=${pages?.pending ?? 0} running=${pages?.running ?? 0} done=${pages?.done ?? 0} failed=${pages?.failed ?? 0}; db_page_sets=${stats.cacheCoverage.chapterPageRows} image_urls=${stats.cacheCoverage.chapterPageImages}`
          );
        })
        .catch((error: Error) => console.warn("[bookmark-worker] progress check failed:", error.message));
    }, progressIntervalMs);
  }

  const runInitialFanout = async () => {
    const refs = await listFavoriteRefs(backfillLimit);
    let queuedPageJobs = 0;
    for (const ref of refs) {
      await enqueueBookmarkDownloadsForRef(ref);
      queuedPageJobs += await enqueueMissingChapterPageDownloadJobsForSavedChapterList({ ...ref, language: "en" });
    }
    return { titles: refs.length, queuedPageJobs };
  };

  if (process.env.BOOKMARK_DOWNLOAD_BACKFILL_ON_START !== "0") {
    setTimeout(() => {
      runInitialFanout()
        .then(({ titles, queuedPageJobs }) =>
          console.log(`Bookmark download backfill queued ${titles} titles and ${queuedPageJobs} saved-list page jobs.`)
        )
        .catch((error: Error) => console.warn("Bookmark download backfill failed:", error.message));
    }, 5000);
  }

  if (process.env.BOOKMARK_COMMENT_BACKFILL_ON_START === "1") {
    setTimeout(() => {
      enqueueBookmarkCommentRefreshJobs(false)
        .then(({ titles, jobs }) => console.log(`Bookmark comment backfill queued ${jobs} jobs for ${titles} titles.`))
        .catch((error: Error) => console.warn("Bookmark comment backfill failed:", error.message));
    }, 5000);
  }

  if (latestIntervalMs > 0) {
    nextBookmarkLatestCheckAt = new Date(Date.now() + latestIntervalMs).toISOString();
    setInterval(() => {
      if (bookmarkLatestCheckQueueRunning) return;
      bookmarkLatestCheckQueueRunning = true;
      nextBookmarkLatestCheckAt = undefined;
      enqueueLatestCheckJobs()
        .then((count) => {
          lastBookmarkLatestCheckQueuedAt = new Date().toISOString();
          lastBookmarkLatestCheckError = undefined;
          console.log(`Bookmark latest checks queued ${count} titles.`);
          void drainLatestCheckJobs("scheduled");
        })
        .catch((error: Error) => {
          lastBookmarkLatestCheckError = error.message;
          console.warn("Bookmark latest check queue failed:", error.message);
        })
        .finally(() => {
          bookmarkLatestCheckQueueRunning = false;
          nextBookmarkLatestCheckAt = new Date(Date.now() + latestIntervalMs).toISOString();
        });
    }, latestIntervalMs);
  }

  if (commentRefreshIntervalMs > 0) {
    setInterval(() => {
      if (bookmarkCommentQueueRunning) return;
      bookmarkCommentQueueRunning = true;
      enqueueBookmarkCommentRefreshJobs(true)
        .then(({ titles, jobs }) => console.log(`Bookmark comment refresh queued ${jobs} jobs for ${titles} titles.`))
        .catch((error: Error) => console.warn("Bookmark comment refresh queue failed:", error.message))
        .finally(() => {
          bookmarkCommentQueueRunning = false;
        });
    }, commentRefreshIntervalMs);
  }
}

function progressInput(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  return {
    source: requestString(body.source),
    mangaId: requestString(body.mangaId),
    canonicalKey: optionalRequestString(body.canonicalKey),
    chapterId: requestString(body.chapterId),
    chapterNumber: optionalRequestString(body.chapterNumber),
    scrollPosition: optionalRequestNumber(body.scrollPosition)
  };
}

app.get("/api/health", (_req, res) => {
  databaseStatus()
    .then((database) => res.json({ ok: true, database, cache: cacheStats() }))
    .catch((error: Error) => res.status(500).json({ ok: false, error: error.message }));
});

app.get(
  "/api/image-proxy",
  asyncRoute(async (req, res) => {
    const url = imageProxyUrl(req.query.url);
    if (!url) {
      res.status(400).json({ error: "Image URL is not allowed." });
      return;
    }

    const response = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: `https://${url.hostname}/`,
        "User-Agent": "Mozilla/5.0 ScottShelf/0.1"
      }
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Image request failed with ${response.status}.` });
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      res.status(415).json({ error: "Proxied URL did not return an image." });
      return;
    }

    if (!response.body) {
      res.status(502).json({ error: "Image response was empty." });
      return;
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    const maxBytes = Number(process.env.IMAGE_PROXY_MAX_BYTES ?? 1024 * 1024 * 24);
    if (contentLength && contentLength > maxBytes) {
      res.status(413).json({ error: "Image response exceeded size limit." });
      return;
    }

    publicCache(res, 60 * 60 * 24);
    res.type(contentType);
    await pipeline(Readable.fromWeb(response.body), sizeLimitStream(maxBytes), res);
  })
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const result = await authenticate(requestString(req.body?.username), requestString(req.body?.password));
    if (!result) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    res.json(result);
  })
);

app.get(
  "/api/auth/me",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ user });
  })
);

app.get(
  "/api/me/bootstrap",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    revalidateCache(res);
    res.json({ unread: await unreadRecommendationCount(user.id) });
  })
);

app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    destroySession(bearerToken(req));
    res.json({ ok: true });
  })
);

app.post(
  "/api/auth/change-password",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const nextUser = await changePassword(
      user.id,
      requestString(req.body?.currentPassword),
      requestString(req.body?.newPassword)
    );
    res.json({ user: nextUser });
  })
);

app.get(
  "/api/admin/users",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    res.json({ users: await listUsers() });
  })
);

app.get(
  "/api/admin/dashboard",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const dashboard = await adminDashboardStats();
    dashboard.refreshSchedules = buildRefreshSchedules(dashboard);
    res.json({ dashboard, cache: cacheStats() });
  })
);

app.post(
  "/api/admin/users",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const role = requestString(req.body?.role) as UserRole;
    const user = await createUser(requestString(req.body?.username), requestString(req.body?.password), role || "user");
    res.status(201).json({ user });
  })
);

app.post(
  "/api/admin/users/:id/reset-password",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const user = await resetPassword(req.params.id, requestString(req.body?.password));
    res.json({ user });
  })
);

app.patch(
  "/api/admin/users/:id/nsfw",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const user = await setUserNsfwAllowed(req.params.id, Boolean(req.body?.nsfwAllowed));
    res.json({ user, users: await listUsers() });
  })
);

app.delete(
  "/api/admin/users/:id",
  asyncRoute(async (req, res) => {
    const currentUser = await requireAdmin(req, res);
    if (!currentUser) return;
    await deleteUser(req.params.id, currentUser.id);
    res.json({ users: await listUsers() });
  })
);

app.get(
  "/api/admin/interaction-blocks",
  asyncRoute(async (_req, res) => {
    if (!(await requireAdmin(_req, res))) return;
    res.json({ blocks: await listInteractionBlocks() });
  })
);

app.post(
  "/api/admin/interaction-blocks",
  asyncRoute(async (req, res) => {
    const currentUser = await requireAdmin(req, res);
    if (!currentUser) return;
    const blocks = await addInteractionBlock(requestString(req.body?.userAId), requestString(req.body?.userBId), currentUser.id);
    res.status(201).json({ blocks });
  })
);

app.delete(
  "/api/admin/interaction-blocks/:id",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    res.json({ blocks: await removeInteractionBlock(req.params.id) });
  })
);

app.get(
  "/api/users/share",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ users: await listShareUsers(user.id) });
  })
);

app.get(
  "/api/taxonomy",
  asyncRoute(async (_req, res) => {
    res.json(await getTaxonomyOptions());
  })
);

app.get(
  "/api/me/favorites",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ favorites: await listFavorites(user.id) });
  })
);

app.get(
  "/api/me/home",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const sourceId = String(req.query.source ?? defaultSource());
    const source = sourceOr404(sourceId);
    const page = Math.max(Number(req.query.page ?? 0), 0);
    const limit = Math.max(Math.min(Number(req.query.limit ?? 24), 48), 1);
    const bookmarkLimit = Math.max(Math.min(Number(req.query.bookmarkLimit ?? 12), 48), 1);
    const historyLimit = Math.max(Math.min(Number(req.query.historyLimit ?? 12), 48), 1);

    const [latest, favorites, bookmarkUpdates, progress] = await Promise.all([
      searchWithFallback(source.info.id, { language: "en", limit, offset: page * limit }).catch(() => [] as MangaSummary[]),
      listFavorites(user.id),
      listCachedBookmarkUpdates(user.id, bookmarkLimit).catch(() => []),
      listReadingProgress(user.id).catch(() => [])
    ]);

    const favoritesByRef = new Map(favorites.map((favorite) => [`${favorite.source}:${favorite.mangaId}`, favorite]));
    const favoritesByCanonical = new Map(
      favorites.filter((favorite) => favorite.canonicalKey).map((favorite) => [favorite.canonicalKey as string, favorite])
    );
    const bookmarkedKeys = new Set([
      ...favorites.map((favorite) => `${favorite.source}:${favorite.mangaId}`),
      ...favorites.filter((favorite) => favorite.canonicalKey).map((favorite) => favorite.canonicalKey as string)
    ]);

    const historyResults = await Promise.allSettled(
      progress
        .filter((item) => item.source !== "external" && item.mangaId)
        .slice(0, historyLimit * 3)
        .map(async (item) => {
          const favorite = favoritesByRef.get(`${item.source}:${item.mangaId}`) ?? (item.canonicalKey ? favoritesByCanonical.get(item.canonicalKey) : undefined);
          const manga = favorite ? compactFavoriteManga(favorite) : await savedCompactManga(item.source, item.mangaId);
          if (!manga) return undefined;
          return {
            ...manga,
            source: favorite?.source ?? item.source,
            id: favorite?.mangaId ?? item.mangaId,
            canonicalKey: manga.canonicalKey ?? item.canonicalKey,
            lastReadChapter: item.chapterNumber,
            lastReadChapterId: item.chapterId,
            scrollPosition: item.scrollPosition,
            updatedAt: item.updatedAt,
            bookmarked: bookmarkedKeys.has(`${favorite?.source ?? item.source}:${favorite?.mangaId ?? item.mangaId}`) ||
              Boolean((manga.canonicalKey ?? item.canonicalKey) && bookmarkedKeys.has((manga.canonicalKey ?? item.canonicalKey) as string))
          };
        })
    );

    revalidateCache(res);
    res.json({
      latest: latest.map((manga) =>
        compactHomeManga(manga, {
          bookmarked: bookmarkedKeys.has(`${manga.source}:${manga.id}`) || Boolean(manga.canonicalKey && bookmarkedKeys.has(manga.canonicalKey))
        })
      ),
      bookmarkUpdates: bookmarkUpdates.map((update) => ({
        manga: compactFavoriteManga(update.manga, { bookmarked: true }),
        latestChapter: update.latestChapter,
        lastReadChapter: update.lastReadChapter,
        checkedAt: update.checkedAt,
        error: update.error
      })),
      readingHistory: historyResults
        .flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : []))
        .slice(0, historyLimit)
    });
  })
);

app.get(
  "/api/me/bookmark-updates",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const limit = Number(req.query.limit ?? 12);
    revalidateCache(res);
    res.json({
      updates: await listCachedBookmarkUpdates(user.id, Number.isFinite(limit) ? limit : 12)
    });
  })
);

app.post(
  "/api/me/favorites",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const favorite = favoriteInput(req.body);
    if (!favorite) {
      res.status(400).json({ error: "Favorite payload is required." });
      return;
    }

    favorite.canonicalKey ??= await canonicalKeyForManga(favorite.source, favorite.mangaId, favorite.title);
    const favorites = await addFavorite(user.id, favorite);
    void enqueueBookmarkDownloadsForRef({ source: favorite.source, mangaId: favorite.mangaId, canonicalKey: favorite.canonicalKey }, 100, true).catch(
      (error: Error) => console.warn(`Bookmark download queue failed for ${favorite.source}:${favorite.mangaId}:`, error.message)
    );
    res.status(201).json({ favorites });
  })
);

app.post(
  "/api/me/favorites/import",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const favoriteRows = Array.isArray(req.body?.favorites) ? req.body.favorites : [];
    const progressRows = Array.isArray(req.body?.progress) ? req.body.progress : [];
    type FavoriteInput = NonNullable<ReturnType<typeof favoriteInput>>;
    type ProgressInput = NonNullable<ReturnType<typeof progressInput>>;
    const favorites = favoriteRows.map(favoriteInput).filter((item: unknown): item is FavoriteInput => Boolean(item));
    const progress = progressRows.map(progressInput).filter((item: unknown): item is ProgressInput => Boolean(item));

    const nextFavorites = await importFavorites(user.id, favorites, progress);
    void enqueueBookmarkDownloadsForAll(Number(process.env.BOOKMARK_DOWNLOAD_BACKFILL_LIMIT ?? 500)).catch((error: Error) =>
      console.warn("Bookmark import download queue failed:", error.message)
    );
    res.status(201).json({
      favorites: nextFavorites,
      imported: {
        favorites: favorites.length,
        progress: progress.length
      }
    });
  })
);

app.delete(
  "/api/me/favorites/:source/:mangaId",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ favorites: await removeFavorite(user.id, req.params.source, req.params.mangaId) });
  })
);

app.get(
  "/api/me/reading-progress",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ progress: await listReadingProgress(user.id) });
  })
);

app.put(
  "/api/me/reading-progress",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const progress = await saveReadingProgress(
      user.id,
      requestString(req.body?.source),
      requestString(req.body?.mangaId),
      optionalRequestString(req.body?.canonicalKey) ??
        (await canonicalKeyForManga(
          requestString(req.body?.source),
          requestString(req.body?.mangaId),
          optionalRequestString(req.body?.title)
        )),
      optionalRequestString(req.body?.chapterSource) ?? requestString(req.body?.source),
      requestString(req.body?.chapterId),
      optionalRequestString(req.body?.chapterNumber),
      optionalRequestNumber(req.body?.scrollPosition)
    );
    res.json({ progress });
  })
);

app.get(
  "/api/me/recommendations",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const [inbox, outbox, unread] = await Promise.all([
      listInboxRecommendations(user.id),
      listOutboxRecommendations(user.id),
      unreadRecommendationCount(user.id)
    ]);
    res.json({ inbox, outbox, unread });
  })
);

async function recommendationsBundle(userId: string) {
  const [inbox, outbox, unread] = await Promise.all([
    listInboxRecommendations(userId),
    listOutboxRecommendations(userId),
    unreadRecommendationCount(userId)
  ]);
  return { inbox, outbox, unread };
}

app.post(
  "/api/me/recommendations",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const input = recommendationInput(req.body);
    if (!input) {
      res.status(400).json({ error: "Recommendation payload is required." });
      return;
    }
    const recommendation = await sendRecommendation(user.id, input);
    res.status(201).json({ recommendation });
  })
);

app.post(
  "/api/me/recommendations/:id/read",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const recommendation = await markRecommendationRead(user.id, req.params.id);
    if (!recommendation) {
      res.status(404).json({ error: "Recommendation not found." });
      return;
    }
    res.json({ recommendation, unread: await unreadRecommendationCount(user.id) });
  })
);

app.post(
  "/api/me/recommendations/read-all",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    await markAllRecommendationsRead(user.id);
    res.json({ inbox: await listInboxRecommendations(user.id), unread: 0 });
  })
);

app.delete(
  "/api/me/recommendations/:id",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const deleted = await deleteRecommendation(user.id, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Recommendation not found." });
      return;
    }
    res.json(await recommendationsBundle(user.id));
  })
);

app.delete(
  "/api/me/recommendations",
  asyncRoute(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const box = req.query.box === "outbox" ? "outbox" : req.query.box === "inbox" ? "inbox" : undefined;
    if (!box) {
      res.status(400).json({ error: "Choose inbox or outbox to clear." });
      return;
    }
    await clearRecommendations(user.id, box);
    res.json(await recommendationsBundle(user.id));
  })
);

app.get(
  "/api/sources",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    res.json({
      sources: listSources(),
      scraperNotes: scraperSourceNotes
    });
  })
);

app.get(
  "/api/sources/health",
  asyncRoute(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    res.json({ sources: await sourceHealth() });
  })
);

app.get(
  "/api/manga",
  asyncRoute(async (req, res) => {
    const sourceId = String(req.query.source ?? defaultSource());
    if (sourceId !== "all") sourceOr404(sourceId);
    const manga = await searchWithFallback(sourceId, {
      query: typeof req.query.query === "string" ? req.query.query : undefined,
      language: typeof req.query.language === "string" ? req.query.language : "en",
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      offset: typeof req.query.offset === "string" ? Number(req.query.offset) : undefined
    });
    publicCache(res, typeof req.query.query === "string" && req.query.query.trim() ? 120 : 300);
    res.json({ manga });
  })
);

app.get(
  "/api/titles/:canonicalId",
  asyncRoute(async (req, res) => {
    const manga = await getCanonicalTitle(req.params.canonicalId);
    if (!manga) {
      res.status(404).json({ error: "Canonical title not found." });
      return;
    }
    revalidateCache(res);
    res.json({ manga });
  })
);

app.get(
  "/api/titles/:canonicalId/chapters",
  asyncRoute(async (req, res) => {
    const language = typeof req.query.language === "string" ? req.query.language : "en";
    const chapters = await getCanonicalChapters(req.params.canonicalId, language);
    publicCache(res, 300);
    res.json({ chapters });
  })
);

app.get(
  "/api/comments/:source/title/:id",
  asyncRoute(async (req, res) => {
    const source = sourceOr404(req.params.source);
    if (!source.getTitleComments) {
      res.status(404).json({ error: "Comments are not available for this source." });
      return;
    }
    const limit = requestLimit(req.query.limit, 5, 50);
    const wantsAll = req.query.all === "true";
    const cachedPage = await getCommentCacheByTarget({
      source: req.params.source,
      targetType: "title",
      mangaId: req.params.id
    }).catch(() => undefined);
    if (cachedPage && (!wantsAll || cachedCommentThreadIsComplete(cachedPage))) {
      publicCache(res, 60);
      res.json(wantsAll ? normalizeCommentPageCounts(cachedPage) : commentPreview(cachedPage, limit));
      return;
    }
    const page = normalizeCommentPageCounts(await source.getTitleComments(req.params.id, {
      sort: requestCommentSort(req.query.sort),
      limit,
      all: wantsAll
    }));
    await upsertCommentCache({ page }).catch((error: Error) =>
      console.warn(`Comment cache save failed for ${req.params.source}:${req.params.id}:`, error.message)
    );
    publicCache(res, 60);
    res.json(normalizeCommentPageCounts(page));
  })
);

app.get(
  "/api/comments/:source/chapter/:mangaId/:chapterNumber",
  asyncRoute(async (req, res) => {
    const source = sourceOr404(req.params.source);
    if (!source.getChapterComments) {
      res.status(404).json({ error: "Comments are not available for this source." });
      return;
    }
    const volume = typeof req.query.volume === "string" ? req.query.volume : "0";
    const limit = requestLimit(req.query.limit, 5, 50);
    const wantsAll = req.query.all === "true";
    const cachedPage = await getCommentCacheByTarget({
      source: req.params.source,
      targetType: "chapter",
      mangaId: req.params.mangaId,
      chapterNumber: req.params.chapterNumber,
      volume
    }).catch(() => undefined);
    if (cachedPage && (!wantsAll || cachedCommentThreadIsComplete(cachedPage))) {
      publicCache(res, 60);
      res.json(wantsAll ? normalizeCommentPageCounts(cachedPage) : commentPreview(cachedPage, limit));
      return;
    }
    const page = normalizeCommentPageCounts(await source.getChapterComments(req.params.mangaId, req.params.chapterNumber, {
      volume,
      sort: requestCommentSort(req.query.sort),
      limit,
      all: wantsAll
    }));
    await upsertCommentCache({ page }).catch((error: Error) =>
      console.warn(
        `Comment cache save failed for ${req.params.source}:${req.params.mangaId}:ch.${req.params.chapterNumber}:`,
        error.message
      )
    );
    publicCache(res, 60);
    res.json(normalizeCommentPageCounts(page));
  })
);

app.get(
  "/api/manga/:source/:id/similar",
  asyncRoute(async (req, res) => {
    const source = sourceOr404(req.params.source);
    const manga = await getSimilarTitles(source, req.params.id);
    res.json({ manga });
  })
);

app.get(
  "/api/manga/:source/:id/cache-status",
  asyncRoute(async (req, res) => {
    sourceOr404(req.params.source);
    publicCache(res, 60);
    res.json({ cache: await titleCacheStatus(req.params.source, req.params.id) });
  })
);

app.get(
  "/api/manga/:source/:id",
  asyncRoute(async (req, res) => {
    const source = sourceOr404(req.params.source);
    const includeMirrors = req.query.mirrors !== "false";
    const manga = includeMirrors ? await mangaWithMirrors(source, req.params.id) : await cachedManga(source, req.params.id);
    revalidateCache(res);
    res.json({ manga });
  })
);

app.get(
  "/api/manga/:source/:id/chapters",
  asyncRoute(async (req, res) => {
    const source = sourceOr404(req.params.source);
    const language = typeof req.query.language === "string" ? req.query.language : "en";
    const targetChapter = typeof req.query.chapterNumber === "string" ? req.query.chapterNumber : undefined;
    const chapters = await chaptersWithMirrors(source, req.params.id, language, targetChapter);
    publicCache(res, 300);
    res.json({ chapters });
  })
);

app.get(
  "/api/chapter/:source/:id/pages",
  asyncRoute(async (req, res) => {
    const source = sourceOr404(req.params.source);
    const language = typeof req.query.language === "string" ? req.query.language : "en";
    const mangaId = typeof req.query.mangaId === "string" ? req.query.mangaId : undefined;
    const chapterNumber = typeof req.query.chapterNumber === "string" ? req.query.chapterNumber : undefined;
    const pages = await cachedChapterPages(source, req.params.id, { mangaId, chapterNumber, language }).catch(async (error) => {
      const fallback = await fallbackChapterPages(source, mangaId, chapterNumber, language);
      if (fallback) return fallback;
      throw error;
    });
    publicCache(res, 900);
    res.json(pages);
  })
);

app.post(
  "/api/chapter/prefetch",
  asyncRoute(async (req, res) => {
    const rows: unknown[] = Array.isArray(req.body?.chapters) ? req.body.chapters : [];
    const chapters = rows
      .map((item) => prefetchChapterInput(item))
      .filter((item): item is { sourceId: string; id: string } => Boolean(item))
      .slice(0, 3);

    let prefetched = 0;
    await Promise.all(
      chapters.map(async ({ sourceId, id }) => {
        const source = sourceOr404(sourceId);
        try {
          await cachedChapterPages(source, id);
          prefetched += 1;
        } catch {
          // Prefetch should never block reading the current chapter.
        }
      })
    );

    res.json({ prefetched });
  })
);

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error.name === "NotFound" ? 404 : 500;
  res.status(status).json({
    error: error.message || "Unexpected server error"
  });
});

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(frontendRoot, "dist");
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "1y"
    })
  );
  app.use(
    express.static(distPath, {
      maxAge: "0",
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    })
  );
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.sendFile(path.join(distPath, "index.html"));
  });
}

initializeAccounts()
	  .then(async () => {
      await initializeMetadataTables();
	    console.log(`MySQL ready at ${databaseLabel()}`);
	    console.log("Ensured tables: users, favorites, reading_progress, recommendations, title_metadata");
      const workerOnly = process.env.SCOTTSHELF_WORKER_ONLY === "1";
      if (!workerOnly) {
        startMetadataRefreshCron();
	      startCacheWarmer();
      }
      startBookmarkDownloadWorker();
      if (workerOnly) {
        console.log("ScottShelf bookmark worker-only process started.");
        return;
      }
      app.listen(port, () => {
        console.log(`ScottShelf API listening on http://localhost:${port}`);
      });
  })
  .catch((error: Error) => {
    console.error("Failed to initialize MySQL account system:", error.message);
    process.exitCode = 1;
  });
