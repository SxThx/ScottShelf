import crypto from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getDatabasePool } from "./accounts";
import type { ChapterSummary, MangaDetail, MangaSummary } from "./sources/types";

type MangaUpdatesImage = {
  url?: {
    original?: string;
    thumb?: string;
  };
};

type MangaUpdatesName = {
  name?: string;
  title?: string;
  type?: string;
};

type MangaUpdatesSeries = {
  series_id: number | string;
  title?: string;
  url?: string;
  associated?: MangaUpdatesName[];
  description?: string;
  image?: MangaUpdatesImage;
  type?: string;
  year?: string | number;
  bayesian_rating?: number | string;
  rating_votes?: number | string;
  genres?: Array<{ genre?: string }>;
  categories?: Array<{ category?: string; votes?: number; votes_plus?: number; votes_minus?: number }>;
  latest_chapter?: string | number;
  status?: string;
  completed?: boolean;
  licensed?: boolean;
  authors?: Array<{ name?: string; type?: string }>;
  publishers?: Array<{ publisher_name?: string; type?: string }>;
  last_updated?: { as_rfc3339?: string };
};

type MangaUpdatesSearchResult = {
  record?: MangaUpdatesSeries;
  hit_title?: string;
};

type RatingDistribution = Array<{ rating: number; count: number }>;

type StoredMetadata = {
  mangaUpdatesId: string;
  title: string;
  url?: string;
  description?: string;
  coverUrl?: string;
  type?: string;
  year?: number;
  status?: string;
  contentRating?: string;
  latestChapter?: string;
  communityRating?: number;
  ratingVotes?: number;
  averageRating?: number;
  tags: string[];
  categories: string[];
  altTitles: string[];
  authors: string[];
  artists: string[];
  publishers: string[];
  ratingDistribution?: RatingDistribution;
  metadataUpdatedAt: string;
};

interface MetadataRow extends RowDataPacket {
  manga_updates_id: string | number;
  title: string;
  url: string | null;
  description: string | null;
  cover_url: string | null;
  type: string | null;
  year: number | null;
  status: string | null;
  content_rating: string | null;
  latest_chapter: string | null;
  community_rating: string | number | null;
  rating_votes: number | null;
  average_rating: string | number | null;
  genres_json: string;
  categories_json: string;
  alt_titles_json: string;
  authors_json: string;
  artists_json: string;
  publishers_json: string;
  rating_distribution_json: string | null;
  metadata_updated_at: Date | string;
}

interface LinkRow extends RowDataPacket {
  manga_updates_id: string | number;
}

interface CompiledTitleRow extends RowDataPacket {
  source: string;
  manga_id: string;
  canonical_key: string | null;
  detail_json: string | MangaDetail;
  source_checked_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CanonicalTitleRow extends RowDataPacket {
  id: string;
  canonical_key: string;
}

interface OwnedTitleRow extends RowDataPacket {
  id: string;
  canonical_key: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  status: string | null;
  content_rating: string | null;
  demographic: string | null;
  year: number | null;
  latest_chapter: string | null;
  latest_chapter_released_at: Date | string | null;
  metadata_source: string | null;
  metadata_updated_at: Date | string | null;
  genres_json: string | string[];
  categories_json: string | string[];
  tags_json: string | string[];
  updated_at: Date | string;
}

interface OwnedTitleSourceRow extends RowDataPacket {
  source: string;
  manga_id: string;
  title: string;
  cover_url: string | null;
  latest_chapter: string | null;
  latest_chapter_released_at: Date | string | null;
  content_rating: string | null;
}

interface OwnedTitleChapterRow extends RowDataPacket {
  source: string;
  manga_id: string;
  chapter_id: string;
  chapter_number: string | null;
  title: string | null;
  volume: string | null;
  language: string;
  published_at: Date | string | null;
  readable_at: Date | string | null;
  groups_json: string | string[] | null;
  pages: number | null;
  external_url: string | null;
}

const apiBase = "https://api.mangaupdates.com/v1";
const metadataFreshMs = Number(process.env.MANGAUPDATES_METADATA_TTL_MS ?? 1000 * 60 * 60 * 24);
const compiledTitleFreshMs = Number(process.env.COMPILED_TITLE_CACHE_TTL_MS ?? 1000 * 60 * 60 * 24);
const refreshIntervalMs = Number(process.env.MANGAUPDATES_REFRESH_INTERVAL_MS ?? 1000 * 60 * 60);
const refreshBatchSize = Number(process.env.MANGAUPDATES_REFRESH_BATCH_SIZE ?? 20);
const fallbackGenres = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Historical",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Slice of Life",
  "Supernatural"
];
const fallbackCategories = [
  "Academy",
  "Adapted to Anime",
  "Age Regression",
  "Animals",
  "Antihero",
  "Beautiful Female Lead",
  "Dungeons",
  "Game Elements",
  "Magic",
  "Martial Arts",
  "Monsters",
  "Nobility",
  "Reincarnation",
  "Revenge",
  "Royalty",
  "Strong Male Lead",
  "System",
  "Time Travel",
  "Villainess",
  "Weak to Strong"
];

function toIsoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIsoDate(value?: Date | string | null) {
  if (!value) return undefined;
  return toIsoDate(value);
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return parseJsonArray(JSON.parse(value));
  } catch {
    return [];
  }
}

