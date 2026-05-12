import crypto from "node:crypto";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { ChapterPages, ChapterSummary } from "./sources/types";

export type UserRole = "admin" | "user";

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  nsfwAllowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteRecord {
  source: string;
  id?: string;
  mangaId: string;
  canonicalKey?: string;
  title: string;
  description?: string;
  coverUrl?: string;
  status?: string;
  contentRating?: string;
  demographic?: string;
  year?: number;
  latestChapter?: string;
  latestChapterReleasedAt?: string;
  tags: string[];
  addedAt: string;
  lastReadChapterId?: string;
  lastReadChapter?: string;
  lastReadScrollPosition?: number;
}

export interface ReadingProgressRecord {
  source: string;
  mangaId: string;
  canonicalKey?: string;
  chapterSource?: string;
  chapterId: string;
  chapterNumber?: string;
  scrollPosition?: number;
  updatedAt: string;
}

export interface ReadingProgressInput {
  source: string;
  mangaId: string;
  canonicalKey?: string;
  chapterSource?: string;
  chapterId: string;
  chapterNumber?: string;
  scrollPosition?: number;
}

export interface BookmarkUpdateRecord {
  manga: FavoriteRecord;
  latestChapter?: ChapterSummary;
  lastReadChapter?: string;
  checkedAt?: string;
  error?: string;
}

export type BookmarkDownloadJobType = "title_detail" | "latest_check" | "chapter_list" | "latest_chapters" | "chapter_pages";

export interface BookmarkDownloadJobRecord {
  id: string;
  jobType: BookmarkDownloadJobType;
  source: string;
  mangaId: string;
  canonicalKey?: string;
  chapterId?: string;
  chapterNumber?: string;
  language: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
}

export interface RecommendationInput {
  toUserId: string;
  source: string;
  mangaId: string;
  title: string;
  coverUrl?: string;
  contentRating?: string;
  demographic?: string;
  tags?: string[];
  latestChapter?: string;
  latestChapterReleasedAt?: string;
}

export interface RecommendationRecord extends RecommendationInput {
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUsername: string;
  readAt?: string;
  createdAt: string;
}

export interface UserInteractionBlockRecord {
  id: string;
  userAId: string;
  userAUsername: string;
  userBId: string;
  userBUsername: string;
  createdBy: string;
  createdByUsername: string;
  createdAt: string;
}

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  role: UserRole;
  nsfw_allowed: number | boolean;
  password_hash: string;
  salt: string;
  iterations: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface FavoriteRow extends RowDataPacket {
  source: string;
  manga_id: string;
  canonical_key: string | null;
  effective_canonical_key?: string | null;
  title: string;
  description: string | null;
  cover_url: string | null;
  status: string | null;
  content_rating: string | null;
  demographic: string | null;
  year: number | null;
  latest_chapter: string | null;
  latest_chapter_released_at: Date | string | null;
  cached_latest_chapter_number?: string | null;
  cached_latest_chapter_published_at?: Date | string | null;
  cached_latest_chapter_readable_at?: Date | string | null;
  tags_json: string;
  added_at: Date | string;
  last_read_chapter_id: string | null;
  last_read_chapter_number: string | null;
  last_read_scroll_position: number | null;
}

interface ReadingProgressRow extends RowDataPacket {
  source: string;
  manga_id: string;
  canonical_key: string | null;
  effective_canonical_key?: string | null;
  favorite_title?: string | null;
  chapter_source: string | null;
  chapter_id: string;
  chapter_number: string | null;
  scroll_position: number | null;
  updated_at: Date | string;
}

interface RecommendationRow extends RowDataPacket {
  id: string;
  from_user_id: string;
  from_username: string;
  to_user_id: string;
  to_username: string;
  source: string;
  manga_id: string;
  title: string;
  cover_url: string | null;
  content_rating: string | null;
  demographic: string | null;
  tags_json: string | null;
  latest_chapter: string | null;
  latest_chapter_released_at: Date | string | null;
  read_at: Date | string | null;
  created_at: Date | string;
}

interface UserInteractionBlockRow extends RowDataPacket {
  id: string;
  user_a_id: string;
  user_a_username: string;
  user_b_id: string;
  user_b_username: string;
  created_by: string;
  created_by_username: string;
  created_at: Date | string;
}

interface BookmarkUpdateCacheRow extends RowDataPacket {
  source: string;
  manga_id: string;
  canonical_key: string | null;
  latest_chapter_source: string | null;
  latest_chapter_id: string | null;
  latest_chapter_manga_id: string | null;
  latest_chapter_number: string | null;
  latest_chapter_title: string | null;
  latest_chapter_volume: string | null;
  latest_chapter_language: string | null;
  latest_chapter_published_at: Date | string | null;
  latest_chapter_readable_at: Date | string | null;
  latest_chapter_groups_json: string | null;
  latest_chapter_pages: number | null;
  latest_chapter_external_url: string | null;
  checked_at: Date | string;
  error: string | null;
}

interface ChapterListCacheRow extends RowDataPacket {
  source: string;
  manga_id: string;
  language: string;
  chapters_json: string;
  checked_at: Date | string;
  error: string | null;
}

interface ChapterPageCacheRow extends RowDataPacket {
  source: string;
  chapter_id: string;
  manga_id: string | null;
  chapter_number: string | null;
  language: string;
  pages_json: string;
  checked_at: Date | string;
  error: string | null;
}

interface BookmarkDownloadJobRow extends RowDataPacket {
  id: string;
  job_type: BookmarkDownloadJobType;
  source: string;
  manga_id: string;
  canonical_key: string | null;
  chapter_id: string | null;
  chapter_number: string | null;
  language: string;
  priority: number;
  attempts: number;
  max_attempts: number;
}

const database = process.env.MYSQL_DATABASE ?? "mangass";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const sessions = new Map<string, { userId: string; expiresAt: number }>();
let pool: Pool | undefined;
let initialization: Promise<Pool> | undefined;

function mysqlConfig(includeDatabase: boolean) {
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    ...(includeDatabase ? { database } : {}),
    waitForConnections: true,
    connectionLimit: 10
  };
}

export function databaseLabel() {
  const config = mysqlConfig(true);
  return `${config.user}@${config.host}:${config.port}/${database}`;
}

function escapeIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function toIsoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    nsfwAllowed: Boolean(user.nsfw_allowed),
    createdAt: toIsoDate(user.created_at),
    updatedAt: toIsoDate(user.updated_at)
  };
}

