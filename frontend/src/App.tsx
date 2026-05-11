import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBookmark as regularBookmark,
  faEnvelope,
  faHouse as regularHouse,
  faShareFromSquare,
  faStar as regularStar,
  faTrashCan as regularTrashCan
} from "@fortawesome/free-regular-svg-icons";
import {
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faCircleExclamation,
  faChevronLeft,
  faChevronRight,
  faChevronUp,
  faCompress,
  faEye,
  faEyeSlash,
  faExpand,
  faGear,
  faMagnifyingGlass,
  faQuestionCircle,
  faRightFromBracket,
  faStar as solidStar
} from "@fortawesome/free-solid-svg-icons";
import { type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode, type TouchEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  changeAccountPassword,
  clearRecommendations,
  clearAuthToken,
  createAccount,
  addInteractionBlock,
  addFavorite,
  deleteAccount,
  deleteRecommendation,
  fetchAccountBootstrap,
  fetchInteractionBlocks,
  fetchChapterPages,
  fetchBookmarkUpdates,
  fetchChapters,
  fetchCurrentUser,
  fetchFavorites,
  fetchHome,
  fetchManga,
  fetchRecommendations,
  fetchReadingProgress,
  fetchShareUsers,
  fetchSimilarManga,
  fetchSourceHealth,
  fetchSources,
  fetchTaxonomyOptions,
  fetchUsers,
  getAuthToken,
  importFavorites,
  login,
  logout,
  markAllRecommendationsRead,
  markRecommendationRead,
  prefetchChapterPages,
  removeFavorite,
  removeInteractionBlock,
  resetUserPassword,
  saveReadingProgress,
  searchManga,
  sendRecommendation,
  setAuthToken,
  updateUserNsfwAllowed
} from "./api";
import { isFavorite } from "./storage";
import { preloadReaderImages, proxiedImageUrl } from "./lib/images";
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
  UserRole,
  View
} from "./types";

const DEFAULT_SOURCE = "comix";
const HOME_PAGE_SIZE = 24;
const CHAPTER_PAGE_SIZE = 15;
const ADMIN_USERS_PAGE_SIZE = 8;
const BOOKMARK_UPDATE_LIMIT = 12;
const READING_HISTORY_LIMIT = 12;
const SHOW_NSFW_KEY = "mangass:show-nsfw";
const ACTIVE_READER_POSITION_KEY = "mangass:active-reader-position";
const READER_TIP_DISMISSED_KEY = "mangass:reader-tip-dismissed";
const READER_PAGE_WIDTH_KEY = "mangass:reader-page-width";
const READER_PAGE_WIDTH_MIN = 720;
const READER_PAGE_WIDTH_MAX = 1600;
const READING_PROGRESS_SAVE_INTERVAL_MS = 30_000;
const READING_PROGRESS_SAVE_DELTA = 600;

interface ActiveReaderPosition {
  source: string;
  mangaId: string;
  canonicalKey?: string;
  chapterSource?: string;
  chapterId: string;
  chapterNumber?: string;
  scrollPosition: number;
}

interface ComickImportResult {
  favorites: MangaSummary[];
  progress: Array<{ source: string; mangaId: string; chapterId: string; chapterNumber?: string }>;
  unresolved: number;
}

interface ReadingHistoryItem {
  manga: MangaSummary;
  progress: ReadingProgress;
  lastReadChapter?: string;
}

type ReaderDirection = "left-to-right" | "right-to-left" | "top-to-bottom";
type ReaderPageMode = "single" | "double";
type ReaderProgressPosition = "top" | "bottom";

interface ChapterGroup {
  key: string;
  label: string;
  sortValue?: number;
  releasedAt?: string;
  chapters: ChapterSummary[];
}

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  variant?: "danger";
  onConfirm: () => void;
};

function loadShowNsfw() {
  return localStorage.getItem(SHOW_NSFW_KEY) === "true";
}

function localDateKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function loadReaderPageWidth() {
  const fallback = 1100;
  try {
    const saved = Number(localStorage.getItem(READER_PAGE_WIDTH_KEY));
    if (Number.isFinite(saved)) return clampReaderPageWidth(saved);
  } catch {
    // Use the default width when storage is unavailable.
  }
  return fallback;
}

function clampReaderPageWidth(value: number) {
  return Math.min(READER_PAGE_WIDTH_MAX, Math.max(READER_PAGE_WIDTH_MIN, Math.round(value)));
}

function readStoredReaderPosition() {
  try {
    const stored = sessionStorage.getItem(ACTIVE_READER_POSITION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<ActiveReaderPosition>;
    if (!parsed.source || !parsed.mangaId || !parsed.chapterId || typeof parsed.scrollPosition !== "number") return null;
    return {
      source: parsed.source,
      mangaId: parsed.mangaId,
      canonicalKey: parsed.canonicalKey,
      chapterSource: parsed.chapterSource,
      chapterId: parsed.chapterId,
      chapterNumber: parsed.chapterNumber,
      scrollPosition: parsed.scrollPosition
    };
  } catch {
    return null;
  }
}

function writeStoredReaderPosition(position: ActiveReaderPosition | null) {
  if (!position) {
    sessionStorage.removeItem(ACTIVE_READER_POSITION_KEY);
    return;
  }
  sessionStorage.setItem(ACTIVE_READER_POSITION_KEY, JSON.stringify(position));
}

function isNsfw(manga: MangaSummary) {
  const rating = manga.contentRating?.trim().toLowerCase();
  if (rating && ["erotica", "pornographic", "adult", "nsfw", "smut"].some((term) => rating === term || rating.includes(term))) {
    return true;
  }

  const exactNsfwTags = new Set(["adult", "erotica", "pornographic", "nsfw", "smut", "hentai"]);
  return taxonomyTerms(manga).some((tag) => exactNsfwTags.has(tag.trim().toLowerCase()));
}

const nsfwTitleWords = [
  "adult",
  "anal",
  "bdsm",
  "boobs",
  "breast",
  "breasts",
  "brothel",
  "ecchi",
  "erotic",
  "erotica",
  "harem",
  "hentai",
  "incest",
  "lewd",
  "masturbation",
  "milf",
  "naked",
  "nude",
  "nudity",
  "orgasm",
  "porn",
  "pornographic",
  "rape",
  "sex",
  "sexual",
  "slave",
  "slut",
  "smut",
  "virgin"
];

function maskLetters(value: string) {
  return value.replace(/\p{L}/gu, "*");
}

function censorNsfwTitle(title: string, manga: MangaSummary) {
  const tagTerms = taxonomyTerms(manga)
    .flatMap((tag) => tag.split(/[^a-z0-9]+/i))
    .filter((word) => nsfwTitleWords.includes(word.toLowerCase()));
  const terms = [...new Set([...nsfwTitleWords, ...tagTerms].filter((word) => word.length >= 3))].sort(
    (left, right) => right.length - left.length
  );

  let censored = title;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    censored = censored.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=[^\\p{L}\\p{N}]|$)`, "giu"), (_match, prefix, word) => {
      return `${prefix}${maskLetters(word)}`;
    });
  }
  return censored;
}

function encodePathPart(value: string) {
  return encodeURIComponent(value);
}

function decodePathPart(value?: string) {
  return value ? decodeURIComponent(value) : "";
}

function viewToPath(view: View) {
  if (view.name === "search") {
    const params = new URLSearchParams();
    if (view.query?.trim()) params.set("q", view.query.trim());
    return `/search${params.toString() ? `?${params.toString()}` : ""}`;
  }
  if (view.name === "library") return "/bookmarks";
  if (view.name === "bookmarkUpdates") return "/bookmark-updates";
  if (view.name === "readingHistory") return "/reading-history";
  if (view.name === "account") return "/account";
  if (view.name === "messages") return `/messages/${view.tab ?? "inbox"}`;
  if (view.name === "detail") return `/title/${encodePathPart(view.source)}/${encodePathPart(view.id)}`;
  if (view.name === "reader") {
    return `/read/${encodePathPart(view.source)}/${encodePathPart(view.mangaId)}/${encodePathPart(view.chapterId)}`;
  }
  return "/";
}

function viewFromLocation(location: Location): View {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === "search") return { name: "search", query: new URLSearchParams(location.search).get("q") || undefined };
  if (parts[0] === "bookmarks" || parts[0] === "favorites") return { name: "library" };
  if (parts[0] === "bookmark-updates") return { name: "bookmarkUpdates" };
  if (parts[0] === "reading-history") return { name: "readingHistory" };
  if (parts[0] === "account") return { name: "account" };
  if (parts[0] === "admin") return { name: "account" };
  if (parts[0] === "messages") return { name: "messages", tab: parts[1] === "outbox" ? "outbox" : "inbox" };
  if (parts[0] === "title" && parts[1] && parts[2]) {
    return { name: "detail", source: decodePathPart(parts[1]), id: decodePathPart(parts[2]) };
  }
  if (parts[0] === "read" && parts[1] && parts[2] && parts[3]) {
    return {
      name: "reader",
      source: decodePathPart(parts[1]),
      mangaId: decodePathPart(parts[2]),
      chapterId: decodePathPart(parts[3])
    };
  }
  return { name: "browse" };
}

function browsePageFromLocation(location: Location) {
  const page = Number(new URLSearchParams(location.search).get("page"));
  return Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0;
}

function browsePagePath(page: number) {
  return page > 0 ? `/?page=${page + 1}` : "/";
}

function formatChapter(chapter: ChapterSummary) {
  const prefix = chapter.chapter ? `Ch. ${chapter.chapter}` : "Chapter";
  return chapter.title && !chapter.title.startsWith("Chapter") ? `${prefix}: ${chapter.title}` : prefix;
}

function displayStatus(value?: string) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("hiatus")) return "Hiatus";
  if (normalized.includes("releasing") || normalized.includes("ongoing")) return "Ongoing";
  if (normalized.includes("complete") || normalized.includes("finished")) return "Completed";
  if (normalized.includes("cancel") || normalized.includes("dropped")) return "Cancelled";
  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function statusKind(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("hiatus")) return "hiatus";
  if (normalized.includes("releasing") || normalized.includes("ongoing")) return "ongoing";
  if (normalized.includes("complete") || normalized.includes("finished")) return "completed";
  if (normalized.includes("cancel") || normalized.includes("dropped")) return "cancelled";
  return "unknown";
}

function statusClassName(value?: string) {
  return `status-pill status-${statusKind(value)}`;
}

function displayType(value?: string) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const known: Record<string, string> = {
    manga: "Manga",
    manhwa: "Manhwa",
    manhua: "Manhua",
    comic: "Comic",
    webtoon: "Webtoon"
  };
  return known[normalized] ?? displayStatus(value);
}

function uniqueText(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function mangaGenres(manga: MangaSummary) {
  const categories = new Set(uniqueText(manga.categories ?? []).map((tag) => tag.toLowerCase()));
  return uniqueText(manga.genres ?? []).filter((tag) => !categories.has(tag.toLowerCase()));
}

function mangaCategoryTags(manga: MangaSummary) {
  if (manga.categories?.length) return uniqueText(manga.categories);
  const genres = new Set(mangaGenres(manga).map((tag) => tag.toLowerCase()));
  return uniqueText(manga.tags ?? []).filter((tag) => !genres.has(tag.toLowerCase()));
}

function taxonomyTerms(manga: MangaSummary) {
  return uniqueText([...(manga.genres ?? []), ...(manga.categories ?? []), ...(manga.tags ?? [])]);
}

function displayCommunityRating(manga: MangaSummary) {
  if (typeof manga.communityRating !== "number") return undefined;
  const rating = manga.communityRating.toFixed(2).replace(/\.00$/, "");
  return manga.ratingVotes ? `${rating}/10 (${manga.ratingVotes} votes)` : `${rating}/10`;
}

function displayMetadataDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function metadataSourceUrl(manga: MangaDetail) {
  const value = manga.links?.mu;
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z0-9]+$/i.test(value)) return `https://www.mangaupdates.com/series/${value}`;
  return undefined;
}

function shortChapterLabel(chapter?: ChapterSummary) {
  if (!chapter) return "";
  return chapter.chapter ? `Ch. ${chapter.chapter}` : "Chapter";
}

function formatReleaseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatRelativeReleaseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const diff = date.getTime() - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60]
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const [unit, milliseconds] = units.find(([, size]) => Math.abs(diff) >= size) ?? ["minute", 1000 * 60];
  return formatter.format(Math.round(diff / milliseconds), unit);
}

