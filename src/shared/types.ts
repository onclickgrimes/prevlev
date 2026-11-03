export interface VideoRecord {
  id: string;
  title: string;
  url: string;
  channel?: string;
  channelId?: string;
  channelUrl?: string;
  views?: number;
  publishedAt?: string;
  durationSeconds?: number;
  subscribers?: number;
  isShort?: boolean;
  thumbnail?: string;
  source?: "youtube-dom" | "public-page" | "user-provided" | "youtube-data-api";
  observedAt?: string;
}
export interface CommentRecord {
  id: string;
  text: string;
  author: string;
  likes?: number;
  replies?: number;
  hearted?: boolean;
}
export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}
export interface Settings {
  hideShorts: boolean;
  hideShortsOnFeed?: boolean;
  hideShortsOnSearch?: boolean;
  showMetrics: boolean;
  backendUrl: string;
  backendToken: string;
  aiModel: string;
  aiStreaming: boolean;
  aiOrigin: string;
}
export const defaultSettings: Settings = {
  hideShorts: false,
  showMetrics: true,
  backendUrl: "",
  backendToken: "",
  aiModel: "",
  aiStreaming: false,
  aiOrigin: "http://127.0.0.1:7814",
};
export interface PageSnapshot {
  url: string;
  title: string;
  videoId?: string;
  videos: VideoRecord[];
  comments: CommentRecord[];
  transcript: TranscriptSegment[];
  studio?: { revenue?: number; currency?: string; videoCount?: number };
  warnings: string[];
}
export type RemoteFeature =
  | "similar-videos"
  | "similar-channels"
  | "niche"
  | "channel-analytics"
  | "channel-report"
  | "view-history"
  | "sponsorships"
  | "combined-analytics"
  | "comment-analysis"
  | "thumbnail-generation"
  | "transcript-summary"
  | "transcript-topics"
  | "transcript-script"
  | "search-analysis";
export interface RemoteResponse {
  status: "ok" | "not_configured" | "unsupported" | "error";
  source: string;
  data?: unknown;
  error?: string;
  limitations?: string[];
}
export interface AiCatalogModel {
  id: string;
  provider: string;
  label: string;
  inputModalities: string[];
  outputModalities: string[];
  operations: string[];
  streaming: boolean;
  textSupported: boolean;
  imageSupported: boolean;
}
export interface AiCatalogData {
  origin: string;
  models: AiCatalogModel[];
  warnings: string[];
}