function optionalIsoDate(value: Date | string | null) {
  if (!value) return undefined;
  return toIsoDate(value);
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return parseTags(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }

  return trimmed
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFallbackKey(value: string) {
  const normalized = normalizeTitle(value);
  return normalized ? `title:${normalized}` : undefined;
}

function chapterNumberValue(value?: string) {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function chapterTimestamp(value?: Date | string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function bookmarkUpdateRowToChapter(row: BookmarkUpdateCacheRow): ChapterSummary | undefined {
  if (!row.latest_chapter_source || !row.latest_chapter_id) return undefined;
  return {
    source: row.latest_chapter_source,
    id: row.latest_chapter_id,
    mangaId: row.latest_chapter_manga_id || row.manga_id,
    title: row.latest_chapter_title || "",
    chapter: row.latest_chapter_number || undefined,
    volume: row.latest_chapter_volume || undefined,
    language: row.latest_chapter_language || "en",
    publishedAt: optionalIsoDate(row.latest_chapter_published_at),
    readableAt: optionalIsoDate(row.latest_chapter_readable_at),
    groups: parseTags(row.latest_chapter_groups_json ?? "[]"),
    pages: row.latest_chapter_pages ?? undefined,
    externalUrl: row.latest_chapter_external_url || undefined
  };
}

function hasUnreadChapter(latestChapter: ChapterSummary | undefined, lastReadChapter?: string, lastReadChapterId?: string) {
  if (!latestChapter) return false;
  if (latestChapter.id && latestChapter.id === lastReadChapterId) return false;

  const latest = chapterNumberValue(latestChapter.chapter);
  const lastRead = chapterNumberValue(lastReadChapter);
  if (latest !== undefined && lastRead !== undefined) return latest > lastRead;
  if (latestChapter.chapter && lastReadChapter) return latestChapter.chapter !== lastReadChapter;
  return true;
}

async function canonicalKeyFromSavedMetadata(db: Pool | PoolConnection, title?: string | null) {
  const trimmed = title?.trim();
  if (!trimmed) return undefined;
  const [rows] = await db.execute<RowDataPacket[]>(
    `
      SELECT manga_updates_id, title, alt_titles_json
      FROM title_metadata
      WHERE LOWER(title) = LOWER(?)
        OR LOWER(CAST(alt_titles_json AS CHAR)) LIKE CONCAT('%', LOWER(?), '%')
      LIMIT 12
    `,
    [trimmed, trimmed]
  );

  let best: { id: string; score: number } | undefined;
  for (const row of rows) {
    const metadataTitles = [String(row.title), ...parseTags(String(row.alt_titles_json ?? "[]"))];
    const score = Math.max(0, ...metadataTitles.map((candidate) => titleSimilarity(trimmed, candidate)));
    if (!best || score > best.score) best = { id: String(row.manga_updates_id), score };
  }
  return best && best.score >= 0.72 ? `mu:${best.id}` : undefined;
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

function preferredFavorite(left: FavoriteRecord, right: FavoriteRecord) {
  const rightChapter = chapterNumberValue(right.latestChapter) ?? -1;
  const leftChapter = chapterNumberValue(left.latestChapter) ?? -1;
  if (rightChapter !== leftChapter) return rightChapter > leftChapter ? right : left;
  const rightUpdated = new Date(right.latestChapterReleasedAt ?? right.addedAt).getTime() || 0;
  const leftUpdated = new Date(left.latestChapterReleasedAt ?? left.addedAt).getTime() || 0;
  if (rightUpdated !== leftUpdated) return rightUpdated > leftUpdated ? right : left;
  return new Date(right.addedAt).getTime() > new Date(left.addedAt).getTime() ? right : left;
}

function favoriteRecord(row: FavoriteRow): FavoriteRecord {
  return {
    source: row.source,
    id: row.manga_id,
    mangaId: row.manga_id,
    canonicalKey: row.effective_canonical_key || row.canonical_key || undefined,
    title: row.title,
    description: row.description || undefined,
    coverUrl: row.cover_url || undefined,
    status: row.status || undefined,
    contentRating: row.content_rating || undefined,
    demographic: row.demographic || undefined,
    year: row.year || undefined,
    latestChapter: row.cached_latest_chapter_number || row.latest_chapter || undefined,
    latestChapterReleasedAt:
      optionalIsoDate(row.cached_latest_chapter_published_at ?? null) ??
      optionalIsoDate(row.cached_latest_chapter_readable_at ?? null) ??
      optionalIsoDate(row.latest_chapter_released_at),
    tags: parseTags(row.tags_json),
    addedAt: toIsoDate(row.added_at),
    lastReadChapterId: row.last_read_chapter_id || undefined,
    lastReadChapter: row.last_read_chapter_number || undefined,
    lastReadScrollPosition: row.last_read_scroll_position ?? undefined
  };
}

function readingProgressRecord(row: ReadingProgressRow): ReadingProgressRecord {
  return {
    source: row.source,
    mangaId: row.manga_id,
    canonicalKey: row.effective_canonical_key || row.canonical_key || undefined,
    chapterSource: row.chapter_source || row.source,
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number || undefined,
    scrollPosition: row.scroll_position ?? undefined,
    updatedAt: toIsoDate(row.updated_at)
  };
}

function recommendationRecord(row: RecommendationRow): RecommendationRecord {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    fromUsername: row.from_username,
    toUserId: row.to_user_id,
    toUsername: row.to_username,
    source: row.source,
    mangaId: row.manga_id,
    title: row.title,
    coverUrl: row.cover_url || undefined,
    contentRating: row.content_rating || undefined,
    demographic: row.demographic || undefined,
    tags: parseTags(row.tags_json),
    latestChapter: row.latest_chapter || undefined,
    latestChapterReleasedAt: optionalIsoDate(row.latest_chapter_released_at),
    readAt: optionalIsoDate(row.read_at),
    createdAt: toIsoDate(row.created_at)
  };
}

function isRecommendationNsfw(input: Pick<RecommendationInput, "contentRating" | "tags">) {
  const rating = input.contentRating?.trim().toLowerCase();
  if (rating && ["erotica", "pornographic", "adult", "nsfw", "smut"].some((term) => rating === term || rating.includes(term))) {
    return true;
  }

  const exactNsfwTags = new Set(["adult", "erotica", "pornographic", "nsfw", "smut", "hentai"]);
  return (input.tags ?? []).some((tag) => exactNsfwTags.has(tag.trim().toLowerCase()));
}

function interactionBlockRecord(row: UserInteractionBlockRow): UserInteractionBlockRecord {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userAUsername: row.user_a_username,
    userBId: row.user_b_id,
    userBUsername: row.user_b_username,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdAt: toIsoDate(row.created_at)
  };
}

function sortedUserPair(leftUserId: string, rightUserId: string) {
  return leftUserId.localeCompare(rightUserId) <= 0
    ? { userAId: leftUserId, userBId: rightUserId }
    : { userAId: rightUserId, userBId: leftUserId };
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex"), iterations = 210000) {
  const passwordHash = crypto.pbkdf2Sync(password, salt, iterations, 64, "sha256").toString("hex");
  return { passwordHash, salt, iterations };
}

function verifyPassword(password: string, user: UserRow) {
  const nextHash = crypto.pbkdf2Sync(password, user.salt, user.iterations, 64, "sha256");
  const storedHash = Buffer.from(user.password_hash, "hex");
  return storedHash.length === nextHash.length && crypto.timingSafeEqual(storedHash, nextHash);
}

async function getPool() {
  if (pool) return pool;
  initialization ??= initializeAccounts();
  return initialization;
}

export async function getDatabasePool() {
  return getPool();
}

async function ensureIndex(db: Pool, tableName: string, indexName: string, columnsSql: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1
    `,
    [database, tableName, indexName]
  );
  if (!rows.length) {
    await db.query(`CREATE INDEX ${escapeIdentifier(indexName)} ON ${escapeIdentifier(tableName)} ${columnsSql}`);
  }
}

async function findUserByUsername(username: string) {
  const db = await getPool();
  const [rows] = await db.execute<UserRow[]>("SELECT * FROM users WHERE LOWER(username) = ? LIMIT 1", [
    normalizeUsername(username)
  ]);
  return rows[0];
}

async function findUserById(id: string) {
  const db = await getPool();
  const [rows] = await db.execute<UserRow[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
  return rows[0];
}

export async function initializeAccounts() {
  if (pool) return pool;

  const bootstrap = await mysql.createConnection(mysqlConfig(false));
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }

  const nextPool = mysql.createPool(mysqlConfig(true));
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
      nsfw_allowed BOOLEAN NOT NULL DEFAULT TRUE,
      password_hash CHAR(128) NOT NULL,
      salt CHAR(32) NOT NULL,
      iterations INT UNSIGNED NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [userColumns] = await nextPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
    `,
    [database]
  );
  const userColumnNames = new Set(userColumns.map((row) => String(row.COLUMN_NAME)));
  if (!userColumnNames.has("nsfw_allowed")) {
    await nextPool.query("ALTER TABLE users ADD COLUMN nsfw_allowed BOOLEAN NOT NULL DEFAULT TRUE AFTER role");
  }
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id CHAR(36) NOT NULL,
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      canonical_key VARCHAR(512) NULL,
      title VARCHAR(512) NOT NULL,
      description TEXT NULL,
      cover_url TEXT NULL,
      status VARCHAR(64) NULL,
      content_rating VARCHAR(64) NULL,
      demographic VARCHAR(64) NULL,
      year SMALLINT NULL,
      latest_chapter VARCHAR(64) NULL,
      latest_chapter_released_at DATETIME(3) NULL,
      tags_json JSON NOT NULL,
      added_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id, source, manga_id),
      CONSTRAINT favorites_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	  await nextPool.query(`
	    CREATE TABLE IF NOT EXISTS reading_progress (
	      user_id CHAR(36) NOT NULL,
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      canonical_key VARCHAR(512) NULL,
      chapter_source VARCHAR(64) NULL,
      chapter_id VARCHAR(255) NOT NULL,
      chapter_number VARCHAR(64) NULL,
      scroll_position INT UNSIGNED NULL,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id, source, manga_id),
	      CONSTRAINT reading_progress_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	  `);
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS recommendations (
      id CHAR(36) PRIMARY KEY,
      from_user_id CHAR(36) NOT NULL,
      to_user_id CHAR(36) NOT NULL,
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      title VARCHAR(512) NOT NULL,
      cover_url TEXT NULL,
      content_rating VARCHAR(64) NULL,
      demographic VARCHAR(128) NULL,
      tags_json JSON NULL,
      latest_chapter VARCHAR(64) NULL,
      latest_chapter_released_at DATETIME(3) NULL,
      read_at TIMESTAMP(3) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX recommendations_to_user_idx (to_user_id, read_at, created_at),
      INDEX recommendations_from_user_idx (from_user_id, created_at),
      CONSTRAINT recommendations_from_user_fk FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT recommendations_to_user_fk FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS user_interaction_blocks (
      id CHAR(36) PRIMARY KEY,
      user_a_id CHAR(36) NOT NULL,
      user_b_id CHAR(36) NOT NULL,
      created_by CHAR(36) NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY user_interaction_blocks_pair_unique (user_a_id, user_b_id),
      INDEX user_interaction_blocks_user_b_idx (user_b_id),
      CONSTRAINT user_interaction_blocks_user_a_fk FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_interaction_blocks_user_b_fk FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_interaction_blocks_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_interaction_blocks_distinct_users CHECK (user_a_id <> user_b_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS bookmark_update_cache (
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      canonical_key VARCHAR(512) NULL,
      latest_chapter_source VARCHAR(64) NULL,
      latest_chapter_id VARCHAR(255) NULL,
      latest_chapter_manga_id VARCHAR(255) NULL,
      latest_chapter_number VARCHAR(64) NULL,
      latest_chapter_title VARCHAR(512) NULL,
      latest_chapter_volume VARCHAR(64) NULL,
      latest_chapter_language VARCHAR(32) NULL,
      latest_chapter_published_at DATETIME(3) NULL,
      latest_chapter_readable_at DATETIME(3) NULL,
      latest_chapter_groups_json JSON NULL,
      latest_chapter_pages INT UNSIGNED NULL,
      latest_chapter_external_url TEXT NULL,
      checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      error TEXT NULL,
      PRIMARY KEY (source, manga_id),
      INDEX bookmark_update_cache_checked_idx (checked_at),
      INDEX bookmark_update_cache_canonical_idx (canonical_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS chapter_list_cache (
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      language VARCHAR(32) NOT NULL,
      chapters_json JSON NOT NULL,
      checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      error TEXT NULL,
      PRIMARY KEY (source, manga_id, language),
      INDEX chapter_list_cache_checked_idx (checked_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS chapter_page_cache (
      source VARCHAR(64) NOT NULL,
      chapter_id VARCHAR(255) NOT NULL,
      manga_id VARCHAR(255) NULL,
      chapter_number VARCHAR(64) NULL,
      language VARCHAR(32) NOT NULL DEFAULT 'en',
      pages_json JSON NOT NULL,
      checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      error TEXT NULL,
      PRIMARY KEY (source, chapter_id),
      INDEX chapter_page_cache_manga_idx (source, manga_id, language),
      INDEX chapter_page_cache_checked_idx (checked_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await nextPool.query(`
    CREATE TABLE IF NOT EXISTS bookmark_download_jobs (
      id CHAR(36) PRIMARY KEY,
      dedupe_key VARCHAR(768) NOT NULL,
      job_type VARCHAR(32) NOT NULL,
      source VARCHAR(64) NOT NULL,
      manga_id VARCHAR(255) NOT NULL,
      canonical_key VARCHAR(512) NULL,
      chapter_id VARCHAR(255) NULL,
      chapter_number VARCHAR(64) NULL,
      language VARCHAR(32) NOT NULL DEFAULT 'en',
      priority INT NOT NULL DEFAULT 0,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      run_after TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      locked_at TIMESTAMP(3) NULL,
      locked_by VARCHAR(128) NULL,
      error TEXT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY bookmark_download_jobs_dedupe_idx (dedupe_key),
      INDEX bookmark_download_jobs_claim_idx (status, run_after, priority, created_at),
      INDEX bookmark_download_jobs_ref_idx (source, manga_id, job_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureIndex(nextPool, "favorites", "favorites_user_added_idx", "(user_id, added_at)");
  await ensureIndex(nextPool, "reading_progress", "reading_progress_user_updated_idx", "(user_id, updated_at)");
  await ensureIndex(nextPool, "reading_progress", "reading_progress_user_canonical_idx", "(user_id, canonical_key)");
	  const [progressColumns] = await nextPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reading_progress' AND COLUMN_NAME = 'chapter_number'
    `,
    [database]
  );
  if (!progressColumns.length) {
    await nextPool.query("ALTER TABLE reading_progress ADD COLUMN chapter_number VARCHAR(64) NULL AFTER chapter_id");
  }
  const [scrollColumns] = await nextPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reading_progress' AND COLUMN_NAME = 'scroll_position'
    `,
    [database]
  );
  if (!scrollColumns.length) {
    await nextPool.query("ALTER TABLE reading_progress ADD COLUMN scroll_position INT UNSIGNED NULL AFTER chapter_number");
  }

  const [favoriteColumns] = await nextPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'favorites'
    `,
    [database]
  );
  const favoriteColumnNames = new Set(favoriteColumns.map((row) => String(row.COLUMN_NAME)));
  if (!favoriteColumnNames.has("canonical_key")) {
    await nextPool.query("ALTER TABLE favorites ADD COLUMN canonical_key VARCHAR(512) NULL AFTER manga_id");
  }

  const [progressAllColumns] = await nextPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'reading_progress'
    `,
    [database]
  );
  const progressColumnNames = new Set(progressAllColumns.map((row) => String(row.COLUMN_NAME)));
  if (!progressColumnNames.has("canonical_key")) {
    await nextPool.query("ALTER TABLE reading_progress ADD COLUMN canonical_key VARCHAR(512) NULL AFTER manga_id");
  }
  if (!progressColumnNames.has("chapter_source")) {
    await nextPool.query("ALTER TABLE reading_progress ADD COLUMN chapter_source VARCHAR(64) NULL AFTER canonical_key");
  }

  const [recommendationColumns] = await nextPool.query<RowDataPacket[]>(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'recommendations'
    `,
    [database]
  );
  const recommendationColumnNames = new Set(recommendationColumns.map((row) => String(row.COLUMN_NAME)));
  if (!recommendationColumnNames.has("content_rating")) {
    await nextPool.query("ALTER TABLE recommendations ADD COLUMN content_rating VARCHAR(64) NULL AFTER cover_url");
  }
  if (!recommendationColumnNames.has("demographic")) {
    await nextPool.query("ALTER TABLE recommendations ADD COLUMN demographic VARCHAR(128) NULL AFTER content_rating");
  }
  if (!recommendationColumnNames.has("tags_json")) {
    await nextPool.query("ALTER TABLE recommendations ADD COLUMN tags_json JSON NULL AFTER demographic");
  }

  pool = nextPool;

  const existingAdmin = await findUserByUsername("Scott");
  if (!existingAdmin) {
    const { passwordHash, salt, iterations } = hashPassword("password");
    await nextPool.execute(
      "INSERT INTO users (id, username, role, password_hash, salt, iterations) VALUES (?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), "Scott", "admin", passwordHash, salt, iterations]
    );
  }

  return nextPool;
}

export async function databaseStatus() {
  const db = await getPool();
  const [tables] = await db.query<RowDataPacket[]>("SHOW TABLES");
  const [users] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM users");
  const [favorites] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM favorites");
  const [readingProgress] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM reading_progress");
  const [recommendations] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM recommendations");
  const [interactionBlocks] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM user_interaction_blocks");
  const [titleMetadata] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM title_metadata").catch(() => [[]]);
  const [compiledTitleCache] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM compiled_title_cache").catch(() => [[]]);
  const [bookmarkUpdateCache] = await db
    .query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM bookmark_update_cache")
    .catch(() => [[]]);
  const [chapterPageCache] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM chapter_page_cache").catch(() => [[]]);
  const [bookmarkDownloadJobs] = await db
    .query<RowDataPacket[]>("SELECT status, COUNT(*) AS count FROM bookmark_download_jobs GROUP BY status")
    .catch(() => [[]]);

  return {
    database,
    connection: databaseLabel(),
    tables: tables.map((row) => String(Object.values(row)[0])),
    counts: {
      users: Number(users[0]?.count ?? 0),
      favorites: Number(favorites[0]?.count ?? 0),
      readingProgress: Number(readingProgress[0]?.count ?? 0),
      recommendations: Number(recommendations[0]?.count ?? 0),
      interactionBlocks: Number(interactionBlocks[0]?.count ?? 0),
      titleMetadata: Number(titleMetadata[0]?.count ?? 0),
      compiledTitleCache: Number(compiledTitleCache[0]?.count ?? 0),
      bookmarkUpdateCache: Number(bookmarkUpdateCache[0]?.count ?? 0),
      chapterPageCache: Number(chapterPageCache[0]?.count ?? 0),
      bookmarkDownloadJobs: Object.fromEntries(bookmarkDownloadJobs.map((row) => [String(row.status), Number(row.count ?? 0)]))
    }
  };
}

export async function authenticate(username: string, password: string) {
  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user)) return undefined;

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionTtlMs });
  return { token, user: publicUser(user) };
}

export async function getUserByToken(token?: string) {
  if (!token) return undefined;

  const session = sessions.get(token);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }

  const user = await findUserById(session.userId);
  return user ? publicUser(user) : undefined;
}

export function destroySession(token?: string) {
  if (token) sessions.delete(token);
}

function destroySessionsForUser(userId: string) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

export async function listUsers() {
  const db = await getPool();
  const [rows] = await db.execute<UserRow[]>("SELECT * FROM users ORDER BY created_at DESC");
  return rows.map(publicUser);
}

export async function hasInteractionBlock(leftUserId: string, rightUserId: string) {
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) return false;
  const { userAId, userBId } = sortedUserPair(leftUserId, rightUserId);
  const db = await getPool();
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM user_interaction_blocks WHERE user_a_id = ? AND user_b_id = ? LIMIT 1",
    [userAId, userBId]
  );
  return rows.length > 0;
}