async function ensureJsonColumn(db: Pool, table: string, column: string, afterColumn: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [table, column]
  );
  if (rows.length) return;

  await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} JSON NULL AFTER ${afterColumn}`);
  await db.query(`UPDATE ${table} SET ${column} = JSON_ARRAY() WHERE ${column} IS NULL`);
}

function parseRatingDistribution(value: unknown): RatingDistribution | undefined {
  if (!value) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return undefined;
  const rows = parsed
    .map((item) => ({
      rating: Number((item as Record<string, unknown>).rating),
      count: Number((item as Record<string, unknown>).count)
    }))
    .filter((item) => Number.isFinite(item.rating) && Number.isFinite(item.count));
  return rows.length ? rows : undefined;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function yearOrUndefined(value: unknown) {
  const year = Number(value);
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function hasTaxonomyOverlap(genres: string[], categories: string[]) {
  const categoryKeys = new Set(categories.map((category) => category.trim().toLowerCase()).filter(Boolean));
  return genres.some((genre) => categoryKeys.has(genre.trim().toLowerCase()));
}

export function cleanSynopsis(value?: string) {
  if (!value) return undefined;
  const withoutMetadataSections = value.replace(/\r\n/g, "\n");
  const sectionMatch = withoutMetadataSections.search(
    /(?:^|\s)(?:\*{1,2}\s*)?(?:Source|Original\s+(?:Webtoon|Novel|Manga|Work)|Official\s+(?:Translations?|English|Raw|Site)|Raw|Translations?|Licensed|Serialization|Webtoon|Novel|Publisher)\s*:/i
  );
  const synopsisOnly = sectionMatch > 0 ? withoutMetadataSections.slice(0, sectionMatch) : withoutMetadataSections;
  const withoutMarkdownLinks = synopsisOnly.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, (_match, label: string) => {
    return /official|translation|scanlation|source|raw|english|spanish|chinese|korean|japanese|indonesian|thai|french/i.test(label)
      ? ""
      : label;
  });
  return withoutMarkdownLinks
    .replace(/(?:^|\n)\s*(?:\*{1,2}\s*)?(?:Source|Original\s+(?:Webtoon|Novel|Manga|Work)|Official\s+(?:Translations?|English|Raw|Site)|Raw|Translations?|Licensed|Serialization|Webtoon|Novel|Publisher)\s*:.*$/gis, "")
    .replace(/\[[^\]]*(?:official|translation|scanlation|source|raw|english|spanish|chinese|korean|japanese|indonesian|thai|french)[^\]]*\]/gi, "")
    .replace(/\((?:https?:\/\/|www\.)[^)]+\)/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/\*{1,2}/g, "")
    .replace(/\s+-\s+(?=\s*(?:$|\[|official|source|raw))/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || undefined;
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|and|of|to|with|in|on|my|i)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTitleKey(value: string) {
  const normalized = normalizeTitle(value);
  return normalized ? `title:${normalized}` : undefined;
}

function canonicalIdFromKey(canonicalKey: string) {
  return crypto.createHash("sha1").update(canonicalKey).digest("hex");
}

function canonicalKeyFromManga(manga: MangaSummary) {
  return manga.canonicalKey || normalizedTitleKey(manga.title) || `${manga.source}:${manga.id}`;
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

function mangaUpdatesSearchTerms(manga: MangaDetail) {
  const terms = [manga.links?.mu, manga.title, ...manga.altTitles].filter((term): term is string => Boolean(term?.trim()));
  const expanded = terms.flatMap((term) => {
    const match = term.match(/mangaupdates\.com\/series\/([^/?#]+)/i);
    if (!match) return [term];
    return [term, `https://www.mangaupdates.com/series/${match[1]}`];
  });
  if (manga.links?.mu && /^[a-z0-9]+$/i.test(manga.links.mu.trim())) {
    expanded.unshift(`https://www.mangaupdates.com/series/${manga.links.mu.trim()}`);
  }
  return uniqueStrings(expanded).slice(0, 5);
}

function inferContentRating(tags: string[]) {
  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const adultTags = new Set(["adult", "hentai", "smut", "erotica", "pornographic", "nsfw"]);
  const suggestiveTags = new Set(["ecchi", "mature", "suggestive"]);
  if (normalizedTags.some((tag) => adultTags.has(tag))) return "adult";
  if (normalizedTags.some((tag) => suggestiveTags.has(tag))) return "suggestive";
  return undefined;
}

function sanitizedContentRating(contentRating: string | undefined, tags: string[]) {
  const normalized = contentRating?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized !== "adult") return contentRating;
  return inferContentRating(tags) === "adult" ? contentRating : undefined;
}

function statusFromSeries(series: MangaUpdatesSeries) {
  const raw = series.status?.trim();
  if (series.completed || raw?.toLowerCase().includes("complete")) return "completed";
  if (raw?.toLowerCase().includes("ongoing")) return "ongoing";
  return normalizeStatus(raw);
}

function normalizeStatus(value?: string) {
  const raw = value?.trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized.includes("hiatus")) return "hiatus";
  if (normalized.includes("ongoing")) return "ongoing";
  if (normalized.includes("complete") || normalized.includes("finished")) return "completed";
  if (normalized.includes("cancel") || normalized.includes("discontinued")) return "cancelled";
  if (normalized.includes("release")) return "ongoing";
  return raw.length > 120 ? raw.slice(0, 120).trim() : raw;
}

function metadataFromSeries(series: MangaUpdatesSeries, ratingDistribution?: RatingDistribution): StoredMetadata {
  const authors = series.authors ?? [];
  const authorNames = authors.filter((item) => item.type?.toLowerCase() !== "artist").map((item) => item.name);
  const artistNames = authors.filter((item) => item.type?.toLowerCase() === "artist").map((item) => item.name);
  const genres = uniqueStrings((series.genres ?? []).map((item) => item.genre));
  const categories = uniqueStrings((series.categories ?? []).map((item) => item.category));
  const ratingTags = uniqueStrings([...genres, ...categories]);
  const communityRating = numberOrUndefined(series.bayesian_rating);

  return {
    mangaUpdatesId: String(series.series_id),
    title: series.title?.trim() || "Untitled",
    url: series.url,
    description: cleanSynopsis(series.description),
    coverUrl: series.image?.url?.original ?? series.image?.url?.thumb,
    type: series.type,
    year: yearOrUndefined(series.year),
    status: statusFromSeries(series),
    contentRating: inferContentRating(ratingTags),
    latestChapter: series.latest_chapter === undefined ? undefined : String(series.latest_chapter),
    communityRating,
    ratingVotes: numberOrUndefined(series.rating_votes),
    averageRating: ratingDistribution?.length
      ? ratingDistribution.reduce((sum, item) => sum + item.rating * item.count, 0) /
        Math.max(ratingDistribution.reduce((sum, item) => sum + item.count, 0), 1)
      : undefined,
    tags: genres,
    categories,
    altTitles: uniqueStrings((series.associated ?? []).map((item) => item.title)),
    authors: uniqueStrings(authorNames),
    artists: uniqueStrings(artistNames),
    publishers: uniqueStrings((series.publishers ?? []).map((item) => item.publisher_name)),
    ratingDistribution,
    metadataUpdatedAt: new Date().toISOString()
  };
}

