export interface PostData {
  id: string;
  author: string;
  authorVerified: boolean;
  text: string;
  timestamp: string;
  url: string;
  likes: number;
  replies: number;
  reposts: number;
  media: MediaItem[];
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