export async function listShareUsers(currentUserId: string) {
  const db = await getPool();
  const [rows] = await db.execute<UserRow[]>(
    `
      SELECT users.*
      FROM users
      WHERE users.id <> ?
        AND NOT EXISTS (
          SELECT 1
          FROM user_interaction_blocks
          WHERE
            (user_interaction_blocks.user_a_id = ? AND user_interaction_blocks.user_b_id = users.id)
            OR (user_interaction_blocks.user_b_id = ? AND user_interaction_blocks.user_a_id = users.id)
        )
      ORDER BY users.username ASC
    `,
    [currentUserId, currentUserId, currentUserId]
  );
  return rows.map(publicUser);
}

export async function listInteractionBlocks() {
  const db = await getPool();
  const [rows] = await db.execute<UserInteractionBlockRow[]>(
    `
      SELECT
        blocks.id,
        blocks.user_a_id,
        user_a.username AS user_a_username,
        blocks.user_b_id,
        user_b.username AS user_b_username,
        blocks.created_by,
        creator.username AS created_by_username,
        blocks.created_at
      FROM user_interaction_blocks blocks
      INNER JOIN users user_a ON user_a.id = blocks.user_a_id
      INNER JOIN users user_b ON user_b.id = blocks.user_b_id
      INNER JOIN users creator ON creator.id = blocks.created_by
      ORDER BY blocks.created_at DESC
    `
  );
  return rows.map(interactionBlockRecord);
}

