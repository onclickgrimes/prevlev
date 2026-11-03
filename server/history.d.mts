import type {RemoteResponse} from '../src/shared/types';
export interface HistoryOptions {dataDir?:string;historyMaxRecords?:number;}
export interface Observation {id:string;videoId:string;title:string;url:string;channel?:string;channelId?:string;channelUrl?:string;observedAt:string;recordedAt?:string;views?:number;subscribers?:number;source:'youtube-dom'|'public-page'|'user-provided';}
export interface HistoryReadPayload {videoId?:string;limit?:number;}
export function handleHistory(payload:Record<string,unknown>,options?:HistoryOptions,now?:number):Promise<RemoteResponse>;
export function readHistory(payload?:HistoryReadPayload,options?:HistoryOptions):Promise<RemoteResponse>;
export function legacyHistory(payload:Record<string,unknown>,dataDir?:string,now?:number):Promise<RemoteResponse>;