function metadataFromRow(row: MetadataRow): StoredMetadata {
  return {
    mangaUpdatesId: String(row.manga_updates_id),
    title: row.title,
    url: row.url || undefined,
    description: cleanSynopsis(row.description || undefined),
    coverUrl: row.cover_url || undefined,
    type: row.type || undefined,
    year: row.year || undefined,
    status: row.status || undefined,
    contentRating: row.content_rating || undefined,
    latestChapter: row.latest_chapter || undefined,
    communityRating: numberOrUndefined(row.community_rating),
    ratingVotes: row.rating_votes ?? undefined,
    averageRating: numberOrUndefined(row.average_rating),
    tags: parseJsonArray(row.genres_json),
    categories: parseJsonArray(row.categories_json),
    altTitles: parseJsonArray(row.alt_titles_json),
    authors: parseJsonArray(row.authors_json),
    artists: parseJsonArray(row.artists_json),
    publishers: parseJsonArray(row.publishers_json),
    ratingDistribution: row.rating_distribution_json ? parseRatingDistribution(row.rating_distribution_json) : undefined,
    metadataUpdatedAt: toIsoDate(row.metadata_updated_at)
  };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MANGAUPDATES_TIMEOUT_MS ?? 8000));
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ScottShelf/0.1",
        ...(init?.headers ?? {})
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`MangaUpdates request failed (${response.status}): ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveSeries(id: string | number) {
  return apiJson<MangaUpdatesSeries>(`/series/${id}`);
}

async function retrieveRatingDistribution(id: string | number) {
  const result = await apiJson<{ rainbow?: RatingDistribution }>(`/series/${id}/ratingrainbow`).catch(() => undefined);
  return result?.rainbow;
}

async function searchSeries(term: string) {
  const body = JSON.stringify({ search: term });
  const result = await apiJson<{ results?: MangaUpdatesSearchResult[] }>("/series/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  return result.results ?? [];
}

function scoreCandidate(base: MangaDetail, candidate: MangaUpdatesSeries, hitTitle?: string) {
  const titles = [base.title, ...base.altTitles].filter(Boolean);
  const candidateTitles = [candidate.title, hitTitle, ...(candidate.associated ?? []).map((item) => item.title)].filter(
    (title): title is string => Boolean(title)
  );
  const similarity = Math.max(0, ...titles.flatMap((left) => candidateTitles.map((right) => titleSimilarity(left, right))));
  let score = similarity * 100;
  if (base.year && yearOrUndefined(candidate.year) === base.year) score += 12;
  if (base.demographic && candidate.type && base.demographic.toLowerCase() === candidate.type.toLowerCase()) score += 6;
  if (base.authors?.some((author) => (candidate.authors ?? []).some((item) => item.name && titleSimilarity(author, item.name) >= 0.8))) {
    score += 8;
  }
  return score;
}

async function fetchBestMetadata(base: MangaDetail) {
  const seen = new Set<string>();
  let best: { series: MangaUpdatesSeries; score: number } | undefined;

  for (const term of mangaUpdatesSearchTerms(base)) {
    const isLinkSearch = /mangaupdates\.com\/series\//i.test(term);
    const results = await searchSeries(term).catch(() => []);
    for (const result of results.slice(0, 8)) {
      const record = result.record;
      if (!record?.series_id || seen.has(String(record.series_id))) continue;
      seen.add(String(record.series_id));
      const score = scoreCandidate(base, record, result.hit_title) + (isLinkSearch ? 20 : 0);
      if (!best || score > best.score) best = { series: record, score };
    }
    if (best && best.score >= 90) break;
  }

  if (!best || best.score < 72) return undefined;

  const full = await retrieveSeries(best.series.series_id).catch(() => best?.series);
  if (!full?.series_id) return undefined;
  const distribution = await retrieveRatingDistribution(full.series_id);
  return metadataFromSeries(full, distribution);
}

async function findLinkedMetadata(db: Pool, source: string, mangaId: string) {
  const [links] = await db.execute<LinkRow[]>(
    "SELECT manga_updates_id FROM title_metadata_links WHERE source = ? AND manga_id = ? LIMIT 1",
    [source, mangaId]
  );
  const link = links[0];
  if (!link) return undefined;

  const [rows] = await db.execute<MetadataRow[]>("SELECT * FROM title_metadata WHERE manga_updates_id = ? LIMIT 1", [
    link.manga_updates_id
  ]);
  return rows[0] ? metadataFromRow(rows[0]) : undefined;
}

async function findStoredMetadataByTitle(db: Pool, base: MangaDetail) {
  const titles = uniqueStrings([base.title, ...base.altTitles]).slice(0, 8);
  let best: { metadata: StoredMetadata; score: number } | undefined;

  for (const title of titles) {
    const [rows] = await db.execute<MetadataRow[]>(
      `
        SELECT *
        FROM title_metadata
        WHERE LOWER(title) = LOWER(?)
          OR LOWER(CAST(alt_titles_json AS CHAR)) LIKE CONCAT('%', LOWER(?), '%')
        LIMIT 8
      `,
      [title, title]
    );

    for (const row of rows) {
      const metadata = metadataFromRow(row);
      const score = Math.max(
        titleSimilarity(base.title, metadata.title),
        ...base.altTitles.map((altTitle) => titleSimilarity(altTitle, metadata.title)),
        ...metadata.altTitles.flatMap((altTitle) => [base.title, ...base.altTitles].map((baseTitle) => titleSimilarity(baseTitle, altTitle)))
      );
      if (!best || score > best.score) best = { metadata, score };
    }
  }

  return best && best.score >= 0.72 ? best.metadata : undefined;
}

async function findStoredMetadataByLooseTitle(db: Pool, title: string) {
  const [rows] = await db.execute<MetadataRow[]>(
    `
      SELECT *
      FROM title_metadata
      WHERE LOWER(title) = LOWER(?)
        OR LOWER(CAST(alt_titles_json AS CHAR)) LIKE CONCAT('%', LOWER(?), '%')
      LIMIT 8
    `,
    [title, title]
  );

  let best: { metadata: StoredMetadata; score: number } | undefined;
  for (const row of rows) {
    const metadata = metadataFromRow(row);
    const score = Math.max(titleSimilarity(title, metadata.title), ...metadata.altTitles.map((altTitle) => titleSimilarity(title, altTitle)));
    if (!best || score > best.score) best = { metadata, score };
  }
  return best && best.score >= 0.72 ? best.metadata : undefined;
}

async function saveMetadata(
  db: Pool,
  metadata: StoredMetadata,
  link?: { source: string; mangaId: string; confidence?: number }
) {
  await db.execute(
    `
      INSERT INTO title_metadata (
        manga_updates_id, title, url, description, cover_url, type, year, status, content_rating, latest_chapter,
        community_rating, rating_votes, average_rating, genres_json, categories_json, alt_titles_json, authors_json,
        artists_json, publishers_json, rating_distribution_json, metadata_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        url = VALUES(url),
        description = VALUES(description),
        cover_url = VALUES(cover_url),
        type = VALUES(type),
        year = VALUES(year),
        status = VALUES(status),
        content_rating = VALUES(content_rating),
        latest_chapter = VALUES(latest_chapter),
        community_rating = VALUES(community_rating),
        rating_votes = VALUES(rating_votes),
        average_rating = VALUES(average_rating),
        genres_json = VALUES(genres_json),
        categories_json = VALUES(categories_json),
        alt_titles_json = VALUES(alt_titles_json),
        authors_json = VALUES(authors_json),
        artists_json = VALUES(artists_json),
        publishers_json = VALUES(publishers_json),
        rating_distribution_json = VALUES(rating_distribution_json),
        metadata_updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      metadata.mangaUpdatesId,
      metadata.title,
      metadata.url ?? null,
      metadata.description ?? null,
      metadata.coverUrl ?? null,
      metadata.type ?? null,
      metadata.year ?? null,
      metadata.status ?? null,
      metadata.contentRating ?? null,
      metadata.latestChapter ?? null,
      metadata.communityRating ?? null,
      metadata.ratingVotes ?? null,
      metadata.averageRating ?? null,
      JSON.stringify(metadata.tags),
      JSON.stringify(metadata.categories),
      JSON.stringify(metadata.altTitles),
      JSON.stringify(metadata.authors),
      JSON.stringify(metadata.artists),
      JSON.stringify(metadata.publishers),
      metadata.ratingDistribution ? JSON.stringify(metadata.ratingDistribution) : null
    ]
  );

  if (link) {
    await db.execute(
      `
        INSERT INTO title_metadata_links (source, manga_id, manga_updates_id, match_confidence)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          manga_updates_id = VALUES(manga_updates_id),
          match_confidence = VALUES(match_confidence),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [link.source, link.mangaId, metadata.mangaUpdatesId, link.confidence ?? 100]
    );
  }
}

function mergedGenres(metadata: StoredMetadata, base: MangaDetail) {
  const mangaUpdatesGenres = uniqueStrings(metadata.tags);
  if (mangaUpdatesGenres.length) return mangaUpdatesGenres.slice(0, 24);
  return uniqueStrings(base.genres ?? []).slice(0, 24);
}

function mergedCategories(metadata: StoredMetadata, base: MangaDetail) {
  const mangaUpdatesCategories = uniqueStrings(metadata.categories);
  if (mangaUpdatesCategories.length) return mangaUpdatesCategories.slice(0, 64);
  return uniqueStrings([...(base.categories ?? []), ...base.tags]).slice(0, 64);
}

function mergedLegacyTags(metadata: StoredMetadata, base: MangaDetail) {
  return uniqueStrings([...metadata.tags, ...metadata.categories, ...(base.genres ?? []), ...(base.categories ?? []), ...base.tags]).slice(0, 96);
}

function mergeMetadata(base: MangaDetail, metadata: StoredMetadata): MangaDetail {
  const genres = mergedGenres(metadata, base);
  const categories = mergedCategories(metadata, base);
  return {
    ...base,
    canonicalKey: `mu:${metadata.mangaUpdatesId}`,
    title: metadata.title || base.title,
    description: cleanSynopsis(metadata.description || base.description),
    coverUrl: metadata.coverUrl || base.coverUrl,
    status: normalizeStatus(metadata.status || base.status),
    contentRating: base.contentRating || sanitizedContentRating(metadata.contentRating, uniqueStrings([...genres, ...categories])),
    demographic: metadata.type || base.demographic,
    year: metadata.year || base.year,
    latestChapter: base.latestChapter ?? metadata.latestChapter,
    genres,
    categories,
    tags: mergedLegacyTags(metadata, base),
    altTitles: uniqueStrings([...metadata.altTitles, ...base.altTitles]).filter((title) => title !== metadata.title),
    links: {
      ...base.links,
      ...(metadata.url ? { mu: metadata.url } : {})
    },
    artists: uniqueStrings([...(metadata.artists ?? []), ...(base.artists ?? [])]),
    authors: uniqueStrings([...(metadata.authors ?? []), ...(base.authors ?? [])]),
    publishers: uniqueStrings([...(metadata.publishers ?? []), ...(base.publishers ?? [])]),
    communityRating: metadata.communityRating,
    ratingVotes: metadata.ratingVotes,
    ratingDistribution: metadata.ratingDistribution,
    metadataSource: "MangaUpdates",
    metadataUpdatedAt: metadata.metadataUpdatedAt
  };
}

function detailFromStoredMetadata(source: string, mangaId: string, metadata: StoredMetadata): MangaDetail {
  const genres = metadata.tags.slice(0, 24);
  const categories = metadata.categories.slice(0, 64);
  const tags = uniqueStrings([...genres, ...categories]).slice(0, 96);
  return {
    source,
    id: mangaId,
    canonicalKey: `mu:${metadata.mangaUpdatesId}`,
    title: metadata.title,
    description: cleanSynopsis(metadata.description),
    coverUrl: metadata.coverUrl,
    status: normalizeStatus(metadata.status),
    contentRating: sanitizedContentRating(metadata.contentRating, tags),
    demographic: metadata.type,
    year: metadata.year,
    latestChapter: metadata.latestChapter,
    communityRating: metadata.communityRating,
    ratingVotes: metadata.ratingVotes,
    metadataSource: "MangaUpdates",
    metadataUpdatedAt: metadata.metadataUpdatedAt,
    genres,
    categories,
    tags,
    altTitles: metadata.altTitles,
    links: metadata.url ? { mu: metadata.url } : {},
    artists: metadata.artists,
    authors: metadata.authors,
    publishers: metadata.publishers,
    ratingDistribution: metadata.ratingDistribution
  };
}

function parseCompiledDetail(value: string | MangaDetail) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") return undefined;
  const detail = parsed as Partial<MangaDetail>;
  if (!detail.source || !detail.id || !detail.title) return undefined;
  const tags = Array.isArray(detail.tags) ? detail.tags : [];
  const genres = Array.isArray(detail.genres) ? detail.genres : [];
  const categories = Array.isArray(detail.categories) ? detail.categories : [];
  const ratingTags = uniqueStrings([...tags, ...genres, ...categories]);
  return {
    ...detail,
    source: detail.source,
    id: detail.id,
    title: detail.title,
    description: cleanSynopsis(detail.description),
    contentRating: sanitizedContentRating(detail.contentRating, ratingTags),
    genres,
    categories,
    tags,
    altTitles: Array.isArray(detail.altTitles) ? detail.altTitles : [],
    links: detail.links && typeof detail.links === "object" ? detail.links : {}
  } as MangaDetail;
}

export function compiledTitleIsStale(updatedAt?: string) {
  if (!updatedAt) return true;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return !Number.isFinite(ageMs) || ageMs > compiledTitleFreshMs;
}

export async function getCompiledTitle(source: string, mangaId: string) {
  const db = await getDatabasePool();
  const [rows] = await db.execute<CompiledTitleRow[]>(
    "SELECT * FROM compiled_title_cache WHERE source = ? AND manga_id = ? LIMIT 1",
    [source, mangaId]
  );
  const row = rows[0];
  if (!row) return undefined;
  const manga = parseCompiledDetail(row.detail_json);
  if (!manga) return undefined;
  return {
    manga,
    sourceCheckedAt: toIsoDate(row.source_checked_at),
    updatedAt: toIsoDate(row.updated_at)
  };
}

export async function getSavedMetadataTitle(source: string, mangaId: string) {
  const db = await getDatabasePool();
  const metadata = await findLinkedMetadata(db, source, mangaId).catch(() => undefined);
  return metadata ? detailFromStoredMetadata(source, mangaId, metadata) : undefined;
}

export async function upsertCanonicalTitle(manga: MangaDetail | MangaSummary) {
  const db = await getDatabasePool();
  const canonicalKey = canonicalKeyFromManga(manga);
  const canonicalId = canonicalIdFromKey(canonicalKey);
  const links = "links" in manga ? manga.links : undefined;
  const metadataSource = manga.metadataSource || links?.mu || links?.website || `${manga.source}:${manga.id}`;

  await db.execute(
    `
      INSERT INTO titles (
        id, canonical_key, title, description, cover_url, status, content_rating, demographic, year,
        latest_chapter, latest_chapter_released_at, metadata_source, metadata_updated_at, genres_json, categories_json, tags_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        description = COALESCE(VALUES(description), description),
        cover_url = COALESCE(VALUES(cover_url), cover_url),
        status = COALESCE(VALUES(status), status),
        content_rating = COALESCE(VALUES(content_rating), content_rating),
        demographic = COALESCE(VALUES(demographic), demographic),
        year = COALESCE(VALUES(year), year),
        latest_chapter = COALESCE(VALUES(latest_chapter), latest_chapter),
        latest_chapter_released_at = COALESCE(VALUES(latest_chapter_released_at), latest_chapter_released_at),
        metadata_source = COALESCE(VALUES(metadata_source), metadata_source),
        metadata_updated_at = COALESCE(VALUES(metadata_updated_at), metadata_updated_at),
        genres_json = VALUES(genres_json),
        categories_json = VALUES(categories_json),
        tags_json = VALUES(tags_json),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      canonicalId,
      canonicalKey,
      manga.title,
      cleanSynopsis(manga.description) ?? null,
      manga.coverUrl ?? null,
      normalizeStatus(manga.status) ?? null,
      manga.contentRating ?? null,
      manga.demographic ?? null,
      manga.year ?? null,
      manga.latestChapter ?? null,
      manga.latestChapterReleasedAt ? new Date(manga.latestChapterReleasedAt) : null,
      metadataSource,
      manga.metadataUpdatedAt ? new Date(manga.metadataUpdatedAt) : null,
      JSON.stringify(manga.genres ?? []),
      JSON.stringify(manga.categories ?? []),
      JSON.stringify(manga.tags ?? [])
    ]
  );

  await db.execute(
    `
      INSERT INTO title_sources (
        canonical_id, source, manga_id, title, cover_url, latest_chapter, latest_chapter_released_at, content_rating
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        canonical_id = VALUES(canonical_id),
        title = VALUES(title),
        cover_url = COALESCE(VALUES(cover_url), cover_url),
        latest_chapter = COALESCE(VALUES(latest_chapter), latest_chapter),
        latest_chapter_released_at = COALESCE(VALUES(latest_chapter_released_at), latest_chapter_released_at),
        content_rating = COALESCE(VALUES(content_rating), content_rating),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      canonicalId,
      manga.source,
      manga.id,
      manga.title,
      manga.coverUrl ?? null,
      manga.latestChapter ?? null,
      manga.latestChapterReleasedAt ? new Date(manga.latestChapterReleasedAt) : null,
      manga.contentRating ?? null
    ]
  );

  return { canonicalId, canonicalKey };
}

async function canonicalTitleBySource(source: string, mangaId: string) {
  const db = await getDatabasePool();
  const [rows] = await db.execute<CanonicalTitleRow[]>(
    `
      SELECT titles.id, titles.canonical_key
      FROM title_sources
      JOIN titles ON titles.id = title_sources.canonical_id
      WHERE title_sources.source = ? AND title_sources.manga_id = ?
      LIMIT 1
    `,
    [source, mangaId]
  );
  return rows[0];
}

export async function upsertCanonicalChapters(source: string, mangaId: string, language: string, chapters: ChapterSummary[]) {
  if (!chapters.length) return;
  let canonical = await canonicalTitleBySource(source, mangaId).catch(() => undefined);
  if (!canonical) {
    const compiled = await getCompiledTitle(source, mangaId).catch(() => undefined);
    if (compiled) {
      await upsertCanonicalTitle(compiled.manga);
      canonical = await canonicalTitleBySource(source, mangaId).catch(() => undefined);
    }
  }
  if (!canonical) return;

  const db = await getDatabasePool();
  for (const chapter of chapters) {
    await db.execute(
      `
        INSERT INTO title_chapters (
          canonical_id, source, manga_id, chapter_id, chapter_number, title, volume, language,
          published_at, readable_at, groups_json, pages, external_url
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          canonical_id = VALUES(canonical_id),
          manga_id = VALUES(manga_id),
          chapter_number = VALUES(chapter_number),
          title = VALUES(title),
          volume = VALUES(volume),
          language = VALUES(language),
          published_at = VALUES(published_at),
          readable_at = VALUES(readable_at),
          groups_json = VALUES(groups_json),
          pages = VALUES(pages),
          external_url = VALUES(external_url),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [
        canonical.id,
        chapter.source,
        chapter.mangaId || mangaId,
        chapter.id,
        chapter.chapter ?? null,
        chapter.title || null,
        chapter.volume ?? null,
        chapter.language || language,
        chapter.publishedAt ? new Date(chapter.publishedAt) : null,
        chapter.readableAt ? new Date(chapter.readableAt) : null,
        JSON.stringify(chapter.groups ?? []),
        chapter.pages ?? null,
        chapter.externalUrl ?? null
      ]
    );
  }
}