export async function addInteractionBlock(leftUserId: string, rightUserId: string, createdBy: string) {
  if (!leftUserId || !rightUserId) throw new Error("Choose two users.");
  if (leftUserId === rightUserId) throw new Error("Choose two different users.");
  if (!(await findUserById(leftUserId)) || !(await findUserById(rightUserId))) throw new Error("One or both users were not found.");

  const { userAId, userBId } = sortedUserPair(leftUserId, rightUserId);
  const db = await getPool();
  await db.execute(
    `
      INSERT INTO user_interaction_blocks (id, user_a_id, user_b_id, created_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE created_by = VALUES(created_by)
    `,
    [crypto.randomUUID(), userAId, userBId, createdBy]
  );
  return listInteractionBlocks();
}

export async function removeInteractionBlock(id: string) {
  if (!id) throw new Error("Block id is required.");
  const db = await getPool();
  await db.execute("DELETE FROM user_interaction_blocks WHERE id = ?", [id]);
  return listInteractionBlocks();
}

export async function createUser(username: string, password: string, role: UserRole = "user") {
  const trimmedUsername = username.trim();
  if (!trimmedUsername) throw new Error("Username is required.");
  if (role !== "admin" && role !== "user") throw new Error("Role must be admin or user.");
  if (await findUserByUsername(trimmedUsername)) throw new Error("Username already exists.");

  const db = await getPool();
  const { passwordHash, salt, iterations } = hashPassword(password);
  const id = crypto.randomUUID();
  await db.execute("INSERT INTO users (id, username, role, password_hash, salt, iterations) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    trimmedUsername,
    role,
    passwordHash,
    salt,
    iterations
  ]);

  const user = await findUserById(id);
  if (!user) throw new Error("User could not be created.");
  return publicUser(user);
}

export async function setUserNsfwAllowed(userId: string, nsfwAllowed: boolean) {
  if (!(await findUserById(userId))) throw new Error("User not found.");
  const db = await getPool();
  await db.execute("UPDATE users SET nsfw_allowed = ? WHERE id = ?", [nsfwAllowed ? 1 : 0, userId]);
  const user = await findUserById(userId);
  if (!user) throw new Error("User not found.");
  return publicUser(user);
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string) {
  if (nextPassword.length < 6) throw new Error("New password must be at least 6 characters.");

  const user = await findUserById(userId);
  if (!user) throw new Error("User not found.");
  if (!verifyPassword(currentPassword, user)) throw new Error("Current password is incorrect.");

  const db = await getPool();
  const { passwordHash, salt, iterations } = hashPassword(nextPassword);
  await db.execute("UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?", [
    passwordHash,
    salt,
    iterations,
    userId
  ]);

  const updated = await findUserById(userId);
  if (!updated) throw new Error("User not found.");
  return publicUser(updated);
}

export async function resetPassword(userId: string, nextPassword: string) {
  if (nextPassword.length < 6) throw new Error("New password must be at least 6 characters.");

  if (!(await findUserById(userId))) throw new Error("User not found.");

  const db = await getPool();
  const { passwordHash, salt, iterations } = hashPassword(nextPassword);
  await db.execute("UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?", [
    passwordHash,
    salt,
    iterations,
    userId
  ]);

  const updated = await findUserById(userId);
  if (!updated) throw new Error("User not found.");
  return publicUser(updated);
}

