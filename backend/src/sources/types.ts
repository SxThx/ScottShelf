export type SourceKind = "api" | "scraper";

export interface SourceInfo {
  id: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  website?: string;
  note?: string;
  disabledReason?: string;
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

export interface SearchOptions {
  query?: string;
  limit?: number;
  offset?: number;
  language?: string;
}

export interface MangaSource {
  info: SourceInfo;
  search(options: SearchOptions): Promise<MangaSummary[]>;
  getManga(id: string): Promise<MangaDetail>;
  getChapters(mangaId: string, language: string): Promise<ChapterSummary[]>;
  getChapterPreview?(mangaId: string, language: string, targetChapter?: string): Promise<ChapterSummary[]>;
  getChapterPages(chapterId: string): Promise<ChapterPages>;
  getTitleComments?(mangaId: string, options?: { sort?: CommentSort; limit?: number; all?: boolean }): Promise<CommentPage>;
  getChapterComments?(
    mangaId: string,
    chapterNumber: string,
    options?: { volume?: string; sort?: CommentSort; limit?: number; all?: boolean }
  ): Promise<CommentPage>;
}