function ownedTitleRowToDetail(row: OwnedTitleRow, sources: OwnedTitleSourceRow[]): MangaDetail {
  const primary = sources[0];
  const genres = parseJsonArray(row.genres_json);
  const categories = parseJsonArray(row.categories_json);
  const tags = parseJsonArray(row.tags_json);
  return {
    source: primary?.source ?? "canonical",
    id: row.id,
    canonicalKey: row.canonical_key,
    title: row.title,
    description: cleanSynopsis(row.description || undefined),
    coverUrl: row.cover_url || primary?.cover_url || undefined,
    status: row.status || undefined,
    contentRating: row.content_rating || primary?.content_rating || undefined,
    demographic: row.demographic || undefined,
    year: row.year || undefined,
    latestChapter: row.latest_chapter || primary?.latest_chapter || undefined,
    latestChapterReleasedAt: optionalIsoDate(row.latest_chapter_released_at) ?? optionalIsoDate(primary?.latest_chapter_released_at ?? null),
    metadataSource: row.metadata_source || undefined,
    metadataUpdatedAt: optionalIsoDate(row.metadata_updated_at),
    genres,
    categories,
    tags,
    altTitles: uniqueStrings(sources.map((source) => source.title).filter((title) => title && title !== row.title)),
    links: {},
    mirrors: sources.map((source) => ({
      source: source.source,
      id: source.manga_id,
      canonicalKey: row.canonical_key,
      title: source.title,
      coverUrl: source.cover_url || undefined,
      contentRating: source.content_rating || row.content_rating || undefined,
      genres,
      categories,
      latestChapter: source.latest_chapter || undefined,
      latestChapterReleasedAt: optionalIsoDate(source.latest_chapter_released_at),
      tags
    }))
  };
}

