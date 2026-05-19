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
  faAnglesLeft,
  faAnglesRight,
  faCircleExclamation,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faChevronUp,
  faCommentDots,
  faCompress,
  faDatabase,
  faEye,
  faEyeSlash,
  faExpand,
  faGear,
  faImages,
  faListUl,
  faMagnifyingGlass,
  faQuestionCircle,
  faRightFromBracket,
  faSlash,
  faStar as solidStar,
  faXmark
} from "@fortawesome/free-solid-svg-icons";
import { type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode, type TouchEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  fetchAdminDashboard,
  fetchInteractionBlocks,
  fetchChapterComments,
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
  fetchTitleComments,
  fetchTitleCacheStatus,
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
  AdminDashboardStats,
  BookmarkUpdate,
  CommentItem,
  CommentPage,
  ChapterPages,
  ChapterSummary,
  FavoriteManga,
  HomeManga,
  MangaDetail,
  MangaSummary,
  MemoryCacheStats,
  ReadingProgress,
  Recommendation,
  SourceHealth,
  SourceInfo,
  TitleCacheStatus,
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
const READER_TOP_CONTROLS_KEY = "mangass:reader-top-controls";
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

function loadReaderTopControls() {
  try {
    const saved = localStorage.getItem(READER_TOP_CONTROLS_KEY);
    return saved === "true";
  } catch {
    return false;
  }
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

const englishTitleWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "beginning",
  "by",
  "for",
  "from",
  "global",
  "hero",
  "in",
  "is",
  "lord",
  "my",
  "of",
  "on",
  "superpowers",
  "the",
  "to",
  "with"
]);

function titleEnglishScore(title?: string) {
  const trimmed = title?.trim();
  if (!trimmed) return 0;
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(trimmed)) return 0;

  const words = trimmed.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
  if (words.length < 2) return 0;

  const letters = trimmed.match(/\p{L}/gu) ?? [];
  const latinLetters = trimmed.match(/[a-z]/gi) ?? [];
  if (letters.length > 0 && latinLetters.length / letters.length < 0.9) return 0;

  const commonWords = words.filter((word) => englishTitleWords.has(word)).length;
  if (commonWords === 0) return 0;

  return commonWords * 4 + Math.min(words.length, 12) + (trimmed.includes(":") ? 2 : 0);
}

function preferredTitleFromAlternates(manga: MangaDetail) {
  const currentScore = titleEnglishScore(manga.title);
  const alternate = uniqueText(manga.altTitles)
    .filter((title) => title.toLowerCase() !== manga.title.trim().toLowerCase())
    .map((title) => ({ title, score: titleEnglishScore(title) }))
    .find((candidate) => candidate.score > currentScore);

  return alternate?.title ?? manga.title;
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
  return manga.ratingVotes ? `${rating}/10 (${new Intl.NumberFormat().format(manga.ratingVotes)})` : `${rating}/10`;
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

function displayDateTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function displayDuration(ms?: number) {
  if (!ms || ms <= 0) return undefined;
  const minutes = Math.round(ms / (1000 * 60));
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function titleCaseLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const BOOKMARK_JOB_ORDER = [
  "title_detail",
  "chapter_list",
  "latest_check",
  "latest_chapters",
  "chapter_pages",
  "title_comments",
  "chapter_comments"
] as const;
const BOOKMARK_JOB_STATUS_ORDER = ["pending", "running", "done", "failed"] as const;

const BOOKMARK_JOB_LABELS: Record<string, string> = {
  title_detail: "Title Detail",
  chapter_list: "Chapter List",
  latest_check: "Latest Check",
  latest_chapters: "Latest Chapter List",
  chapter_pages: "Chapter Pages",
  title_comments: "Title Comments",
  chapter_comments: "Chapter Comments"
};

const BOOKMARK_JOB_DESCRIPTIONS: Record<string, string> = {
  title_detail: "Saves title metadata for bookmarked titles.",
  chapter_list: "Saves the full chapter index used by title pages, reader menus, and next/previous navigation.",
  latest_check: "Checks bookmarked titles to see whether the source has a newer latest chapter.",
  latest_chapters: "Saves only the newest chapter-list entries after a latest check finds updates.",
  chapter_pages: "Saves the page/image URLs for each chapter so reader pages can load from DB storage.",
  title_comments: "Saves read-only Comix title comment threads for bookmarked titles.",
  chapter_comments: "Saves read-only Comix chapter comment threads by chapter number and volume."
};

function bookmarkJobLabel(jobType: string) {
  return BOOKMARK_JOB_LABELS[jobType] ?? titleCaseLabel(jobType);
}

function bookmarkJobDescription(jobType: string) {
  return BOOKMARK_JOB_DESCRIPTIONS[jobType] ?? "Queued bookmark worker job.";
}

function bookmarkJobOrder(jobType: string) {
  const index = BOOKMARK_JOB_ORDER.findIndex((item) => item === jobType);
  return index === -1 ? BOOKMARK_JOB_ORDER.length : index;
}

function pairKey(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join(":");
}

function displayRelativeTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
    ["second", 1000]
  ];
  const [unit, size] = units.find(([, unitMs]) => abs >= unitMs) ?? ["second", 1000];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(diff / size), unit);
}

function DashboardTimeValue({ value, fallback }: { value?: string; fallback?: string }) {
  const absolute = displayDateTime(value);
  const relative = displayRelativeTime(value);
  if (!absolute) return <strong>{fallback ?? "None"}</strong>;
  return (
    <strong className="dashboard-time-value">
      <span>{absolute}</span>
      {relative && <small>{relative}</small>}
    </strong>
  );
}

function commentPlainText(value: string) {
  const fallback = value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  if (typeof document === "undefined") return fallback.replace(/\s+/g, " ").trim();
  const template = document.createElement("template");
  template.innerHTML = value;
  return (template.content.textContent ?? fallback).replace(/\s+/g, " ").trim();
}

function InlineExpandableText({
  text,
  expanded,
  onToggle,
  limit,
  className
}: {
  text: string;
  expanded: boolean;
  onToggle: () => void;
  limit: number;
  className: string;
}) {
  const cleanText = text.trim();
  const needsToggle = cleanText.length > limit;
  const visibleText = !expanded && needsToggle ? cleanText.slice(0, limit).trimEnd() : cleanText;
  return (
    <p className={expanded ? `${className} expanded` : className}>
      {visibleText || "No information available."}
      {needsToggle && (
        <span className="inline-toggle-wrap">
          {!expanded && "…"}
          <button className="inline-text-toggle" type="button" onClick={onToggle}>
            {expanded ? "less" : "more"}
          </button>
        </span>
      )}
    </p>
  );
}

function commentAuthorName(comment: CommentItem) {
  return comment.user?.name?.trim() || "Comix user";
}

function commentMetaLabel(comment: CommentItem) {
  const date = comment.createdAtFormatted || displayDateTime(comment.createdAt);
  const flags = [comment.isPinned ? "Pinned" : "", comment.isEdited ? "Edited" : ""].filter(Boolean);
  return [date, ...flags].filter(Boolean).join(" · ");
}

function commentReplyPreviewLimit(depth: number) {
  return depth === 0 ? 3 : 2;
}

function countLoadedCommentReplies(comment: CommentItem): number {
  const replies = comment.replies ?? [];
  return replies.reduce((total, reply) => total + 1 + countLoadedCommentReplies(reply), 0);
}