export async function deleteUser(userId: string, currentUserId: string) {
  if (userId === currentUserId) throw new Error("You cannot delete your own account.");

  const user = await findUserById(userId);
  if (!user) throw new Error("User not found.");

  if (user.role === "admin") {
    const db = await getPool();
    const [rows] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (Number(rows[0]?.count ?? 0) <= 1) throw new Error("You cannot delete the last admin account.");
  }

  const db = await getPool();
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  destroySessionsForUser(userId);
}

export async function listFavorites(userId: string) {
  const db = await getPool();
  const [rows] = await db.execute<FavoriteRow[]>(
    `
      SELECT
        favorites.*,
        COALESCE(favorites.canonical_key, CONCAT('mu:', title_metadata_links.manga_updates_id)) AS effective_canonical_key,
        bookmark_update_cache.latest_chapter_number AS cached_latest_chapter_number,
        bookmark_update_cache.latest_chapter_published_at AS cached_latest_chapter_published_at,
        bookmark_update_cache.latest_chapter_readable_at AS cached_latest_chapter_readable_at,
        reading_progress.chapter_id AS last_read_chapter_id,
        reading_progress.chapter_number AS last_read_chapter_number,
        reading_progress.scroll_position AS last_read_scroll_position
      FROM favorites
      LEFT JOIN title_metadata_links
        ON title_metadata_links.source = favorites.source
        AND title_metadata_links.manga_id = favorites.manga_id
      LEFT JOIN bookmark_update_cache
        ON bookmark_update_cache.source = favorites.source
        AND bookmark_update_cache.manga_id = favorites.manga_id
      LEFT JOIN reading_progress
        ON reading_progress.user_id = favorites.user_id
        AND (
          (reading_progress.source = favorites.source AND reading_progress.manga_id = favorites.manga_id)
          OR (
            COALESCE(favorites.canonical_key, CONCAT('mu:', title_metadata_links.manga_updates_id)) IS NOT NULL
            AND reading_progress.canonical_key = COALESCE(favorites.canonical_key, CONCAT('mu:', title_metadata_links.manga_updates_id))
          )
        )
      WHERE favorites.user_id = ?
      ORDER BY favorites.added_at DESC
    `,
    [userId]
  );
  const bySeries = new Map<string, FavoriteRecord>();
  for (const row of rows) {
    const record = favoriteRecord(row);
    if (!record.canonicalKey) {
      record.canonicalKey = await canonicalKeyFromSavedMetadata(db, record.title);
      if (record.canonicalKey) {
        await db.execute("UPDATE favorites SET canonical_key = ? WHERE user_id = ? AND source = ? AND manga_id = ?", [
          record.canonicalKey,
          userId,
          record.source,
          record.mangaId
        ]);
      }
    }
    const key = record.canonicalKey ?? titleFallbackKey(record.title) ?? `${record.source}:${record.mangaId}`;
    const existing = bySeries.get(key);
    bySeries.set(key, existing ? preferredFavorite(existing, record) : record);
  }
  return [...bySeries.values()];
}

export async function listFavoriteRefs(limit = 200) {
  const db = await getPool();
  const safeLimit = Math.max(Math.min(Math.floor(limit), 500), 1);
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        favorites.source,
        favorites.manga_id AS mangaId,
        COALESCE(favorites.canonical_key, CONCAT('mu:', title_metadata_links.manga_updates_id)) AS canonicalKey,
        MAX(favorites.added_at) AS addedAt
      FROM favorites
      LEFT JOIN title_metadata_links
        ON title_metadata_links.source = favorites.source
        AND title_metadata_links.manga_id = favorites.manga_id
      GROUP BY favorites.source, favorites.manga_id, canonicalKey
      ORDER BY addedAt DESC
      LIMIT ${safeLimit}
    `
  );
  return rows.map((row) => ({
    source: String(row.source),
    mangaId: String(row.mangaId),
    canonicalKey: row.canonicalKey ? String(row.canonicalKey) : undefined
  }));
}

export async function upsertBookmarkUpdateCache(input: {
  source: string;
  mangaId: string;
  canonicalKey?: string;
  latestChapter?: ChapterSummary;
  error?: string;
}) {
  if (!input.source || !input.mangaId) return;

  const db = await getPool();
  const chapter = input.latestChapter;
  await db.execute(
    `
      INSERT INTO bookmark_update_cache (
        source, manga_id, canonical_key,
        latest_chapter_source, latest_chapter_id, latest_chapter_manga_id, latest_chapter_number,
        latest_chapter_title, latest_chapter_volume, latest_chapter_language, latest_chapter_published_at,
        latest_chapter_readable_at, latest_chapter_groups_json, latest_chapter_pages, latest_chapter_external_url,
        checked_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)
      ON DUPLICATE KEY UPDATE
        canonical_key = COALESCE(VALUES(canonical_key), canonical_key),
        latest_chapter_source = VALUES(latest_chapter_source),
        latest_chapter_id = VALUES(latest_chapter_id),
        latest_chapter_manga_id = VALUES(latest_chapter_manga_id),
        latest_chapter_number = VALUES(latest_chapter_number),
        latest_chapter_title = VALUES(latest_chapter_title),
        latest_chapter_volume = VALUES(latest_chapter_volume),
        latest_chapter_language = VALUES(latest_chapter_language),
        latest_chapter_published_at = VALUES(latest_chapter_published_at),
        latest_chapter_readable_at = VALUES(latest_chapter_readable_at),
        latest_chapter_groups_json = VALUES(latest_chapter_groups_json),
        latest_chapter_pages = VALUES(latest_chapter_pages),
        latest_chapter_external_url = VALUES(latest_chapter_external_url),
        checked_at = CURRENT_TIMESTAMP(3),
        error = VALUES(error)
    `,
    [
      input.source,
      input.mangaId,
      input.canonicalKey ?? null,
      chapter?.source ?? null,
      chapter?.id ?? null,
      chapter?.mangaId ?? null,
      chapter?.chapter ?? null,
      chapter?.title ?? null,
      chapter?.volume ?? null,
      chapter?.language ?? null,
      chapter?.publishedAt ? new Date(chapter.publishedAt) : null,
      chapter?.readableAt ? new Date(chapter.readableAt) : null,
      chapter ? JSON.stringify(chapter.groups ?? []) : null,
      chapter?.pages ?? null,
      chapter?.externalUrl ?? null,
      input.error?.slice(0, 2000) ?? null
    ]
  );
}

export async function getChapterListCache(source: string, mangaId: string, language: string) {
  const db = await getPool();
  const [rows] = await db.execute<ChapterListCacheRow[]>(
    `
      SELECT *
      FROM chapter_list_cache
      WHERE source = ? AND manga_id = ? AND language = ?
      LIMIT 1
    `,
    [source, mangaId, language]
  );
  const row = rows[0];
  if (!row) return undefined;

  const rawChapters = row.chapters_json as unknown;
  let chapters: ChapterSummary[] = [];
  if (Array.isArray(rawChapters)) {
    chapters = rawChapters as ChapterSummary[];
  } else {
    try {
      chapters = JSON.parse(String(rawChapters)) as ChapterSummary[];
    } catch {
      chapters = [];
    }
  }

  return {
    source: row.source,
    mangaId: row.manga_id,
    language: row.language,
    chapters,
    checkedAt: toIsoDate(row.checked_at),
    error: row.error || undefined
  };
}

export async function upsertChapterListCache(input: {
  source: string;
  mangaId: string;
  language: string;
  chapters?: ChapterSummary[];
  error?: string;
}) {
  const db = await getPool();
  await db.execute(
    `
      INSERT INTO chapter_list_cache (source, manga_id, language, chapters_json, checked_at, error)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)
      ON DUPLICATE KEY UPDATE
        chapters_json = CASE
          WHEN VALUES(error) IS NULL THEN VALUES(chapters_json)
          ELSE chapters_json
        END,
        checked_at = CURRENT_TIMESTAMP(3),
        error = VALUES(error)
    `,
    [
      input.source,
      input.mangaId,
      input.language,
      JSON.stringify(input.chapters ?? []),
      input.error?.slice(0, 2000) ?? null
    ]
  );
}

function parsePages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item));
  if (typeof value !== "string") return [];
  try {
    return parsePages(JSON.parse(value));
  } catch {
    return [];
  }
}

export async function getChapterPageCache(source: string, chapterId: string) {
  const db = await getPool();
  const [rows] = await db.execute<ChapterPageCacheRow[]>(
    `
      SELECT *
      FROM chapter_page_cache
      WHERE source = ? AND chapter_id = ?
      LIMIT 1
    `,
    [source, chapterId]
  );
  const row = rows[0];
  if (!row) return undefined;

  return {
    pages: {
      source: row.source,
      id: row.chapter_id,
      pages: parsePages(row.pages_json)
    } as ChapterPages,
    mangaId: row.manga_id || undefined,
    chapterNumber: row.chapter_number || undefined,
    language: row.language,
    checkedAt: toIsoDate(row.checked_at),
    error: row.error || undefined
  };
}

export async function upsertChapterPageCache(input: {
  source: string;
  chapterId: string;
  mangaId?: string;
  chapterNumber?: string;
  language?: string;
  pages?: string[];
  error?: string;
}) {
  const db = await getPool();
  await db.execute(
    `
      INSERT INTO chapter_page_cache (source, chapter_id, manga_id, chapter_number, language, pages_json, checked_at, error)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)
      ON DUPLICATE KEY UPDATE
        manga_id = COALESCE(VALUES(manga_id), manga_id),
        chapter_number = COALESCE(VALUES(chapter_number), chapter_number),
        language = VALUES(language),
        pages_json = CASE
          WHEN VALUES(error) IS NULL THEN VALUES(pages_json)
          ELSE pages_json
        END,
        checked_at = CURRENT_TIMESTAMP(3),
        error = VALUES(error)
    `,
    [
      input.source,
      input.chapterId,
      input.mangaId ?? null,
      input.chapterNumber ?? null,
      input.language ?? "en",
      JSON.stringify(input.pages ?? []),
      input.error?.slice(0, 2000) ?? null
    ]
  );
}

function bookmarkDownloadJobRecord(row: BookmarkDownloadJobRow): BookmarkDownloadJobRecord {
  return {
    id: row.id,
    jobType: row.job_type,
    source: row.source,
    mangaId: row.manga_id,
    canonicalKey: row.canonical_key || undefined,
    chapterId: row.chapter_id || undefined,
    chapterNumber: row.chapter_number || undefined,
    language: row.language,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  };
}

function bookmarkDownloadDedupeKey(input: {
  jobType: BookmarkDownloadJobType;
  source: string;
  mangaId: string;
  chapterId?: string;
  language?: string;
}) {
  return [input.jobType, input.source, input.mangaId, input.language ?? "en", input.chapterId ?? ""].join(":").slice(0, 768);
}

export async function enqueueBookmarkDownloadJob(input: {
  jobType: BookmarkDownloadJobType;
  source: string;
  mangaId: string;
  canonicalKey?: string;
  chapterId?: string;
  chapterNumber?: string;
  language?: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  refreshExisting?: boolean;
}) {
  if (!input.source || !input.mangaId) return;
  const db = await getPool();
  const dedupeKey = bookmarkDownloadDedupeKey(input);
  const refreshExisting = input.refreshExisting !== false;
  await db.execute(
    `
      INSERT INTO bookmark_download_jobs (
        id, dedupe_key, job_type, source, manga_id, canonical_key, chapter_id, chapter_number, language,
        priority, max_attempts, status, run_after
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON DUPLICATE KEY UPDATE
        canonical_key = COALESCE(VALUES(canonical_key), canonical_key),
        chapter_number = COALESCE(VALUES(chapter_number), chapter_number),
        priority = GREATEST(priority, VALUES(priority)),
        max_attempts = GREATEST(max_attempts, VALUES(max_attempts)),
        attempts = CASE
          WHEN status = 'running' OR (status = 'done' AND ? = 0) THEN attempts
          ELSE 0
        END,
        run_after = CASE
          WHEN status = 'done' AND ? = 0 THEN run_after
          ELSE LEAST(run_after, VALUES(run_after))
        END,
        status = CASE
          WHEN status = 'running' THEN status
          WHEN status = 'done' AND ? = 0 THEN status
          ELSE 'pending'
        END,
        error = NULL,
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      crypto.randomUUID(),
      dedupeKey,
      input.jobType,
      input.source,
      input.mangaId,
      input.canonicalKey ?? null,
      input.chapterId ?? null,
      input.chapterNumber ?? null,
      input.language ?? "en",
      input.priority ?? 0,
      input.maxAttempts ?? 3,
      input.runAfter ?? new Date(),
      refreshExisting ? 1 : 0,
      refreshExisting ? 1 : 0,
      refreshExisting ? 1 : 0
    ]
  );
}

