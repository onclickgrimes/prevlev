import type {RemoteResponse} from '../src/shared/types';
export interface YouTubeConfig {youtubeEnabled?:boolean;youtubeApiKey?:string;}
export interface OfficialVideo {id:string;title:string|null;url:string;channelId:string|null;channelTitle:string|null;publishedAt:string|null;duration:string|null;viewCount:string|null;likeCount:string|null;commentCount:string|null;thumbnail:string|null;source:'youtube-data-api';fetchedAt:string;}
export interface OfficialChannel {id:string;title:string|null;url:string;subscriberCount:string|null;hiddenSubscriberCount:boolean|null;viewCount:string|null;videoCount:string|null;publishedAt:string|null;thumbnail:string|null;source:'youtube-data-api';fetchedAt:string;}
export interface YouTubeQuery {q:string;type?:'video'|'channel';order?:'relevance'|'date'|'viewCount';maxResults?:number;channelId?:string;pageToken?:string;publishedAfter?:string;publishedBefore?:string;apiConsent:boolean;}
export function searchYouTube(payload:Record<string,unknown>|YouTubeQuery,config?:YouTubeConfig,fetcher?:typeof fetch,signal?:AbortSignal):Promise<RemoteResponse>;