function CommentCard({
  comment,
  depth = 0,
  expanded = false
}: {
  comment: CommentItem;
  depth?: number;
  expanded?: boolean;
}) {
  const text = useMemo(() => commentPlainText(comment.contentHtml), [comment.contentHtml]);
  const allReplies = Array.isArray(comment.replies) ? comment.replies : [];
  const replies = expanded ? allReplies : allReplies.slice(0, commentReplyPreviewLimit(depth));
  const loadedReplyCount = countLoadedCommentReplies(comment);
  const avatarUrl = comment.user?.avatarUrl ? proxiedImageUrl(comment.user.avatarUrl) : undefined;
  const articleRef = useRef<HTMLElement | null>(null);
  const repliesRef = useRef<HTMLDivElement | null>(null);
  const [lineHeight, setLineHeight] = useState<number | undefined>();

  useLayoutEffect(() => {
    if (!replies.length) {
      setLineHeight(undefined);
      return undefined;
    }

    const article = articleRef.current;
    const repliesElement = repliesRef.current;
    if (!article || !repliesElement) return undefined;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const lastReply = repliesElement.lastElementChild;
        if (!(lastReply instanceof HTMLElement)) return;
        const articleRect = article.getBoundingClientRect();
        const lastReplyRect = lastReply.getBoundingClientRect();
        const articleStyles = window.getComputedStyle(article);
        const replyStyles = window.getComputedStyle(lastReply);
        const lineTop = Number.parseFloat(articleStyles.getPropertyValue("--comment-line-top")) || 0;
        const elbowStop = Number.parseFloat(replyStyles.getPropertyValue("--reply-elbow-stop")) || 27;
        const elbowTrim = Number.parseFloat(replyStyles.getPropertyValue("--reply-elbow-trim")) || 3;
        const nextHeight = Math.max(0, lastReplyRect.top - articleRect.top + elbowStop - elbowTrim - lineTop);
        setLineHeight((current) => (Math.abs((current ?? -1) - nextHeight) > 0.5 ? nextHeight : current));
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    observer.observe(repliesElement);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [replies.length, expanded, text]);

  return (
    <article
      ref={articleRef}
      className={depth > 0 ? "comment-card comment-card-reply" : "comment-card"}
      style={lineHeight !== undefined ? ({ "--comment-line-height": `${lineHeight}px` } as CSSProperties) : undefined}
    >
      <div className="comment-header">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="comment-avatar-fallback" aria-hidden="true">
            {commentAuthorName(comment).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <strong>{commentAuthorName(comment)}</strong>
          {commentMetaLabel(comment) && <span>{commentMetaLabel(comment)}</span>}
        </div>
      </div>
      <p>{text || "No comment text."}</p>
      <div className="comment-stats" aria-label="Comment stats">
        <span>{comment.likeCount ?? 0} likes</span>
        {(comment.dislikeCount ?? 0) > 0 && <span>{comment.dislikeCount} dislikes</span>}
        {loadedReplyCount > 0 && <span>{loadedReplyCount} {loadedReplyCount === 1 ? "reply" : "replies"}</span>}
      </div>
      {replies.length > 0 && (
        <div className="comment-replies" ref={repliesRef}>
          {replies.map((reply) => (
            <CommentCard key={reply.id} comment={reply} depth={depth + 1} expanded={expanded} />
          ))}
        </div>
      )}
    </article>
  );
}

function commentDisplayStats(comments: CommentItem[], expanded = true, depth = 0) {
  let replies = 0;
  for (const comment of comments) {
    const allNested = comment.replies ?? [];
    const nested = expanded ? allNested : allNested.slice(0, commentReplyPreviewLimit(depth));
    replies += nested.length;
    replies += commentDisplayStats(nested, expanded, depth + 1).replies;
  }
  return { comments: comments.length, replies };
}

function hasLoadedCommentsOutsidePreview(comments: CommentItem[], rootLimit: number, depth = 0) {
  if (depth === 0 && comments.length > rootLimit) return true;
  const visibleComments = depth === 0 ? comments.slice(0, rootLimit) : comments;
  for (const comment of visibleComments) {
    const replies = comment.replies ?? [];
    const replyLimit = commentReplyPreviewLimit(depth);
    if (replies.length > replyLimit) return true;
    if (hasLoadedCommentsOutsidePreview(replies.slice(0, replyLimit), rootLimit, depth + 1)) return true;
  }
  return false;
}

function commentCountText(commentCount: number, replyCount = 0) {
  const comments = `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`;
  if (!replyCount) return comments;
  return `${comments}, ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;
}

function threadCountText(comments: CommentPage | null) {
  const total = comments?.thread.commentCount;
  const main = comments?.thread.mainCommentCount;
  if (typeof total === "number" && typeof main === "number" && main > 0 && total >= main) {
    return commentCountText(main, total - main);
  }
  if (typeof total === "number" && total > 0) return commentCountText(total);
  return undefined;
}

function CommentsPanel({
  title,
  comments,
  loading,
  error,
  emptyLabel,
  loadingMore = false,
  expanded = false,
  previewLimit = 7,
  onShowMore,
  onShowLess,
  className = ""
}: {
  title: string;
  comments: CommentPage | null;
  loading: boolean;
  error: string;
  emptyLabel: string;
  loadingMore?: boolean;
  expanded?: boolean;
  previewLimit?: number;
  onShowMore?: () => void;
  onShowLess?: () => void;
  className?: string;
}) {
  const loadedComments = comments?.comments ?? [];
  const visibleComments = expanded ? loadedComments : loadedComments.slice(0, previewLimit);
  const visibleStats = commentDisplayStats(visibleComments, expanded);
  const visibleCount = visibleStats.comments + visibleStats.replies;
  const countLabel = threadCountText(comments) ?? commentCountText(visibleStats.comments, visibleStats.replies);
  const allCountLabel = threadCountText(comments);
  const totalThreadCount = comments?.thread.commentCount;
  const loadedStats = commentDisplayStats(loadedComments);
  const loadedCount = loadedStats.comments + loadedStats.replies;
  const hasReliableTotal = typeof totalThreadCount === "number" && totalThreadCount >= loadedCount;
  const hasLoadedHiddenItems = hasLoadedCommentsOutsidePreview(loadedComments, previewLimit);
  const hasMoreThanPreview = Boolean(
    comments &&
      (loadedComments.length > previewLimit ||
        hasLoadedHiddenItems ||
        (loadedComments.length >= previewLimit && hasReliableTotal && totalThreadCount > loadedCount) ||
        (!hasReliableTotal && Boolean(comments.cursor)))
  );
  const canShowMore = Boolean(
    onShowMore &&
      comments &&
      !expanded &&
      hasMoreThanPreview
  );
  const canShowLess = Boolean(onShowLess && expanded && hasMoreThanPreview);
  return (
    <section className={`comments-panel ${className}`.trim()}>
      <div className="section-heading compact comments-heading">
        <div>
          <h2>{title}</h2>
          <span>{visibleCount ? countLabel : "No comments loaded"}</span>
        </div>
      </div>
      {loading && <LoadingNotice label="Loading comments" />}
      {error && <div className="notice error">Comments could not be loaded: {error}</div>}
      {!loading && !error && visibleComments.length === 0 && <div className="notice">{emptyLabel}</div>}
      {!loading && !error && visibleComments.length > 0 && (
        <div className="comments-list">
          {visibleComments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} expanded={expanded} />
          ))}
        </div>
      )}
      {(canShowMore || canShowLess) && (
        <button
          className="comments-show-more-button"
          type="button"
          onClick={canShowLess ? onShowLess : onShowMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading comments..." : canShowLess ? "Show less" : `Show all ${allCountLabel ?? "comments"}`}
        </button>
      )}
    </section>
  );
}

function metadataSourceUrl(manga: MangaDetail) {
  const value = manga.links?.mu;
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z0-9]+$/i.test(value)) return `https://www.mangaupdates.com/series/${value}`;
  return undefined;
}

function metadataLinkUrl(kind: "mu" | "mal" | "al", value?: string) {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (kind === "mu" && /^[a-z0-9]+$/i.test(value)) return `https://www.mangaupdates.com/series/${value}`;
  if (kind === "mal" && /^\d+$/.test(value)) return `https://myanimelist.net/manga/${value}`;
  if (kind === "al" && /^\d+$/.test(value)) return `https://anilist.co/manga/${value}`;
  return undefined;
}

function metadataSourceLinks(manga: MangaDetail) {
  const label = manga.metadataSource || "";
  const links = [
    { label: "MangaUpdates", href: metadataLinkUrl("mu", manga.links?.mu), active: /mangaupdates/i.test(label) || Boolean(manga.links?.mu) },
    { label: "MyAnimeList", href: metadataLinkUrl("mal", manga.links?.mal), active: /myanimelist/i.test(label) || Boolean(manga.links?.mal) },
    { label: "AniList", href: metadataLinkUrl("al", manga.links?.al), active: /anilist/i.test(label) || Boolean(manga.links?.al) }
  ].filter((item) => item.active);
  return links.length ? links : undefined;
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

type ImportSource = "comick" | "comix";

interface ImportResult {
  favorites: MangaSummary[];
  progress: Array<{ source: string; mangaId: string; chapterId: string; chapterNumber?: string }>;
  unresolved: number;
  targetSource: string;
}

function normalizeImportedChapter(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const number = Number(trimmed);
  if (Number.isFinite(number)) return Number.isInteger(number) ? String(number) : String(number).replace(/0+$/, "").replace(/\.$/, "");
  return trimmed;
}

function parseComickImport(text: string): ImportResult {
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
  const progress: ImportResult["progress"] = [];
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

    const chapter = normalizeImportedChapter(read);
    if (chapter && chapter !== "0") {
      progress.push({
        source: "external",
        mangaId: hid,
        chapterId: chapter,
        chapterNumber: chapter
      });
    }
  }

  return { favorites, progress, unresolved: favorites.length, targetSource: "comix" };
}

function parseComixImport(text: string): ImportResult {
  const [headers = [], ...rows] = parseCsv(text);
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  if (!normalizedHeaders.includes("title") || !normalizedHeaders.includes("chapter")) {
    throw new Error("This does not look like a Comix reading list CSV.");
  }

  const headerIndex = new Map(normalizedHeaders.map((header, index) => [header, index]));

  function value(row: string[], key: string) {
    const index = headerIndex.get(key);
    return index === undefined ? "" : (row[index] || "").trim();
  }

  const favorites: MangaSummary[] = [];
  const progress: ImportResult["progress"] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const title = value(row, "title");
    if (!title) continue;
    const externalId = value(row, "url_mu") || value(row, "url_al") || value(row, "url_mal") || title;
    const key = externalId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    favorites.push({
      source: "external",
      id: externalId,
      title,
      description: [value(row, "url_mal"), value(row, "url_al"), value(row, "url_mu")].filter(Boolean).join("\n") || undefined,
      tags: []
    });

    const chapter = normalizeImportedChapter(value(row, "chapter"));
    if (chapter && chapter !== "0") {
      progress.push({
        source: "external",
        mangaId: externalId,
        chapterId: chapter,
        chapterNumber: chapter
      });
    }
  }

  return { favorites, progress, unresolved: favorites.length, targetSource: "comix" };
}

function parseImportFile(text: string, importSource: ImportSource) {
  return importSource === "comix" ? parseComixImport(text) : parseComickImport(text);
}

async function resolveImportedFavorites(imported: ImportResult): Promise<ImportResult> {
  const favorites: MangaSummary[] = [];
  const progress: ImportResult["progress"] = [];
  let unresolved = 0;

  for (const favorite of imported.favorites) {
    const readProgress = imported.progress.find((item) => item.mangaId === favorite.id);
    try {
      const { manga } = await searchManga(imported.targetSource, favorite.title, "en", 0, 5);
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

  return { favorites, progress, unresolved, targetSource: imported.targetSource };
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

function mergeChapterSummaries(existing: ChapterSummary[], incoming: ChapterSummary[]) {
  const chapters = new Map<string, ChapterSummary>();
  for (const chapter of existing) {
    chapters.set(`${chapter.source}:${chapter.id}`, chapter);
  }
  for (const chapter of incoming) {
    chapters.set(`${chapter.source}:${chapter.id}`, chapter);
  }
  return [...chapters.values()];
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

function chapterGroupMatchesSearch(group: ChapterGroup, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase().replace(/^ch(?:apter)?\.?\s*/, "");
  if (!query) return true;
  return group.chapters.some((chapter) => {
    const candidates = [group.label, chapter.chapter, compactChapterLabel(chapter.chapter), shortChapterLabel(chapter)]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return candidates.some((candidate) => candidate.includes(query));
  });
}

function chapterListLooksPartial(chapters: ChapterSummary[]) {
  if (!chapters.length) return false;
  return displayedChapterCount(chapters) > groupChaptersByNumber(chapters).length;
}

function updateKnownChapterSummaries(existing: ChapterSummary[], incoming: ChapterSummary[]) {
  if (!incoming.length) return existing;
  return chapterListLooksPartial(incoming) ? mergeChapterSummaries(existing, incoming) : incoming;
}

function chapterRangeSummary(chapters: ChapterSummary[]) {
  const values = [
    ...new Set(
      chapters
        .map((chapter) => chapterNumberValue(chapter.chapter))
        .filter((value): value is number => value !== undefined && Number.isInteger(value))
        .sort((left, right) => left - right)
    )
  ];
  if (!values.length) return "";

  const ranges: Array<{ start: number; end: number }> = [];
  for (const value of values) {
    const current = ranges[ranges.length - 1];
    if (current && value === current.end + 1) {
      current.end = value;
    } else {
      ranges.push({ start: value, end: value });
    }
  }

  return ranges
    .slice(0, 4)
    .map((range) => (range.start === range.end ? `Ch. ${range.start}` : `Ch. ${range.start}-${range.end}`))
    .join(", ");
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

function elementScrollProgressPercent(element: HTMLElement | null) {
  if (!element) return readingProgressPercent();
  const scrollTop = currentScrollPosition();
  const rect = element.getBoundingClientRect();
  const elementTop = scrollTop + rect.top;
  const elementBottom = elementTop + element.offsetHeight;
  const endScroll = Math.max(elementTop, elementBottom - window.innerHeight);
  const scrollableDistance = endScroll - elementTop;
  if (scrollableDistance <= 0) return scrollTop >= elementTop ? 100 : 0;
  return Math.min(100, Math.max(0, ((scrollTop - elementTop) / scrollableDistance) * 100));
}

function isLikelyInternalChapterId(value?: string) {
  const number = chapterNumberValue(value);
  return number !== undefined && Number.isInteger(number) && number >= 10000;
}

function chapterLabelFromStoredId(value?: string) {
  if (!value) return undefined;

  const numericValue = chapterNumberValue(value);
  if (numericValue !== undefined) return isLikelyInternalChapterId(value) ? undefined : value;

  const parts = value.split("~");
  if (parts.length >= 3) {
    const chapter = decodePathPart(parts[2]);
    if (chapterNumberValue(chapter) !== undefined) return chapter;
  }

  const decoded = decodePathPart(value);
  const match = decoded.match(/(?:^|[^a-z])(?:ch(?:apter)?\.?\s*|chapter[-_\s]*)(\d+(?:\.\d+)?)/i);
  return match?.[1];
}

function lastReadLabel(manga: FavoriteManga) {
  if (manga.lastReadChapter) return manga.lastReadChapter;
  return chapterLabelFromStoredId(manga.lastReadChapterId);
}

function progressLastReadLabel(progress: ReadingProgress, resolvedChapter?: string) {
  if (progress.chapterNumber) return progress.chapterNumber;
  if (resolvedChapter) return resolvedChapter;
  return chapterLabelFromStoredId(progress.chapterId);
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

function detailValues(values?: string[]) {
  return uniqueText(values ?? []).filter(Boolean);
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
  const [activeTab, setActiveTab] = useState(user.role === "admin" ? "dashboard" : "settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSource, setImportSource] = useState<ImportSource>("comick");
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
      .then((text) => parseImportFile(text, importSource))
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

  const tabs = user.role === "admin" ? ["dashboard", "admin", "settings"] : ["settings"];

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
            <span>{tab === "dashboard" ? "Dashboard" : tab}</span>
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
              <span>Import source</span>
              <select value={importSource} onChange={(event) => setImportSource(event.target.value as ImportSource)}>
                <option value="comick">Comick CSV</option>
                <option value="comix">Comix CSV</option>
              </select>
            </label>
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

      {activeTab === "dashboard" && user.role === "admin" && <AdminDashboardView />}

    </main>
  );
}

function AdminDashboardView() {
  const [dashboard, setDashboard] = useState<AdminDashboardStats | null>(null);
  const [memoryCache, setMemoryCache] = useState<MemoryCacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const numberFormat = useMemo(() => new Intl.NumberFormat(), []);

  function loadDashboard() {
    setLoading(true);
    setError("");
    fetchAdminDashboard()
      .then(({ dashboard, cache }) => {
        setDashboard(dashboard);
        setMemoryCache(cache);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const formatCount = (value?: number) => numberFormat.format(value ?? 0);
  const chapterWithPagesLabel = (value: number) => `${formatCount(value)} ${value === 1 ? "chapter" : "chapters"} with pages`;
  const totals = dashboard
    ? [
        { label: "Users", value: dashboard.totals.users },
        { label: "Bookmarks", value: dashboard.totals.favorites },
        { label: "Reading progress", value: dashboard.totals.readingProgress },
        { label: "Recommendations", value: dashboard.totals.recommendations },
        { label: "Unread recs", value: dashboard.totals.unreadRecommendations },
        { label: "Blocked pairs", value: dashboard.totals.interactionBlocks }
      ]
    : [];
  const cacheBars = dashboard
    ? [
        { label: "Title details", value: dashboard.cacheCoverage.titleDetails },
        { label: "Chapter lists", value: dashboard.cacheCoverage.chapterLists },
        { label: "Titles with pages", value: dashboard.cacheCoverage.chapterPageTitles },
        { label: "Chapters with pages", value: dashboard.cacheCoverage.chapterPageRows },
        { label: "Image URLs", value: dashboard.cacheCoverage.chapterPageImages },
        { label: "Canonical chapters", value: dashboard.totals.titleChapters },
        { label: "MU metadata", value: dashboard.totals.titleMetadata },
        { label: "MU links", value: dashboard.totals.metadataLinks }
      ]
    : [];
  const maxCacheBar = Math.max(1, ...cacheBars.map((item) => item.value));
  const maxSourceValue = Math.max(
    1,
    ...(dashboard?.sourceBreakdown ?? []).map((item) => item.titleDetails + item.chapterLists + item.chapterPageRows)
  );
  const maxJobTypeValue = Math.max(1, ...(dashboard?.jobTypes ?? []).map((item) => item.total));
  const userBookmarkRows = dashboard?.userBookmarks ?? [];
  const userActivityRows = dashboard?.userActivity ?? [];
  const maxUserBookmarks = Math.max(1, ...userBookmarkRows.map((item) => item.bookmarks));
  const memoryCacheRows = memoryCache
    ? [
        { label: "Entries", value: memoryCache.entries },
        { label: "Fresh", value: memoryCache.fresh },
        { label: "Stale", value: memoryCache.stale },
        { label: "Pending", value: memoryCache.pending }
      ]
    : [];
  const memoryCacheTitle = memoryCacheRows.map((item) => `${item.label}: ${formatCount(item.value)}`).join("\n");
  const refreshSchedules = dashboard?.refreshSchedules ?? [];
  const orderedJobTypes = dashboard
    ? [...dashboard.jobTypes].sort((left, right) => bookmarkJobOrder(left.jobType) - bookmarkJobOrder(right.jobType))
    : [];

  return (
    <section className="admin-dashboard">
      <div className="settings-panel-heading dashboard-heading">
        <div>
          <h2>Dashboard</h2>
          <p className="muted-text">DB storage, user activity, memory cache, and bookmark worker health.</p>
        </div>
        <button className="small-button" type="button" onClick={loadDashboard} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && !dashboard && <LoadingNotice label="Loading dashboard" />}

      {dashboard && (
        <>
          <section className="dashboard-stat-grid" aria-label="Application totals">
            {totals.map((item) => (
              <article className="dashboard-stat-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{formatCount(item.value)}</strong>
              </article>
            ))}
          </section>

          <section className="dashboard-grid">
            {refreshSchedules.length > 0 && (
              <article className="settings-panel dashboard-chart-panel dashboard-wide-panel">
                <h3>Refresh schedule</h3>
                <div className="refresh-schedule-list">
                  {refreshSchedules.map((item) => {
                    const interval = displayDuration(item.intervalMs);
                    return (
                      <div className="refresh-schedule-row" key={item.key} title={item.detail}>
                        <div>
                          <strong>{item.label}</strong>
                          {item.detail && <span>{item.detail}</span>}
                        </div>
                        <span className={`refresh-status refresh-status-${item.status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                          {item.status}
                        </span>
                        <div>
                          <span>Last</span>
                          <DashboardTimeValue value={item.lastRefreshedAt} />
                        </div>
                        <div>
                          <span>{item.status === "On demand" ? "Stale after" : "Next"}</span>
                          <DashboardTimeValue value={item.nextRefreshAt} fallback={interval ? `Every ${interval}` : "None"} />
                        </div>
                        <div>
                          <span>Interval</span>
                          <strong>{interval ?? "None"}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}

            <article className="settings-panel dashboard-chart-panel dashboard-wide-panel">
              <h3>User bookmarks</h3>
              <div className="user-bookmark-chart">
                {userBookmarkRows.map((item) => (
                  <div className="user-bookmark-row" key={item.userId}>
                    <div>
                      <strong>{item.username}</strong>
                      <span>{formatCount(item.bookmarks)} bookmarks</span>
                    </div>
                    <span
                      className="dashboard-bar-track"
                      title={`${item.username}: ${formatCount(item.bookmarks)} bookmarks`}
                      aria-label={`${item.username}: ${formatCount(item.bookmarks)} bookmarks`}
                    >
                      <span style={{ width: `${Math.max(item.bookmarks ? 4 : 0, (item.bookmarks / maxUserBookmarks) * 100)}%` }} />
                    </span>
                  </div>
                ))}
              </div>
              {!userBookmarkRows.length && <div className="notice">No bookmark rows yet.</div>}
            </article>

            <article className="settings-panel dashboard-chart-panel dashboard-wide-panel">
              <h3>User reading activity</h3>
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Last active</th>
                      <th>Last read title</th>
                      <th>Chapter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userActivityRows.map((item) => (
                      <tr key={item.userId}>
                        <td>{item.username}</td>
                        <td><DashboardTimeValue value={item.lastActiveAt} /></td>
                        <td>{item.lastReadTitle ?? "Not started"}</td>
                        <td>{item.lastReadChapter ? `Ch. ${item.lastReadChapter}` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!userActivityRows.length && <div className="notice">No user activity rows yet.</div>}
            </article>

            <article className="settings-panel dashboard-chart-panel">
              <h3>DB storage coverage</h3>
              <div className="dashboard-bars">
                {cacheBars.map((item) => (
                  <div className="dashboard-bar-row" key={item.label}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{formatCount(item.value)}</strong>
                    </div>
                    <span
                      className="dashboard-bar-track"
                      title={`${item.label}: ${formatCount(item.value)}\nScaled against ${formatCount(maxCacheBar)}, the largest value in this chart.`}
                      aria-label={`${item.label}: ${formatCount(item.value)}`}
                    >
                      <span style={{ width: `${Math.max(4, (item.value / maxCacheBar) * 100)}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="settings-panel dashboard-chart-panel">
              <h3>Memory cache</h3>
              <div className="chart-legend" aria-label="Memory cache legend">
                <span><i className="legend-fresh" />Fresh</span>
                <span><i className="legend-stale" />Stale</span>
                <span><i className="legend-pending" />Pending</span>
              </div>
              <div className="dashboard-donut-row">
                <div
                  className="dashboard-donut"
                  style={
                    {
                      "--fresh": `${memoryCache?.entries ? (memoryCache.fresh / memoryCache.entries) * 100 : 0}%`,
                      "--stale": `${memoryCache?.entries ? (memoryCache.stale / memoryCache.entries) * 100 : 0}%`
                    } as CSSProperties
                  }
                  title={memoryCacheTitle}
                  aria-label={memoryCacheTitle}
                />
                <div className="dashboard-mini-stats">
                  {memoryCacheRows.map((item) => (
                    <div key={item.label} title={`${item.label}: ${formatCount(item.value)}`}>
                      <span>{item.label}</span>
                      <strong>{formatCount(item.value)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="settings-panel dashboard-chart-panel dashboard-wide-panel">
              <h3>DB storage by source</h3>
              <div className="chart-legend" aria-label="DB storage by source legend">
                <span><i className="legend-title" />Title details</span>
                <span><i className="legend-list" />Chapter lists</span>
                <span><i className="legend-pages" />Chapters with pages</span>
              </div>
              <div className="source-breakdown-chart">
                {dashboard.sourceBreakdown.map((item) => {
                  const total = item.titleDetails + item.chapterLists + item.chapterPageRows;
                  return (
                    <div className="source-breakdown-row" key={item.source}>
                      <strong>{item.source}</strong>
                      <div
                        className="source-breakdown-bars"
                        aria-label={`${item.source}: ${formatCount(item.titleDetails)} titles, ${formatCount(item.chapterLists)} lists, ${chapterWithPagesLabel(item.chapterPageRows)}, ${formatCount(item.chapterPageImages)} images`}
                        title={`${item.source}\nTitle details: ${formatCount(item.titleDetails)}\nChapter lists: ${formatCount(item.chapterLists)}\nChapters with pages: ${formatCount(item.chapterPageRows)}\nImage URLs: ${formatCount(item.chapterPageImages)}`}
                      >
                        <span className="source-bar-title" title={`Title details: ${formatCount(item.titleDetails)}`} style={{ width: `${Math.max(3, (item.titleDetails / maxSourceValue) * 100)}%` }} />
                        <span className="source-bar-list" title={`Chapter lists: ${formatCount(item.chapterLists)}`} style={{ width: `${Math.max(3, (item.chapterLists / maxSourceValue) * 100)}%` }} />
                        <span className="source-bar-pages" title={`Chapters with pages: ${formatCount(item.chapterPageRows)}`} style={{ width: `${Math.max(3, (item.chapterPageRows / maxSourceValue) * 100)}%` }} />
                      </div>
                      <div className="source-metric-pills">
                        <span className="source-metric-pill source-metric-title">{formatCount(item.titleDetails)} titles</span>
                        <span className="source-metric-pill source-metric-list">{formatCount(item.chapterLists)} lists</span>
                        <span className="source-metric-pill source-metric-pages">{chapterWithPagesLabel(item.chapterPageRows)}</span>
                        <span className="source-metric-pill source-metric-images">{formatCount(item.chapterPageImages)} images</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!dashboard.sourceBreakdown.length && <div className="notice">No DB storage rows yet.</div>}
            </article>

            <article className="settings-panel dashboard-chart-panel dashboard-wide-panel">
              <h3>Bookmark worker jobs</h3>
              <div className="chart-legend" aria-label="Bookmark worker jobs legend">
                <span><i className="legend-pending" />Pending</span>
                <span><i className="legend-running" />Running</span>
                <span><i className="legend-done" />Done</span>
                <span><i className="legend-failed" />Failed</span>
              </div>
              <div className="job-status-pills">
                {dashboard.jobStatus.map((item) => (
                  <span key={item.status}>
                    {titleCaseLabel(item.status)}: <strong>{formatCount(item.count)}</strong>
                  </span>
                ))}
              </div>
              <div className="job-type-chart">
                {orderedJobTypes.map((item) => {
                  const jobLabel = bookmarkJobLabel(item.jobType);
                  const jobDescription = bookmarkJobDescription(item.jobType);
                  return (
                  <div className="job-type-row" key={item.jobType}>
                    <div className="job-type-label">
                      <strong>{jobLabel}</strong>
                      <span>{jobDescription}</span>
                    </div>
                    <div
                      className="job-type-stack"
                      aria-label={`${item.jobType} jobs`}
                      title={`${jobLabel}\n${jobDescription}\nPending: ${formatCount(item.pending)}\nRunning: ${formatCount(item.running)}\nDone: ${formatCount(item.done)}\nFailed: ${formatCount(item.failed)}\nTotal: ${formatCount(item.total)}`}
                    >
                      {BOOKMARK_JOB_STATUS_ORDER.map((status) => (
                        <span
                          key={status}
                          className={`job-segment job-segment-${status}`}
                          style={{ width: `${Math.max(item[status] ? 3 : 0, (item[status] / maxJobTypeValue) * 100)}%` }}
                          title={`${status}: ${formatCount(item[status])}`}
                        />
                      ))}
                    </div>
                    <div className="job-metric-pills">
                      {BOOKMARK_JOB_STATUS_ORDER.map((status) => (
                        <span key={status} className={`job-metric-pill job-metric-${status}`}>
                          {titleCaseLabel(status)} <strong>{formatCount(item[status])}</strong>
                        </span>
                      ))}
                      <span className="job-metric-pill job-metric-total">
                        Total <strong>{formatCount(item.total)}</strong>
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </article>

            <article className="settings-panel dashboard-chart-panel">
              <h3>Recent DB writes</h3>
              <div className="recent-cache-list">
                {dashboard.recentActivity.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value ? displayMetadataDate(item.value) : "None"}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      )}
    </section>
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
  const [noticeScope, setNoticeScope] = useState<"" | "create" | "users" | "interaction">("");
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
  const blockedPairKeys = useMemo(
    () => new Set(interactionBlocks.map((block) => pairKey(block.userAId, block.userBId))),
    [interactionBlocks]
  );
  const affectedUserCount = useMemo(
    () => new Set(interactionBlocks.flatMap((block) => [block.userAId, block.userBId])).size,
    [interactionBlocks]
  );
  const sortedInteractionBlocks = useMemo(
    () => [...interactionBlocks].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [interactionBlocks]
  );
  const blockUserAName = users.find((user) => user.id === blockUserAId)?.username;
  const blockUserBName = users.find((user) => user.id === blockUserBId)?.username;
  const blockPairAlreadyExists = Boolean(blockUserAId && blockUserBId && blockedPairKeys.has(pairKey(blockUserAId, blockUserBId)));
  const blockUserBOptions = users.filter((user) => {
    if (!blockUserAId) return true;
    if (user.id === blockUserAId) return false;
    return !blockedPairKeys.has(pairKey(blockUserAId, user.id));
  });

  function loadUsers() {
    setLoading(true);
    setNoticeScope("users");
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
    setNoticeScope("create");
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
    setNoticeScope("interaction");
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
    setNoticeScope("interaction");
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
    setNoticeScope("users");
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
    setNoticeScope("users");
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
    setNoticeScope("users");
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
        <form className="settings-panel admin-create-panel" onSubmit={submitCreate}>
          <h2>Create account</h2>
          {noticeScope === "create" && message && <div className="notice success">{message}</div>}
          {noticeScope === "create" && error && <div className="notice error">{error}</div>}
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
          {noticeScope === "users" && message && <div className="notice success">{message}</div>}
          {noticeScope === "users" && error && <div className="notice error">{error}</div>}
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

        <section className="settings-panel admin-interaction-panel">
          <div className="settings-panel-heading">
            <div>
              <h2>User interaction</h2>
              <p className="muted-text">Blocked pairs cannot see each other in Share or send recommendations to each other.</p>
            </div>
          </div>
          {noticeScope === "interaction" && message && <div className="notice success">{message}</div>}
          {noticeScope === "interaction" && error && <div className="notice error">{error}</div>}

          <div className="interaction-summary">
            <div>
              <span>Blocked pairs</span>
              <strong>{interactionBlocks.length}</strong>
            </div>
            <div>
              <span>Affected users</span>
              <strong>{affectedUserCount}</strong>
            </div>
          </div>

          <form className="interaction-block-form" onSubmit={submitInteractionBlock}>
            <div className="interaction-picker-grid">
              <label className="form-field">
                <span>First user</span>
                <select
                  value={blockUserAId}
                  onChange={(event) => {
                    setBlockUserAId(event.target.value);
                    setBlockUserBId("");
                  }}
                >
                  <option value="">Choose user</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.username}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Second user</span>
                <select value={blockUserBId} onChange={(event) => setBlockUserBId(event.target.value)} disabled={!blockUserAId}>
                  <option value="">{blockUserAId ? "Choose user" : "Choose first user"}</option>
                  {blockUserBOptions.map((user) => (
                    <option key={user.id} value={user.id}>{user.username}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="interaction-block-preview">
              {blockUserAId && blockUserBId ? (
                <span>{blockUserAName} and {blockUserBName} will be hidden from each other.</span>
              ) : blockUserAId && blockUserBOptions.length === 0 ? (
                <span>Every available pair for {blockUserAName} is already blocked.</span>
              ) : (
                <span>Select two users to block sharing and recommendations in both directions.</span>
              )}
            </div>
            <button className="primary-button" type="submit" disabled={!blockUserAId || !blockUserBId || blockPairAlreadyExists}>
              {blockPairAlreadyExists ? "Already blocked" : "Block pair"}
            </button>
          </form>

          <div className="interaction-block-list">
            {sortedInteractionBlocks.map((block) => (
              <article className="interaction-block-card" key={block.id}>
                <div className="interaction-block-users">
                  <span>{block.userAUsername}</span>
                  <small>blocked with</small>
                  <span>{block.userBUsername}</span>
                </div>
                <div className="interaction-block-meta">
                  <span>Added by {block.createdByUsername}</span>
                  <span>{displayDateTime(block.createdAt) ?? "Unknown date"}</span>
                </div>
                <button className="small-button" type="button" onClick={() => requestRemoveInteractionBlock(block)}>
                  Enable pair
                </button>
              </article>
            ))}
            {!interactionBlocks.length && !loading && <div className="notice">No blocked user pairs.</div>}
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
  userRole,
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
  userRole?: UserRole;
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
  const [chapterRefreshPending, setChapterRefreshPending] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [altTitlesExpanded, setAltTitlesExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [chapterPage, setChapterPage] = useState(0);
  const [chapterSort, setChapterSort] = useState<ChapterSortMode>("chapter-desc");
  const [chapterSearchInput, setChapterSearchInput] = useState("");
  const [chapterSearchTerm, setChapterSearchTerm] = useState("");
  const [similarTitles, setSimilarTitles] = useState<MangaSummary[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUserId, setShareUserId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [nsfwShareUserId, setNsfwShareUserId] = useState("");
  const [cacheStatus, setCacheStatus] = useState<TitleCacheStatus | null>(null);
  const [titleComments, setTitleComments] = useState<CommentPage | null>(null);
  const [titleCommentsLoading, setTitleCommentsLoading] = useState(false);
  const [titleCommentsLoadingMore, setTitleCommentsLoadingMore] = useState(false);
  const [titleCommentsExpanded, setTitleCommentsExpanded] = useState(false);
  const [titleCommentsError, setTitleCommentsError] = useState("");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const categoryTagsRef = useRef<HTMLDivElement | null>(null);
  const [categoryTagsNeedToggle, setCategoryTagsNeedToggle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCacheStatus(null);
    fetchTitleCacheStatus(source, id)
      .then(({ cache }) => {
        if (!cancelled) setCacheStatus(cache);
      })
      .catch(() => {
        if (!cancelled) setCacheStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const updateViewport = () => setIsMobileViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useLayoutEffect(() => {
    const element = categoryTagsRef.current;
    if (!element) {
      setCategoryTagsNeedToggle(false);
      return undefined;
    }
    const tagElement = element;

    function measureTags() {
      const styles = window.getComputedStyle(tagElement);
      const rowHeight = parseFloat(styles.getPropertyValue("--tag-row-height")) || 28;
      const rowGap = parseFloat(styles.getPropertyValue("--tag-row-gap")) || 6;
      const collapsedRows = parseFloat(styles.getPropertyValue("--tag-collapsed-rows")) || 2;
      const collapsedHeight = rowHeight * collapsedRows + rowGap * Math.max(collapsedRows - 1, 0);
      setCategoryTagsNeedToggle(tagElement.scrollHeight > collapsedHeight + 1);
    }

    measureTags();
    const observer = new ResizeObserver(measureTags);
    observer.observe(tagElement);
    window.addEventListener("resize", measureTags);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureTags);
    };
  }, [manga?.id, factsExpanded, tagsExpanded]);

  useEffect(() => {
    let cancelled = false;
    setTitleComments(null);
    setTitleCommentsError("");
    setTitleCommentsLoadingMore(false);
    setTitleCommentsExpanded(false);
    if (source !== "comix") {
      setTitleCommentsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setTitleCommentsLoading(true);
    fetchTitleComments(source, id, 7)
      .then((comments) => {
        if (!cancelled) setTitleComments(comments);
      })
      .catch((err: Error) => {
        if (!cancelled) setTitleCommentsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setTitleCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  function showAllTitleComments() {
    if (source !== "comix") return;
    setTitleCommentsLoadingMore(true);
    setTitleCommentsError("");
    fetchTitleComments(source, id, 50, true)
      .then((comments) => {
        setTitleComments(comments);
        setTitleCommentsExpanded(true);
      })
      .catch((err: Error) => setTitleCommentsError(err.message))
      .finally(() => setTitleCommentsLoadingMore(false));
  }

  function showLessTitleComments() {
    setTitleCommentsExpanded(false);
  }

  useEffect(() => {
    if (loading || chaptersLoading || chapterRefreshPending) return;
    let cancelled = false;
    fetchTitleCacheStatus(source, id)
      .then(({ cache }) => {
        if (!cancelled) setCacheStatus(cache);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source, id, loading, chaptersLoading, chapterRefreshPending, chapters.length]);

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
    const refreshDelayMs = 15000;
    setChapters([]);
    setChaptersError("");
    setChapterRefreshPending(false);
    setChaptersLoading(true);
    const chapterHintBookmark =
      favorites.find((item) => item.source === source && item.id === id) ??
      (manga?.canonicalKey ? favorites.find((item) => item.canonicalKey === manga.canonicalKey) : undefined);
    const chapterHintProgress =
      readingProgress.find((item) => item.source === source && item.mangaId === id) ??
      (manga?.canonicalKey ? readingProgress.find((item) => item.canonicalKey === manga.canonicalKey) : undefined);
    const chapterHint =
      chapterHintBookmark?.lastReadChapter ??
      chapterHintProgress?.chapterNumber ??
      chapterHintBookmark?.lastReadChapterId ??
      chapterHintProgress?.chapterId;

    const scheduleRefresh = (currentChapters: ChapterSummary[]) => {
      setChapterRefreshPending(true);
      refreshTimer = setTimeout(() => {
        fetchChapters(source, id, "en", chapterHint)
          .then((refreshed) => {
            if (cancelled) return;
            if (refreshed.chapters.length >= currentChapters.length) setChapters(refreshed.chapters);
            if (source === "comix" && chapterListLooksPartial(refreshed.chapters)) {
              scheduleRefresh(refreshed.chapters);
              return;
            }
            setChapterRefreshPending(false);
          })
          .catch(() => {
            if (!cancelled) setChapterRefreshPending(false);
          });
      }, refreshDelayMs);
    };

    fetchChapters(source, id, "en", chapterHint)
      .then((chapterResult) => {
        if (cancelled) return;
        setChapters(chapterResult.chapters);
        if (source === "comix" && chapterListLooksPartial(chapterResult.chapters)) scheduleRefresh(chapterResult.chapters);
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
  }, [source, id, manga?.canonicalKey, favorites, readingProgress]);

  const chapterGroups = useMemo(() => sortChapterGroups(groupChaptersByNumber(chapters), chapterSort), [chapters, chapterSort]);
  const searchedChapterGroups = useMemo(
    () => (chapterSearchTerm.trim() ? chapterGroups.filter((group) => chapterGroupMatchesSearch(group, chapterSearchTerm)) : chapterGroups),
    [chapterGroups, chapterSearchTerm]
  );
  const previewChapterSummary = useMemo(() => chapterRangeSummary(chapters), [chapters]);

		  useEffect(() => {
		    setSynopsisExpanded(false);
    setAltTitlesExpanded(false);
    setTagsExpanded(false);
    setFactsExpanded(false);
    setChapterPage(0);
    setChapterSearchInput("");
    setChapterSearchTerm("");
    setShareOpen(false);
    setShareUserId("");
    setShareMessage("");
    setShareError("");
    setNsfwShareUserId("");
	  }, [source, id]);

  useEffect(() => {
    setChapterPage(0);
  }, [chapterSort, chapterSearchTerm]);

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
    const maxPage = Math.max(Math.ceil(searchedChapterGroups.length / CHAPTER_PAGE_SIZE) - 1, 0);
    setChapterPage((current) => Math.min(current, maxPage));
  }, [searchedChapterGroups.length]);

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
  const displayTitle = preferredTitleFromAlternates(manga);
  const otherNames = uniqueText([manga.title, ...manga.altTitles]).filter((title) => title !== displayTitle).slice(0, 8);
  const otherNamesText = otherNames.join(", ");
  const genres = mangaGenres(manga);
  const categoryTags = mangaCategoryTags(manga);
  const metadataLinks = metadataSourceLinks(manga);
  const metadataUrl = metadataSourceUrl(manga);
  const latestChapterNumber = chapters.reduce<number | undefined>((latest, chapter) => {
    const value = chapterNumberValue(chapter.chapter);
    if (value === undefined) return latest;
    return latest === undefined || value > latest ? value : latest;
  }, undefined);
  const chapterCountLabel =
    latestChapterNumber !== undefined
      ? `${compactChapterLabel(String(latestChapterNumber))} Chapters`
      : chapterGroups.length
        ? `${chapterGroups.length} Chapters`
        : undefined;
  const titleTypeLabel = displayType(manga.demographic);
  const contentRatingLabel = manga.contentRating ? displayStatus(manga.contentRating) : undefined;
  const detailFacts = [
    { label: "Artist", value: detailValues(manga.artists) },
    { label: "Author", value: detailValues(manga.authors) },
    { label: "Publisher", value: detailValues(manga.publishers) },
    { label: "Release Year", value: manga.year ? String(manga.year) : undefined },
    { label: "Metadata Source", value: manga.metadataSource, href: metadataUrl, links: metadataLinks }
  ].filter((item) => (Array.isArray(item.value) ? item.value.length > 0 : Boolean(item.value)));
  const hasAdditionalDetails = detailFacts.length > 0 || genres.length > 0 || categoryTags.length > 0;
  const chapterSearchActive = Boolean(chapterSearchTerm.trim());
  const chapterListComplete = !chaptersLoading && !chaptersError && !chapterRefreshPending && !(source === "comix" && chapterListLooksPartial(chapters));
  const displayedChapterGroups = chapterListComplete ? searchedChapterGroups : chapterGroups;
  const chapterPageCount = Math.max(Math.ceil(displayedChapterGroups.length / CHAPTER_PAGE_SIZE), 1);
  const visibleChapterGroups = displayedChapterGroups.slice(chapterPage * CHAPTER_PAGE_SIZE, (chapterPage + 1) * CHAPTER_PAGE_SIZE);
  const chapterStart = chapterPage * CHAPTER_PAGE_SIZE + 1;
  const chapterEnd = Math.min((chapterPage + 1) * CHAPTER_PAGE_SIZE, displayedChapterGroups.length);
  const showChapterPagination = chapterPageCount > 1;
  const chapterPageNumbers = Array.from({ length: Math.min(5, chapterPageCount) }, (_, index) => {
    const start = Math.min(Math.max(chapterPage - 2, 0), Math.max(chapterPageCount - 5, 0));
    return start + index;
  });
  const titleBackdropUrl = proxiedImageUrl(manga.coverUrl);
  const titleBackdropStyle = titleBackdropUrl
    ? ({ "--title-backdrop": `url("${titleBackdropUrl.replace(/"/g, "%22")}")` } as CSSProperties)
    : undefined;
  const titleIsNsfw = isNsfw(manga);
  const eligibleShareUsers = titleIsNsfw ? shareUsers.filter((item) => item.nsfwAllowed) : shareUsers;
  const cacheBadges: Array<{ key: string; icon: typeof faDatabase; label: string; value?: string }> = [];
  if (userRole === "admin" && cacheStatus?.titleMetadata.cached) {
    cacheBadges.push({
      key: "metadata",
      icon: faDatabase,
      label: "Title metadata saved in database",
      value: cacheStatus.titleMetadata.checkedAt ? `Updated ${displayMetadataDate(cacheStatus.titleMetadata.checkedAt)}` : undefined
    });
  }
  if (userRole === "admin" && cacheStatus?.chapterList.cached) {
    cacheBadges.push({
      key: "chapters",
      icon: faListUl,
      label: `Chapter list saved in database (${cacheStatus.chapterList.chapters} chapters)`,
      value: `${cacheStatus.chapterList.chapters}`
    });
  }
  if (userRole === "admin" && cacheStatus?.chapterPages.cached) {
    cacheBadges.push({
      key: "pages",
      icon: faImages,
      label: `Chapter page URLs saved in database (${cacheStatus.chapterPages.chapters} chapters, ${cacheStatus.chapterPages.images} images)`,
      value: `${cacheStatus.chapterPages.chapters}`
    });
  }

  function ChapterPagination() {
    if (!showChapterPagination) return null;
    return (
      <div className="pagination-controls chapter-pagination" aria-label="Chapter list pagination">
        <span>{displayedChapterGroups.length ? `${chapterStart} - ${chapterEnd} of ${displayedChapterGroups.length}` : "0 of 0"}</span>
        <div className="chapter-pagination-pages">
          <button type="button" onClick={() => setChapterPage(0)} disabled={chapterPage === 0} aria-label="First page">
            <FontAwesomeIcon icon={faAnglesLeft} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setChapterPage((current) => Math.max(current - 1, 0))} disabled={chapterPage === 0} aria-label="Previous page">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
          </button>
          {chapterPageNumbers.map((page) => (
            <button
              key={page}
              className={page === chapterPage ? "active" : ""}
              type="button"
              onClick={() => setChapterPage(page)}
              aria-current={page === chapterPage ? "page" : undefined}
            >
              {page + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setChapterPage((current) => Math.min(current + 1, chapterPageCount - 1))}
            disabled={chapterPage >= chapterPageCount - 1}
            aria-label="Next page"
          >
            <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setChapterPage(chapterPageCount - 1)} disabled={chapterPage >= chapterPageCount - 1} aria-label="Last page">
            <FontAwesomeIcon icon={faAnglesRight} aria-hidden="true" />
          </button>
        </div>
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
            <p>Recommend "{displayTitle}" to another user.</p>
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
          <div className="title-cover-frame">
            <Cover manga={manga} />
            {favorite ? (
              <button
                className="cover-icon-button cover-bookmark-button active"
                type="button"
                onClick={() => onFavorite(manga)}
                aria-label="Remove bookmark"
                title="Remove bookmark"
              >
                <span className="bookmark-slash-icon" aria-hidden="true">
                  <BookmarkIcon active={true} />
                  <FontAwesomeIcon icon={faSlash} />
                </span>
              </button>
            ) : (
              <button className="cover-icon-button cover-bookmark-button" type="button" onClick={() => onFavorite(manga)} aria-label="Add bookmark" title="Add bookmark">
                <BookmarkIcon active={false} />
              </button>
            )}
            <button
              className="cover-icon-button cover-share-button"
              type="button"
              onClick={() => {
                setShareError("");
                setShareOpen(true);
              }}
              aria-label="Share"
              title="Share"
            >
              <ShareIcon />
            </button>
          </div>
          <div className="desktop-cover-actions">
            {favorite ? (
              <button className="danger-bookmark-button" type="button" onClick={() => onFavorite(manga)}>
                <span className="bookmark-slash-icon" aria-hidden="true">
                  <BookmarkIcon active={true} />
                  <FontAwesomeIcon icon={faSlash} />
                </span>
                Remove bookmark
              </button>
            ) : (
              <button className="bookmark-add-button" type="button" onClick={() => onFavorite(manga)}>
                <BookmarkIcon active={false} />
                Add bookmark
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
              Share
            </button>
          </div>
          {readTarget && (
            <button className="primary-button read-primary-button cover-read-button" onClick={() => onRead(readTarget, readScrollPosition)}>
              {readLabel}
            </button>
          )}
          {shareMessage && <div className="notice success share-notice">{shareMessage}</div>}
        </aside>

        <div className="title-main-column">
          <article className="title-info">
            <h1>{displayTitle}</h1>
            {otherNames.length > 0 && (
              <p className={altTitlesExpanded ? "title-alt-names expanded" : "title-alt-names"}>
                <span className="title-alt-names-full">{otherNamesText}</span>
                <span className="title-alt-names-mobile">
                  <span className="title-alt-names-mobile-text">{otherNamesText}</span>
                  {otherNamesText.length > 64 && (
                    <span className="inline-toggle-wrap">
                      <button className="inline-text-toggle" type="button" onClick={() => setAltTitlesExpanded((expanded) => !expanded)}>
                        {altTitlesExpanded ? "less" : "more"}
                      </button>
                    </span>
                  )}
                </span>
              </p>
            )}
            {cacheBadges.length > 0 && (
              <div className="title-cache-badges" aria-label="Database storage status">
                {cacheBadges.map((badge) => (
                  <span className="title-cache-badge" key={badge.key} title={badge.label} aria-label={badge.label}>
                    <FontAwesomeIcon icon={badge.icon} aria-hidden="true" />
                    <span>{badge.value ?? "Saved"}</span>
                  </span>
                ))}
              </div>
            )}
            {(manga.status || titleTypeLabel || contentRatingLabel || chapterCountLabel) && (
              <section className="title-detail-section status-section">
                <div className="status-pill-row">
                  {manga.status && <span className={statusClassName(manga.status)}>{displayStatus(manga.status)}</span>}
                  {titleTypeLabel && <span className="status-pill status-type">{titleTypeLabel}</span>}
                  {contentRatingLabel && <span className="status-pill status-content-rating">{contentRatingLabel}</span>}
                  {chapterCountLabel && <span className="status-pill status-chapters">{chapterCountLabel}</span>}
                </div>
              </section>
            )}
            <TitleRating manga={manga} />
            <section className="title-detail-section synopsis-section">
              <h2>Synopsis</h2>
              <InlineExpandableText
                text={manga.description || "No synopsis available."}
                expanded={synopsisExpanded}
                onToggle={() => setSynopsisExpanded((expanded) => !expanded)}
                limit={isMobileViewport ? 170 : 310}
                className="synopsis"
              />
            </section>
          </article>

          {hasAdditionalDetails && (
            <button className="mobile-toggle-button facts-toggle" type="button" onClick={() => setFactsExpanded((expanded) => !expanded)}>
              <FontAwesomeIcon icon={factsExpanded ? faChevronUp : faChevronDown} aria-hidden="true" />
              <span>{factsExpanded ? "Hide additional details" : "Show additional details"}</span>
            </button>
          )}

          {hasAdditionalDetails && (
            <aside className={factsExpanded ? "detail-facts expanded" : "detail-facts"} aria-label="Details">
              {genres.length > 0 && (
                <div className="fact-card fact-card-wide detail-tag-card">
                  <span>Genre</span>
                  <div className="tag-row genre-tags">
                    {genres.map((tag) => (
                      <button key={tag} type="button" onClick={() => onTagSearch(tag)}>{tag}</button>
                    ))}
                  </div>
                </div>
              )}
              {categoryTags.length > 0 && (
                <div className="fact-card fact-card-wide detail-tag-card">
                  <span>Categories</span>
                  <div ref={categoryTagsRef} className={tagsExpanded ? "tag-row category-tags expanded" : "tag-row category-tags"}>
                    {categoryTags.map((tag) => (
                      <button key={tag} type="button" onClick={() => onTagSearch(tag)}>{tag}</button>
                    ))}
                  </div>
                  {categoryTagsNeedToggle && (
                    <button className="text-toggle-button tags-toggle" type="button" onClick={() => setTagsExpanded((expanded) => !expanded)}>
                      {tagsExpanded ? "less" : "more"}
                    </button>
                  )}
                </div>
              )}
              {detailFacts.map((fact) => (
                <div className="fact-card" key={fact.label}>
                  <span>{fact.label}</span>
                  {fact.links?.length ? (
                    <span className="fact-link-row">
                      {fact.links.map((link) =>
                        link.href ? (
                          <a key={link.label} className="fact-source-link" href={link.href} target="_blank" rel="noreferrer">
                            {link.label}
                          </a>
                        ) : (
                          <span key={link.label} className="fact-source-link static">{link.label}</span>
                        )
                      )}
                    </span>
                  ) : Array.isArray(fact.value) ? (
                    <span className="fact-value-row">
                      {fact.value.map((value) => (
                        <span className="fact-value" key={value}>{value}</span>
                      ))}
                    </span>
                  ) : fact.href ? (
                    <a className="fact-value" href={fact.href} target="_blank" rel="noreferrer">{fact.value}</a>
                  ) : (
                    <span className="fact-value">{fact.value}</span>
                  )}
                </div>
              ))}
            </aside>
          )}
        </div>

      </section>

      {readTarget && (
        <button className="primary-button read-primary-button mobile-floating-read-button" onClick={() => onRead(readTarget, readScrollPosition)}>
          {readLabel}
        </button>
      )}

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
        {!chaptersLoading && !chaptersError && chapterRefreshPending && (
          <div className="chapter-refresh-status" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span>
              Loading full chapter list
              {previewChapterSummary ? `, currently showing ${previewChapterSummary}` : ""}
            </span>
          </div>
        )}
        {!chaptersLoading && !chaptersError && <ChapterPagination />}
        {chapterListComplete && chapterGroups.length > 0 && (
          <div className="chapter-list-tools">
            <div className="chapter-search-form">
              <label>
                <span>Chapter</span>
                <input
                  type="search"
                  inputMode="decimal"
                  value={chapterSearchInput}
                  onChange={(event) => {
                    setChapterSearchInput(event.target.value);
                    setChapterSearchTerm(event.target.value.trim());
                  }}
                  placeholder="Number"
                  aria-label="Chapter number"
                />
              </label>
            </div>
          </div>
        )}
        {chapterListComplete && chapterSearchActive && (
          <div className="chapter-search-status">
            {displayedChapterGroups.length
              ? `Showing ${displayedChapterGroups.length} ${displayedChapterGroups.length === 1 ? "match" : "matches"} for Ch. ${chapterSearchTerm}`
              : `No chapters found for Ch. ${chapterSearchTerm}`}
          </div>
        )}
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
        {!chaptersLoading && !chaptersError && !chapterSearchActive && !chapterGroups.length && <div className="notice">No hosted image chapters are available for this title.</div>}
        {!chaptersLoading && !chaptersError && chapterSearchActive && !displayedChapterGroups.length && <div className="notice">No matching chapters are available.</div>}
      </section>

      {source === "comix" && (
        <CommentsPanel
          title="Comments"
          comments={titleComments}
          loading={titleCommentsLoading}
          error={titleCommentsError}
          emptyLabel="No comments yet."
          loadingMore={titleCommentsLoadingMore}
          expanded={titleCommentsExpanded}
          previewLimit={7}
          onShowMore={showAllTitleComments}
          onShowLess={showLessTitleComments}
        />
      )}

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
  const [chaptersRefreshing, setChaptersRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [chapterError, setChapterError] = useState("");
  const chaptersRef = useRef<ChapterSummary[]>([]);
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
  const pagesElement = useRef<HTMLElement | null>(null);
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
  const [topChapterControlsEnabled, setTopChapterControlsEnabled] = useState(loadReaderTopControls);
  const [readerCommentsPanelOpen, setReaderCommentsPanelOpen] = useState(false);
  const [readerCommentsRevealReady, setReaderCommentsRevealReady] = useState(false);
  const [pagedPageIndex, setPagedPageIndex] = useState(0);
  const [readerPercent, setReaderPercent] = useState(0);
  const [readerTipVisible, setReaderTipVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobilePanelAnchor, setMobilePanelAnchor] = useState<"top" | "bottom">("bottom");
  const [chapterComments, setChapterComments] = useState<CommentPage | null>(null);
  const [chapterCommentsLoading, setChapterCommentsLoading] = useState(false);
  const [chapterCommentsLoadingMore, setChapterCommentsLoadingMore] = useState(false);
  const [chapterCommentsExpanded, setChapterCommentsExpanded] = useState(false);
  const [chapterCommentsError, setChapterCommentsError] = useState("");

  useEffect(() => {
    chaptersRef.current = [];
    setChapters([]);
  }, [source, mangaId]);

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
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshDelayMs = 15000;
    setChaptersLoading(true);
    setChaptersRefreshing(false);
    setChapterError("");

    const scheduleFullRefresh = (currentChapters: ChapterSummary[]) => {
      if (source !== "comix" || !chapterListLooksPartial(currentChapters)) {
        setChaptersRefreshing(false);
        return;
      }
      refreshTimer = setTimeout(() => {
        setChaptersRefreshing(true);
        fetchChapters(source, mangaId, "en", chapterNumber)
          .then((refreshed) => {
            if (cancelled) return;
            const nextChapters = updateKnownChapterSummaries(chaptersRef.current, refreshed.chapters);
            chaptersRef.current = nextChapters;
            setChapters(nextChapters);
            setChaptersRefreshing(false);
            if (chapterListLooksPartial(nextChapters)) {
              scheduleFullRefresh(nextChapters);
              return;
            }
          })
          .catch(() => {
            if (!cancelled) setChaptersRefreshing(false);
          });
      }, refreshDelayMs);
    };

    Promise.all([fetchManga(source, mangaId), fetchChapters(source, mangaId, "en", chapterNumber)])
      .then(([mangaResult, chapterResult]) => {
        if (!cancelled) {
          setManga(mangaResult.manga);
          const nextChapters = updateKnownChapterSummaries(chaptersRef.current, chapterResult.chapters);
          chaptersRef.current = nextChapters;
          setChapters(nextChapters);
          scheduleFullRefresh(nextChapters);
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
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [source, mangaId, chapterNumber]);

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
    let cancelled = false;
    const targetChapterNumber = currentChapter?.chapter ?? chapterNumber;
    setChapterComments(null);
    setChapterCommentsError("");
    setChapterCommentsLoadingMore(false);
    setChapterCommentsExpanded(false);
    setChapterCommentsLoading(false);
    if (!readerCommentsPanelOpen || !readerCommentsRevealReady || source !== "comix" || !targetChapterNumber || chapterComments) {
      setChapterCommentsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setChapterCommentsLoading(true);
    fetchChapterComments(source, mangaId, targetChapterNumber, currentChapter?.volume ?? "0", 20)
      .then((comments) => {
        if (!cancelled) setChapterComments(comments);
      })
      .catch((err: Error) => {
        if (!cancelled) setChapterCommentsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setChapterCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readerCommentsPanelOpen, readerCommentsRevealReady, source, mangaId, chapterNumber, currentChapter?.chapter, currentChapter?.volume]);

  useEffect(() => {
    setReaderCommentsPanelOpen(false);
    setReaderCommentsRevealReady(false);
  }, [source, mangaId, chapterId]);

  function showAllChapterComments() {
    const targetChapterNumber = currentChapter?.chapter ?? chapterNumber;
    if (source !== "comix" || !targetChapterNumber) return;
    setChapterCommentsLoadingMore(true);
    setChapterCommentsError("");
    fetchChapterComments(source, mangaId, targetChapterNumber, currentChapter?.volume ?? "0", 50, true)
      .then((comments) => {
        setChapterComments(comments);
        setChapterCommentsExpanded(true);
      })
      .catch((err: Error) => setChapterCommentsError(err.message))
      .finally(() => setChapterCommentsLoadingMore(false));
  }

  function showLessChapterComments() {
    setChapterCommentsExpanded(false);
  }

  useEffect(() => {
    if (readerDirection === "top-to-bottom") setReaderPageMode("single");
  }, [readerDirection]);

  useEffect(() => {
    if (!readerCommentsPanelOpen) {
      setReaderCommentsRevealReady(false);
      return;
    }
    setReaderCommentsRevealReady(false);
    const timeout = window.setTimeout(() => setReaderCommentsRevealReady(true), 2000);
    return () => window.clearTimeout(timeout);
  }, [readerCommentsPanelOpen]);

  useEffect(() => {
    if (!readerCommentsPanelOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [readerCommentsPanelOpen]);

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
    try {
      localStorage.setItem(READER_TOP_CONTROLS_KEY, String(topChapterControlsEnabled));
    } catch {
      // The duplicate controls preference is optional.
    }
  }, [topChapterControlsEnabled]);

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
      setReaderPercent(elementScrollProgressPercent(pagesElement.current));
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

  function adjacentChapterFromList(list: ChapterSummary[], direction: "previous" | "next") {
    const groups = sortChapterGroups(groupChaptersByNumber(list), "chapter-asc");
    const groupIndex = groups.findIndex((group) =>
      group.chapters.some((chapter) => chapter.id === chapterId) ||
      (currentValue !== undefined && group.sortValue === currentValue)
    );
    if (groupIndex < 0) return undefined;
    const adjacentGroup = groups[groupIndex + (direction === "next" ? 1 : -1)];
    return adjacentGroup ? preferredChapterChoice(adjacentGroup.chapters, currentChapter, chapterId) : undefined;
  }

  function hasAdjacentGap(candidate?: ChapterSummary) {
    const candidateValue = chapterNumberValue(candidate?.chapter);
    if (currentValue === undefined || candidateValue === undefined) return false;
    return Math.abs(candidateValue - currentValue) > 1.0001;
  }

  function targetChapterForAdjacentRefresh(direction: "previous" | "next", candidate?: ChapterSummary) {
    if (currentValue !== undefined && Number.isInteger(currentValue)) {
      return String(direction === "next" ? currentValue + 1 : Math.max(0, currentValue - 1));
    }
    return candidate?.chapter ?? chapterNumber;
  }

  async function changeAdjacentChapter(direction: "previous" | "next") {
    const knownChapters = chaptersRef.current.length ? chaptersRef.current : chapters;
    let candidate = adjacentChapterFromList(knownChapters, direction) ?? (direction === "next" ? nextChapter : previousChapter);
    const shouldRefreshChapterList = source === "comix" && chapterListLooksPartial(knownChapters);
    if (!candidate && !shouldRefreshChapterList) {
      leaveReader();
      return;
    }

    if (shouldRefreshChapterList) {
      const targetChapter = targetChapterForAdjacentRefresh(direction, candidate);
      setChaptersRefreshing(true);
      setChapterError("");
      try {
        const refreshed = await fetchChapters(source, mangaId, "en", targetChapter);
        const nextChapters = updateKnownChapterSummaries(chaptersRef.current, refreshed.chapters);
        chaptersRef.current = nextChapters;
        setChapters(nextChapters);
        candidate = adjacentChapterFromList(nextChapters, direction) ?? candidate;
      } catch (err) {
        setChapterError(err instanceof Error ? err.message : "Chapter list could not be refreshed.");
        setChaptersRefreshing(false);
        return;
      } finally {
        setChaptersRefreshing(false);
      }
    }

    if (!candidate) {
      leaveReader();
      return;
    }

    if (!hasAdjacentGap(candidate)) {
      changeChapter(candidate);
      return;
    }

    const targetChapter = targetChapterForAdjacentRefresh(direction, candidate);
    setChapterError(`Chapter ${targetChapter ?? "list"} is still loading. Try again in a moment.`);
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
    void changeAdjacentChapter("previous");
  }

  function goPagedNext() {
    const pageCount = pages?.pages.length ?? 0;
    const step = readerPageMode === "double" ? 2 : 1;
    if (pagedPageIndex + step < pageCount) {
      setPagedPageIndex((index) => Math.min(Math.max(0, pageCount - 1), index + step));
      return;
    }
    void changeAdjacentChapter("next");
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

  const chapterCommentStats = commentDisplayStats(chapterComments?.comments ?? []);
  const chapterCommentCountLabel =
    threadCountText(chapterComments) ?? commentCountText(chapterCommentStats.comments, chapterCommentStats.replies);
  const commentsToggleLabel = readerCommentsPanelOpen ? "Close comments" : "Open comments";

  function toggleReaderComments() {
    setReaderCommentsPanelOpen((open) => !open);
    setMobilePickerOpen(false);
    setMobileSettingsOpen(false);
    setMobileControlsVisible(true);
  }

  function closeReaderComments() {
    setReaderCommentsPanelOpen(false);
    setReaderCommentsRevealReady(false);
  }

  function ReaderCommentToggleButton({ compact = false }: { compact?: boolean }) {
    return (
      <button
        className={compact ? "reader-mobile-icon-button reader-comment-icon-button" : "reader-comment-toggle"}
        type="button"
        onClick={toggleReaderComments}
        aria-pressed={readerCommentsPanelOpen}
        aria-label={commentsToggleLabel}
        title={commentsToggleLabel}
      >
        <FontAwesomeIcon icon={faCommentDots} aria-hidden="true" />
        {!compact && <span>{readerCommentsPanelOpen ? "Comments open" : "Comments"}</span>}
      </button>
    );
  }

  function ReaderCommentsSkeleton() {
    return (
      <div className="reader-comments-skeleton" aria-label="Preparing comments">
        <article className="comment-card comment-card-skeleton has-skeleton-replies">
          <span className="skeleton-thread-line" aria-hidden="true" />
          <div className="comment-header">
            <span className="comment-avatar-fallback reader-skeleton-pulse" aria-hidden="true" />
            <div>
              <strong className="reader-skeleton-pulse" />
              <span className="reader-skeleton-pulse" />
            </div>
          </div>
          <p>
            <i className="reader-skeleton-pulse" />
            <i className="reader-skeleton-pulse" />
            <i className="reader-skeleton-pulse short" />
          </p>
          <div className="comment-stats">
            <span className="reader-skeleton-pulse" />
            <span className="reader-skeleton-pulse" />
          </div>
          <div className="comment-replies">
            <article className="comment-card comment-card-reply comment-card-skeleton has-skeleton-replies">
              <span className="skeleton-reply-elbow" aria-hidden="true" />
              <span className="skeleton-thread-line" aria-hidden="true" />
              <div className="comment-header">
                <span className="comment-avatar-fallback reader-skeleton-pulse" aria-hidden="true" />
                <div>
                  <strong className="reader-skeleton-pulse" />
                  <span className="reader-skeleton-pulse" />
                </div>
              </div>
              <p>
                <i className="reader-skeleton-pulse" />
                <i className="reader-skeleton-pulse short" />
              </p>
              <div className="comment-stats">
                <span className="reader-skeleton-pulse" />
              </div>
              <div className="comment-replies">
                <article className="comment-card comment-card-reply comment-card-skeleton">
                  <span className="skeleton-reply-elbow" aria-hidden="true" />
                  <div className="comment-header">
                    <span className="comment-avatar-fallback reader-skeleton-pulse" aria-hidden="true" />
                    <div>
                      <strong className="reader-skeleton-pulse" />
                      <span className="reader-skeleton-pulse" />
                    </div>
                  </div>
                  <p>
                    <i className="reader-skeleton-pulse" />
                    <i className="reader-skeleton-pulse short" />
                  </p>
                  <div className="comment-stats">
                    <span className="reader-skeleton-pulse" />
                  </div>
                </article>
              </div>
            </article>
            <article className="comment-card comment-card-reply comment-card-skeleton">
              <span className="skeleton-reply-elbow" aria-hidden="true" />
              <div className="comment-header">
                <span className="comment-avatar-fallback reader-skeleton-pulse" aria-hidden="true" />
                <div>
                  <strong className="reader-skeleton-pulse" />
                  <span className="reader-skeleton-pulse" />
                </div>
              </div>
              <p>
                <i className="reader-skeleton-pulse" />
                <i className="reader-skeleton-pulse short" />
              </p>
              <div className="comment-stats">
                <span className="reader-skeleton-pulse" />
              </div>
            </article>
          </div>
        </article>
        <article className="comment-card comment-card-skeleton">
          <div className="comment-header">
            <span className="comment-avatar-fallback reader-skeleton-pulse" aria-hidden="true" />
            <div>
              <strong className="reader-skeleton-pulse" />
              <span className="reader-skeleton-pulse" />
            </div>
          </div>
          <p>
            <i className="reader-skeleton-pulse" />
            <i className="reader-skeleton-pulse short" />
          </p>
          <div className="comment-stats">
            <span className="reader-skeleton-pulse" />
          </div>
        </article>
      </div>
    );
  }

  function ReaderCommentsDrawer() {
    if (!readerCommentsPanelOpen || source !== "comix") return null;
    const waitingToReveal = !readerCommentsRevealReady;
    const showingSkeleton = waitingToReveal || (!chapterComments && !chapterCommentsError);
    return (
      <div className="reader-comments-drawer-backdrop" role="presentation" onClick={closeReaderComments}>
        <aside
          className="reader-comments-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reader-comments-title"
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <header className="reader-comments-drawer-header">
            <div>
              <h2 id="reader-comments-title">Comments</h2>
              {showingSkeleton ? <span className="reader-comments-count-skeleton reader-skeleton-pulse" aria-hidden="true" /> : <span>{chapterCommentCountLabel}</span>}
              <p>
                These comments may contain <strong>spoilers</strong> for this chapter.
              </p>
            </div>
            <button className="reader-comments-close" type="button" onClick={closeReaderComments} aria-label="Close comments">
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          </header>
          {showingSkeleton ? (
            <ReaderCommentsSkeleton />
          ) : (
            <CommentsPanel
              title="Comments"
              comments={chapterComments}
              loading={chapterCommentsLoading}
              error={chapterCommentsError}
              emptyLabel="No comments yet."
              loadingMore={chapterCommentsLoadingMore}
              expanded={chapterCommentsExpanded}
              previewLimit={20}
              onShowMore={showAllChapterComments}
              onShowLess={showLessChapterComments}
              className="reader-comments reader-comments-drawer-panel"
            />
          )}
        </aside>
      </div>
    );
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
      <div className={`reader-mobile-panel reader-mobile-panel--${mobilePanelAnchor}`} role="dialog" aria-modal="false">
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

            <div className="reader-mobile-panel__title">Chapter controls</div>
            <div className="reader-setting-group" role="group" aria-label="Chapter controls">
              <button className={topChapterControlsEnabled ? "active" : ""} type="button" onClick={() => setTopChapterControlsEnabled((enabled) => !enabled)}>
                <FontAwesomeIcon icon={faArrowUp} aria-hidden="true" />
                <span>Top controls</span>
              </button>
            </div>

          </>
        )}
      </div>
    );
  }

  function openMobilePicker(anchor: "top" | "bottom") {
    setMobilePanelAnchor(anchor);
    setMobileSettingsOpen(false);
    setMobilePickerOpen((open) => (mobilePanelAnchor === anchor ? !open : true));
    setMobileControlsVisible(true);
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
        {topChapterControlsEnabled && (
          <div className="reader-mobile-controls reader-mobile-controls--top" aria-label="Top reader controls">
            <button className="reader-mobile-icon-button" type="button" onClick={() => void changeAdjacentChapter("previous")} disabled={chaptersRefreshing} aria-label="Previous chapter">
              <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
            </button>
            <button className="reader-mobile-chapter-button" type="button" onClick={() => openMobilePicker("top")}>
              <span>{readerChapterProgressLabel}</span>
              <FontAwesomeIcon icon={faChevronUp} aria-hidden="true" />
            </button>
            <button className="reader-mobile-icon-button" type="button" onClick={() => void changeAdjacentChapter("next")} disabled={chaptersRefreshing} aria-label="Next chapter">
              <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
            </button>
          </div>
        )}
        <MobileReaderPanel />
        <div className="reader-mobile-controls" aria-label="Reader controls">
          <button className="reader-mobile-icon-button" type="button" onClick={() => void changeAdjacentChapter("previous")} disabled={chaptersRefreshing} aria-label="Previous chapter">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
          </button>
          <button
            className="reader-mobile-chapter-button"
            type="button"
            onClick={() => openMobilePicker("bottom")}
          >
            <span>{readerChapterProgressLabel}</span>
            <FontAwesomeIcon icon={faChevronUp} aria-hidden="true" />
          </button>
          <button className="reader-mobile-icon-button" type="button" onClick={() => void changeAdjacentChapter("next")} disabled={chaptersRefreshing} aria-label="Next chapter">
            <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
          </button>
          <div className="reader-mobile-tools" aria-label="Reader tools">
            {source === "comix" && <ReaderCommentToggleButton compact />}
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
                setMobilePanelAnchor("bottom");
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

        <div className={source === "comix" ? "reader-nav-pair with-comments" : "reader-nav-pair"}>
          <button className="reader-nav-button" type="button" onClick={() => void changeAdjacentChapter("previous")} disabled={chaptersRefreshing}>
            <ArrowLeftIcon />
            <span>{previousChapter ? `Previous ${shortChapterLabel(previousChapter)}` : "Previous: title"}</span>
          </button>
          <button className="reader-nav-button" type="button" onClick={() => void changeAdjacentChapter("next")} disabled={chaptersRefreshing}>
            <span>{chaptersRefreshing ? "Loading chapters..." : nextChapter ? `Next ${shortChapterLabel(nextChapter)}` : "Next: title"}</span>
            <ArrowRightIcon />
          </button>
          {source === "comix" && <ReaderCommentToggleButton />}
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
      {loading && (
        <div className="reader-loading-center">
          <LoadingNotice label="Loading pages" />
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {!loading && chaptersRefreshing && <LoadingNotice label="Loading more chapters" />}
      {chapterError && <div className="notice error">{chapterError}</div>}
      {!loading && <ReaderControls placement="top" />}
      <section
        ref={pagesElement}
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
      <ReaderCommentsDrawer />
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
            userRole={user?.role}
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
