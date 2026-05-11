import type {
  AccountUser,
  BookmarkUpdate,
  ChapterPages,
  ChapterSummary,
  FavoriteManga,
  HomeManga,
  MangaDetail,
  MangaSummary,
  ReadingProgress,
  Recommendation,
  SourceHealth,
  SourceInfo,
  UserInteractionBlock,
  UserRole
} from "./types";

const TOKEN_KEY = "mangass:auth-token";
const defaultGetCacheTtlMs = 1000 * 30;

type ApiRequestOptions = RequestInit & {
  clientCache?: "default" | "no-store";
  clientCacheTtlMs?: number;
};

type ClientCacheEntry = {
  expiresAt: number;
  promise?: Promise<unknown>;
  value?: unknown;
};

const clientRequestCache = new Map<string, ClientCacheEntry>();

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setAuthToken(token: string) {
  clearClientRequestCache();
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  clearClientRequestCache();
  localStorage.removeItem(TOKEN_KEY);
}

function clearClientRequestCache() {
  clientRequestCache.clear();
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = getAuthToken();
  const { clientCache = "default", clientCacheTtlMs = defaultGetCacheTtlMs, ...fetchOptions } = options;
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const method = (fetchOptions.method ?? "GET").toUpperCase();
  const canUseClientCache = method === "GET" && clientCache !== "no-store";
  const cacheKey = `${token}:${path}`;
  if (canUseClientCache) {
    const cached = clientRequestCache.get(cacheKey);
    if (cached?.value !== undefined && cached.expiresAt > Date.now()) return cached.value as T;
    if (cached?.promise) return cached.promise as Promise<T>;
  }

  const requestPromise = fetch(path, { ...fetchOptions, headers, cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      return response.json() as Promise<T>;
    })
    .then((value) => {
      if (canUseClientCache) {
        clientRequestCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + clientCacheTtlMs
        });
      } else if (method !== "GET") {
        clearClientRequestCache();
      }
      return value;
    })
    .catch((error) => {
      if (canUseClientCache) clientRequestCache.delete(cacheKey);
      throw error;
    });

  if (canUseClientCache) {
    clientRequestCache.set(cacheKey, {
      promise: requestPromise,
      expiresAt: Date.now() + clientCacheTtlMs
    });
  }

  return requestPromise;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body)
  };
}

export async function login(username: string, password: string) {
  return apiRequest<{ token: string; user: AccountUser }>("/api/auth/login", jsonBody({ username, password }));
}

export async function fetchCurrentUser() {
  return apiRequest<{ user: AccountUser }>("/api/auth/me");
}

export async function fetchAccountBootstrap() {
  return apiRequest<{ unread: number }>("/api/me/bootstrap");
}