export async function enqueueBookmarkDownloadsForRef(
  ref: { source: string; mangaId: string; canonicalKey?: string },
  priority = 0,
  refreshExisting = false
) {
  await enqueueBookmarkDownloadJob({ jobType: "title_detail", ...ref, priority, refreshExisting });
  await enqueueBookmarkDownloadJob({ jobType: "chapter_list", ...ref, priority, refreshExisting });
}

export async function enqueueBookmarkDownloadsForAll(limit = 500) {
  const refs = await listFavoriteRefs(limit);
  for (const ref of refs) {
    await enqueueBookmarkDownloadsForRef(ref);
  }
  return refs.length;
}

export async function enqueueChapterPageDownloadJobsForChapters(
  ref: { source: string; mangaId: string; canonicalKey?: string; language?: string },
  chapters: ChapterSummary[],
  priority = 50
) {
  const maxJobs = Number(process.env.BOOKMARK_DOWNLOAD_MAX_PAGE_JOBS_PER_TITLE ?? 0);
  const pageChapters = chapters
    .filter((chapter) => chapter.source && chapter.id)
    .slice(0, maxJobs > 0 ? maxJobs : chapters.length);

  for (const chapter of pageChapters) {
    await enqueueBookmarkDownloadJob({
      jobType: "chapter_pages",
      source: chapter.source,
      mangaId: chapter.mangaId || ref.mangaId,
      canonicalKey: ref.canonicalKey,
      chapterId: chapter.id,
      chapterNumber: chapter.chapter,
      language: chapter.language || ref.language || "en",
      priority,
      maxAttempts: 2,
      refreshExisting: false
    });
  }
  return pageChapters.length;
}