function ownedChapterRowToSummary(row: OwnedTitleChapterRow): ChapterSummary {
  return {
    source: row.source,
    id: row.chapter_id,
    mangaId: row.manga_id,
    title: row.title || "",
    chapter: row.chapter_number || undefined,
    volume: row.volume || undefined,
    language: row.language,
    publishedAt: optionalIsoDate(row.published_at),
    readableAt: optionalIsoDate(row.readable_at),
    groups: parseJsonArray(row.groups_json ?? "[]"),
    pages: row.pages ?? undefined,
    externalUrl: row.external_url || undefined
  };
}

export async function getCanonicalTitle(canonicalId: string) {
  const db = await getDatabasePool();
  const [titleRows] = await db.execute<OwnedTitleRow[]>("SELECT * FROM titles WHERE id = ? LIMIT 1", [canonicalId]);
  const title = titleRows[0];
  if (!title) return undefined;
  const [sourceRows] = await db.execute<OwnedTitleSourceRow[]>(
    `
      SELECT *
      FROM title_sources
      WHERE canonical_id = ?
      ORDER BY latest_chapter_released_at DESC, updated_at DESC
    `,
    [canonicalId]
  );
  return ownedTitleRowToDetail(title, sourceRows);
}

export async function getCanonicalChapters(canonicalId: string, language = "en") {
  const db = await getDatabasePool();
  const [rows] = await db.execute<OwnedTitleChapterRow[]>(
    `
      SELECT *
      FROM title_chapters
      WHERE canonical_id = ? AND language = ?
      ORDER BY
        CASE WHEN chapter_number REGEXP '^[0-9]+(\\\\.[0-9]+)?$' THEN CAST(chapter_number AS DECIMAL(10,3)) ELSE -1 END DESC,
        published_at DESC,
        readable_at DESC
    `,
    [canonicalId, language]
  );
  return rows.map(ownedChapterRowToSummary);
}