export async function logout() {
  return apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export async function changeAccountPassword(currentPassword: string, newPassword: string) {
  return apiRequest<{ user: AccountUser }>(
    "/api/auth/change-password",
    jsonBody({ currentPassword, newPassword })
  );
}

export async function fetchUsers() {
  return apiRequest<{ users: AccountUser[] }>("/api/admin/users");
}

export async function createAccount(username: string, password: string, role: UserRole) {
  return apiRequest<{ user: AccountUser }>("/api/admin/users", jsonBody({ username, password, role }));
}

export async function resetUserPassword(id: string, password: string) {
  return apiRequest<{ user: AccountUser }>(`/api/admin/users/${id}/reset-password`, jsonBody({ password }));
}

export async function deleteAccount(id: string) {
  return apiRequest<{ users: AccountUser[] }>(`/api/admin/users/${id}`, { method: "DELETE" });
}

export async function updateUserNsfwAllowed(id: string, nsfwAllowed: boolean) {
  return apiRequest<{ user: AccountUser; users: AccountUser[] }>(
    `/api/admin/users/${id}/nsfw`,
    {
      method: "PATCH",
      body: JSON.stringify({ nsfwAllowed })
    }
  );
}

export async function fetchInteractionBlocks() {
  return apiRequest<{ blocks: UserInteractionBlock[] }>("/api/admin/interaction-blocks");
}

export async function addInteractionBlock(userAId: string, userBId: string) {
  return apiRequest<{ blocks: UserInteractionBlock[] }>("/api/admin/interaction-blocks", jsonBody({ userAId, userBId }));
}

export async function removeInteractionBlock(id: string) {
  return apiRequest<{ blocks: UserInteractionBlock[] }>(`/api/admin/interaction-blocks/${id}`, { method: "DELETE" });
}

export async function fetchShareUsers() {
  return apiRequest<{ users: AccountUser[] }>("/api/users/share");
}

export async function fetchFavorites() {
  return apiRequest<{ favorites: FavoriteManga[] }>("/api/me/favorites");
}

export async function fetchBookmarkUpdates(limit = 12) {
  return apiRequest<{ updates: BookmarkUpdate[] }>(`/api/me/bookmark-updates?${new URLSearchParams({ limit: String(limit) })}`);
}

function normalizeHomeManga(manga: HomeManga): HomeManga {
  return {
    ...manga,
    genres: Array.isArray(manga.genres) ? manga.genres : [],
    categories: Array.isArray(manga.categories) ? manga.categories : [],
    tags: Array.isArray(manga.tags) ? manga.tags : []
  };
}

export async function fetchHome(source: string, page: number, limit = 24, bookmarkLimit = 12, historyLimit = 12) {
  const params = new URLSearchParams({
    source,
    page: String(page),
    limit: String(limit),
    bookmarkLimit: String(bookmarkLimit),
    historyLimit: String(historyLimit)
  });
  const result = await apiRequest<{
    latest: HomeManga[];
    bookmarkUpdates: BookmarkUpdate[];
    readingHistory: HomeManga[];
  }>(`/api/me/home?${params.toString()}`);
  return {
    latest: result.latest.map(normalizeHomeManga),
    bookmarkUpdates: result.bookmarkUpdates.map((update) => ({
      ...update,
      manga: normalizeHomeManga(update.manga as HomeManga)
    })),
    readingHistory: result.readingHistory.map(normalizeHomeManga)
  };
}

export async function addFavorite(manga: MangaSummary) {
  return apiRequest<{ favorites: FavoriteManga[] }>("/api/me/favorites", jsonBody(manga));
}

export async function importFavorites(
  favorites: MangaSummary[],
  progress: Array<{ source: string; mangaId: string; chapterId: string; chapterNumber?: string }>
) {
  return apiRequest<{
    favorites: FavoriteManga[];
    imported: { favorites: number; progress: number };
  }>("/api/me/favorites/import", jsonBody({ favorites, progress }));
}

export async function removeFavorite(source: string, mangaId: string) {
  return apiRequest<{ favorites: FavoriteManga[] }>(`/api/me/favorites/${source}/${encodeURIComponent(mangaId)}`, {
    method: "DELETE"
  });
}

export async function fetchReadingProgress() {
  return apiRequest<{ progress: ReadingProgress[] }>("/api/me/reading-progress");
}

export async function saveReadingProgress(
  source: string,
  mangaId: string,
  chapterId: string,
  chapterNumber?: string,
  scrollPosition?: number,
  canonicalKey?: string,
  title?: string,
  chapterSource?: string
) {
  return apiRequest<{ progress: ReadingProgress }>(
    "/api/me/reading-progress",
    {
      method: "PUT",
      body: JSON.stringify({ source, mangaId, canonicalKey, title, chapterSource, chapterId, chapterNumber, scrollPosition })
    }
  );
}

export async function fetchRecommendations() {
  return apiRequest<{ inbox: Recommendation[]; outbox: Recommendation[]; unread: number }>("/api/me/recommendations");
}

export async function sendRecommendation(toUserId: string, manga: MangaSummary) {
  return apiRequest<{ recommendation: Recommendation }>(
    "/api/me/recommendations",
    jsonBody({
      toUserId,
      source: manga.source,
      mangaId: manga.id,
      title: manga.title,
      coverUrl: manga.coverUrl,
      contentRating: manga.contentRating,
      demographic: manga.demographic,
      tags: manga.tags,
      latestChapter: manga.latestChapter,
      latestChapterReleasedAt: manga.latestChapterReleasedAt
    })
  );
}

export async function markRecommendationRead(id: string) {
  return apiRequest<{ recommendation: Recommendation; unread: number }>(`/api/me/recommendations/${id}/read`, jsonBody({}));
}

export async function markAllRecommendationsRead() {
  return apiRequest<{ inbox: Recommendation[]; unread: number }>("/api/me/recommendations/read-all", jsonBody({}));
}

export async function deleteRecommendation(id: string) {
  return apiRequest<{ inbox: Recommendation[]; outbox: Recommendation[]; unread: number }>(`/api/me/recommendations/${id}`, {
    method: "DELETE"
  });
}

export async function clearRecommendations(box: "inbox" | "outbox") {
  return apiRequest<{ inbox: Recommendation[]; outbox: Recommendation[]; unread: number }>(
    `/api/me/recommendations?${new URLSearchParams({ box })}`,
    { method: "DELETE" }
  );
}

export async function fetchSources() {
  return apiRequest<{ sources: SourceInfo[]; scraperNotes: string[] }>("/api/sources");
}

export async function fetchSourceHealth() {
  return apiRequest<{ sources: SourceHealth[] }>("/api/sources/health", { clientCache: "no-store" });
}

export async function fetchTaxonomyOptions() {
  return apiRequest<{ genres: string[]; categories: string[] }>("/api/taxonomy", { clientCacheTtlMs: 1000 * 60 * 10 });
}

export async function searchManga(source: string, query: string, language = "en", offset = 0, limit = 24) {
  const params = new URLSearchParams({
    source,
    language,
    limit: String(limit),
    offset: String(offset)
  });
  if (query.trim()) params.set("query", query.trim());
  return apiRequest<{ manga: MangaSummary[] }>(`/api/manga?${params.toString()}`);
}

export async function fetchManga(source: string, id: string, options: { mirrors?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.mirrors === false) params.set("mirrors", "false");
  return apiRequest<{ manga: MangaDetail }>(`/api/manga/${source}/${id}${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function fetchSimilarManga(source: string, id: string) {
  return apiRequest<{ manga: MangaSummary[] }>(`/api/manga/${source}/${id}/similar`);
}

export async function fetchChapters(source: string, id: string, language = "en", chapterNumber?: string) {
  const params = new URLSearchParams({ language });
  if (chapterNumber) params.set("chapterNumber", chapterNumber);
  return apiRequest<{ chapters: ChapterSummary[] }>(`/api/manga/${source}/${id}/chapters?${params}`);
}

export async function fetchChapterPages(source: string, id: string, mangaId?: string, chapterNumber?: string, language = "en") {
  const params = new URLSearchParams({ language });
  if (mangaId) params.set("mangaId", mangaId);
  if (chapterNumber) params.set("chapterNumber", chapterNumber);
  return apiRequest<ChapterPages>(`/api/chapter/${source}/${id}/pages?${params.toString()}`);
}

export async function prefetchChapterPages(chapters: Array<{ source: string; id: string }>) {
  return apiRequest<{ prefetched: number }>("/api/chapter/prefetch", jsonBody({ chapters }));
}