export async function claimBookmarkDownloadJobs(limit: number, workerId: string) {
  const db = await getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const safeLimit = Math.max(Math.min(Math.floor(limit), 25), 1);
    const [rows] = await connection.query<BookmarkDownloadJobRow[]>(
      `
        SELECT id, job_type, source, manga_id, canonical_key, chapter_id, chapter_number, language, priority, attempts + 1 AS attempts, max_attempts
        FROM bookmark_download_jobs
        WHERE status = 'pending' AND run_after <= CURRENT_TIMESTAMP(3) AND attempts < max_attempts
        ORDER BY priority DESC, created_at ASC
        LIMIT ${safeLimit}
        FOR UPDATE SKIP LOCKED
      `
    );
    if (rows.length) {
      await connection.query(
        `
          UPDATE bookmark_download_jobs
          SET status = 'running',
            attempts = attempts + 1,
            locked_at = CURRENT_TIMESTAMP(3),
            locked_by = ?,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id IN (${rows.map(() => "?").join(", ")})
        `,
        [workerId, ...rows.map((row) => row.id)]
      );
    }
    await connection.commit();
    return rows.map(bookmarkDownloadJobRecord);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function completeBookmarkDownloadJob(id: string) {
  const db = await getPool();
  await db.execute(
    `
      UPDATE bookmark_download_jobs
      SET status = 'done', locked_at = NULL, locked_by = NULL, error = NULL, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
    [id]
  );
}

export async function failBookmarkDownloadJob(job: BookmarkDownloadJobRecord, error: unknown) {
  const db = await getPool();
  const message = error instanceof Error ? error.message : String(error);
  const terminal = job.attempts >= job.maxAttempts;
  const delaySeconds = Math.min(60 * Math.max(1, 2 ** Math.max(job.attempts - 1, 0)), 60 * 30);
  await db.execute(
    `
      UPDATE bookmark_download_jobs
      SET status = ?,
        run_after = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
        locked_at = NULL,
        locked_by = NULL,
        error = ?,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
    [terminal ? "failed" : "pending", delaySeconds, message.slice(0, 2000), job.id]
  );
}

export async function getBookmarkUpdateLatest(source: string, mangaId: string) {
  const db = await getPool();
  const [rows] = await db.execute<BookmarkUpdateCacheRow[]>(
    "SELECT * FROM bookmark_update_cache WHERE source = ? AND manga_id = ? LIMIT 1",
    [source, mangaId]
  );
  const row = rows[0];
  if (!row) return undefined;
  return bookmarkUpdateRowToChapter(row);
}

export async function listCachedBookmarkUpdates(userId: string, limit = 12): Promise<BookmarkUpdateRecord[]> {
  const favorites = await listFavorites(userId);
  const readableFavorites = favorites.filter((favorite) => favorite.source !== "external" && favorite.id);
  if (!readableFavorites.length) return [];

  const db = await getPool();
  const placeholders = readableFavorites.map(() => "(?, ?)").join(", ");
  const values = readableFavorites.flatMap((favorite) => [favorite.source, favorite.mangaId]);
  const [rows] = await db.execute<BookmarkUpdateCacheRow[]>(
    `
      SELECT *
      FROM bookmark_update_cache
      WHERE (source, manga_id) IN (${placeholders})
    `,
    values
  );
  const cacheByRef = new Map(rows.map((row) => [`${row.source}:${row.manga_id}`, row]));
  const updates: BookmarkUpdateRecord[] = [];

  for (const manga of readableFavorites) {
    const row = cacheByRef.get(`${manga.source}:${manga.mangaId}`);
    const fallbackChapter: ChapterSummary | undefined = manga.latestChapter
      ? {
          source: manga.source,
          id: `${manga.source}:${manga.mangaId}:latest:${manga.latestChapter}`,
          mangaId: manga.mangaId,
          title: "",
          chapter: manga.latestChapter,
          language: "en",
          publishedAt: manga.latestChapterReleasedAt,
          groups: []
        }
      : undefined;
    if (!row && !fallbackChapter) continue;

    const latestChapter = row ? bookmarkUpdateRowToChapter(row) ?? fallbackChapter : fallbackChapter;
    const lastReadChapter = manga.lastReadChapter;
    if (!hasUnreadChapter(latestChapter, lastReadChapter, manga.lastReadChapterId)) continue;

    updates.push({
      manga,
      latestChapter,
      lastReadChapter,
      checkedAt: row ? toIsoDate(row.checked_at) : undefined,
      error: row?.error || undefined
    });
  }

  return updates
    .sort((left, right) => {
      const rightTime = chapterTimestamp(right.latestChapter?.publishedAt ?? right.latestChapter?.readableAt);
      const leftTime = chapterTimestamp(left.latestChapter?.publishedAt ?? left.latestChapter?.readableAt);
      if (rightTime !== leftTime) return rightTime - leftTime;
      return (chapterNumberValue(right.latestChapter?.chapter) ?? 0) - (chapterNumberValue(left.latestChapter?.chapter) ?? 0);
    })
    .slice(0, Math.max(Math.min(Math.floor(limit), 200), 1));
}

export async function addFavorite(userId: string, favorite: FavoriteRecord) {
  if (!favorite.source) throw new Error("Favorite source is required.");
  if (!favorite.mangaId) throw new Error("Favorite manga id is required.");
  if (!favorite.title) throw new Error("Favorite title is required.");

  const db = await getPool();
  await insertFavorite(db, userId, favorite);
  return listFavorites(userId);
}

async function insertFavorite(db: Pool | PoolConnection, userId: string, favorite: FavoriteRecord) {
  await db.execute(
    `
      INSERT INTO favorites (
        user_id, source, manga_id, canonical_key, title, description, cover_url, status, content_rating, demographic,
        year, latest_chapter, latest_chapter_released_at, tags_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        canonical_key = COALESCE(VALUES(canonical_key), canonical_key),
        title = VALUES(title),
        description = VALUES(description),
        cover_url = VALUES(cover_url),
        status = VALUES(status),
        content_rating = VALUES(content_rating),
        demographic = VALUES(demographic),
        year = VALUES(year),
        latest_chapter = VALUES(latest_chapter),
        latest_chapter_released_at = VALUES(latest_chapter_released_at),
        tags_json = VALUES(tags_json)
    `,
    [
      userId,
      favorite.source,
      favorite.mangaId,
      favorite.canonicalKey ?? null,
      favorite.title,
      favorite.description ?? null,
      favorite.coverUrl ?? null,
      favorite.status ?? null,
      favorite.contentRating ?? null,
      favorite.demographic ?? null,
      favorite.year ?? null,
      favorite.latestChapter ?? null,
      favorite.latestChapterReleasedAt ? new Date(favorite.latestChapterReleasedAt) : null,
      JSON.stringify(favorite.tags ?? [])
    ]
  );

  if (favorite.canonicalKey) {
    await db.execute(
      `
        DELETE FROM favorites
        WHERE user_id = ? AND canonical_key = ? AND NOT (source = ? AND manga_id = ?)
      `,
      [userId, favorite.canonicalKey, favorite.source, favorite.mangaId]
    );
  }
}

export async function removeFavorite(userId: string, source: string, mangaId: string) {
  const db = await getPool();
  await db.execute("DELETE FROM favorites WHERE user_id = ? AND source = ? AND manga_id = ?", [userId, source, mangaId]);
  return listFavorites(userId);
}

export async function listReadingProgress(userId: string) {
  const db = await getPool();
  const [rows] = await db.execute<ReadingProgressRow[]>(
    `
      SELECT
        reading_progress.*,
        favorites.title AS favorite_title,
        COALESCE(
          reading_progress.canonical_key,
          favorites.canonical_key,
          CONCAT('mu:', title_metadata_links.manga_updates_id)
        ) AS effective_canonical_key
      FROM reading_progress
      LEFT JOIN favorites
        ON favorites.user_id = reading_progress.user_id
        AND favorites.source = reading_progress.source
        AND favorites.manga_id = reading_progress.manga_id
      LEFT JOIN title_metadata_links
        ON title_metadata_links.source = reading_progress.source
        AND title_metadata_links.manga_id = reading_progress.manga_id
      WHERE reading_progress.user_id = ?
      ORDER BY reading_progress.updated_at DESC
    `,
    [userId]
  );
  const bySeries = new Map<string, ReadingProgressRecord>();
  for (const row of rows) {
    const record = readingProgressRecord(row);
    if (!record.canonicalKey) {
      record.canonicalKey = await canonicalKeyFromSavedMetadata(db, row.favorite_title);
      if (record.canonicalKey) {
        await db.execute("UPDATE reading_progress SET canonical_key = ? WHERE user_id = ? AND source = ? AND manga_id = ?", [
          record.canonicalKey,
          userId,
          record.source,
          record.mangaId
        ]);
      }
    }
    const key = record.canonicalKey ?? (row.favorite_title ? titleFallbackKey(row.favorite_title) : undefined) ?? `${record.source}:${record.mangaId}`;
    if (!bySeries.has(key)) bySeries.set(key, record);
  }
  return [...bySeries.values()];
}

export async function saveReadingProgress(
  userId: string,
  source: string,
  mangaId: string,
  canonicalKey: string | undefined,
  chapterSource: string | undefined,
  chapterId: string,
  chapterNumber?: string,
  scrollPosition?: number
) {
  if (!source) throw new Error("Reading progress source is required.");
  if (!mangaId) throw new Error("Reading progress manga id is required.");
  if (!chapterId) throw new Error("Reading progress chapter id is required.");

  const db = await getPool();
  await insertReadingProgress(db, userId, { source, mangaId, canonicalKey, chapterSource, chapterId, chapterNumber, scrollPosition });

  const [rows] = await db.execute<ReadingProgressRow[]>(
    "SELECT * FROM reading_progress WHERE user_id = ? AND source = ? AND manga_id = ? LIMIT 1",
    [userId, source, mangaId]
  );
  const progress = rows[0];
  if (!progress) throw new Error("Reading progress could not be saved.");
  return readingProgressRecord(progress);
}

async function insertReadingProgress(db: Pool | PoolConnection, userId: string, progress: ReadingProgressInput) {
  if (!progress.source) throw new Error("Reading progress source is required.");
  if (!progress.mangaId) throw new Error("Reading progress manga id is required.");
  if (!progress.chapterId) throw new Error("Reading progress chapter id is required.");

  await db.execute(
    `
      INSERT INTO reading_progress (user_id, source, manga_id, canonical_key, chapter_source, chapter_id, chapter_number, scroll_position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        canonical_key = COALESCE(VALUES(canonical_key), canonical_key),
        chapter_source = COALESCE(VALUES(chapter_source), chapter_source, source),
        scroll_position = CASE
          WHEN chapter_id <> VALUES(chapter_id) THEN COALESCE(VALUES(scroll_position), 0)
          WHEN VALUES(scroll_position) IS NULL THEN scroll_position
          WHEN VALUES(scroll_position) = 0 AND scroll_position IS NOT NULL THEN scroll_position
          ELSE VALUES(scroll_position)
        END,
        chapter_id = VALUES(chapter_id),
        chapter_number = VALUES(chapter_number),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    [
      userId,
      progress.source,
      progress.mangaId,
      progress.canonicalKey ?? null,
      progress.chapterSource ?? progress.source,
      progress.chapterId,
      progress.chapterNumber ?? null,
      progress.scrollPosition ?? null
    ]
  );

  if (progress.canonicalKey) {
    await db.execute(
      `
        DELETE FROM reading_progress
        WHERE user_id = ? AND canonical_key = ? AND NOT (source = ? AND manga_id = ?)
      `,
      [userId, progress.canonicalKey, progress.source, progress.mangaId]
    );
  }
}

export async function importFavorites(userId: string, favorites: FavoriteRecord[], progress: ReadingProgressInput[]) {
  if (!favorites.length) throw new Error("No favorites were found in the import file.");

  const db = await getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    for (const favorite of favorites) {
      if (!favorite.source) throw new Error("Favorite source is required.");
      if (!favorite.mangaId) throw new Error("Favorite manga id is required.");
      if (!favorite.title) throw new Error("Favorite title is required.");
      await insertFavorite(connection, userId, favorite);
    }

    for (const item of progress) {
      await insertReadingProgress(connection, userId, item);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return listFavorites(userId);
}

async function findRecommendationById(userId: string, id: string) {
  const db = await getPool();
  const [rows] = await db.execute<RecommendationRow[]>(
    `
      SELECT
        recommendations.*,
        sender.username AS from_username,
        recipient.username AS to_username
      FROM recommendations
      INNER JOIN users sender ON sender.id = recommendations.from_user_id
      INNER JOIN users recipient ON recipient.id = recommendations.to_user_id
      WHERE recommendations.id = ? AND (recommendations.from_user_id = ? OR recommendations.to_user_id = ?)
      LIMIT 1
    `,
    [id, userId, userId]
  );
  return rows[0] ? recommendationRecord(rows[0]) : undefined;
}

export async function sendRecommendation(fromUserId: string, input: RecommendationInput) {
  if (!input.toUserId) throw new Error("Recipient is required.");
  if (input.toUserId === fromUserId) throw new Error("Choose another user to recommend this title to.");
  if (!input.source) throw new Error("Recommendation source is required.");
  if (!input.mangaId) throw new Error("Recommendation manga id is required.");
  if (!input.title) throw new Error("Recommendation title is required.");
  const recipient = await findUserById(input.toUserId);
  if (!recipient) throw new Error("Recipient was not found.");
  if (!Boolean(recipient.nsfw_allowed) && isRecommendationNsfw(input)) {
    throw new Error("This user cannot receive NSFW recommendations.");
  }
  if (await hasInteractionBlock(fromUserId, input.toUserId)) {
    throw new Error("Recommendations are disabled between these users.");
  }

  const db = await getPool();
  const id = crypto.randomUUID();
  await db.execute(
    `
      INSERT INTO recommendations (
        id, from_user_id, to_user_id, source, manga_id, title, cover_url, content_rating, demographic, tags_json, latest_chapter, latest_chapter_released_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      fromUserId,
      input.toUserId,
      input.source,
      input.mangaId,
      input.title,
      input.coverUrl ?? null,
      input.contentRating ?? null,
      input.demographic ?? null,
      JSON.stringify(input.tags ?? []),
      input.latestChapter ?? null,
      input.latestChapterReleasedAt ? new Date(input.latestChapterReleasedAt) : null
    ]
  );

  const recommendation = await findRecommendationById(fromUserId, id);
  if (!recommendation) throw new Error("Recommendation could not be created.");
  return recommendation;
}

export async function listInboxRecommendations(userId: string) {
  const db = await getPool();
  const user = await findUserById(userId);
  const [rows] = await db.execute<RecommendationRow[]>(
    `
      SELECT
        recommendations.*,
        sender.username AS from_username,
        recipient.username AS to_username
      FROM recommendations
      INNER JOIN users sender ON sender.id = recommendations.from_user_id
      INNER JOIN users recipient ON recipient.id = recommendations.to_user_id
      WHERE recommendations.to_user_id = ?
      ORDER BY recommendations.created_at DESC
    `,
    [userId]
  );
  const records = rows.map(recommendationRecord);
  return Boolean(user?.nsfw_allowed) ? records : records.filter((recommendation) => !isRecommendationNsfw(recommendation));
}

export async function listOutboxRecommendations(userId: string) {
  const db = await getPool();
  const [rows] = await db.execute<RecommendationRow[]>(
    `
      SELECT
        recommendations.*,
        sender.username AS from_username,
        recipient.username AS to_username
      FROM recommendations
      INNER JOIN users sender ON sender.id = recommendations.from_user_id
      INNER JOIN users recipient ON recipient.id = recommendations.to_user_id
      WHERE recommendations.from_user_id = ?
      ORDER BY recommendations.created_at DESC
    `,
    [userId]
  );
  return rows.map(recommendationRecord);
}

export async function unreadRecommendationCount(userId: string) {
  const inbox = await listInboxRecommendations(userId);
  return inbox.filter((recommendation) => !recommendation.readAt).length;
}

export async function markRecommendationRead(userId: string, id: string) {
  const db = await getPool();
  await db.execute(
    "UPDATE recommendations SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3)) WHERE id = ? AND to_user_id = ?",
    [id, userId]
  );
  return findRecommendationById(userId, id);
}

export async function markAllRecommendationsRead(userId: string) {
  const db = await getPool();
  await db.execute("UPDATE recommendations SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3)) WHERE to_user_id = ? AND read_at IS NULL", [
    userId
  ]);
}

export async function deleteRecommendation(userId: string, id: string) {
  const db = await getPool();
  const [result] = await db.execute<ResultSetHeader>(
    "DELETE FROM recommendations WHERE id = ? AND (from_user_id = ? OR to_user_id = ?)",
    [id, userId, userId]
  );
  return result.affectedRows > 0;
}

export async function clearRecommendations(userId: string, box: "inbox" | "outbox") {
  const db = await getPool();
  if (box === "inbox") {
    await db.execute("DELETE FROM recommendations WHERE to_user_id = ?", [userId]);
    return;
  }
  await db.execute("DELETE FROM recommendations WHERE from_user_id = ?", [userId]);
}