export async function saveCompiledTitle(manga: MangaDetail) {
  const db = await getDatabasePool();
  const cleanManga = { ...manga, description: cleanSynopsis(manga.description) };
  await db.execute(
    `
      INSERT INTO compiled_title_cache (source, manga_id, canonical_key, detail_json, source_checked_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        canonical_key = VALUES(canonical_key),
        detail_json = VALUES(detail_json),
        source_checked_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [cleanManga.source, cleanManga.id, cleanManga.canonicalKey ?? null, JSON.stringify(cleanManga)]
  );
  await upsertCanonicalTitle(cleanManga);
}

export async function canonicalKeyForManga(source: string, mangaId: string, fallbackTitle?: string) {
  const db = await getDatabasePool();
  const [links] = await db.execute<LinkRow[]>(
    "SELECT manga_updates_id FROM title_metadata_links WHERE source = ? AND manga_id = ? LIMIT 1",
    [source, mangaId]
  );
  const link = links[0];
  if (link) return `mu:${link.manga_updates_id}`;
  if (fallbackTitle) {
    const metadata = await findStoredMetadataByLooseTitle(db, fallbackTitle).catch(() => undefined);
    if (metadata) {
      await saveMetadata(db, metadata, { source, mangaId }).catch((error: Error) =>
        console.warn(`MangaUpdates canonical link save failed for ${source}:${mangaId}:`, error.message)
      );
      return `mu:${metadata.mangaUpdatesId}`;
    }
  }
  return fallbackTitle ? normalizedTitleKey(fallbackTitle) : undefined;
}

export async function getTaxonomyOptions() {
  const db = await getDatabasePool();
  const genres: string[] = [...fallbackGenres];
  const categories: string[] = [...fallbackCategories];

  const [metadataRows] = await db.query<RowDataPacket[]>(
    "SELECT genres_json, categories_json FROM title_metadata ORDER BY metadata_updated_at DESC LIMIT 2000"
  );
  for (const row of metadataRows) {
    genres.push(...parseJsonArray(row.genres_json));
    categories.push(...parseJsonArray(row.categories_json));
  }

  const [compiledRows] = await db.query<RowDataPacket[]>(
    "SELECT detail_json FROM compiled_title_cache ORDER BY updated_at DESC LIMIT 1000"
  );
  for (const row of compiledRows) {
    const detail = parseCompiledDetail(row.detail_json as string | MangaDetail);
    if (!detail) continue;
    genres.push(...(detail.genres ?? []));
    categories.push(...(detail.categories ?? []));
  }

  return {
    genres: uniqueStrings(genres).sort((left, right) => left.localeCompare(right)),
    categories: uniqueStrings(categories).sort((left, right) => left.localeCompare(right))
  };
}

export async function initializeMetadataTables() {
  const db = await getDatabasePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS title_metadata (
      manga_updates_id BIGINT UNSIGNED PRIMARY KEY,
      title VARCHAR(512) NOT NULL,
      url TEXT NULL,
      description MEDIUMTEXT NULL,
      cover_url TEXT NULL,
      type VARCHAR(64) NULL,
      year SMALLINT NULL,
      status VARCHAR(255) NULL,
      content_rating VARCHAR(64) NULL,
      latest_chapter VARCHAR(64) NULL,
      community_rating DECIMAL(5,2) NULL,
      rating_votes INT UNSIGNED NULL,
      average_rating DECIMAL(5,2) NULL,
      genres_json JSON NOT NULL,
      categories_json JSON NOT NULL,
      alt_titles_json JSON NOT NULL,
      authors_json JSON NOT NULL,
      artists_json JSON NOT NULL,
      publishers_json JSON NOT NULL,
      rating_distribution_json JSON NULL,
      metadata_updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX title_metadata_updated_idx (metadata_updated_at),
      FULLTEXT INDEX title_metadata_title_ft (title)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS title_metadata_links (
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      manga_updates_id BIGINT UNSIGNED NOT NULL,
      match_confidence SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (source, manga_id),
      INDEX title_metadata_links_mu_idx (manga_updates_id),
      CONSTRAINT title_metadata_links_mu_fk FOREIGN KEY (manga_updates_id) REFERENCES title_metadata(manga_updates_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS titles (
      id CHAR(40) PRIMARY KEY,
      canonical_key VARCHAR(512) NOT NULL UNIQUE,
      title VARCHAR(512) NOT NULL,
      description MEDIUMTEXT NULL,
      cover_url TEXT NULL,
      status VARCHAR(128) NULL,
      content_rating VARCHAR(64) NULL,
      demographic VARCHAR(128) NULL,
      year SMALLINT NULL,
      latest_chapter VARCHAR(64) NULL,
      latest_chapter_released_at DATETIME(3) NULL,
      metadata_source VARCHAR(512) NULL,
      metadata_updated_at TIMESTAMP(3) NULL,
      genres_json JSON NOT NULL,
      categories_json JSON NOT NULL,
      tags_json JSON NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX titles_updated_idx (updated_at),
      INDEX titles_latest_idx (latest_chapter_released_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureJsonColumn(db, "titles", "genres_json", "metadata_updated_at");
  await ensureJsonColumn(db, "titles", "categories_json", "genres_json");

  await db.query(`
    CREATE TABLE IF NOT EXISTS title_sources (
      canonical_id CHAR(40) NOT NULL,
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      title VARCHAR(512) NOT NULL,
      cover_url TEXT NULL,
      latest_chapter VARCHAR(64) NULL,
      latest_chapter_released_at DATETIME(3) NULL,
      content_rating VARCHAR(64) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (source, manga_id),
      INDEX title_sources_canonical_idx (canonical_id),
      CONSTRAINT title_sources_canonical_fk FOREIGN KEY (canonical_id) REFERENCES titles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS title_chapters (
      canonical_id CHAR(40) NOT NULL,
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      chapter_id VARCHAR(255) NOT NULL,
      chapter_number VARCHAR(64) NULL,
      title VARCHAR(512) NULL,
      volume VARCHAR(64) NULL,
      language VARCHAR(32) NOT NULL,
      published_at DATETIME(3) NULL,
      readable_at DATETIME(3) NULL,
      groups_json JSON NULL,
      pages INT UNSIGNED NULL,
      external_url TEXT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (source, chapter_id),
      INDEX title_chapters_canonical_idx (canonical_id, language, chapter_number),
      INDEX title_chapters_manga_idx (source, manga_id),
      CONSTRAINT title_chapters_canonical_fk FOREIGN KEY (canonical_id) REFERENCES titles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compiled_title_cache (
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      canonical_key VARCHAR(512) NULL,
      detail_json JSON NOT NULL,
      source_checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (source, manga_id),
      INDEX compiled_title_cache_canonical_idx (canonical_key),
      INDEX compiled_title_cache_updated_idx (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await cleanStoredSynopsisRows(db);
  void refreshMetadataRowsMissingSplitData().catch((error: Error) =>
    console.warn("MangaUpdates split metadata refresh failed:", error.message)
  );
  void refreshMetadataRowsWithCategoryLeak().catch((error: Error) =>
    console.warn("MangaUpdates taxonomy repair failed:", error.message)
  );
}

async function cleanStoredSynopsisRows(db: Pool) {
  const [metadataRows] = await db.query<RowDataPacket[]>(
    "SELECT manga_updates_id, description FROM title_metadata WHERE description IS NOT NULL"
  );
  for (const row of metadataRows) {
    const current = String(row.description ?? "");
    const cleaned = cleanSynopsis(current) ?? null;
    if (cleaned !== current) {
      await db.execute("UPDATE title_metadata SET description = ? WHERE manga_updates_id = ?", [cleaned, row.manga_updates_id]);
    }
  }

  const [compiledRows] = await db.query<RowDataPacket[]>("SELECT source, manga_id, detail_json FROM compiled_title_cache");
  for (const row of compiledRows) {
    const detail = parseCompiledDetail(row.detail_json as string | MangaDetail);
    if (!detail) continue;
    let nextDetail = detail;
    if (detail.description) {
      const cleaned = cleanSynopsis(detail.description);
      if (cleaned !== detail.description) nextDetail = { ...nextDetail, description: cleaned };
    }

    const metadata = await findLinkedMetadata(db, String(row.source), String(row.manga_id)).catch(() => undefined);
    if (metadata) {
      const merged = mergeMetadata(nextDetail, metadata);
      const taxonomyChanged =
        !sameStringArray(nextDetail.genres ?? [], merged.genres ?? []) ||
        !sameStringArray(nextDetail.categories ?? [], merged.categories ?? []) ||
        !sameStringArray(nextDetail.tags ?? [], merged.tags ?? []);
      if (taxonomyChanged) nextDetail = merged;
    }

    if (JSON.stringify(nextDetail) === JSON.stringify(detail)) continue;
    await db.execute("UPDATE compiled_title_cache SET detail_json = ?, canonical_key = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE source = ? AND manga_id = ?", [
      JSON.stringify(nextDetail),
      nextDetail.canonicalKey ?? null,
      row.source,
      row.manga_id
    ]);
    await upsertCanonicalTitle(nextDetail);
  }
}

async function refreshMetadataRowsMissingSplitData() {
  const db = await getDatabasePool();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT manga_updates_id
      FROM title_metadata
      WHERE JSON_LENGTH(categories_json) = 0
         OR JSON_LENGTH(genres_json) = 0
      ORDER BY metadata_updated_at ASC
      LIMIT 50
    `
  );

  let refreshed = 0;
  for (const row of rows) {
    try {
      await refreshMetadataById(String(row.manga_updates_id));
      refreshed += 1;
    } catch (error) {
      console.warn(`MangaUpdates split metadata refresh failed for ${row.manga_updates_id}:`, error instanceof Error ? error.message : String(error));
    }
  }
  if (refreshed) console.log(`MangaUpdates split metadata refresh queued: ${refreshed} titles`);
}

async function refreshMetadataRowsWithCategoryLeak() {
  const db = await getDatabasePool();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT manga_updates_id, genres_json, categories_json
      FROM title_metadata
      ORDER BY metadata_updated_at ASC
      LIMIT 500
    `
  );

  let refreshed = 0;
  for (const row of rows) {
    const genres = parseJsonArray(row.genres_json);
    const categories = parseJsonArray(row.categories_json);
    if (genres.length <= 12 && !hasTaxonomyOverlap(genres, categories)) continue;
    try {
      await refreshMetadataById(String(row.manga_updates_id));
      refreshed += 1;
    } catch (error) {
      console.warn(`MangaUpdates taxonomy repair failed for ${row.manga_updates_id}:`, error instanceof Error ? error.message : String(error));
    }
  }
  if (refreshed) console.log(`MangaUpdates taxonomy repair refreshed: ${refreshed} titles`);
}

export async function enrichMangaMetadata(base: MangaDetail): Promise<MangaDetail> {
  const db = await getDatabasePool();
  const linked = await findLinkedMetadata(db, base.source, base.id).catch(() => undefined);
  if (linked) {
    const ageMs = Date.now() - new Date(linked.metadataUpdatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs > metadataFreshMs) {
      void refreshMetadataById(linked.mangaUpdatesId).catch((error: Error) =>
        console.warn(`MangaUpdates metadata refresh failed for ${linked.mangaUpdatesId}:`, error.message)
      );
    }
    return mergeMetadata(base, linked);
  }

  const stored = await findStoredMetadataByTitle(db, base).catch(() => undefined);
  if (stored) {
    await saveMetadata(db, stored, { source: base.source, mangaId: base.id }).catch((error: Error) =>
      console.warn(`MangaUpdates metadata link save failed for ${base.source}:${base.id}:`, error.message)
    );
    return mergeMetadata(base, stored);
  }

  const metadata = await fetchBestMetadata(base).catch((error: Error) => {
    console.warn(`MangaUpdates metadata lookup failed for ${base.source}:${base.id}:`, error.message);
    return undefined;
  });
  if (!metadata) return base;

  await saveMetadata(db, metadata, { source: base.source, mangaId: base.id }).catch((error: Error) =>
    console.warn(`MangaUpdates metadata save failed for ${base.source}:${base.id}:`, error.message)
  );
  return mergeMetadata(base, metadata);
}

async function refreshMetadataById(mangaUpdatesId: string | number) {
  const series = await retrieveSeries(mangaUpdatesId);
  const distribution = await retrieveRatingDistribution(mangaUpdatesId);
  const metadata = metadataFromSeries(series, distribution);
  const db = await getDatabasePool();
  await saveMetadata(db, metadata);
  await refreshCompiledRowsForMetadata(db, metadata);
}

async function refreshCompiledRowsForMetadata(db: Pool, metadata: StoredMetadata) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `
      SELECT compiled_title_cache.source, compiled_title_cache.manga_id, compiled_title_cache.detail_json
      FROM compiled_title_cache
      JOIN title_metadata_links
        ON title_metadata_links.source = compiled_title_cache.source
        AND title_metadata_links.manga_id = compiled_title_cache.manga_id
      WHERE title_metadata_links.manga_updates_id = ?
    `,
    [metadata.mangaUpdatesId]
  );

  for (const row of rows) {
    const detail = parseCompiledDetail(row.detail_json as string | MangaDetail);
    if (!detail) continue;
    const nextDetail = mergeMetadata(detail, metadata);
    await db.execute(
      `
        UPDATE compiled_title_cache
        SET detail_json = ?, canonical_key = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE source = ? AND manga_id = ?
      `,
      [JSON.stringify(nextDetail), nextDetail.canonicalKey ?? null, row.source, row.manga_id]
    );
    await upsertCanonicalTitle(nextDetail);
  }
}

async function refreshStaleMetadataBatch() {
  const db = await getDatabasePool();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT manga_updates_id
      FROM title_metadata
      WHERE metadata_updated_at < DATE_SUB(NOW(3), INTERVAL 24 HOUR)
      ORDER BY metadata_updated_at ASC
      LIMIT ${Math.max(Math.min(Math.floor(refreshBatchSize), 100), 1)}
    `
  );

  let refreshed = 0;
  for (const row of rows) {
    try {
      await refreshMetadataById(String(row.manga_updates_id));
      refreshed += 1;
    } catch (error) {
      console.warn(`MangaUpdates scheduled refresh failed for ${row.manga_updates_id}:`, error instanceof Error ? error.message : String(error));
    }
  }
  if (refreshed) console.log(`MangaUpdates metadata refresh completed: ${refreshed} titles`);
}

export function startMetadataRefreshCron() {
  if (refreshIntervalMs <= 0) return;
  setTimeout(() => {
    refreshStaleMetadataBatch().catch((error: Error) => console.warn("MangaUpdates metadata refresh failed:", error.message));
  }, 1000 * 30);
  setInterval(() => {
    refreshStaleMetadataBatch().catch((error: Error) => console.warn("MangaUpdates metadata refresh failed:", error.message));
  }, refreshIntervalMs);
}
