export interface SourceInfo {
  id: string;
  name: string;
  kind: "api" | "scraper";
  enabled: boolean;
  website?: string;
  note?: string;
  disabledReason?: string;
}

export interface SourceHealth {
  id: string;
  name: string;
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
  sampleTitle?: string;
  error?: string;
}

export interface AdminDashboardStats {
  totals: Record<string, number>;
  cacheCoverage: {
    titleDetails: number;
    chapterLists: number;
    chapterPageTitles: number;
    chapterPageRows: number;
    chapterPageImages: number;
  };
  sourceBreakdown: Array<{
    source: string;
    titleDetails: number;
    chapterLists: number;
    chapterPageTitles: number;
    chapterPageRows: number;
    chapterPageImages: number;
  }>;
  userBookmarks: Array<{
    userId: string;
    username: string;
    bookmarks: number;
  }>;
  userActivity: Array<{
    userId: string;
    username: string;
    lastActiveAt?: string;
    lastReadTitle?: string;
    lastReadChapter?: string;
    lastReadSource?: string;
    lastReadMangaId?: string;
  }>;
  jobStatus: Array<{ status: string; count: number }>;
  jobTypes: Array<{ jobType: string; pending: number; running: number; done: number; failed: number; total: number }>;
  jobActivity: {
    latestCheckLastCompletedAt?: string;
    latestCheckNextQueuedAt?: string;
    latestChaptersLastCompletedAt?: string;
    workerLastCompletedAt?: string;
  };
  recentActivity: Array<{ label: string; value?: string }>;
  refreshSchedules?: Array<{
    key: string;
    label: string;
    status: string;
    lastRefreshedAt?: string;
    nextRefreshAt?: string;
    intervalMs?: number;
    detail?: string;
  }>;
}

export interface MemoryCacheStats {
  entries: number;
  fresh: number;
  stale: number;
  pending: number;
}

export interface TitleCacheStatus {
  source: string;
  mangaId: string;
  titleMetadata: {
    cached: boolean;
    compiled: boolean;
    linked: boolean;
    checkedAt?: string;
  };
  chapterList: {
    cached: boolean;
    chapters: number;
    checkedAt?: string;
    error?: string;
  };
  chapterPages: {
    cached: boolean;
    chapters: number;
    images: number;
    checkedAt?: string;
  };
}

export interface MangaSummary {
  source: string;
  id: string;
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
  communityRating?: number;
  ratingVotes?: number;
  metadataSource?: string;
  metadataUpdatedAt?: string;
  genres?: string[];
  categories?: string[];
  tags: string[];
}

export interface HomeManga extends MangaSummary {
  bookmarked?: boolean;
  lastReadChapter?: string;
  lastReadChapterId?: string;
  scrollPosition?: number;
  updatedAt?: string;
}

export interface MangaDetail extends MangaSummary {
  altTitles: string[];
  links: Record<string, string>;
  artists?: string[];
  authors?: string[];
  publishers?: string[];
  language?: string;
  ratingDistribution?: Array<{ rating: number; count: number }>;
  mirrors?: MangaSummary[];
}

export interface ChapterSummary {
  source: string;
  id: string;
  mangaId: string;
  title: string;
  chapter?: string;
  volume?: string;
  language: string;
  publishedAt?: string;
  readableAt?: string;
  groups: string[];
  pages?: number;
  externalUrl?: string;
}

export interface ChapterPages {
  source: string;
  id: string;
  pages: string[];
}

export type CommentSort = "best" | "newest" | "oldest";

export interface CommentUser {
  id?: string;
  name?: string;
  avatarUrl?: string;
}

export interface CommentItem {
  id: string;
  parentId?: string;
  user?: CommentUser;
  contentHtml: string;
  likeCount?: number;
  dislikeCount?: number;
  replyCount?: number;
  isPinned?: boolean;
  isEdited?: boolean;
  createdAt?: string;
  createdAtFormatted?: string;
  replies: CommentItem[];
}

export interface CommentThread {
  id: string;
  key: string;
  pageUrl?: string;
  pageTitle?: string;
  commentCount?: number;
  mainCommentCount?: number;
  isClosed?: boolean;
}

export interface CommentPage {
  source: string;
  targetType: "title" | "chapter";
  mangaId: string;
  chapterNumber?: string;
  volume?: string;
  thread: CommentThread;
  comments: CommentItem[];
  sort: CommentSort;
  cursor?: string;
}

export interface FavoriteManga extends MangaSummary {
  addedAt: string;
  lastReadChapterId?: string;
  lastReadChapter?: string;
  lastReadScrollPosition?: number;
}

export interface ReadingProgress {
  source: string;
  mangaId: string;
  canonicalKey?: string;
  chapterSource?: string;
  chapterId: string;
  chapterNumber?: string;
  scrollPosition?: number;
  updatedAt: string;
}

export interface BookmarkUpdate {
  manga: MangaSummary;
  latestChapter?: ChapterSummary;
  lastReadChapter?: string;
  checkedAt?: string;
  error?: string;
}

export type UserRole = "admin" | "user";

export interface AccountUser {
  id: string;
  username: string;
  role: UserRole;
  nsfwAllowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserInteractionBlock {
  id: string;
  userAId: string;
  userAUsername: string;
  userBId: string;
  userBUsername: string;
  createdBy: string;
  createdByUsername: string;
  createdAt: string;
}

export interface Recommendation {
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  toUsername: string;
  source: string;
  mangaId: string;
  title: string;
  coverUrl?: string;
  contentRating?: string;
  demographic?: string;
  tags?: string[];
  latestChapter?: string;
  latestChapterReleasedAt?: string;
  readAt?: string;
  createdAt: string;
}

export type View =
  | { name: "browse" }
  | { name: "search"; query?: string }
  | { name: "library" }
  | { name: "bookmarkUpdates" }
  | { name: "readingHistory" }
  | { name: "account" }
  | { name: "messages"; tab?: "inbox" | "outbox" }
  | { name: "detail"; source: string; id: string }
  | { name: "reader"; source: string; mangaId: string; chapterId: string; chapterNumber?: string; scrollPosition?: number };