function formatRecommendationTime(value: string | undefined, mode: "inbox" | "outbox") {
  if (!value) return mode === "inbox" ? "Received just now" : "Sent just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return mode === "inbox" ? "Received just now" : "Sent just now";
  const ageMs = Date.now() - date.getTime();
  const label = ageMs >= 0 && ageMs < 1000 * 60 ? "just now" : formatRelativeReleaseDate(value) ?? "just now";
  return `${mode === "inbox" ? "Received" : "Sent"} ${label}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseComickImport(text: string): ComickImportResult {
  const [headers = [], ...rows] = parseCsv(text);
  if (!headers.includes("hid") || !headers.includes("title")) {
    throw new Error("This does not look like a Comick mylist CSV.");
  }

  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));

  function value(row: string[], key: string) {
    const index = headerIndex.get(key);
    return index === undefined ? "" : (row[index] || "").trim();
  }

  const favorites: MangaSummary[] = [];
  const progress: ComickImportResult["progress"] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const hid = value(row, "hid");
    const title = value(row, "title");
    if (!hid || !title || seen.has(hid)) continue;

    seen.add(hid);
    const type = value(row, "type");
    const origination = value(row, "origination");
    const read = value(row, "read");

    favorites.push({
      source: "external",
      id: hid,
      title,
      description: value(row, "synonyms") || undefined,
      tags: [type, origination].filter(Boolean)
    });

    if (read) {
      progress.push({
        source: "external",
        mangaId: hid,
        chapterId: read,
        chapterNumber: read
      });
    }
  }

  return { favorites, progress, unresolved: favorites.length };
}

async function resolveImportedFavorites(imported: ComickImportResult): Promise<ComickImportResult> {
  const favorites: MangaSummary[] = [];
  const progress: ComickImportResult["progress"] = [];
  let unresolved = 0;

  for (const favorite of imported.favorites) {
    const readProgress = imported.progress.find((item) => item.mangaId === favorite.id);
    try {
      const { manga } = await searchManga("comix", favorite.title, "en", 0, 5);
      const normalizedTitle = favorite.title.trim().toLowerCase();
      const match =
        manga.find((item) => item.title.trim().toLowerCase() === normalizedTitle) ??
        manga.find((item) => item.title.trim().toLowerCase().includes(normalizedTitle) || normalizedTitle.includes(item.title.trim().toLowerCase())) ??
        manga[0];

      if (match) {
        favorites.push(match);
        if (readProgress) {
          progress.push({
            source: match.source,
            mangaId: match.id,
            chapterId: readProgress.chapterId,
            chapterNumber: readProgress.chapterNumber
          });
        }
        continue;
      }
    } catch {
      // Keep unmatched rows as external records so the import remains complete.
    }

    unresolved += 1;
    favorites.push(favorite);
    if (readProgress) progress.push(readProgress);
  }

  return { favorites, progress, unresolved };
}

function Cover({ manga }: { manga: MangaSummary }) {
  const coverUrl = proxiedImageUrl(manga.coverUrl);
  return (
    <div className="cover">
      {coverUrl ? <img src={coverUrl} alt="" loading="lazy" /> : <span>{manga.title.slice(0, 2)}</span>}
    </div>
  );
}

function LogoMark() {
  return (
    <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 7h14a4 4 0 0 1 4 4v14H11a4 4 0 0 1-4-4V7Z" />
      <path d="M11 11h10M11 16h7M11 21h10" />
    </svg>
  );
}

function PasswordField({
  value,
  onChange,
  autoComplete,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input-wrap">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
      <button
        className="password-toggle-button"
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} aria-hidden="true" />
      </button>
    </div>
  );
}

function BookmarkIcon({ active }: { active: boolean }) {
  return <FontAwesomeIcon icon={regularBookmark} aria-hidden="true" data-active={active ? "true" : undefined} />;
}

function TrashIcon() {
  return <FontAwesomeIcon icon={regularTrashCan} aria-hidden="true" />;
}

function ArrowLeftIcon() {
  return <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />;
}

function ArrowRightIcon() {
  return <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />;
}

function HomeIcon() {
  return <FontAwesomeIcon icon={regularHouse} aria-hidden="true" />;
}

function BookmarksIcon() {
  return <FontAwesomeIcon icon={regularBookmark} aria-hidden="true" />;
}

function SearchIcon() {
  return <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />;
}

function SettingsIcon() {
  return <FontAwesomeIcon icon={faGear} aria-hidden="true" />;
}

function SortArrowIcon({ direction }: { direction: "up" | "down" }) {
  return <FontAwesomeIcon icon={direction === "up" ? faArrowUp : faArrowDown} aria-hidden="true" />;
}

function MailIcon() {
  return <FontAwesomeIcon icon={faEnvelope} aria-hidden="true" />;
}

function ShareIcon() {
  return <FontAwesomeIcon icon={faShareFromSquare} aria-hidden="true" />;
}

function LogoutIcon() {
  return <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />;
}

function LoadingNotice({ label, page = false }: { label: string; page?: boolean }) {
  return (
    <section className={page ? "loading-page" : undefined}>
      <div className="loading-state" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </section>
  );
}

function TitleRating({ manga }: { manga: MangaSummary }) {
  if (typeof manga.communityRating !== "number") return null;
  const filledStars = Math.max(0, Math.min(5, Math.round(manga.communityRating / 2)));
  return (
    <div className="title-rating" aria-label={`Community rating ${displayCommunityRating(manga)}`}>
      <span className="rating-stars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <FontAwesomeIcon key={index} icon={index < filledStars ? solidStar : regularStar} />
        ))}
      </span>
      <strong>{displayCommunityRating(manga)}</strong>
    </div>
  );
}

function MangaGridSkeleton({ count = 24, rail = false }: { count?: number; rail?: boolean }) {
  return (
    <section className={rail ? "grid rail-grid skeleton-grid" : "grid skeleton-grid"} aria-label="Loading titles">
      {Array.from({ length: count }, (_, index) => (
        <article className="manga-card skeleton-card" key={index}>
          <div className="skeleton-cover" />
          <div className="skeleton-line short" />
          <div className="skeleton-line" />
        </article>
      ))}
    </section>
  );
}

function RailScroller({ children, className }: { children: ReactNode; className: string }) {
  const railRef = useRef<HTMLElement | null>(null);

  function scrollRail(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.82, 320), behavior: "smooth" });
  }

  return (
    <div className="rail-scroller">
      <button className="rail-scroll-button rail-scroll-left" type="button" onClick={() => scrollRail(-1)} aria-label="Scroll left">
        <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
      </button>
      <section ref={railRef} className={className}>
        {children}
      </section>
      <button className="rail-scroll-button rail-scroll-right" type="button" onClick={() => scrollRail(1)} aria-label="Scroll right">
        <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
      </button>
    </div>
  );
}

function chapterNumberValue(value?: string) {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function chapterReleaseValue(chapter: ChapterSummary) {
  const value = chapter.publishedAt ?? chapter.readableAt;
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function chapterGroupRelease(chapters: ChapterSummary[]) {
  const latest = Math.max(
    0,
    ...chapters
      .map(chapterReleaseValue)
      .filter((value): value is number => value !== undefined)
  );
  return latest > 0 ? new Date(latest).toISOString() : undefined;
}

function chapterSourceLabel(chapter: ChapterSummary) {
  return chapter.groups[0] || chapter.language || "Source";
}

function chapterChoiceKey(chapter: ChapterSummary) {
  return chapterSourceLabel(chapter).trim().toLowerCase() || `${chapter.source}:${chapter.id}`;
}

function dedupeChapterChoices(chapters: ChapterSummary[], preferredChapterId?: string) {
  const choices = new Map<string, ChapterSummary>();
  for (const chapter of chapters) {
    const key = chapterChoiceKey(chapter);
    const existing = choices.get(key);
    if (!existing || chapter.id === preferredChapterId || (existing.source !== "comix" && chapter.source === "comix")) {
      choices.set(key, chapter);
    }
  }
  return [...choices.values()];
}

function preferredChapterChoice(chapters: ChapterSummary[], preferred?: ChapterSummary, preferredChapterId?: string) {
  const choices = dedupeChapterChoices(chapters, preferredChapterId);
  if (!choices.length) return undefined;
  const preferredKey = preferred ? chapterChoiceKey(preferred) : undefined;
  return (
    choices.find((chapter) => preferredKey && chapterChoiceKey(chapter) === preferredKey) ??
    choices.find((chapter) => preferred && chapter.source === preferred.source) ??
    choices[0]
  );
}

function groupChaptersByNumber(chapters: ChapterSummary[]) {
  const groups = new Map<string, ChapterGroup & { firstIndex: number }>();

  chapters.forEach((chapter, index) => {
    const numericValue = chapterNumberValue(chapter.chapter);
    const key = numericValue === undefined ? `chapter:${chapter.id}` : `chapter:${numericValue}`;
    const label = numericValue === undefined ? formatChapter(chapter) : `Ch. ${chapter.chapter}`;
    const existing = groups.get(key);
    if (existing) {
      existing.chapters.push(chapter);
      return;
    }

    groups.set(key, {
      key,
      label,
      sortValue: numericValue,
      releasedAt: chapterGroupRelease([chapter]),
      chapters: [chapter],
      firstIndex: index
    });
  });

  const values = [...groups.values()].map((group) => ({
    ...group,
    releasedAt: chapterGroupRelease(group.chapters)
  }));

  return values.sort((left, right) => {
    if (left.sortValue !== undefined && right.sortValue !== undefined && left.sortValue !== right.sortValue) {
      return right.sortValue - left.sortValue;
    }
    if (left.sortValue !== undefined) return -1;
    if (right.sortValue !== undefined) return 1;
    return left.firstIndex - right.firstIndex;
  });
}

type ChapterSortMode = "chapter-desc" | "chapter-asc";

function sortChapterGroups(groups: ChapterGroup[], mode: ChapterSortMode) {
  return [...groups].sort((left, right) => {
    const chapterOrder =
      left.sortValue !== undefined && right.sortValue !== undefined
        ? right.sortValue - left.sortValue
        : left.sortValue !== undefined
          ? -1
          : right.sortValue !== undefined
            ? 1
            : left.label.localeCompare(right.label);

    return mode === "chapter-asc" ? -chapterOrder : chapterOrder;
  });
}

function firstReadableChapter(chapters: ChapterSummary[]) {
  const firstGroup = sortChapterGroups(groupChaptersByNumber(chapters), "chapter-asc")[0];
  return firstGroup ? preferredChapterChoice(firstGroup.chapters) : chapters[chapters.length - 1];
}

function displayedChapterCount(chapters: ChapterSummary[]) {
  const highestChapter = Math.max(
    0,
    ...chapters
      .map((chapter) => chapterNumberValue(chapter.chapter))
      .filter((value): value is number => value !== undefined)
      .map((value) => Math.floor(value))
  );

  return highestChapter || groupChaptersByNumber(chapters).length;
}

function compactChapterLabel(label?: string) {
  return label?.replace(/^Ch\.\s*/i, "") ?? "";
}

function currentScrollPosition() {
  return Math.max(
    0,
    Math.round(
      window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
    )
  );
}

function maxScrollPosition() {
  return Math.max(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight);
}

function readingProgressPercent() {
  const maxScroll = maxScrollPosition();
  if (maxScroll <= 0) return 0;
  return Math.min(100, Math.max(0, (currentScrollPosition() / maxScroll) * 100));
}

function restoreScrollPosition(target: number, allowClamp = false) {
  const maxScroll = maxScrollPosition();
  if (maxScroll <= 0) return false;
  if (!allowClamp && maxScroll < target - 80) return false;
  const nextTop = Math.min(target, maxScroll);
  window.scrollTo({ top: nextTop });
  return Math.abs(currentScrollPosition() - nextTop) < 80;
}

function isLikelyInternalChapterId(value?: string) {
  const number = chapterNumberValue(value);
  return number !== undefined && Number.isInteger(number) && number >= 10000;
}

function lastReadLabel(manga: FavoriteManga) {
  if (manga.lastReadChapter) return manga.lastReadChapter;
  return chapterNumberValue(manga.lastReadChapterId) !== undefined && !isLikelyInternalChapterId(manga.lastReadChapterId)
    ? manga.lastReadChapterId
    : undefined;
}

function progressLastReadLabel(progress: ReadingProgress, resolvedChapter?: string) {
  if (progress.chapterNumber) return progress.chapterNumber;
  if (resolvedChapter) return resolvedChapter;
  return isLikelyInternalChapterId(progress.chapterId) ? undefined : progress.chapterId;
}

function normalizedSeriesKey(manga: MangaSummary) {
  if (manga.canonicalKey) return manga.canonicalKey;
  const title = manga.title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title ? `title:${title}` : `source:${manga.source}:${manga.id}`;
}

function dedupeReadingHistoryItems(items: ReadingHistoryItem[]) {
  const bySeries = new Map<string, ReadingHistoryItem>();
  for (const item of items) {
    const key = item.progress.canonicalKey ?? normalizedSeriesKey(item.manga);
    const existing = bySeries.get(key);
    if (!existing || new Date(item.progress.updatedAt).getTime() > new Date(existing.progress.updatedAt).getTime()) {
      bySeries.set(key, item);
    }
  }
  return [...bySeries.values()].sort(
    (left, right) => new Date(right.progress.updatedAt).getTime() - new Date(left.progress.updatedAt).getTime()
  );
}

function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Request timed out.")), ms);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

async function resolveReadingHistoryItem(
  progress: ReadingProgress,
  favorites: FavoriteManga[],
  options: { allowDetailFetch?: boolean } = {}
): Promise<ReadingHistoryItem | undefined> {
  const favorite =
    favorites.find((item) => item.source === progress.source && item.id === progress.mangaId) ??
    favorites.find((item) => progress.canonicalKey && item.canonicalKey === progress.canonicalKey);
  let manga: MangaSummary | undefined = favorite;

  if (!manga && options.allowDetailFetch !== false) {
    try {
      const result = await withTimeout(fetchManga(progress.source, progress.mangaId, { mirrors: false }));
      manga = result.manga;
    } catch {
      return undefined;
    }
  }
  if (!manga) return undefined;

  let lastReadChapter: string | undefined;
  if (!progress.chapterNumber && isLikelyInternalChapterId(progress.chapterId)) {
    try {
      const { chapters } = await withTimeout(fetchChapters(progress.source, progress.mangaId), 8000);
      lastReadChapter = chapters.find((chapter) => chapter.id === progress.chapterId)?.chapter;
    } catch {
      lastReadChapter = undefined;
    }
  }

  return { manga, progress, lastReadChapter };
}

function newChapterCount(manga: FavoriteManga) {
  const latest = chapterNumberValue(manga.latestChapter);
  const lastRead = chapterNumberValue(lastReadLabel(manga));
  if (latest === undefined || lastRead === undefined) return undefined;
  const count = Math.max(Math.floor(latest - lastRead), 0);
  return count || undefined;
}

function chapterTimestamp(chapter?: ChapterSummary) {
  if (!chapter) return 0;
  const value = chapter.publishedAt ?? chapter.readableAt;
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortBookmarkUpdates(updates: BookmarkUpdate[]) {
  return [...updates].sort((left, right) => chapterTimestamp(right.latestChapter) - chapterTimestamp(left.latestChapter));
}

function homeHistoryItemToReadingHistory(item: HomeManga): ReadingHistoryItem {
  return {
    manga: item,
    progress: {
      source: item.source,
      mangaId: item.id,
      canonicalKey: item.canonicalKey,
      chapterSource: item.source,
      chapterId: item.lastReadChapterId ?? item.lastReadChapter ?? item.id,
      chapterNumber: item.lastReadChapter,
      scrollPosition: item.scrollPosition,
      updatedAt: item.updatedAt ?? new Date().toISOString()
    },
    lastReadChapter: item.lastReadChapter
  };
}

type BookmarkSort = "added-desc" | "title-asc" | "latest-desc" | "chapter-desc" | "last-read-desc" | "unread-desc";

function sortBookmarks(bookmarks: FavoriteManga[], sort: BookmarkSort) {
  return [...bookmarks].sort((left, right) => {
    if (sort === "title-asc") return left.title.localeCompare(right.title);
    if (sort === "latest-desc") {
      return (new Date(right.latestChapterReleasedAt ?? 0).getTime() || 0) - (new Date(left.latestChapterReleasedAt ?? 0).getTime() || 0);
    }
    if (sort === "chapter-desc") return (chapterNumberValue(right.latestChapter) ?? 0) - (chapterNumberValue(left.latestChapter) ?? 0);
    if (sort === "last-read-desc") return (chapterNumberValue(lastReadLabel(right)) ?? 0) - (chapterNumberValue(lastReadLabel(left)) ?? 0);
    if (sort === "unread-desc") return (newChapterCount(right) ?? 0) - (newChapterCount(left) ?? 0);
    return new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime();
  });
}

function joinValues(values?: string[]) {
  return values?.filter(Boolean).join(", ");
}

function MangaCard({
  manga,
  favorite,
  lastReadChapter,
  newChapters,
  detailOrder = "standard",
  onOpen,
  onFavorite
}: {
  manga: MangaSummary;
  favorite: boolean;
  lastReadChapter?: string;
  newChapters?: number;
  detailOrder?: "standard" | "title-first";
  onOpen: () => void;
  onFavorite: () => void;
}) {
  const releasedAt = formatRelativeReleaseDate(manga.latestChapterReleasedAt);
  const nsfw = isNsfw(manga);

  return (
    <article className="manga-card">
      <button className="cover-button" onClick={onOpen} aria-label={`Open ${manga.title}`}>
        <Cover manga={manga} />
      </button>
      {nsfw && (
        <span className="card-nsfw-badge" title="NSFW title" aria-label="NSFW title">
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
        </span>
      )}
      {newChapters && <span className="update-count" title={`${newChapters} new chapters`}>{newChapters}</span>}
      <button
        className={favorite ? "favorite-toggle active" : "favorite-toggle"}
        onClick={onFavorite}
        aria-label={favorite ? "Remove bookmark" : "Add bookmark"}
        title={favorite ? "Remove bookmark" : "Add bookmark"}
      >
        <BookmarkIcon active={favorite} />
      </button>
      <div className="manga-card-body">
        {detailOrder === "title-first" ? (
          <>
            <button className="title-button" onClick={onOpen}>
              {manga.title}
            </button>
            {manga.latestChapter && <div className="rail-detail-line">Ch. {manga.latestChapter}</div>}
            {releasedAt && <div className="rail-detail-time">{releasedAt}</div>}
            {lastReadChapter && <div className="last-read-row">Last read Ch. {lastReadChapter}</div>}
          </>
        ) : (
          <>
            {lastReadChapter && <div className="last-read-row">Last read Ch. {lastReadChapter}</div>}
            {(manga.latestChapter || manga.latestChapterReleasedAt) && (
              <div className="latest-row">
                {manga.latestChapter && <span>Ch. {manga.latestChapter}</span>}
                {releasedAt && <small>{releasedAt}</small>}
              </div>
            )}
            <button className="title-button" onClick={onOpen}>
              {manga.title}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ConfirmModal({
  dialog,
  onCancel
}: {
  dialog: ConfirmDialogState;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="modal-actions">
          <button className="small-button" type="button" onClick={onCancel}>Cancel</button>
          <button
            className={dialog.variant === "danger" ? "danger-confirm-button" : "primary-button"}
            type="button"
            onClick={dialog.onConfirm}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function LoginView({ onLoggedIn }: { onLoggedIn: (user: AccountUser, token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    login(username, password)
      .then(({ user, token }) => onLoggedIn(user, token))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <div className="auth-brand">
          <LogoMark />
          <span>ScottShelf</span>
        </div>
        <div className="section-heading">
          <h1>Sign in</h1>
          <p>Use your ScottShelf account to browse, read, and manage bookmarks.</p>
        </div>
        {error && <div className="notice error">{error}</div>}
        <label className="form-field">
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label className="form-field">
          <span>Password</span>
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        </label>
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>
    </main>
  );
}

function BrowseView({
  source,
  favorites,
  readingProgress,
  showNsfw,
  onFavorite,
  onOpen,
  onViewBookmarkUpdates,
  onViewHistory
}: {
  source: string;
  favorites: FavoriteManga[];
  readingProgress: ReadingProgress[];
  showNsfw: boolean;
  onFavorite: (manga: MangaSummary) => void;
  onOpen: (manga: MangaSummary) => void;
  onViewBookmarkUpdates: () => void;
  onViewHistory: () => void;
}) {
  const [page, setPage] = useState(() => browsePageFromLocation(window.location));
  const [items, setItems] = useState<MangaSummary[]>([]);
  const [bookmarkUpdates, setBookmarkUpdates] = useState<BookmarkUpdate[]>([]);
  const [historyItems, setHistoryItems] = useState<ReadingHistoryItem[]>([]);
  const [bookmarkUpdatesLoading, setBookmarkUpdatesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nsfwMode, setNsfwMode] = useState<"mixed" | "safe" | "nsfw">("mixed");
  const feedTitle = "Latest Updates";
  const feedSubtitle = "Popular titles from recent chapter releases";
  const visibleItems = items.filter((manga) => {
    const nsfw = isNsfw(manga);
    if (!showNsfw) return !nsfw;
    if (nsfwMode === "safe") return !nsfw;
    if (nsfwMode === "nsfw") return nsfw;
    return true;
  });
  const visibleBookmarkUpdates = showNsfw ? bookmarkUpdates : bookmarkUpdates.filter((item) => !isNsfw(item.manga));
  const canGoBack = page > 0;
  const canGoForward = items.length === HOME_PAGE_SIZE;

  function changePage(nextPage: number) {
    const normalizedPage = Math.max(nextPage, 0);
    setPage(normalizedPage);
    window.history.pushState({ view: { name: "browse" } }, "", browsePagePath(normalizedPage));
    window.scrollTo({ top: 0 });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBookmarkUpdatesLoading(true);
    setHistoryLoading(true);
    setError("");
    fetchHome(source, page, HOME_PAGE_SIZE, BOOKMARK_UPDATE_LIMIT, READING_HISTORY_LIMIT)
      .then(({ latest, bookmarkUpdates, readingHistory }) => {
        if (!cancelled) {
          setItems(latest);
          setBookmarkUpdates(sortBookmarkUpdates(bookmarkUpdates));
          setHistoryItems(readingHistory.map(homeHistoryItemToReadingHistory));
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setItems([]);
          setBookmarkUpdates([]);
          setHistoryItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setBookmarkUpdatesLoading(false);
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, page]);

  useEffect(() => {
    const handlePopState = () => {
      setPage(browsePageFromLocation(window.location));
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return (
    <main className="content">
      {error && <div className="notice error">{error}</div>}

      {(bookmarkUpdatesLoading || visibleBookmarkUpdates.length > 0) && (
        <section className="bookmark-updates">
          <div className="section-heading compact">
            <h2>New Chapters from Bookmarks</h2>
            <button className="view-all-button" type="button" onClick={onViewBookmarkUpdates}>View all</button>
          </div>
          {bookmarkUpdatesLoading && !visibleBookmarkUpdates.length && <MangaGridSkeleton count={12} rail />}
          {visibleBookmarkUpdates.length > 0 && (
            <RailScroller className="grid rail-grid">
              {visibleBookmarkUpdates.map(({ manga, latestChapter, lastReadChapter }) => (
                <MangaCard
                  key={`bookmark-update:${manga.source}:${manga.id}`}
                  manga={{
                    ...manga,
                    latestChapter: latestChapter?.chapter ?? manga.latestChapter,
                    latestChapterReleasedAt: latestChapter?.publishedAt ?? latestChapter?.readableAt ?? manga.latestChapterReleasedAt
                  }}
                  favorite={Boolean((manga as HomeManga).bookmarked) || isFavorite(favorites, manga.source, manga.id)}
                  lastReadChapter={lastReadChapter}
                  detailOrder="title-first"
                  onOpen={() => onOpen(manga)}
                  onFavorite={() => onFavorite(manga)}
                />
              ))}
            </RailScroller>
          )}
        </section>
      )}

      {(historyLoading || historyItems.length > 0) && (
        <section className="reading-history">
          <div className="section-heading compact">
            <h2>Reading History</h2>
            <button className="view-all-button" type="button" onClick={onViewHistory}>View all</button>
          </div>
          {historyLoading && !historyItems.length && <MangaGridSkeleton count={12} rail />}
          {historyItems.length > 0 && (
            <RailScroller className="grid rail-grid">
              {historyItems
              .filter(({ manga }) => showNsfw || !isNsfw(manga))
              .map(({ manga, progress, lastReadChapter }) => (
                <MangaCard
                  key={`history:${progress.source}:${progress.mangaId}`}
                  manga={manga}
                  favorite={Boolean((manga as HomeManga).bookmarked) || isFavorite(favorites, manga.source, manga.id)}
                  lastReadChapter={progressLastReadLabel(progress, lastReadChapter)}
                  detailOrder="title-first"
                  onOpen={() => onOpen(manga)}
                  onFavorite={() => onFavorite(manga)}
                />
              ))}
            </RailScroller>
          )}
        </section>
      )}

      {!error && (
        <section className="section-heading feed-heading">
          <div>
            <h1>{feedTitle}</h1>
            <p>{feedSubtitle}</p>
          </div>
          {showNsfw && (
            <label className="feed-content-filter">
              <span>Content</span>
              <select value={nsfwMode} onChange={(event) => setNsfwMode(event.target.value as "mixed" | "safe" | "nsfw")}>
                <option value="mixed">Mixed content</option>
                <option value="safe">Non-NSFW only</option>
                <option value="nsfw">NSFW only</option>
              </select>
            </label>
          )}
        </section>
      )}

      {loading && <MangaGridSkeleton />}

      <section className={loading ? "grid hidden-grid" : "grid"}>
        {visibleItems.map((manga) => (
          <MangaCard
            key={`${manga.source}:${manga.id}`}
            manga={manga}
            favorite={Boolean((manga as HomeManga).bookmarked) || isFavorite(favorites, manga.source, manga.id)}
            onOpen={() => onOpen(manga)}
            onFavorite={() => onFavorite(manga)}
          />
        ))}
      </section>

      {!error && !loading && items.length > 0 && (
        <div className="pagination-controls pagination-bottom" aria-label="Home pagination">
          <button type="button" onClick={() => changePage(page - 1)} disabled={!canGoBack}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button type="button" onClick={() => changePage(page + 1)} disabled={!canGoForward}>
            Next
          </button>
        </div>
      )}
    </main>
  );
}

function SearchView({
  initialQuery,
  source,
  sources,
  favorites,
  showNsfw,
  onFavorite,
  onOpen
}: {
  initialQuery?: string;
  source: string;
  sources: SourceInfo[];
  favorites: FavoriteManga[];
  showNsfw: boolean;
  onFavorite: (manga: MangaSummary) => void;
  onOpen: (manga: MangaSummary) => void;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery ?? "");
  const [selectedSource, setSelectedSource] = useState(source);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [categoryTag, setCategoryTag] = useState("");
  const [genreTag, setGenreTag] = useState("");
  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");
  const [nsfwMode, setNsfwMode] = useState<"mixed" | "safe" | "nsfw">("mixed");
  const [sort, setSort] = useState("relevance");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [items, setItems] = useState<MangaSummary[]>([]);
  const [taxonomy, setTaxonomy] = useState<{ genres: string[]; categories: string[] }>({ genres: [], categories: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
	  const availableSources = sources.filter((item) => item.enabled);
	  const sourceOptions = [
    { id: "all", name: "All backup sources", enabled: true },
    ...(availableSources.length ? availableSources : [{ id: selectedSource, name: selectedSource, enabled: true }])
  ];

  useEffect(() => {
    setQuery(initialQuery ?? "");
    setSubmittedQuery(initialQuery ?? "");
    setPage(0);
  }, [initialQuery]);

  useEffect(() => {
    let cancelled = false;
    fetchTaxonomyOptions()
      .then((options) => {
        if (!cancelled) setTaxonomy(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    searchManga(selectedSource, submittedQuery, "en", page * HOME_PAGE_SIZE, HOME_PAGE_SIZE)
      .then(({ manga }) => {
        if (!cancelled) setItems(manga);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSource, submittedQuery, page]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setPage(0);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    window.history.replaceState({ view: { name: "search", query: query.trim() || undefined } }, "", `/search${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const selectedCategoryTag = categoryTag.trim().toLowerCase();
  const selectedGenreTag = genreTag.trim().toLowerCase();
  const availableCategoryTags = uniqueText([
    ...taxonomy.categories,
    ...items.flatMap((manga) => mangaCategoryTags(manga))
  ]).sort((left, right) => left.localeCompare(right));
  const availableGenres = uniqueText([
    ...taxonomy.genres,
    ...items.flatMap((manga) => mangaGenres(manga))
  ]).sort((left, right) => left.localeCompare(right));

  const filteredItems = items
    .filter((manga) => {
      const nsfw = isNsfw(manga);
      if (!showNsfw) return !nsfw;
      if (nsfwMode === "safe") return !nsfw;
      if (nsfwMode === "nsfw") return nsfw;
      return true;
    })
    .filter((manga) => !status || statusKind(manga.status) === status)
    .filter((manga) => !type || manga.demographic?.toLowerCase() === type)
    .filter((manga) => {
      if (!selectedCategoryTag) return true;
      const terms = mangaCategoryTags(manga).map((item) => item.toLowerCase());
      return terms.some((item) => item === selectedCategoryTag);
    })
    .filter((manga) => {
      if (!selectedGenreTag) return true;
      const terms = mangaGenres(manga).map((item) => item.toLowerCase());
      return terms.some((item) => item === selectedGenreTag);
    })
    .filter((manga) => !yearMin || (manga.year ?? 0) >= Number(yearMin))
    .filter((manga) => !yearMax || (manga.year ?? 99999) <= Number(yearMax))
    .sort((left, right) => {
      if (sort === "title") return left.title.localeCompare(right.title);
      if (sort === "latest") return (new Date(right.latestChapterReleasedAt ?? 0).getTime() || 0) - (new Date(left.latestChapterReleasedAt ?? 0).getTime() || 0);
      if (sort === "year") return (right.year ?? 0) - (left.year ?? 0);
      if (sort === "chapter") return (chapterNumberValue(right.latestChapter) ?? 0) - (chapterNumberValue(left.latestChapter) ?? 0);
      return 0;
    });

  return (
    <main className="content">
      <section className="section-heading">
        <h1>Search</h1>
	        <p>Search across backup sources, then refine results with supported local filters.</p>
      </section>

      <form className="search-panel search-panel-refined" onSubmit={submit}>
        <div className="search-basic-row">
          <label className="form-field search-query">
            <span>Title, author, or category</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="primary-button search-submit-button" type="submit">Search</button>
        </div>

        <button className="search-advanced-toggle" type="button" onClick={() => setAdvancedOpen((open) => !open)}>
          <span>{advancedOpen ? "Hide advanced search" : "Advanced search"}</span>
          <span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
        </button>

        {advancedOpen && (
          <div className="search-advanced-grid">
            <label className="form-field search-source-field">
              <span>Source</span>
              <select value={selectedSource} onChange={(event) => { setSelectedSource(event.target.value); setPage(0); }}>
                {sourceOptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Any status</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
                <option value="hiatus">Hiatus</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="form-field">
              <span>Type</span>
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">Any type</option>
                <option value="manga">Manga</option>
                <option value="manhwa">Manhwa</option>
                <option value="manhua">Manhua</option>
              </select>
            </label>
            <SearchableTagSelect
              label="Category tag"
              options={availableCategoryTags}
              value={categoryTag}
              onChange={setCategoryTag}
              placeholder="Any category"
            />
            <SearchableTagSelect
              label="Genre"
              options={availableGenres}
              value={genreTag}
              onChange={setGenreTag}
              placeholder="Any genre"
            />
            <label className="form-field">
              <span>Year from</span>
              <input value={yearMin} onChange={(event) => setYearMin(event.target.value.replace(/\D/g, ""))} inputMode="numeric" pattern="[0-9]*" />
            </label>
            <label className="form-field">
              <span>Year to</span>
              <input value={yearMax} onChange={(event) => setYearMax(event.target.value.replace(/\D/g, ""))} inputMode="numeric" pattern="[0-9]*" />
            </label>
            {showNsfw && (
              <label className="form-field">
                <span>Content</span>
                <select value={nsfwMode} onChange={(event) => setNsfwMode(event.target.value as "mixed" | "safe" | "nsfw")}>
                  <option value="mixed">Mixed content</option>
                  <option value="safe">Non-NSFW only</option>
                  <option value="nsfw">NSFW only</option>
                </select>
              </label>
            )}
            <label className="form-field">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="relevance">Source relevance</option>
                <option value="latest">Latest update</option>
                <option value="title">Title A-Z</option>
                <option value="year">Release year</option>
                <option value="chapter">Latest chapter</option>
              </select>
            </label>
          </div>
        )}
      </form>

      {error && <div className="notice error">{error}</div>}
      {loading && <MangaGridSkeleton />}
      {!loading && !filteredItems.length && <div className="notice">No titles matched your search.</div>}
      <section className={loading ? "grid hidden-grid" : "grid"}>
        {filteredItems.map((manga) => (
          <MangaCard
            key={`${manga.source}:${manga.id}`}
            manga={manga}
            favorite={isFavorite(favorites, manga.source, manga.id)}
            onOpen={() => onOpen(manga)}
            onFavorite={() => onFavorite(manga)}
          />
        ))}
      </section>
      {!loading && items.length > 0 && (
        <div className="pagination-controls pagination-bottom" aria-label="Search pagination">
          <button type="button" onClick={() => setPage((current) => Math.max(current - 1, 0))} disabled={page === 0}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button type="button" onClick={() => setPage((current) => current + 1)} disabled={items.length < HOME_PAGE_SIZE}>
            Next
          </button>
        </div>
      )}
    </main>
  );
}

function BookmarkUpdatesView({
  favorites,
  showNsfw,
  onFavorite,
  onOpen
}: {
  favorites: FavoriteManga[];
  showNsfw: boolean;
  onFavorite: (manga: MangaSummary) => void;
  onOpen: (manga: MangaSummary) => void;
}) {
  const [items, setItems] = useState<BookmarkUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!favorites.length) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    fetchBookmarkUpdates(200)
      .then(({ updates }) => {
        if (!cancelled) setItems(sortBookmarkUpdates(showNsfw ? updates : updates.filter((item) => !isNsfw(item.manga))));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [favorites.length, showNsfw]);

  return (
    <main className="content">
      <section className="section-heading">
        <h1>New Chapters from Bookmarks</h1>
      </section>
      {error && <div className="notice error">{error}</div>}
      {loading && <MangaGridSkeleton />}
      {!loading && !items.length && <div className="notice">No unread bookmark updates.</div>}
      <section className={loading ? "grid hidden-grid" : "grid"}>
        {items.map(({ manga, latestChapter, lastReadChapter }) => (
          <MangaCard
            key={`bookmark-update-page:${manga.source}:${manga.id}`}
            manga={{
              ...manga,
              latestChapter: latestChapter?.chapter ?? manga.latestChapter,
              latestChapterReleasedAt: latestChapter?.publishedAt ?? latestChapter?.readableAt ?? manga.latestChapterReleasedAt
            }}
            favorite={isFavorite(favorites, manga.source, manga.id)}
            lastReadChapter={lastReadChapter}
            detailOrder="title-first"
            onOpen={() => onOpen(manga)}
            onFavorite={() => onFavorite(manga)}
          />
        ))}
      </section>
    </main>
  );
}

function ReadingHistoryView({
  favorites,
  readingProgress,
  showNsfw,
  onFavorite,
  onOpen
}: {
  favorites: FavoriteManga[];
  readingProgress: ReadingProgress[];
  showNsfw: boolean;
  onFavorite: (manga: MangaSummary) => void;
  onOpen: (manga: MangaSummary) => void;
}) {
  const [items, setItems] = useState<ReadingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const readableProgress = readingProgress.filter((progress) => progress.source !== "external" && progress.mangaId);
    if (!readableProgress.length) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    Promise.allSettled(
      readableProgress.map(async (progress): Promise<ReadingHistoryItem | undefined> => {
        return resolveReadingHistoryItem(progress, favorites);
      })
    )
      .then((nextItems) => {
        if (!cancelled) {
          setItems(
            dedupeReadingHistoryItems(
              nextItems
                .filter((item): item is PromiseFulfilledResult<ReadingHistoryItem | undefined> => item.status === "fulfilled")
                .map((item) => item.value)
                .filter((item): item is ReadingHistoryItem => Boolean(item))
            )
          );
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [favorites, readingProgress]);

  const visibleItems = showNsfw ? items : items.filter(({ manga }) => !isNsfw(manga));

  return (
    <main className="content">
      <section className="section-heading">
        <h1>Reading History</h1>
      </section>
      {error && <div className="notice error">{error}</div>}
      {loading && <MangaGridSkeleton />}
      {!loading && !visibleItems.length && <div className="notice">No reading history yet.</div>}
      <section className={loading ? "grid hidden-grid" : "grid"}>
        {visibleItems.map(({ manga, progress, lastReadChapter }) => (
          <MangaCard
            key={`history-page:${progress.source}:${progress.mangaId}`}
            manga={manga}
            favorite={isFavorite(favorites, manga.source, manga.id)}
            lastReadChapter={progressLastReadLabel(progress, lastReadChapter)}
            detailOrder="title-first"
            onOpen={() => onOpen(manga)}
            onFavorite={() => onFavorite(manga)}
          />
        ))}
      </section>
    </main>
  );
}

function LibraryView({
  favorites,
  showNsfw,
  onOpen,
  onFavorite
}: {
  favorites: FavoriteManga[];
  showNsfw: boolean;
  onOpen: (manga: MangaSummary) => void;
  onFavorite: (manga: MangaSummary) => void;
}) {
  const [sort, setSort] = useState<BookmarkSort>("added-desc");
  const visibleBookmarks = useMemo(
    () => sortBookmarks(showNsfw ? favorites : favorites.filter((manga) => !isNsfw(manga)), sort),
    [favorites, showNsfw, sort]
  );

  return (
    <main className="content">
      <section className="section-heading">
        <h1>Bookmarks</h1>
        <p>{visibleBookmarks.length ? `${visibleBookmarks.length} bookmarked titles` : "Bookmarked titles will appear here."}</p>
      </section>
      <section className="library-tools" aria-label="Bookmark sorting">
        <label className="form-field">
          <span>Sort bookmarks</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as BookmarkSort)}>
            <option value="added-desc">Recently bookmarked</option>
            <option value="title-asc">Title A-Z</option>
            <option value="latest-desc">Latest update</option>
            <option value="chapter-desc">Latest chapter</option>
            <option value="last-read-desc">Last read chapter</option>
            <option value="unread-desc">New chapters</option>
          </select>
        </label>
      </section>
      <section className="grid">
        {visibleBookmarks.map((manga) => (
          <MangaCard
            key={`${manga.source}:${manga.id}`}
            manga={manga}
            favorite
            lastReadChapter={lastReadLabel(manga)}
            newChapters={newChapterCount(manga)}
            detailOrder="title-first"
            onOpen={() => onOpen(manga)}
            onFavorite={() => onFavorite(manga)}
          />
        ))}
      </section>
    </main>
  );
}

function SearchableTagSelect({
  label,
  options,
  value,
  onChange,
  placeholder
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (tag: string) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const suggestions = options
    .filter((option) => !input.trim() || option.toLowerCase().includes(input.trim().toLowerCase()))
    .slice(0, 8);

  function selectTag(tag: string) {
    onChange(tag);
    setInput("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions.length) selectTag(suggestions[0]);
    }
  }

  return (
    <div className="form-field tag-select-field">
      <span>{label}</span>
      <div className="tag-search-select" onMouseDown={() => setOpen(true)}>
        {value && (
          <button className="tag-select-value" type="button" onClick={() => onChange("")} aria-label={`Clear ${value}`}>
            {value}
            <span aria-hidden="true">x</span>
          </button>
        )}
          <input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={handleKeyDown}
          placeholder={value ? "Change selection" : placeholder}
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-autocomplete="list"
          />
        {open && (
          <div className="tag-suggestions" role="listbox">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectTag("")}
            >
              Any
            </button>
            {suggestions.length > 0 ? (
              suggestions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectTag(option)}
                >
                  {option}
                </button>
              ))
            ) : (
              <span className="tag-suggestions-empty">No matching options</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function recommendationManga(recommendation: Recommendation): MangaSummary {
  return {
    source: recommendation.source,
    id: recommendation.mangaId,
    title: recommendation.title,
    coverUrl: recommendation.coverUrl,
    contentRating: recommendation.contentRating,
    demographic: recommendation.demographic,
    latestChapter: recommendation.latestChapter,
    latestChapterReleasedAt: recommendation.latestChapterReleasedAt,
    tags: recommendation.tags ?? []
  };
}

function RecommendationList({
  recommendations,
  mode,
  showNsfw,
  onOpen,
  onMarkRead,
  onDelete
}: {
  recommendations: Recommendation[];
  mode: "inbox" | "outbox";
  showNsfw: boolean;
  onOpen: (recommendation: Recommendation) => void;
  onMarkRead?: (id: string) => void;
  onDelete: (recommendation: Recommendation) => void;
}) {
  if (!recommendations.length) {
    return <div className="notice">{mode === "inbox" ? "No recommendations received yet." : "No recommendations sent yet."}</div>;
  }

  return (
    <section className="recommendation-list">
      {recommendations.map((recommendation) => {
        const manga = recommendationManga(recommendation);
        const hiddenNsfw = mode === "inbox" && !showNsfw && isNsfw(manga);
        return (
          <article
            key={recommendation.id}
            className={[
              "recommendation-card",
              recommendation.readAt ? "" : "unread",
              hiddenNsfw ? "nsfw-recommendation" : ""
            ].filter(Boolean).join(" ")}
          >
            <button className="recommendation-cover" type="button" onClick={() => onOpen(recommendation)}>
              <Cover manga={manga} />
              {hiddenNsfw && <span className="nsfw-cover-badge">NSFW</span>}
              {!recommendation.readAt && mode === "inbox" && <span className="unread-dot" aria-label="Unread recommendation" />}
            </button>
            <div className="recommendation-body">
              <button className="recommendation-title" type="button" onClick={() => onOpen(recommendation)}>
                {hiddenNsfw ? censorNsfwTitle(recommendation.title, manga) : recommendation.title}
              </button>
              {hiddenNsfw && <span className="recommendation-nsfw-note">NSFW recommendation</span>}
	              <span>{mode === "inbox" ? `From ${recommendation.fromUsername}` : `To ${recommendation.toUsername}`}</span>
	              {recommendation.latestChapter && <span>Latest Ch. {recommendation.latestChapter}</span>}
	              <span>{formatRecommendationTime(recommendation.createdAt, mode)}</span>
	              {mode === "outbox" && <span>{recommendation.readAt ? "Read" : "Unread"}</span>}
              {mode === "inbox" && !recommendation.readAt && onMarkRead && (
                <button className="small-button recommendation-read-button" type="button" onClick={() => onMarkRead(recommendation.id)}>
                  Mark as read
                </button>
              )}
              <button className="small-button recommendation-delete-button" type="button" onClick={() => onDelete(recommendation)}>
                <TrashIcon />
                <span>Delete</span>
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function MessagesView({
  tab,
  recommendations,
  showNsfw,
  onTabChange,
  onOpenRecommendation,
  onMarkRecommendationRead,
  onMarkAllRecommendationsRead,
  onDeleteRecommendation,
  onClearRecommendations
}: {
  tab: "inbox" | "outbox";
  recommendations: { inbox: Recommendation[]; outbox: Recommendation[]; unread: number };
  showNsfw: boolean;
  onTabChange: (tab: "inbox" | "outbox") => void;
  onOpenRecommendation: (recommendation: Recommendation) => void;
  onMarkRecommendationRead: (id: string) => void;
  onMarkAllRecommendationsRead: () => void;
  onDeleteRecommendation: (recommendation: Recommendation) => void;
  onClearRecommendations: (box: "inbox" | "outbox") => void;
}) {
  return (
    <main className="content">
      <section className="section-heading">
        <h1>Messages</h1>
        <p>Title recommendations you sent and received.</p>
      </section>
      <div className="settings-tabs message-tabs" role="tablist" aria-label="Messages sections">
        <button
          className={tab === "inbox" ? "settings-tab active" : "settings-tab"}
          type="button"
          onClick={() => onTabChange("inbox")}
        >
          <span>Inbox</span>
          {recommendations.unread > 0 && <span className="tab-badge">{recommendations.unread}</span>}
        </button>
        <button
          className={tab === "outbox" ? "settings-tab active" : "settings-tab"}
          type="button"
          onClick={() => onTabChange("outbox")}
        >
          <span>Outbox</span>
        </button>
      </div>

      {tab === "inbox" && (
        <section className="settings-panel recommendations-panel">
          <div className="settings-panel-heading">
            <h2>Inbox</h2>
            <div className="panel-actions">
              <button className="small-button" type="button" onClick={onMarkAllRecommendationsRead} disabled={recommendations.unread === 0}>
                Mark all as read
              </button>
              <button className="small-button danger-lite-button" type="button" onClick={() => onClearRecommendations("inbox")} disabled={recommendations.inbox.length === 0}>
                Clear inbox
              </button>
            </div>
          </div>
          <RecommendationList
            recommendations={recommendations.inbox}
            mode="inbox"
            showNsfw={showNsfw}
            onOpen={onOpenRecommendation}
            onMarkRead={onMarkRecommendationRead}
            onDelete={onDeleteRecommendation}
          />
        </section>
      )}

      {tab === "outbox" && (
        <section className="settings-panel recommendations-panel">
          <div className="settings-panel-heading">
            <h2>Outbox</h2>
            <button className="small-button danger-lite-button" type="button" onClick={() => onClearRecommendations("outbox")} disabled={recommendations.outbox.length === 0}>
              Clear outbox
            </button>
          </div>
          <RecommendationList
            recommendations={recommendations.outbox}
            mode="outbox"
            showNsfw={showNsfw}
            onOpen={onOpenRecommendation}
            onDelete={onDeleteRecommendation}
          />
        </section>
      )}
    </main>
  );
}

function AccountView({
  user,
  source,
  sources,
  showNsfw,
  onUserUpdate,
  onShowNsfwChange,
  onFavoritesImported,
  onSourceChange,
  onSourcesLoaded,
  onShareUsersChanged
}: {
  user: AccountUser;
  source: string;
  sources: SourceInfo[];
  showNsfw: boolean;
  onUserUpdate: (user: AccountUser) => void;
  onShowNsfwChange: (showNsfw: boolean) => void;
  onFavoritesImported: (favorites: FavoriteManga[]) => void;
  onSourceChange: (source: string) => void;
  onSourcesLoaded: (sources: SourceInfo[]) => void;
  onShareUsersChanged: () => void;
}) {
  const [activeTab, setActiveTab] = useState(user.role === "admin" ? "admin" : "settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    changeAccountPassword(currentPassword, newPassword)
      .then(({ user: nextUser }) => {
        onUserUpdate(nextUser);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage("Password changed.");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function submitImport(event: FormEvent) {
    event.preventDefault();
    setImportMessage("");
    setImportError("");
    if (!importFile) {
      setImportError("Choose a CSV file.");
      return;
    }

    setImporting(true);
    importFile
      .text()
      .then(parseComickImport)
      .then(resolveImportedFavorites)
      .then(({ favorites, progress }) => importFavorites(favorites, progress))
      .then(({ favorites, imported }) => {
        onFavoritesImported(favorites);
        const unresolved = favorites.filter((item) => item.source === "external").length;
        setImportMessage(
          `${imported.favorites} bookmarks imported. ${imported.progress} read progress entries updated. ${unresolved} unmatched.`
        );
        setImportFile(null);
      })
      .catch((err: Error) => setImportError(err.message))
      .finally(() => setImporting(false));
  }

  const tabs = user.role === "admin" ? ["admin", "settings"] : ["settings"];

  return (
    <main className="content">
      <section className="section-heading">
        <h1>Settings</h1>
        <p>{user.username} - {user.role}</p>
      </section>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "settings-tab active" : "settings-tab"}
            type="button"
            onClick={() => setActiveTab(tab)}
          >
            <span>{tab}</span>
          </button>
        ))}
      </div>

      {activeTab === "settings" && (
        <>
          {user.nsfwAllowed && (
            <section className="settings-panel">
              <h2>Content</h2>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={showNsfw}
                  onChange={(event) => onShowNsfwChange(event.target.checked)}
                />
                <span>Show NSFW titles</span>
              </label>
            </section>
          )}
          <form className="settings-panel" onSubmit={submit}>
            <h2>Change password</h2>
            {message && <div className="notice success">{message}</div>}
            {error && <div className="notice error">{error}</div>}
            <label className="form-field">
              <span>Current password</span>
              <PasswordField value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            </label>
            <label className="form-field">
              <span>New password</span>
              <PasswordField value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            </label>
            <label className="form-field">
              <span>Confirm new password</span>
              <PasswordField value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
            </label>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Changing..." : "Change password"}
            </button>
          </form>

          <form className="settings-panel import-panel" onSubmit={submitImport}>
            <h2>Import bookmarks</h2>
            {importMessage && <div className="notice success">{importMessage}</div>}
            {importError && <div className="notice error">{importError}</div>}
            <label className="form-field">
              <span>CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button className="primary-button" type="submit" disabled={importing}>
              {importing ? "Importing..." : "Import bookmarks"}
            </button>
          </form>
        </>
      )}

      {activeTab === "admin" && user.role === "admin" && (
        <AdminView
          currentUser={user}
          source={source}
          sources={sources}
          onSourceChange={onSourceChange}
          onSourcesLoaded={onSourcesLoaded}
          onShareUsersChanged={onShareUsersChanged}
          onUserUpdate={onUserUpdate}
          onShowNsfwChange={onShowNsfwChange}
          embedded
        />
      )}

    </main>
  );
}

function AdminView({
  currentUser,
  source,
  sources,
  onSourceChange,
  onSourcesLoaded,
  onShareUsersChanged,
  onUserUpdate,
  onShowNsfwChange,
  embedded = false
}: {
  currentUser: AccountUser;
  source: string;
  sources: SourceInfo[];
  onSourceChange: (source: string) => void;
  onSourcesLoaded: (sources: SourceInfo[]) => void;
  onShareUsersChanged: () => void;
  onUserUpdate: (user: AccountUser) => void;
  onShowNsfwChange: (showNsfw: boolean) => void;
  embedded?: boolean;
}) {
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [interactionBlocks, setInteractionBlocks] = useState<UserInteractionBlock[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [blockUserAId, setBlockUserAId] = useState("");
  const [blockUserBId, setBlockUserBId] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [userPage, setUserPage] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
	  const [sourceError, setSourceError] = useState("");
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
	  const [loading, setLoading] = useState(true);
	  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
	  const activeSource = sources.find((item) => item.id === source);
  const userPageCount = Math.max(Math.ceil(users.length / ADMIN_USERS_PAGE_SIZE), 1);
  const visibleUsers = users.slice(userPage * ADMIN_USERS_PAGE_SIZE, (userPage + 1) * ADMIN_USERS_PAGE_SIZE);
  const userStart = users.length ? userPage * ADMIN_USERS_PAGE_SIZE + 1 : 0;
  const userEnd = Math.min((userPage + 1) * ADMIN_USERS_PAGE_SIZE, users.length);

  function loadUsers() {
    setLoading(true);
    setError("");
    Promise.all([fetchUsers(), fetchInteractionBlocks()])
      .then(([userResult, blockResult]) => {
        setUsers(userResult.users);
        setInteractionBlocks(blockResult.blocks);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setUserPage((current) => Math.min(current, Math.max(Math.ceil(users.length / ADMIN_USERS_PAGE_SIZE) - 1, 0)));
  }, [users.length]);

	  useEffect(() => {
	    setSourceError("");
	    fetchSources()
      .then(({ sources: nextSources }) => {
        onSourcesLoaded(nextSources);
        const enabledSources = nextSources.filter((item) => item.enabled);
        if (enabledSources[0] && !enabledSources.some((item) => item.id === source)) {
          onSourceChange(enabledSources[0].id);
        }
      })
	      .catch((err: Error) => setSourceError(err.message));
	  }, [onSourceChange, onSourcesLoaded, source]);

  function refreshSourceHealth() {
    setHealthLoading(true);
    setSourceError("");
    fetchSourceHealth()
      .then(({ sources }) => setSourceHealth(sources))
      .catch((err: Error) => setSourceError(err.message))
      .finally(() => setHealthLoading(false));
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    createAccount(username, password, role)
      .then(({ user }) => {
        setUsers((current) => [user, ...current]);
        setUsername("");
        setPassword("");
        setRole("user");
        setMessage(`Created ${user.username}.`);
      })
      .catch((err: Error) => setError(err.message));
  }

  function submitInteractionBlock(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    addInteractionBlock(blockUserAId, blockUserBId)
      .then(({ blocks }) => {
        setInteractionBlocks(blocks);
        setBlockUserAId("");
        setBlockUserBId("");
        setMessage("User interaction disabled.");
        onShareUsersChanged();
      })
      .catch((err: Error) => setError(err.message));
  }

  function requestRemoveInteractionBlock(block: UserInteractionBlock) {
    setMessage("");
    setError("");
    setConfirmDialog({
      title: "Enable interaction?",
      message: `Allow "${block.userAUsername}" and "${block.userBUsername}" to see and recommend titles to each other again?`,
      confirmLabel: "Enable interaction",
      onConfirm: () => {
        setConfirmDialog(null);
        removeInteractionBlock(block.id)
          .then(({ blocks }) => {
            setInteractionBlocks(blocks);
            setMessage("User interaction enabled.");
            onShareUsersChanged();
          })
          .catch((err: Error) => setError(err.message));
      }
    });
  }

  function submitReset(user: AccountUser) {
    setMessage("");
    setError("");
    resetUserPassword(user.id, resetPasswords[user.id] || "")
      .then(() => {
        setResetPasswords((current) => ({ ...current, [user.id]: "" }));
        setMessage(`Password reset for ${user.username}.`);
        loadUsers();
      })
      .catch((err: Error) => setError(err.message));
  }

  function requestDelete(user: AccountUser) {
    setMessage("");
    setError("");
    setConfirmDialog({
      title: "Delete user?",
      message: `Delete "${user.username}" and all of their bookmarks and reading history? This cannot be undone.`,
      confirmLabel: "Delete user",
      variant: "danger",
      onConfirm: () => {
        setConfirmDialog(null);
        deleteAccount(user.id)
          .then(({ users: nextUsers }) => {
            setUsers(nextUsers);
            setMessage(`Deleted ${user.username}.`);
          })
          .catch((err: Error) => setError(err.message));
      }
    });
  }

  function toggleUserNsfw(user: AccountUser, nsfwAllowed: boolean) {
    setMessage("");
    setError("");
    updateUserNsfwAllowed(user.id, nsfwAllowed)
      .then(({ user: updatedUser, users: nextUsers }) => {
        setUsers(nextUsers);
        setMessage(`${updatedUser.username} ${updatedUser.nsfwAllowed ? "can access" : "cannot access"} NSFW content.`);
        if (updatedUser.id === currentUser.id) {
          onUserUpdate(updatedUser);
          if (!updatedUser.nsfwAllowed) onShowNsfwChange(false);
        }
      })
      .catch((err: Error) => setError(err.message));
  }

  const content = (
    <>
      {confirmDialog && <ConfirmModal dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />}
      <section className="section-heading">
        <h1>Admin</h1>
        <p>Create users and reset account passwords.</p>
      </section>

      <section className="settings-panel source-tools">
        <h2>Source tools</h2>
        {sourceError && <div className="notice error">{sourceError}</div>}
        <label className="form-field source-select">
          <span>Browse source</span>
          <select value={source} onChange={(event) => onSourceChange(event.target.value)}>
            {sources.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.enabled}>
                {item.name}{item.enabled ? "" : " (pending)"}
              </option>
            ))}
          </select>
        </label>
        {activeSource?.note && <div className="notice source-note">{activeSource.note}</div>}
	        <section className="source-grid" aria-label="Source status">
	          {sources.map((item) => (
            <article key={item.id} className={item.enabled ? "source-card enabled" : "source-card"}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.kind}</span>
              </div>
              <p>{item.enabled ? item.note || "Enabled" : item.disabledReason}</p>
            </article>
	          ))}
	        </section>
        <div className="settings-panel-heading">
          <h3>Source health</h3>
          <button className="small-button" type="button" onClick={refreshSourceHealth} disabled={healthLoading}>
            {healthLoading ? "Checking..." : "Check now"}
          </button>
        </div>
        {sourceHealth.length > 0 && (
          <section className="source-grid" aria-label="Live source health">
            {sourceHealth.map((item) => (
              <article key={item.id} className={item.ok ? "source-card enabled" : "source-card source-card-error"}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.ok ? `${item.latencyMs} ms` : "down"}</span>
                </div>
                <p>{item.ok ? item.sampleTitle || "Search check passed." : item.error}</p>
              </article>
            ))}
          </section>
        )}
	      </section>

      <section className="admin-layout">
        <form className="settings-panel" onSubmit={submitCreate}>
          <h2>Create account</h2>
          {message && <div className="notice success">{message}</div>}
          {error && <div className="notice error">{error}</div>}
          <label className="form-field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
          </label>
          <label className="form-field">
            <span>Password</span>
            <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />
          </label>
          <label className="form-field">
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            Create account
          </button>
        </form>

        <section className="settings-panel users-management-panel">
          <div className="settings-panel-heading">
            <div>
              <h2>Users</h2>
              <p className="muted-text">{users.length ? `${userStart} - ${userEnd} of ${users.length}` : "No users yet"}</p>
            </div>
            {userPageCount > 1 && (
              <div className="pagination-controls admin-users-pagination">
                <button type="button" onClick={() => setUserPage((current) => Math.max(current - 1, 0))} disabled={userPage === 0}>
                  Previous
                </button>
                <span>Page {userPage + 1}</span>
                <button
                  type="button"
                  onClick={() => setUserPage((current) => Math.min(current + 1, userPageCount - 1))}
                  disabled={userPage >= userPageCount - 1}
                >
                  Next
                </button>
              </div>
            )}
          </div>
          {loading && <LoadingNotice label="Loading users" />}
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>NSFW</th>
                  <th>Reset password</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.username}</strong>
                    </td>
                    <td>
                      <span className="role-pill">{user.role}</span>
                    </td>
                    <td>
                      <label className="inline-toggle user-nsfw-toggle compact-toggle">
                        <input
                          type="checkbox"
                          checked={user.nsfwAllowed}
                          onChange={(event) => toggleUserNsfw(user, event.target.checked)}
                        />
                        <span>Allowed</span>
                      </label>
                    </td>
                    <td>
                      <div className="reset-row">
                        <PasswordField
                          value={resetPasswords[user.id] || ""}
                          onChange={(value) => setResetPasswords((current) => ({ ...current, [user.id]: value }))}
                          placeholder="New password"
                          autoComplete="new-password"
                        />
                        <button className="small-button" type="button" onClick={() => submitReset(user)}>
                          Reset
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className="danger-user-button"
                        type="button"
                        onClick={() => requestDelete(user)}
                        disabled={user.id === currentUser.id}
                        title={user.id === currentUser.id ? "You cannot delete your own active account." : "Delete user"}
                      >
                        <TrashIcon />
                        <span>Delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleUsers.length && !loading && <div className="notice">No users found.</div>}
          </div>
          <div className="admin-user-cards">
            {visibleUsers.map((user) => (
              <article className="admin-user-card" key={user.id}>
                <div className="admin-user-card-header">
                  <div>
                    <strong>{user.username}</strong>
                    <span>{user.role}</span>
                  </div>
                  <label className="inline-toggle user-nsfw-toggle compact-toggle">
                    <input
                      type="checkbox"
                      checked={user.nsfwAllowed}
                      onChange={(event) => toggleUserNsfw(user, event.target.checked)}
                    />
                    <span>NSFW</span>
                  </label>
                </div>
                <div className="user-actions-row">
                  <div className="reset-row">
                    <PasswordField
                      value={resetPasswords[user.id] || ""}
                      onChange={(value) => setResetPasswords((current) => ({ ...current, [user.id]: value }))}
                      placeholder="New password"
                      autoComplete="new-password"
                    />
                    <button className="small-button" type="button" onClick={() => submitReset(user)}>
                      Reset
                    </button>
                  </div>
                  <button
                    className="danger-user-button"
                    type="button"
                    onClick={() => requestDelete(user)}
                    disabled={user.id === currentUser.id}
                    title={user.id === currentUser.id ? "You cannot delete your own active account." : "Delete user"}
                  >
                    <TrashIcon />
                    <span>Delete</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="settings-panel">
          <h2>User interaction</h2>
          <p className="muted-text">Disabled pairs cannot see each other in Share, and recommendation requests are blocked both ways.</p>
          <form className="interaction-block-form" onSubmit={submitInteractionBlock}>
            <label className="form-field">
              <span>User A</span>
              <select value={blockUserAId} onChange={(event) => setBlockUserAId(event.target.value)}>
                <option value="">Choose user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.username}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>User B</span>
              <select value={blockUserBId} onChange={(event) => setBlockUserBId(event.target.value)}>
                <option value="">Choose user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.username}</option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={!blockUserAId || !blockUserBId || blockUserAId === blockUserBId}>
              Disable interaction
            </button>
          </form>
          <div className="user-list interaction-block-list">
            {interactionBlocks.map((block) => (
              <article className="user-row" key={block.id}>
                <div>
                  <strong>{block.userAUsername} / {block.userBUsername}</strong>
                  <span>Added by {block.createdByUsername}</span>
                </div>
                <button className="small-button" type="button" onClick={() => requestRemoveInteractionBlock(block)}>
                  Enable
                </button>
              </article>
            ))}
            {!interactionBlocks.length && !loading && <div className="notice">No disabled user pairs.</div>}
          </div>
        </section>
      </section>
    </>
  );

  return embedded ? <section className="account-admin-tools">{content}</section> : <main className="content">{content}</main>;
}

function DetailView({
  source,
  id,
  favorites,
  readingProgress,
  showNsfw,
  shareUsers,
  onFavorite,
  onRead,
  onShare,
  onTagSearch,
  onOpenSimilar
}: {
  source: string;
  id: string;
  favorites: FavoriteManga[];
  readingProgress: ReadingProgress[];
  showNsfw: boolean;
  shareUsers: AccountUser[];
  onFavorite: (manga: MangaSummary) => void;
  onRead: (chapter: ChapterSummary, scrollPosition?: number) => void;
  onShare: (manga: MangaSummary, toUserId: string) => Promise<void>;
  onTagSearch: (tag: string) => void;
  onOpenSimilar: (manga: MangaSummary) => void;
}) {
  const [manga, setManga] = useState<MangaDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [chaptersError, setChaptersError] = useState("");
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [altTitlesExpanded, setAltTitlesExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [chapterPage, setChapterPage] = useState(0);
  const [chapterSort, setChapterSort] = useState<ChapterSortMode>("chapter-desc");
  const [similarTitles, setSimilarTitles] = useState<MangaSummary[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUserId, setShareUserId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [nsfwShareUserId, setNsfwShareUserId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setManga(null);
    fetchManga(source, id, { mirrors: false })
      .then((mangaResult) => {
        if (!cancelled) {
          setManga(mangaResult.manga);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    setChapters([]);
    setChaptersError("");
    setChaptersLoading(true);
    fetchChapters(source, id)
      .then((chapterResult) => {
        if (cancelled) return;
        setChapters(chapterResult.chapters);
        if (source === "comix" && chapterResult.chapters.length === 20) {
          refreshTimer = setTimeout(() => {
            fetchChapters(source, id)
              .then((refreshed) => {
                if (!cancelled && refreshed.chapters.length > chapterResult.chapters.length) setChapters(refreshed.chapters);
              })
              .catch(() => undefined);
          }, 20000);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setChaptersError(err.message);
      })
      .finally(() => {
        if (!cancelled) setChaptersLoading(false);
      });
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [source, id]);

  const chapterGroups = useMemo(() => sortChapterGroups(groupChaptersByNumber(chapters), chapterSort), [chapters, chapterSort]);

	  useEffect(() => {
	    setSynopsisExpanded(false);
    setAltTitlesExpanded(false);
    setTagsExpanded(false);
    setFactsExpanded(false);
    setChapterPage(0);
    setShareOpen(false);
    setShareUserId("");
    setShareMessage("");
    setShareError("");
    setNsfwShareUserId("");
	  }, [source, id]);

  useEffect(() => {
    setChapterPage(0);
  }, [chapterSort]);

  useEffect(() => {
    let cancelled = false;
    setSimilarTitles([]);
    setSimilarError("");
    setSimilarLoading(false);

    const loadSimilarTitles = () => {
      if (cancelled) return;
      setSimilarLoading(true);
      fetchSimilarManga(source, id)
        .then(({ manga }) => {
          if (!cancelled) setSimilarTitles(manga);
        })
        .catch((err: Error) => {
          if (!cancelled) setSimilarError(err.message);
        })
        .finally(() => {
          if (!cancelled) setSimilarLoading(false);
        });
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const usedIdleCallback = Boolean(idleWindow.requestIdleCallback);
    const idleId = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(loadSimilarTitles, { timeout: 2500 })
      : window.setTimeout(loadSimilarTitles, 1200);

    return () => {
      cancelled = true;
      if (usedIdleCallback && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [source, id]);

  useEffect(() => {
    const maxPage = Math.max(Math.ceil(chapterGroups.length / CHAPTER_PAGE_SIZE) - 1, 0);
    setChapterPage((current) => Math.min(current, maxPage));
  }, [chapterGroups.length]);

  if (loading) {
    return <main className="content loading-content"><LoadingNotice label="Loading title" page /></main>;
  }

  if (error || !manga) {
    return <main className="content"><div className="notice error">{error || "Title not found."}</div></main>;
  }

  if (!showNsfw && isNsfw(manga)) {
    return <main className="content"><div className="notice">This title is hidden by your NSFW filter.</div></main>;
  }

  const favorite =
    isFavorite(favorites, manga.source, manga.id) ||
    favorites.some((item) => manga.canonicalKey && item.canonicalKey === manga.canonicalKey);
  const bookmark =
    favorites.find((item) => item.source === manga.source && item.id === manga.id) ??
    favorites.find((item) => manga.canonicalKey && item.canonicalKey === manga.canonicalKey);
  const progress =
    readingProgress.find((item) => item.source === manga.source && item.mangaId === manga.id) ??
    readingProgress.find((item) => manga.canonicalKey && item.canonicalKey === manga.canonicalKey);
  const lastReadChapterId = bookmark?.lastReadChapterId ?? progress?.chapterId;
  const lastReadChapterNumber = bookmark?.lastReadChapter ?? progress?.chapterNumber;
  const preferredProgressSource = progress?.chapterSource ?? progress?.source ?? bookmark?.source;
  const lastReadChapter =
    chapters.find((chapter) => chapter.id === lastReadChapterId && (!preferredProgressSource || chapter.source === preferredProgressSource)) ??
    chapters.find((chapter) => chapter.id === lastReadChapterId) ??
    chapters.find(
      (chapter) =>
        (chapter.chapter === lastReadChapterId || chapter.chapter === lastReadChapterNumber) &&
        (!preferredProgressSource || chapter.source === preferredProgressSource)
    ) ??
    chapters.find((chapter) => chapter.chapter === lastReadChapterId || chapter.chapter === lastReadChapterNumber);
  const firstChapter = firstReadableChapter(chapters);
  const readTarget = lastReadChapter ?? firstChapter;
  const readLabel = lastReadChapter ? `Continue ${formatChapter(lastReadChapter)}` : "Start reading";
  const readScrollPosition = lastReadChapter ? bookmark?.lastReadScrollPosition ?? progress?.scrollPosition : undefined;
  const otherNames = manga.altTitles.filter((title) => title && title !== manga.title).slice(0, 8);
  const genres = mangaGenres(manga);
  const categoryTags = mangaCategoryTags(manga);
  const metadataUrl = metadataSourceUrl(manga);
  const detailFacts = [
    { label: "Artist", value: joinValues(manga.artists) },
    { label: "Author", value: joinValues(manga.authors) },
    { label: "Publisher", value: joinValues(manga.publishers) },
    { label: "Type", value: displayType(manga.demographic) },
    { label: "Release Year", value: manga.year ? String(manga.year) : undefined },
    { label: "Content Rating", value: displayStatus(manga.contentRating) },
    { label: "Language", value: manga.language || "English" },
    { label: "Metadata Source", value: manga.metadataSource, href: metadataUrl },
    { label: "Metadata Updated", value: displayMetadataDate(manga.metadataUpdatedAt) }
  ].filter((item) => Boolean(item.value));
  const chapterPageCount = Math.max(Math.ceil(chapterGroups.length / CHAPTER_PAGE_SIZE), 1);
  const visibleChapterGroups = chapterGroups.slice(chapterPage * CHAPTER_PAGE_SIZE, (chapterPage + 1) * CHAPTER_PAGE_SIZE);
  const chapterStart = chapterPage * CHAPTER_PAGE_SIZE + 1;
  const chapterEnd = Math.min((chapterPage + 1) * CHAPTER_PAGE_SIZE, chapterGroups.length);
  const showChapterPagination = chapterPageCount > 1;
  const titleBackdropUrl = proxiedImageUrl(manga.coverUrl);
  const titleBackdropStyle = titleBackdropUrl
    ? ({ "--title-backdrop": `url("${titleBackdropUrl.replace(/"/g, "%22")}")` } as CSSProperties)
    : undefined;
  const titleIsNsfw = isNsfw(manga);
  const eligibleShareUsers = titleIsNsfw ? shareUsers.filter((item) => item.nsfwAllowed) : shareUsers;

	  function ChapterPagination() {
    if (!showChapterPagination) return null;
    return (
      <div className="pagination-controls chapter-pagination" aria-label="Chapter list pagination">
        <button type="button" onClick={() => setChapterPage((current) => Math.max(current - 1, 0))} disabled={chapterPage === 0}>
          Previous
        </button>
        <span>{chapterGroups.length ? `${chapterStart} - ${chapterEnd} of ${chapterGroups.length}` : "0 of 0"}</span>
        <button
          type="button"
          onClick={() => setChapterPage((current) => Math.min(current + 1, chapterPageCount - 1))}
          disabled={chapterPage >= chapterPageCount - 1}
        >
          Next
        </button>
      </div>
    );
	  }

	  function submitShare(event: FormEvent) {
	    event.preventDefault();
    if (!manga) return;
	    if (!shareUserId) {
	      setShareError("Choose a user.");
      return;
    }

    if (!eligibleShareUsers.some((item) => item.id === shareUserId)) {
      setShareError("That user cannot receive this recommendation.");
      return;
    }

    if (titleIsNsfw) {
      setNsfwShareUserId(shareUserId);
      return;
    }

    sendShare(shareUserId);
  }

  function sendShare(toUserId: string) {
    if (!manga) return;
    setShareLoading(true);
    setShareMessage("");
    setShareError("");
    onShare(manga, toUserId)
      .then(() => {
        const recipient = eligibleShareUsers.find((item) => item.id === toUserId);
        setShareMessage(`Recommended to ${recipient?.username ?? "user"}.`);
        setShareOpen(false);
        setShareUserId("");
        setNsfwShareUserId("");
      })
      .catch((err: Error) => setShareError(err.message))
      .finally(() => setShareLoading(false));
  }

  return (
    <main className={titleBackdropUrl ? "content title-page-content has-backdrop" : "content title-page-content"} style={titleBackdropStyle}>
      {nsfwShareUserId && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="nsfw-share-title">
            <h2 id="nsfw-share-title">Send NSFW recommendation?</h2>
            <p>
              This title is marked as NSFW. The recipient may have NSFW content turned off and may not be able to access it.
            </p>
            <div className="modal-actions">
              <button className="small-button" type="button" onClick={() => setNsfwShareUserId("")}>Cancel</button>
              <button className="danger-confirm-button" type="button" onClick={() => sendShare(nsfwShareUserId)} disabled={shareLoading}>
                {shareLoading ? "Sending..." : "Send anyway"}
              </button>
            </div>
          </section>
        </div>
      )}
      {shareOpen && !nsfwShareUserId && (
        <div className="modal-backdrop" role="presentation">
          <form className="confirm-modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onSubmit={submitShare}>
            <h2 id="share-title">Share title</h2>
            <p>Recommend "{manga.title}" to another user.</p>
            {shareError && <div className="notice error share-notice">{shareError}</div>}
            <label className="form-field">
              <span>Recommend to</span>
              <select value={shareUserId} onChange={(event) => setShareUserId(event.target.value)}>
                <option value="">Select user</option>
                {eligibleShareUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </label>
            {eligibleShareUsers.length === 0 && (
              <span className="share-empty">
                {titleIsNsfw ? "No users are allowed to receive NSFW recommendations." : "No other users are available."}
              </span>
            )}
            <div className="modal-actions">
              <button
                className="small-button"
                type="button"
                onClick={() => {
                  setShareOpen(false);
                  setShareUserId("");
                  setShareError("");
                }}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={shareLoading || eligibleShareUsers.length === 0}>
                {shareLoading ? "Sharing..." : "Send recommendation"}
              </button>
            </div>
          </form>
        </div>
      )}
      <section className="detail-layout">
        <aside className="title-cover-panel">
          <Cover manga={manga} />
          <div className="bookmark-cover-actions">
            {favorite ? (
              <button
                className="danger-bookmark-button"
                type="button"
                onClick={() => onFavorite(manga)}
              >
                <TrashIcon />
                <span>Remove bookmark</span>
              </button>
            ) : (
              <button className="bookmark-add-button" type="button" onClick={() => onFavorite(manga)}>
                <BookmarkIcon active={false} />
                <span>Add bookmark</span>
              </button>
            )}
            <button
              className="share-title-button"
              type="button"
              onClick={() => {
                setShareError("");
                setShareOpen(true);
              }}
            >
              <ShareIcon />
              <span>Share</span>
            </button>
          </div>
          {shareMessage && <div className="notice success share-notice">{shareMessage}</div>}
        </aside>

        <article className="title-info">
          <h1>{manga.title}</h1>
          <TitleRating manga={manga} />
          {otherNames.length > 0 && (
            <section className="title-detail-section known-names-block">
              <h2>Alternate names</h2>
              <p className={altTitlesExpanded ? "known-names expanded" : "known-names"}>{otherNames.join(", ")}</p>
              <button className="text-toggle-button alt-title-toggle" type="button" onClick={() => setAltTitlesExpanded((expanded) => !expanded)}>
                {altTitlesExpanded ? "Show less" : "Show more"}
              </button>
            </section>
          )}
          {manga.status && (
            <section className="title-detail-section status-section">
              <h2>Status</h2>
              <span className={statusClassName(manga.status)}>{displayStatus(manga.status)}</span>
            </section>
          )}
          <section className="title-detail-section synopsis-section">
            <h2>Synopsis</h2>
            <p className={synopsisExpanded ? "synopsis expanded" : "synopsis"}>{manga.description || "No synopsis available."}</p>
            <button className="text-toggle-button synopsis-toggle" type="button" onClick={() => setSynopsisExpanded((expanded) => !expanded)}>
              {synopsisExpanded ? "Show less" : "Show more"}
            </button>
          </section>
          {genres.length > 0 && (
            <section className="title-detail-section">
              <h2>Genre</h2>
              <div className="tag-row genre-tags">
                {genres.map((tag) => (
                  <button key={tag} type="button" onClick={() => onTagSearch(tag)}>{tag}</button>
                ))}
              </div>
            </section>
          )}
          {categoryTags.length > 0 && (
            <section className="title-detail-section">
              <h2>Categories</h2>
              <div className={tagsExpanded ? "tag-row category-tags expanded" : "tag-row category-tags"}>
                {categoryTags.map((tag) => (
                  <button key={tag} type="button" onClick={() => onTagSearch(tag)}>{tag}</button>
                ))}
              </div>
              <button className="text-toggle-button tags-toggle" type="button" onClick={() => setTagsExpanded((expanded) => !expanded)}>
                {tagsExpanded ? "Show less" : "Show more"}
              </button>
            </section>
          )}
        </article>

        {detailFacts.length > 0 && (
          <button className="mobile-toggle-button facts-toggle" type="button" onClick={() => setFactsExpanded((expanded) => !expanded)}>
            {factsExpanded ? "Hide details" : "Show details"}
          </button>
        )}

        <aside className={factsExpanded ? "detail-facts expanded" : "detail-facts"} aria-label="Details">
          <h2>Details</h2>
          {detailFacts.map((fact) => (
            <div className="fact-card" key={fact.label}>
              <span>{fact.label}</span>
              {fact.href ? (
                <a className="fact-value" href={fact.href} target="_blank" rel="noreferrer">{fact.value}</a>
              ) : (
                <span className="fact-value">{fact.value}</span>
              )}
            </div>
          ))}
        </aside>

	      <div className="title-actions">
	        {readTarget && (
	          <button className="primary-button read-primary-button" onClick={() => onRead(readTarget, readScrollPosition)}>
	            {readLabel}
	          </button>
          )}
	      </div>
      </section>

      <section className="chapter-list">
        <div className="section-heading compact chapter-list-heading">
          <div className="chapter-heading-row">
            <h2>Chapters</h2>
            {!chaptersLoading && !chaptersError && (
              <button
                className="chapter-sort-toggle"
                type="button"
                onClick={() => setChapterSort((current) => (current === "chapter-desc" ? "chapter-asc" : "chapter-desc"))}
                aria-label={chapterSort === "chapter-desc" ? "Sort chapters low to high" : "Sort chapters high to low"}
                title={chapterSort === "chapter-desc" ? "Chapter: high to low" : "Chapter: low to high"}
              >
                <SortArrowIcon direction={chapterSort === "chapter-desc" ? "down" : "up"} />
              </button>
            )}
          </div>
        </div>
        {chaptersError && <div className="notice error">Chapter list could not be loaded: {chaptersError}</div>}
        {chaptersLoading && <LoadingNotice label="Loading chapters" />}
        {!chaptersLoading && !chaptersError && <ChapterPagination />}
	        <div className="chapter-table">
	          {!chaptersLoading && !chaptersError && visibleChapterGroups.map((group) => {
              const choices = dedupeChapterChoices(group.chapters, lastReadChapter?.id);
	            const groupLastRead = choices.some((chapter) => chapter.id === lastReadChapter?.id);
              const releaseDate = formatReleaseDate(group.releasedAt);
	            if (choices.length === 1) {
	              const chapter = choices[0];
	              return (
                <button
                  key={group.key}
                  className={groupLastRead ? "chapter-list-row single-source last-read" : "chapter-list-row single-source"}
                  type="button"
                  onClick={() => onRead(chapter)}
                >
                  <span className="chapter-list-top">
                    <span className="chapter-list-main">
                      <span className="chapter-list-title">{group.label}</span>
                      {releaseDate && <span className="chapter-list-date">Released {releaseDate}</span>}
                    </span>
                    {groupLastRead && <span className="last-read-pill">Last read<span aria-hidden="true" /></span>}
                  </span>
                  <span className="chapter-list-sources">
                    <span className="source-choice static">{chapterSourceLabel(chapter)}</span>
                  </span>
                </button>
              );
            }

            return (
              <article key={group.key} className={groupLastRead ? "chapter-list-row multi-source last-read" : "chapter-list-row multi-source"}>
                <div className="chapter-list-top">
                  <div className="chapter-list-main">
                    <span className="chapter-list-title">{group.label}</span>
                    {releaseDate && <span className="chapter-list-date">Released {releaseDate}</span>}
                  </div>
                  {groupLastRead && <span className="last-read-pill">Last read<span aria-hidden="true" /></span>}
                </div>
                <div className="chapter-list-sources" aria-label={`${group.label} sources`}>
	                  {choices.map((chapter) => (
                    <button
                      key={chapter.id}
                      className={chapter.id === lastReadChapter?.id ? "source-choice active" : "source-choice"}
                      type="button"
                      onClick={() => onRead(chapter)}
                    >
                      {chapterSourceLabel(chapter)}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
        {!chaptersLoading && !chaptersError && <ChapterPagination />}
        {!chaptersLoading && !chaptersError && !chapterGroups.length && <div className="notice">No hosted image chapters are available for this title.</div>}
      </section>

      {(similarLoading || similarTitles.length > 0 || similarError) && (
        <section className="similar-titles">
          <div className="section-heading compact">
            <h2>Similar Titles</h2>
          </div>
          {similarError && <div className="notice error">{similarError}</div>}
          {similarLoading && !similarTitles.length && <MangaGridSkeleton count={12} rail />}
          {similarTitles.length > 0 && (
            <RailScroller className="grid rail-grid">
              {similarTitles
              .filter((candidate) => showNsfw || !isNsfw(candidate))
              .filter((candidate) => {
                if (candidate.source === manga.source && candidate.id === manga.id) return false;
                if (candidate.canonicalKey && manga.canonicalKey && candidate.canonicalKey === manga.canonicalKey) return false;
                return true;
              })
              .map((candidate) => (
                <MangaCard
                  key={`similar:${candidate.source}:${candidate.id}`}
                  manga={candidate}
                  favorite={isFavorite(favorites, candidate.source, candidate.id)}
                  detailOrder="title-first"
                  onOpen={() => onOpenSimilar(candidate)}
                  onFavorite={() => onFavorite(candidate)}
                />
              ))}
            </RailScroller>
          )}
        </section>
      )}
    </main>
  );
}

function ReaderView({
  source,
  mangaId,
  chapterId,
  chapterNumber,
  initialScrollPosition,
  readingProgress,
  navHidden,
  onHome,
  onBack,
  onChapterChange,
  onToggleNavHidden,
  onReaderPosition,
  onRemember
}: {
  source: string;
  mangaId: string;
  chapterId: string;
  chapterNumber?: string;
  initialScrollPosition?: number;
  readingProgress: ReadingProgress[];
  navHidden: boolean;
  onHome: () => void;
  onBack: () => void;
  onChapterChange: (chapter: ChapterSummary) => void;
  onToggleNavHidden: () => void;
  onReaderPosition: (position: ActiveReaderPosition) => void;
  onRemember: (source: string, mangaId: string, chapterId: string, chapterNumber?: string, scrollPosition?: number, canonicalKey?: string, title?: string, chapterSource?: string) => void;
}) {
  const [pages, setPages] = useState<ChapterPages | null>(null);
  const [manga, setManga] = useState<MangaDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [error, setError] = useState("");
  const [chapterError, setChapterError] = useState("");
  const loadedPageCount = useRef(0);
  const [resumeScrollPosition, setResumeScrollPosition] = useState<number | undefined>(initialScrollPosition);
  const restoredScrollKey = useRef("");
  const lastSavedScroll = useRef<number | undefined>(undefined);
  const lastRemoteSavedScroll = useRef<number | undefined>(undefined);
  const lastRemoteSaveAt = useRef(0);
  const initialChapterSavedKey = useRef("");
  const latestReaderScroll = useRef(0);
  const lastUserScrollIntentAt = useRef(0);
  const touchStartX = useRef<number | null>(null);
  const lastPagedSwipeAt = useRef(0);
  const widthSliderActive = useRef(false);
  const widthSliderTrack = useRef<HTMLDivElement | null>(null);
  const failedAutoFallbackKey = useRef("");
  const restoreReady = useRef(false);
  const restoreCancelled = useRef(false);
  const skipUnmountSave = useRef(false);
  const savedProgress = readingProgress.find((item) => item.source === source && item.mangaId === mangaId);
  const [mobileControlsVisible, setMobileControlsVisible] = useState(false);
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [readerDirection, setReaderDirection] = useState<ReaderDirection>("top-to-bottom");
  const [readerPageMode, setReaderPageMode] = useState<ReaderPageMode>("single");
  const [progressPosition, setProgressPosition] = useState<ReaderProgressPosition>("bottom");
  const [readerPageWidth, setReaderPageWidth] = useState(loadReaderPageWidth);
  const [pagedPageIndex, setPagedPageIndex] = useState(0);
  const [readerPercent, setReaderPercent] = useState(0);
  const [readerTipVisible, setReaderTipVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPages(null);
    loadedPageCount.current = 0;
    fetchChapterPages(source, chapterId, mangaId, chapterNumber)
      .then((result) => {
        if (!cancelled) {
          setPages(result);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, chapterId]);

  useEffect(() => {
    setResumeScrollPosition(initialScrollPosition);
  }, [source, mangaId, chapterId, initialScrollPosition]);

  useEffect(() => {
    if (resumeScrollPosition !== undefined) return;
    if (savedProgress?.chapterId !== chapterId || savedProgress.scrollPosition === undefined) return;
    setResumeScrollPosition(savedProgress.scrollPosition);
  }, [resumeScrollPosition, savedProgress?.chapterId, savedProgress?.scrollPosition, chapterId]);

  useEffect(() => {
    if (!pages) return;
    const key = `${source}:${mangaId}:${chapterId}:${manga?.canonicalKey ?? ""}`;
    if (initialChapterSavedKey.current === key) return;
    initialChapterSavedKey.current = key;
    lastRemoteSaveAt.current = Date.now();
    lastRemoteSavedScroll.current = resumeScrollPosition ?? 0;
    saveReadingProgress(source, mangaId, chapterId, chapterNumber, resumeScrollPosition, manga?.canonicalKey, manga?.title, source).catch(() => undefined);
  }, [pages, source, mangaId, chapterId, chapterNumber, resumeScrollPosition, manga?.canonicalKey, manga?.title]);

  useEffect(() => {
    lastSavedScroll.current = resumeScrollPosition ?? 0;
    lastRemoteSavedScroll.current = resumeScrollPosition ?? 0;
    lastRemoteSaveAt.current = 0;
    latestReaderScroll.current = currentScrollPosition();
    restoreReady.current = !resumeScrollPosition || resumeScrollPosition <= 0;
    restoreCancelled.current = false;
    restoredScrollKey.current = "";
  }, [source, mangaId, chapterId, resumeScrollPosition]);

  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChaptersLoading(true);
    setChapterError("");
    Promise.all([fetchManga(source, mangaId), fetchChapters(source, mangaId)])
      .then(([mangaResult, chapterResult]) => {
        if (!cancelled) {
          setManga(mangaResult.manga);
          setChapters(chapterResult.chapters);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setChapterError(err.message);
      })
      .finally(() => {
        if (!cancelled) setChaptersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, mangaId]);

  const orderedChapterGroups = useMemo(() => {
    return groupChaptersByNumber(chapters)
      .map((group, index) => ({ group, index }))
      .sort((left, right) => {
        if (left.group.sortValue !== undefined && right.group.sortValue !== undefined && left.group.sortValue !== right.group.sortValue) {
          return left.group.sortValue - right.group.sortValue;
        }
        if (left.group.sortValue !== undefined) return -1;
        if (right.group.sortValue !== undefined) return 1;
        return left.index - right.index;
      })
      .map(({ group }) => group);
  }, [chapters]);
  const currentChapter =
    chapters.find((chapter) => chapter.id === chapterId && chapter.source === source) ??
    chapters.find((chapter) => chapter.id === chapterId);
  const titleType = (manga?.demographic ?? "").toLowerCase();
  const titleLooksLikeManga = titleType.includes("manga") && !titleType.includes("manhwa") && !titleType.includes("manhua");
  const currentValue = chapterNumberValue(currentChapter?.chapter ?? chapterNumber);
  const currentGroupIndex = orderedChapterGroups.findIndex((group) =>
    group.chapters.some((chapter) => chapter.id === chapterId) ||
    (currentValue !== undefined && group.sortValue === currentValue)
  );
  const currentGroup = currentGroupIndex >= 0 ? orderedChapterGroups[currentGroupIndex] : undefined;
  const currentGroupChoices = currentGroup ? dedupeChapterChoices(currentGroup.chapters, chapterId) : [];
  const currentChapterCount = displayedChapterCount(chapters);
  const currentChapterText = compactChapterLabel(currentChapter?.chapter ?? chapterNumber);
  const readerChapterProgressLabel = currentChapterText
    ? `Ch. ${currentChapterText}`
    : currentChapter
      ? shortChapterLabel(currentChapter)
      : "Chapter";
  const readerTopChapterProgressLabel =
    currentChapterText && currentChapterCount
      ? `Ch. ${currentChapterText}/${currentChapterCount}`
      : readerChapterProgressLabel;
  const currentSourceLabel = currentChapter ? chapterSourceLabel(currentChapter) : source;
  const previousChapter = currentGroupIndex > 0 ? preferredChapterChoice(orderedChapterGroups[currentGroupIndex - 1].chapters, currentChapter, chapterId) : undefined;
  const nextChapter =
    currentGroupIndex >= 0 && currentGroupIndex < orderedChapterGroups.length - 1
      ? preferredChapterChoice(orderedChapterGroups[currentGroupIndex + 1].chapters, currentChapter, chapterId)
      : undefined;
  const dropdownChapterGroups = useMemo(() => [...orderedChapterGroups].reverse(), [orderedChapterGroups]);
  const pagedReader = readerDirection !== "top-to-bottom";
  const visibleReaderPages = useMemo(() => {
    const allPages = pages?.pages ?? [];
    if (!pagedReader) return allPages.map((page, index) => ({ page, index, displayIndex: index }));
    const pageCount = readerPageMode === "double" ? 2 : 1;
    const spread = allPages.slice(pagedPageIndex, pagedPageIndex + pageCount).map((page, offset) => ({
      page,
      index: pagedPageIndex + offset,
      displayIndex: offset
    }));
    return readerPageMode === "double" && readerDirection === "right-to-left" ? [...spread].reverse() : spread;
  }, [pages?.pages, pagedPageIndex, pagedReader, readerDirection, readerPageMode]);

  useEffect(() => {
    if (readerDirection === "top-to-bottom") setReaderPageMode("single");
  }, [readerDirection]);

  useEffect(() => {
    try {
      setReaderTipVisible(localStorage.getItem(READER_TIP_DISMISSED_KEY) !== localDateKey());
    } catch {
      setReaderTipVisible(true);
    }
  }, []);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(READER_PAGE_WIDTH_KEY, String(readerPageWidth));
    } catch {
      // Width preference is optional.
    }
  }, [readerPageWidth]);

  useEffect(() => {
    if (!pagedReader || !pages?.pages.length) return;
    setPagedPageIndex((index) => Math.min(index, Math.max(0, pages.pages.length - 1)));
  }, [pagedReader, pages?.pages.length]);

  useEffect(() => {
    setMobileControlsVisible(false);
    setMobilePickerOpen(false);
    setMobileSettingsOpen(false);
    setPagedPageIndex(0);
  }, [source, mangaId, chapterId]);

  useEffect(() => {
    const update = () => {
      if (pagedReader && pages?.pages.length) {
        const maxIndex = Math.max(1, pages.pages.length - 1);
        setReaderPercent(Math.min(100, Math.max(0, (pagedPageIndex / maxIndex) * 100)));
        return;
      }
      setReaderPercent(readingProgressPercent());
    };
    const hideChrome = () => {
      update();
      if (widthSliderActive.current) return;
      setMobileControlsVisible(false);
      setMobilePickerOpen(false);
      setMobileSettingsOpen(false);
    };
    update();
    window.addEventListener("scroll", hideChrome, { passive: true });
    window.addEventListener("wheel", hideChrome, { passive: true });
    window.addEventListener("touchmove", hideChrome, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", hideChrome);
      window.removeEventListener("wheel", hideChrome);
      window.removeEventListener("touchmove", hideChrome);
      window.removeEventListener("resize", update);
    };
  }, [pagedReader, pagedPageIndex, pages?.pages.length]);

  useEffect(() => {
    if (!error || loading || chaptersLoading || !currentGroupChoices.length) return;
    const fallbackKey = `${source}:${chapterId}`;
    if (failedAutoFallbackKey.current === fallbackKey) return;
    const fallbackChapter = currentGroupChoices.find((chapter) => chapter.source !== source || chapter.id !== chapterId);
    if (!fallbackChapter) return;
    failedAutoFallbackKey.current = fallbackKey;
    setError("");
    changeChapter(fallbackChapter);
  }, [error, loading, chaptersLoading, currentGroupChoices, source, chapterId]);

  useEffect(() => {
    if (!pages || currentGroupIndex < 0 || document.hidden) return;
    const connection = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (connection.connection?.saveData) return;

    const nextChapters = orderedChapterGroups
      .slice(currentGroupIndex + 1, currentGroupIndex + 4)
      .map((group) => preferredChapterChoice(group.chapters, currentChapter, chapterId))
      .filter((chapter): chapter is ChapterSummary => Boolean(chapter))
      .map((chapter) => ({
        source: chapter.source,
        id: chapter.id
      }));
    if (!nextChapters.length) return;

    prefetchChapterPages(nextChapters).catch(() => undefined);
    const nextChapter = orderedChapterGroups
      .slice(currentGroupIndex + 1, currentGroupIndex + 2)
      .map((group) => preferredChapterChoice(group.chapters, currentChapter, chapterId))[0];
    if (nextChapter) {
      fetchChapterPages(nextChapter.source, nextChapter.id, nextChapter.mangaId, nextChapter.chapter)
        .then((result) => preloadReaderImages(result.pages.slice(0, 3)))
        .catch(() => undefined);
    }
  }, [pages, currentGroupIndex, orderedChapterGroups, currentChapter, chapterId]);

  useEffect(() => {
    if (!pages || !resumeScrollPosition || resumeScrollPosition <= 0) return;
    const scrollKey = `${source}:${mangaId}:${chapterId}:${resumeScrollPosition}`;
    restoredScrollKey.current = scrollKey;

    restoreReady.current = false;
    restoreCancelled.current = false;
    let attempts = 0;
    let stableHeightChecks = 0;
    let lastHeight = 0;
    const cancelRestore = () => {
      restoreCancelled.current = true;
      restoreReady.current = true;
      latestReaderScroll.current = currentScrollPosition();
      lastSavedScroll.current = latestReaderScroll.current;
    };
    const interval = window.setInterval(() => {
      if (restoreCancelled.current) {
        window.clearInterval(interval);
        return;
      }
      attempts += 1;
      const timedOut = attempts >= 60;
      restoreScrollPosition(resumeScrollPosition, timedOut);

      const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      stableHeightChecks = height === lastHeight ? stableHeightChecks + 1 : 0;
      lastHeight = height;

      const allKnownPagesLoaded = Boolean(pages.pages.length) && loadedPageCount.current >= pages.pages.length;
      const layoutStable = stableHeightChecks >= 6;
      if (allKnownPagesLoaded || layoutStable || timedOut) {
        restoreScrollPosition(resumeScrollPosition, timedOut);
        window.clearInterval(interval);
        restoreReady.current = true;
        latestReaderScroll.current = currentScrollPosition();
        lastSavedScroll.current = latestReaderScroll.current;
      }
    }, 250);
    const firstAttempt = window.setTimeout(() => {
      restoreScrollPosition(resumeScrollPosition);
    }, 50);
    window.addEventListener("wheel", cancelRestore, { passive: true });
    window.addEventListener("touchstart", cancelRestore, { passive: true });
    window.addEventListener("keydown", cancelRestore);
    window.addEventListener("pointerdown", cancelRestore);

    return () => {
      window.clearTimeout(firstAttempt);
      window.clearInterval(interval);
      window.removeEventListener("wheel", cancelRestore);
      window.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("keydown", cancelRestore);
      window.removeEventListener("pointerdown", cancelRestore);
    };
  }, [pages, source, mangaId, chapterId, resumeScrollPosition]);

  useEffect(() => {
    if (!pages) return;
    let timeout: number | undefined;

    function rememberLocalPosition(nextScroll: number) {
      latestReaderScroll.current = nextScroll;
      lastSavedScroll.current = nextScroll;
      onReaderPosition({ source, mangaId, canonicalKey: manga?.canonicalKey, chapterSource: source, chapterId, chapterNumber, scrollPosition: nextScroll });
    }

    function saveKnownPosition(nextScroll: number, force = false, updateAppState = false) {
      if (!force && !restoreReady.current) return;
      const movedSinceRemoteSave = Math.abs(nextScroll - (lastRemoteSavedScroll.current ?? 0));
      const elapsedSinceRemoteSave = Date.now() - lastRemoteSaveAt.current;
      rememberLocalPosition(nextScroll);
      if (updateAppState) {
        onRemember(source, mangaId, chapterId, chapterNumber, nextScroll, manga?.canonicalKey, manga?.title, source);
        return;
      }
      if (!force && movedSinceRemoteSave < READING_PROGRESS_SAVE_DELTA && elapsedSinceRemoteSave < READING_PROGRESS_SAVE_INTERVAL_MS) return;
      lastRemoteSavedScroll.current = nextScroll;
      lastRemoteSaveAt.current = Date.now();
      saveReadingProgress(source, mangaId, chapterId, chapterNumber, nextScroll, manga?.canonicalKey, manga?.title, source).catch(() => undefined);
    }

    function savePosition(force = false, updateAppState = false) {
      saveKnownPosition(currentScrollPosition(), force, updateAppState);
    }

    const scheduleSave = () => {
      rememberLocalPosition(currentScrollPosition());
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => saveKnownPosition(latestReaderScroll.current), 2500);
    };

    const markUserScrollIntent = () => {
      lastUserScrollIntentAt.current = Date.now();
      scheduleSave();
    };

    const scheduleFromScroll = () => {
      if (Date.now() - lastUserScrollIntentAt.current > 1500) return;
      scheduleSave();
    };

    const saveBeforeLeaving = () => {
      if (timeout) window.clearTimeout(timeout);
      savePosition(true);
    };

    const saveForBrowserBack = () => {
      if (timeout) window.clearTimeout(timeout);
      saveKnownPosition(latestReaderScroll.current, true, true);
      skipUnmountSave.current = true;
    };

    const saveWhenHidden = () => {
      if (document.hidden) saveBeforeLeaving();
    };

    window.addEventListener("scroll", scheduleFromScroll, { passive: true });
    window.addEventListener("wheel", markUserScrollIntent, { passive: true });
    window.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    window.addEventListener("keyup", markUserScrollIntent);
    window.addEventListener("pointerup", markUserScrollIntent);
    window.addEventListener("popstate", saveForBrowserBack, true);
    window.addEventListener("beforeunload", saveBeforeLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);

    return () => {
      window.removeEventListener("scroll", scheduleFromScroll);
      window.removeEventListener("wheel", markUserScrollIntent);
      window.removeEventListener("touchmove", markUserScrollIntent);
      window.removeEventListener("keyup", markUserScrollIntent);
      window.removeEventListener("pointerup", markUserScrollIntent);
      window.removeEventListener("popstate", saveForBrowserBack, true);
      window.removeEventListener("beforeunload", saveBeforeLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      if (timeout) window.clearTimeout(timeout);
      if (!skipUnmountSave.current) savePosition(true, true);
      skipUnmountSave.current = false;
    };
  }, [pages, source, mangaId, chapterId, chapterNumber, manga?.canonicalKey, manga?.title, onReaderPosition, onRemember]);

  function rememberCurrentPosition() {
    if (!pages || !restoreReady.current) return;
    const nextScroll = currentScrollPosition();
    latestReaderScroll.current = nextScroll;
    lastSavedScroll.current = nextScroll;
    onReaderPosition({ source, mangaId, canonicalKey: manga?.canonicalKey, chapterSource: source, chapterId, chapterNumber, scrollPosition: nextScroll });
    skipUnmountSave.current = true;
    onRemember(source, mangaId, chapterId, chapterNumber, nextScroll, manga?.canonicalKey, manga?.title, source);
  }

  function leaveReader() {
    rememberCurrentPosition();
    onBack();
  }

  function changeChapter(chapter: ChapterSummary) {
    rememberCurrentPosition();
    onChapterChange(chapter);
  }

  function handlePageLoaded() {
    loadedPageCount.current += 1;
    if (resumeScrollPosition && resumeScrollPosition > 0 && !restoreReady.current && !restoreCancelled.current) {
      window.setTimeout(() => restoreScrollPosition(resumeScrollPosition), 0);
    }
  }

  function goPagedPrevious() {
    const step = readerPageMode === "double" ? 2 : 1;
    if (pagedPageIndex > 0) {
      setPagedPageIndex((index) => Math.max(0, index - step));
      return;
    }
    if (previousChapter) changeChapter(previousChapter);
  }

  function goPagedNext() {
    const pageCount = pages?.pages.length ?? 0;
    const step = readerPageMode === "double" ? 2 : 1;
    if (pagedPageIndex + step < pageCount) {
      setPagedPageIndex((index) => Math.min(Math.max(0, pageCount - 1), index + step));
      return;
    }
    if (nextChapter) changeChapter(nextChapter);
  }

  function toggleMobileControls() {
    setMobilePickerOpen(false);
    setMobileSettingsOpen(false);
    setMobileControlsVisible((visible) => !visible);
    if (pagedReader && pages?.pages.length) {
      const maxIndex = Math.max(1, pages.pages.length - 1);
      setReaderPercent(Math.min(100, Math.max(0, (pagedPageIndex / maxIndex) * 100)));
    } else {
      setReaderPercent(readingProgressPercent());
    }
  }

  function handleReaderPageClick(event: MouseEvent<HTMLElement>) {
    if (Date.now() - lastPagedSwipeAt.current < 350) return;
    if (!pagedReader) {
      toggleMobileControls();
      return;
    }
    const x = event.clientX / Math.max(1, window.innerWidth);
    if (x > 0.34 && x < 0.66) {
      toggleMobileControls();
      return;
    }
    const leftSide = x <= 0.34;
    const shouldGoNext = readerDirection === "right-to-left" ? leftSide : !leftSide;
    if (shouldGoNext) goPagedNext();
    else goPagedPrevious();
  }

  function handlePagedTouchStart(event: TouchEvent<HTMLElement>) {
    if (!pagedReader) return;
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handlePagedTouchEnd(event: TouchEvent<HTMLElement>) {
    if (!pagedReader || touchStartX.current === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 45) return;
    lastPagedSwipeAt.current = Date.now();
    const swipedLeft = delta < 0;
    const shouldGoNext = readerDirection === "right-to-left" ? !swipedLeft : swipedLeft;
    if (shouldGoNext) goPagedNext();
    else goPagedPrevious();
  }

  function selectReaderDirection(nextDirection: ReaderDirection) {
    setReaderDirection(nextDirection);
  }

  function selectReaderPageMode(nextMode: ReaderPageMode) {
    setReaderPageMode(nextMode);
  }

  function dismissReaderTip() {
    try {
      localStorage.setItem(READER_TIP_DISMISSED_KEY, localDateKey());
    } catch {
      // Ignore storage failures; the tip can safely reappear next session.
    }
    setReaderTipVisible(false);
  }

  function showReaderTip() {
    setReaderTipVisible(true);
    setMobilePickerOpen(false);
    setMobileSettingsOpen(false);
    setMobileControlsVisible(true);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    document.documentElement.requestFullscreen().catch(() => undefined);
  }

  function widthFromPointer(clientX: number) {
    const track = widthSliderTrack.current;
    if (!track) return readerPageWidth;
    const rect = track.getBoundingClientRect();
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return clampReaderPageWidth(READER_PAGE_WIDTH_MIN + percent * (READER_PAGE_WIDTH_MAX - READER_PAGE_WIDTH_MIN));
  }

  function updateWidthSlider(clientX: number) {
    setReaderPageWidth(widthFromPointer(clientX));
  }

  function startWidthSliderDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.preventDefault();
    widthSliderActive.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateWidthSlider(event.clientX);
    setMobileControlsVisible(true);
  }

  function moveWidthSlider(event: PointerEvent<HTMLDivElement>) {
    if (!widthSliderActive.current) return;
    event.stopPropagation();
    event.preventDefault();
    updateWidthSlider(event.clientX);
  }

  function finishWidthSliderDrag(event?: PointerEvent<HTMLDivElement>) {
    event?.stopPropagation();
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => {
      widthSliderActive.current = false;
    }, 200);
  }

  function handleWidthSliderKey(event: KeyboardEvent<HTMLDivElement>) {
    const smallStep = 20;
    const largeStep = 100;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setReaderPageWidth((width) => clampReaderPageWidth(width - smallStep));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setReaderPageWidth((width) => clampReaderPageWidth(width + smallStep));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setReaderPageWidth((width) => clampReaderPageWidth(width - largeStep));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setReaderPageWidth((width) => clampReaderPageWidth(width + largeStep));
    } else if (event.key === "Home") {
      event.preventDefault();
      setReaderPageWidth(READER_PAGE_WIDTH_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      setReaderPageWidth(READER_PAGE_WIDTH_MAX);
    }
  }

  function MobileReaderPanel() {
    if (!mobilePickerOpen && !mobileSettingsOpen) return null;
    return (
      <div className="reader-mobile-panel" role="dialog" aria-modal="false">
        {mobilePickerOpen && (
          <>
            <div className="reader-mobile-panel__title">Chapter</div>
            <label className="chapter-select">
              <select
                aria-label="Chapter"
                value={currentGroup?.key ?? `current:${chapterId}`}
                onChange={(event) => {
                  const selectedGroup = orderedChapterGroups.find((group) => group.key === event.target.value);
                  const selected = selectedGroup ? preferredChapterChoice(selectedGroup.chapters, currentChapter, chapterId) : undefined;
                  if (selected) changeChapter(selected);
                }}
                disabled={!orderedChapterGroups.length || chaptersLoading}
              >
                {!currentGroup && <option value={`current:${chapterId}`}>{chapterNumber ? `Ch. ${chapterNumber}` : "Current chapter"}</option>}
                {dropdownChapterGroups.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.label}
                  </option>
                ))}
              </select>
            </label>

            {currentGroupChoices.length > 1 && (
              <label className="chapter-select">
                <select
                  aria-label="Source"
                  value={currentChapter?.id ?? chapterId}
                  onChange={(event) => {
                    const selected = currentGroupChoices.find((chapter) => chapter.id === event.target.value);
                    if (selected) changeChapter(selected);
                  }}
                  disabled={chaptersLoading}
                >
                  {currentGroupChoices.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapterSourceLabel(chapter)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {mobileSettingsOpen && (
          <>
            <div className="reader-mobile-panel__title">Reading direction</div>
            <div className="reader-setting-group reader-direction-group" role="group" aria-label="Reading direction">
              <button className={readerDirection === "left-to-right" ? "active" : ""} type="button" onClick={() => selectReaderDirection("left-to-right")}>
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                <span>Left to right</span>
              </button>
              <button className={readerDirection === "right-to-left" ? "active" : ""} type="button" onClick={() => selectReaderDirection("right-to-left")}>
                <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
                <span>Right to left</span>
              </button>
              <button className={readerDirection === "top-to-bottom" ? "active" : ""} type="button" onClick={() => selectReaderDirection("top-to-bottom")}>
                <FontAwesomeIcon icon={faArrowDown} aria-hidden="true" />
                <span>Top to bottom</span>
              </button>
            </div>

            {titleLooksLikeManga && readerDirection !== "top-to-bottom" && (
              <div className="reader-setting-group" role="group" aria-label="Page mode">
                <button className={readerPageMode === "single" ? "active" : ""} type="button" onClick={() => selectReaderPageMode("single")}>
                  Single page
                </button>
                <button className={readerPageMode === "double" ? "active" : ""} type="button" onClick={() => selectReaderPageMode("double")}>
                  Double page
                </button>
              </div>
            )}

            <div className="reader-mobile-panel__title">Progress bar</div>
            <div className="reader-setting-group" role="group" aria-label="Progress bar position">
              <button className={progressPosition === "top" ? "active" : ""} type="button" onClick={() => setProgressPosition("top")}>
                <FontAwesomeIcon icon={faArrowUp} aria-hidden="true" />
                Top
              </button>
              <button className={progressPosition === "bottom" ? "active" : ""} type="button" onClick={() => setProgressPosition("bottom")}>
                <FontAwesomeIcon icon={faArrowDown} aria-hidden="true" />
                Bottom
              </button>
            </div>

          </>
        )}
      </div>
    );
  }

  function MobileReaderControls() {
    if (!mobileControlsVisible && !mobilePickerOpen && !mobileSettingsOpen) return null;
    return (
      <>
        <div className="reader-mobile-top">
          <button className="reader-mobile-home" type="button" onClick={onHome} aria-label="Home">
            <HomeIcon />
          </button>
          <button className="reader-mobile-back-title" type="button" onClick={leaveReader} aria-label="Back to title">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
          </button>
          <button className="reader-mobile-title" type="button" onClick={leaveReader}>
            <span>{manga?.title ?? "Reader"}</span>
          </button>
          <div className="reader-mobile-meta" aria-label={`${readerTopChapterProgressLabel}, ${currentSourceLabel}`}>
            <strong>{readerTopChapterProgressLabel}</strong>
            <span>{currentSourceLabel}</span>
          </div>
        </div>
        <MobileReaderPanel />
        <div className="reader-mobile-controls" aria-label="Reader controls">
          <button className="reader-mobile-icon-button" type="button" onClick={() => (previousChapter ? changeChapter(previousChapter) : leaveReader())} aria-label="Previous chapter">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
          </button>
          <button
            className="reader-mobile-chapter-button"
            type="button"
            onClick={() => {
              setMobileSettingsOpen(false);
              setMobilePickerOpen((open) => !open);
              setMobileControlsVisible(true);
            }}
          >
            <span>{readerChapterProgressLabel}</span>
            <FontAwesomeIcon icon={faChevronUp} aria-hidden="true" />
          </button>
          <button className="reader-mobile-icon-button" type="button" onClick={() => (nextChapter ? changeChapter(nextChapter) : leaveReader())} aria-label="Next chapter">
            <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
          </button>
          <div className="reader-mobile-tools" aria-label="Reader tools">
            <button className="reader-mobile-icon-button" type="button" onClick={showReaderTip} aria-label="Show reader controls guide">
              <FontAwesomeIcon icon={faQuestionCircle} aria-hidden="true" />
            </button>
            <button
              className="reader-mobile-icon-button reader-desktop-only"
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} aria-hidden="true" />
            </button>
            <button
              className="reader-mobile-icon-button"
              type="button"
              onClick={() => {
                setMobilePickerOpen(false);
                setMobileSettingsOpen((open) => !open);
                setMobileControlsVisible(true);
              }}
              aria-label="Reader settings"
            >
              <FontAwesomeIcon icon={faGear} aria-hidden="true" />
            </button>
          </div>
          {!pagedReader && (
            <div className="reader-page-width-control reader-inline-width-control reader-desktop-only">
              <div
                ref={widthSliderTrack}
                className="reader-inline-width-slider"
                role="slider"
                tabIndex={0}
                aria-label="Reader page width"
                aria-valuemin={READER_PAGE_WIDTH_MIN}
                aria-valuemax={READER_PAGE_WIDTH_MAX}
                aria-valuenow={readerPageWidth}
                style={{ "--reader-width-percent": `${((readerPageWidth - READER_PAGE_WIDTH_MIN) / (READER_PAGE_WIDTH_MAX - READER_PAGE_WIDTH_MIN)) * 100}%` } as CSSProperties}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={startWidthSliderDrag}
                onPointerMove={moveWidthSlider}
                onPointerUp={finishWidthSliderDrag}
                onPointerCancel={finishWidthSliderDrag}
                onKeyDown={handleWidthSliderKey}
              />
              <span className="reader-inline-width-value">{readerPageWidth}px</span>
            </div>
          )}
        </div>
      </>
    );
  }

  function ReaderControls({ placement }: { placement: "top" | "bottom" }) {
    const hasChapters = orderedChapterGroups.length > 0;
    return (
      <nav className={`reader-controls ${placement}`} aria-label={`${placement} chapter navigation`}>
        <div className="reader-select-row">
          <label className="chapter-select">
            <select
              aria-label="Chapter"
              value={currentGroup?.key ?? `current:${chapterId}`}
              onChange={(event) => {
                const selectedGroup = orderedChapterGroups.find((group) => group.key === event.target.value);
                const selected = selectedGroup ? preferredChapterChoice(selectedGroup.chapters, currentChapter, chapterId) : undefined;
                if (selected) changeChapter(selected);
              }}
              disabled={!hasChapters || chaptersLoading}
            >
              {!currentGroup && <option value={`current:${chapterId}`}>{chapterNumber ? `Ch. ${chapterNumber}` : "Current chapter"}</option>}
              {dropdownChapterGroups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>

          {currentGroupChoices.length > 1 && (
            <label className="chapter-select source-select">
              <select
                aria-label="Source"
                value={currentChapter?.id ?? chapterId}
                onChange={(event) => {
                  const selected = currentGroupChoices.find((chapter) => chapter.id === event.target.value);
                  if (selected) changeChapter(selected);
                }}
                disabled={chaptersLoading}
              >
                {currentGroupChoices.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapterSourceLabel(chapter)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="reader-nav-pair">
          <button className="reader-nav-button" type="button" onClick={() => (previousChapter ? changeChapter(previousChapter) : leaveReader())}>
            <ArrowLeftIcon />
            <span>{previousChapter ? `Previous ${shortChapterLabel(previousChapter)}` : "Previous: title"}</span>
          </button>
          <button className="reader-nav-button" type="button" onClick={() => (nextChapter ? changeChapter(nextChapter) : leaveReader())}>
            <span>{nextChapter ? `Next ${shortChapterLabel(nextChapter)}` : "Next: title"}</span>
            <ArrowRightIcon />
          </button>
        </div>

      </nav>
    );
  }

  const readerClassName = [
    "reader",
    pagedReader ? "reader--paged" : "",
    pagedReader && readerPageMode === "double" ? "reader--double-page" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <main className={readerClassName}>
      <div className={`reader-progress-bar reader-progress-bar--${progressPosition}`} aria-hidden="true">
        <span style={{ width: `${readerPercent}%` }} />
      </div>
      <div className="reader-bar">
        <button className="reader-title-button" onClick={leaveReader}>
          <strong>{manga?.title ?? "Reader"}</strong>
          <span>{currentChapter ? shortChapterLabel(currentChapter) : chapterNumber ? `Ch. ${chapterNumber}` : ""}</span>
        </button>
        <button className="reader-nav-toggle" type="button" onClick={onToggleNavHidden}>
          {navHidden ? "Show nav" : "Hide nav"}
        </button>
      </div>
      {readerTipVisible && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal reader-tip-modal" role="dialog" aria-modal="true" aria-labelledby="reader-tip-title">
            <h2 id="reader-tip-title">Reader controls</h2>
            <p>Tap the page once to bring the controls up. Tap again, or start scrolling, and they will fade out of the way.</p>
            <div className="reader-tip-list">
              <span>
                <FontAwesomeIcon icon={faChevronUp} aria-hidden="true" />
                Open chapter and source controls from the chapter button.
              </span>
              <span>
                <FontAwesomeIcon icon={faGear} aria-hidden="true" />
                Use settings to change reading direction and progress bar position.
              </span>
              <span>
                <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
                In left-to-right or right-to-left mode, tap a side or swipe to turn pages.
              </span>
            </div>
            <div className="modal-actions">
              <button className="primary-button" type="button" onClick={dismissReaderTip}>
                Got it
              </button>
            </div>
          </section>
        </div>
      )}
      {loading && <LoadingNotice label="Loading pages" />}
      {error && <div className="notice error">{error}</div>}
      {chapterError && <div className="notice error">{chapterError}</div>}
      {!loading && <ReaderControls placement="top" />}
      <section
        className="pages"
        style={!pagedReader ? ({ "--reader-page-width": `${readerPageWidth}px` } as CSSProperties) : undefined}
        onClick={handleReaderPageClick}
        onTouchStart={handlePagedTouchStart}
        onTouchEnd={handlePagedTouchEnd}
      >
        {visibleReaderPages.map(({ page, index, displayIndex }) => (
          <img
            key={page}
            src={proxiedImageUrl(page)}
            alt={`Page ${index + 1}`}
            loading={displayIndex < 2 ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={displayIndex === 0 ? "high" : "auto"}
            onLoad={handlePageLoaded}
            onError={handlePageLoaded}
          />
        ))}
      </section>
      {!loading && (pages || error) && <ReaderControls placement="bottom" />}
      <MobileReaderControls />
    </main>
  );
}

export function App() {
  const [view, setView] = useState<View>(() => viewFromLocation(window.location));
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(getAuthToken()));
  const [favorites, setFavorites] = useState<FavoriteManga[]>([]);
  const [readingProgress, setReadingProgress] = useState<ReadingProgress[]>([]);
  const [shareUsers, setShareUsers] = useState<AccountUser[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [readingProgressLoaded, setReadingProgressLoaded] = useState(false);
  const [shareUsersLoaded, setShareUsersLoaded] = useState(false);
  const [recommendations, setRecommendations] = useState<{ inbox: Recommendation[]; outbox: Recommendation[]; unread: number }>({
    inbox: [],
    outbox: [],
    unread: 0
  });
  const [favoritesError, setFavoritesError] = useState("");
  const [showNsfw, setShowNsfw] = useState(loadShowNsfw);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [readerNavHidden, setReaderNavHidden] = useState(false);
  const topbarRef = useRef<HTMLElement | null>(null);
  const activeReaderPosition = useRef<ActiveReaderPosition | null>(readStoredReaderPosition());
  const currentViewRef = useRef(view);
  const handleRememberRef = useRef(
    (
      _source: string,
      _mangaId: string,
      _chapterId: string,
      _chapterNumber?: string,
      _scrollPosition?: number,
      _canonicalKey?: string,
      _title?: string,
      _chapterSource?: string
    ) => undefined
  ) as MutableRefObject<
    (source: string, mangaId: string, chapterId: string, chapterNumber?: string, scrollPosition?: number, canonicalKey?: string, title?: string, chapterSource?: string) => void
  >;
  const [topbarHeight, setTopbarHeight] = useState(0);

  currentViewRef.current = view;

  useEffect(() => {
    const currentView = viewFromLocation(window.location);
    const currentPath = currentView.name === "browse" ? browsePagePath(browsePageFromLocation(window.location)) : viewToPath(currentView);
    window.history.replaceState({ view: currentView }, "", currentPath);

    const handlePopState = (event: PopStateEvent) => {
      const currentReaderView = currentViewRef.current.name === "reader" ? currentViewRef.current : undefined;
      const fallbackReader: ActiveReaderPosition | null = currentReaderView
        ? {
            source: currentReaderView.source,
            mangaId: currentReaderView.mangaId,
            chapterSource: currentReaderView.source,
            chapterId: currentReaderView.chapterId,
            chapterNumber: currentReaderView.chapterNumber,
            scrollPosition: currentScrollPosition()
          }
        : null;
      const reader = activeReaderPosition.current ?? readStoredReaderPosition() ?? fallbackReader;
      if (reader) {
        handleRememberRef.current(reader.source, reader.mangaId, reader.chapterId, reader.chapterNumber, reader.scrollPosition, reader.canonicalKey, undefined, reader.chapterSource);
        activeReaderPosition.current = null;
        writeStoredReaderPosition(null);
      }
      setView(event.state?.view ?? viewFromLocation(window.location));
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!getAuthToken()) return;

    setAuthLoading(true);
    fetchCurrentUser()
      .then(({ user: nextUser }) => {
        setUser(nextUser);
        if (!nextUser.nsfwAllowed) {
          setShowNsfw(false);
          localStorage.setItem(SHOW_NSFW_KEY, "false");
        }
      })
      .catch(() => {
        clearAuthToken();
        setUser(null);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    const element = topbarRef.current;
    if (!element) return;

    const updateHeight = () => setTopbarHeight(element.offsetHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [user]);

	  useEffect(() => {
	    if (!user) {
	      setFavorites([]);
	      setReadingProgress([]);
      setShareUsers([]);
      setFavoritesLoaded(false);
      setReadingProgressLoaded(false);
      setShareUsersLoaded(false);
      setRecommendations({ inbox: [], outbox: [], unread: 0 });
	      return;
	    }
	
	    setFavoritesError("");
	    fetchAccountBootstrap()
	      .then(({ unread }) => {
        setRecommendations((current) => ({ ...current, unread }));
      })
	      .catch((err: Error) => setFavoritesError(err.message));
	  }, [user]);

  useEffect(() => {
    if (!user) return;

    const needsFavorites = ["search", "library", "bookmarkUpdates", "readingHistory", "detail", "reader"].includes(view.name);
    const needsProgress = ["readingHistory", "detail", "reader"].includes(view.name);
    const needsShareUsers = view.name === "detail";

    if (needsFavorites && !favoritesLoaded) {
      fetchFavorites()
        .then(({ favorites }) => {
          setFavorites(favorites);
          setFavoritesLoaded(true);
        })
        .catch((err: Error) => setFavoritesError(err.message));
    }

    if (needsProgress && !readingProgressLoaded) {
      fetchReadingProgress()
        .then(({ progress }) => {
          setReadingProgress(progress);
          setReadingProgressLoaded(true);
        })
        .catch((err: Error) => setFavoritesError(err.message));
    }

    if (needsShareUsers && !shareUsersLoaded) {
      fetchShareUsers()
        .then(({ users }) => {
          setShareUsers(users);
          setShareUsersLoaded(true);
        })
        .catch((err: Error) => setFavoritesError(err.message));
    }

    if (view.name === "messages") {
      fetchRecommendations()
        .then((nextRecommendations) => setRecommendations(nextRecommendations))
        .catch((err: Error) => setFavoritesError(err.message));
    }
  }, [favoritesLoaded, readingProgressLoaded, shareUsersLoaded, user, view.name]);

  useEffect(() => {
    if (view.name === "reader") {
      setReaderNavHidden(window.matchMedia("(max-width: 720px)").matches);
      return;
    }

    setReaderNavHidden(false);
  }, [view.name]);

  const handleFavorite = (manga: MangaSummary) => {
    const exists = isFavorite(favorites, manga.source, manga.id);
    if (exists) {
      setConfirmDialog({
        title: "Remove bookmark?",
        message: `Remove "${manga.title}" from your bookmarks?`,
        confirmLabel: "Remove bookmark",
        variant: "danger",
        onConfirm: () => {
          setConfirmDialog(null);
          removeBookmark(manga);
        }
      });
      return;
    }

    addBookmark(manga);
  };

  function addBookmark(manga: MangaSummary) {
    const previousFavorites = favorites;
    const optimisticFavorites = [{ ...manga, addedAt: new Date().toISOString() }, ...favorites];

    setFavorites(optimisticFavorites);
    setFavoritesLoaded(true);
    setFavoritesError("");

    addFavorite(manga)
      .then(({ favorites: nextFavorites }) => setFavorites(nextFavorites))
      .catch((err: Error) => {
        setFavorites(previousFavorites);
        setFavoritesError(err.message);
      });
  }

  function removeBookmark(manga: MangaSummary) {
    const previousFavorites = favorites;
    const optimisticFavorites = favorites.filter((item) => item.source !== manga.source || item.id !== manga.id);

    setFavorites(optimisticFavorites);
    setFavoritesLoaded(true);
    setFavoritesError("");

    removeFavorite(manga.source, manga.id)
      .then(({ favorites: nextFavorites }) => setFavorites(nextFavorites))
      .catch((err: Error) => {
        setFavorites(previousFavorites);
        setFavoritesError(err.message);
      });
  }

  const handleRemember = useCallback((
    nextSource: string,
    mangaId: string,
    chapterId: string,
    chapterNumber?: string,
    scrollPosition?: number,
    canonicalKey?: string,
    title?: string,
    chapterSource?: string
  ) => {
    setFavorites((current) =>
      current.map((item) =>
        item.source === nextSource && item.id === mangaId
          ? {
              ...item,
              lastReadChapterId: chapterId,
              lastReadChapter: chapterNumber ?? item.lastReadChapter,
              lastReadScrollPosition: scrollPosition ?? item.lastReadScrollPosition
            }
          : item
      )
    );
    setReadingProgress((current) => {
      const existing = current.find((item) => item.source === nextSource && item.mangaId === mangaId);
      const existingCanonical = canonicalKey ? current.find((item) => item.canonicalKey === canonicalKey) : undefined;
      return [
        {
          source: nextSource,
          mangaId,
          canonicalKey,
          chapterSource: chapterSource ?? nextSource,
          chapterId,
          chapterNumber,
          scrollPosition: scrollPosition ?? existing?.scrollPosition ?? existingCanonical?.scrollPosition,
          updatedAt: new Date().toISOString()
        },
        ...current.filter((item) => {
          if (item.source === nextSource && item.mangaId === mangaId) return false;
          if (canonicalKey && item.canonicalKey === canonicalKey) return false;
          return true;
        })
      ];
    });
    setReadingProgressLoaded(true);
    saveReadingProgress(nextSource, mangaId, chapterId, chapterNumber, scrollPosition, canonicalKey, title, chapterSource ?? nextSource)
      .then(({ progress }) => {
        setFavorites((current) =>
          current.map((item) =>
            item.source === progress.source && item.id === progress.mangaId
              ? {
                  ...item,
                  lastReadChapterId: progress.chapterId,
                  lastReadChapter: progress.chapterNumber ?? item.lastReadChapter,
                  lastReadScrollPosition: progress.scrollPosition ?? item.lastReadScrollPosition
                }
              : item
          )
        );
        setReadingProgress((current) => [
          progress,
          ...current.filter((item) => {
            if (item.source === progress.source && item.mangaId === progress.mangaId) return false;
            if (progress.canonicalKey && item.canonicalKey === progress.canonicalKey) return false;
            return true;
          })
        ]);
      })
      .catch((err: Error) => setFavoritesError(err.message));
  }, []);
  handleRememberRef.current = handleRemember;

  const handleReaderPosition = useCallback((position: ActiveReaderPosition) => {
    activeReaderPosition.current = position;
    writeStoredReaderPosition(position);
  }, []);

  const navigate = (nextView: View) => {
    if (view.name === "reader") {
      const reader = activeReaderPosition.current ?? readStoredReaderPosition();
      if (reader) handleRemember(reader.source, reader.mangaId, reader.chapterId, reader.chapterNumber, reader.scrollPosition, reader.canonicalKey, undefined, reader.chapterSource);
      activeReaderPosition.current = null;
      writeStoredReaderPosition(null);
    }
    setView(nextView);
    window.history.pushState({ view: nextView }, "", viewToPath(nextView));
    window.scrollTo({ top: 0 });
  };

  const handleLoggedIn = (nextUser: AccountUser, token: string) => {
    setAuthToken(token);
    setUser(nextUser);
    if (!nextUser.nsfwAllowed) handleShowNsfwChange(false);
    setView({ name: "browse" });
    window.history.replaceState({ view: { name: "browse" } }, "", "/");
  };

  const handleLogout = () => {
    setConfirmDialog({
      title: "Log out?",
      message: "You will need to sign in again to access your bookmarks and reading history.",
      confirmLabel: "Logout",
      variant: "danger",
      onConfirm: () => {
        setConfirmDialog(null);
        completeLogout();
      }
    });
  };

  function completeLogout() {
    logout().catch(() => undefined);
    clearAuthToken();
    setUser(null);
	    setFavorites([]);
	    setReadingProgress([]);
    setShareUsers([]);
    setFavoritesLoaded(false);
    setReadingProgressLoaded(false);
    setShareUsersLoaded(false);
    setRecommendations({ inbox: [], outbox: [], unread: 0 });
	    setSources([]);
    setView({ name: "browse" });
    window.history.replaceState({ view: { name: "browse" } }, "", "/");
  }

	  const handleShowNsfwChange = (nextShowNsfw: boolean) => {
    const allowedValue = Boolean(user?.nsfwAllowed) && nextShowNsfw;
	    setShowNsfw(allowedValue);
	    localStorage.setItem(SHOW_NSFW_KEY, String(allowedValue));
	  };

  const handleShareTitle = async (manga: MangaSummary, toUserId: string) => {
    const { recommendation } = await sendRecommendation(toUserId, manga);
    setRecommendations((current) => ({
      ...current,
      outbox: [recommendation, ...current.outbox]
    }));
  };

  const refreshShareUsers = useCallback(() => {
    fetchShareUsers()
      .then(({ users }) => setShareUsers(users))
      .catch((err: Error) => setFavoritesError(err.message));
  }, []);

  const handleMarkRecommendationRead = (id: string) => {
    markRecommendationRead(id)
      .then(({ recommendation, unread }) => {
        setRecommendations((current) => ({
          ...current,
          unread,
          inbox: current.inbox.map((item) => (item.id === recommendation.id ? recommendation : item))
        }));
      })
      .catch((err: Error) => setFavoritesError(err.message));
  };

  const handleMarkAllRecommendationsRead = () => {
    markAllRecommendationsRead()
      .then(({ inbox, unread }) => {
        setRecommendations((current) => ({ ...current, inbox, unread }));
      })
      .catch((err: Error) => setFavoritesError(err.message));
  };

  const handleDeleteRecommendation = (recommendation: Recommendation) => {
    setConfirmDialog({
      title: "Delete recommendation?",
      message: `Remove "${recommendation.title}" from your ${recommendation.fromUserId === user?.id ? "outbox" : "inbox"}?`,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: () => {
        setConfirmDialog(null);
        deleteRecommendation(recommendation.id)
          .then((nextRecommendations) => setRecommendations(nextRecommendations))
          .catch((err: Error) => setFavoritesError(err.message));
      }
    });
  };

  const handleClearRecommendations = (box: "inbox" | "outbox") => {
    setConfirmDialog({
      title: `Clear ${box}?`,
      message: `Delete every recommendation in your ${box}?`,
      confirmLabel: `Clear ${box}`,
      variant: "danger",
      onConfirm: () => {
        setConfirmDialog(null);
        clearRecommendations(box)
          .then((nextRecommendations) => setRecommendations(nextRecommendations))
          .catch((err: Error) => setFavoritesError(err.message));
      }
    });
  };

	  if (authLoading) {
    return <main className="auth-shell"><LoadingNotice label="Checking session" page /></main>;
  }

  if (!user) {
    return <LoginView onLoggedIn={handleLoggedIn} />;
  }

  const appStyle = { "--topbar-height": `${topbarHeight}px` } as CSSProperties;

  return (
    <div className="app" style={appStyle}>
      <header ref={topbarRef} className={view.name === "reader" ? "topbar reader-app-hidden" : "topbar"}>
        <div className="topbar-main">
          <button className="brand" onClick={() => navigate({ name: "browse" })}>
            <LogoMark />
            <span>ScottShelf</span>
          </button>
          <button
            className={view.name === "messages" ? "header-mail-button active" : "header-mail-button"}
            onClick={() => navigate({ name: "messages", tab: "inbox" })}
            aria-label={recommendations.unread > 0 ? `${recommendations.unread} unread recommendations` : "Messages"}
          >
            <MailIcon />
            {recommendations.unread > 0 && <span className="nav-badge">{recommendations.unread}</span>}
          </button>
        </div>
        <nav>
          <button className={["browse", "bookmarkUpdates", "readingHistory"].includes(view.name) ? "nav-active" : ""} onClick={() => navigate({ name: "browse" })}>
            <HomeIcon />
            <span>Home</span>
          </button>
          <button className={view.name === "search" ? "nav-active" : ""} onClick={() => navigate({ name: "search" })}>
            <SearchIcon />
            <span>Search</span>
          </button>
          <button className={view.name === "library" ? "nav-active" : ""} onClick={() => navigate({ name: "library" })}>
            <BookmarksIcon />
            <span>Bookmarks</span>
          </button>
	          <button className={view.name === "account" ? "nav-active" : ""} onClick={() => navigate({ name: "account" })}>
	            <SettingsIcon />
	            <span>Settings</span>
	          </button>
          <button className="logout-button" onClick={handleLogout}>
            <LogoutIcon />
            <span>Logout</span>
          </button>
        </nav>
      </header>

      {favoritesError && <main className="content compact-content"><div className="notice error">{favoritesError}</div></main>}
      {confirmDialog && <ConfirmModal dialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />}

      {view.name === "browse" && (
        <BrowseView
          source={source}
          favorites={favorites}
          readingProgress={readingProgress}
          showNsfw={showNsfw}
          onFavorite={handleFavorite}
          onOpen={(manga) => navigate({ name: "detail", source: manga.source, id: manga.id })}
          onViewBookmarkUpdates={() => navigate({ name: "bookmarkUpdates" })}
          onViewHistory={() => navigate({ name: "readingHistory" })}
        />
      )}

      {view.name === "search" && (
        <SearchView
          initialQuery={view.query}
          source={source}
          sources={sources}
          favorites={favorites}
          showNsfw={showNsfw}
          onFavorite={handleFavorite}
          onOpen={(manga) => navigate({ name: "detail", source: manga.source, id: manga.id })}
        />
      )}

      {view.name === "bookmarkUpdates" && (
        <BookmarkUpdatesView
          favorites={favorites}
          showNsfw={showNsfw}
          onFavorite={handleFavorite}
          onOpen={(manga) => navigate({ name: "detail", source: manga.source, id: manga.id })}
        />
      )}

      {view.name === "readingHistory" && (
        <ReadingHistoryView
          favorites={favorites}
          readingProgress={readingProgress}
          showNsfw={showNsfw}
          onFavorite={handleFavorite}
          onOpen={(manga) => navigate({ name: "detail", source: manga.source, id: manga.id })}
        />
      )}

      {view.name === "library" && (
        <LibraryView
          favorites={favorites}
          showNsfw={showNsfw}
          onFavorite={handleFavorite}
          onOpen={(manga) => navigate({ name: "detail", source: manga.source, id: manga.id })}
        />
      )}

      {view.name === "account" && (
        <AccountView
          user={user}
          source={source}
	          sources={sources}
	          showNsfw={showNsfw}
	          onUserUpdate={setUser}
	          onShowNsfwChange={handleShowNsfwChange}
	          onFavoritesImported={setFavorites}
	          onSourceChange={setSource}
	          onSourcesLoaded={setSources}
	          onShareUsersChanged={refreshShareUsers}
	        />
	      )}

      {view.name === "messages" && (
        <MessagesView
          tab={view.tab ?? "inbox"}
          recommendations={recommendations}
          showNsfw={showNsfw}
          onTabChange={(tab) => navigate({ name: "messages", tab })}
          onOpenRecommendation={(recommendation) => navigate({ name: "detail", source: recommendation.source, id: recommendation.mangaId })}
          onMarkRecommendationRead={handleMarkRecommendationRead}
          onMarkAllRecommendationsRead={handleMarkAllRecommendationsRead}
          onDeleteRecommendation={handleDeleteRecommendation}
          onClearRecommendations={handleClearRecommendations}
        />
      )}

      {view.name === "detail" && view.source !== "external" && (
        <DetailView
          source={view.source}
          id={view.id}
	          favorites={favorites}
	          readingProgress={readingProgress}
	          showNsfw={showNsfw}
            shareUsers={shareUsers}
	          onFavorite={handleFavorite}
            onShare={handleShareTitle}
	          onTagSearch={(tag) => navigate({ name: "search", query: tag })}
          onOpenSimilar={(manga) => navigate({ name: "detail", source: manga.source, id: manga.id })}
          onRead={(chapter, scrollPosition) =>
            navigate({
              name: "reader",
              source: chapter.source,
              mangaId: chapter.mangaId || view.id,
              chapterId: chapter.id,
              chapterNumber: chapter.chapter,
              scrollPosition
            })
          }
        />
      )}

      {view.name === "detail" && view.source === "external" && (
        <main className="content"><div className="notice">This imported bookmark could not be matched to an active reading source yet.</div></main>
      )}

      {view.name === "reader" && (
        <ReaderView
          source={view.source}
          mangaId={view.mangaId}
          chapterId={view.chapterId}
          chapterNumber={view.chapterNumber}
          initialScrollPosition={view.scrollPosition}
          readingProgress={readingProgress}
          navHidden={readerNavHidden}
          onHome={() => navigate({ name: "browse" })}
          onBack={() => navigate({ name: "detail", source: view.source, id: view.mangaId })}
          onChapterChange={(chapter) =>
            navigate({
              name: "reader",
              source: chapter.source,
              mangaId: chapter.mangaId || view.mangaId,
              chapterId: chapter.id,
              chapterNumber: chapter.chapter
            })
          }
          onToggleNavHidden={() => setReaderNavHidden((hidden) => !hidden)}
          onReaderPosition={handleReaderPosition}
          onRemember={handleRemember}
        />
      )}
    </div>
  );
}
