export interface QuotedPost {
  author: string;
  authorVerified: boolean;
  profilePicUrl: string;
  text: string;
  url: string;
  media: MediaItem[];
}

export interface PostData {
  id: string;
  author: string;
  authorVerified: boolean;
  profilePicUrl: string;
  text: string;
  note?: string;
  timestamp: string;
  url: string;
  likes: number;
  replies: number;
  reposts: number;
  media: MediaItem[];
  quotedPost?: QuotedPost;
  isReply: boolean;
  replyToAuthor?: string;
}

export interface MediaItem {
  type: "image" | "video";
  url: string;
  localPath?: string;
}

export interface BackupState {
  lastRunAt: string;
  backedUpPostIds: string[];
}

export interface Config {
  outputDir: string;
}

export interface GalleryMediaItem {
  type: "image" | "video";
  src: string;
  poster?: string;
}

export interface GalleryQuotedPost {
  author: string;
  verified: boolean;
  avatar?: string;
  text: string;
  url: string;
  media: GalleryMediaItem[];
}

export interface GalleryPost {
  id: string;
  author: string;
  verified: boolean;
  avatar?: string;
  date: string;
  url: string;
  likes: number;
  replies: number;
  reposts: number;
  text: string;
  note?: string;
  media: GalleryMediaItem[];
  quotedPost?: GalleryQuotedPost;
  isReply?: boolean;
  replyToAuthor?: string;
}
