import { defaultSettings, type Settings, type PageSnapshot } from "./types";
import {normalizeSwipeLibrary,ensureSwipeBudget} from '../core/swipe';
import type {SwipeAssetMetadata} from '../core/swipe-assets';
export interface SwipeItem {
  id: string;
  folder: string;
  folderId?:string;
  title: string;
  url: string;
  image?: string;
  asset?:SwipeAssetMetadata;
  createdAt: string;
  updatedAt?:string;
  type?:'video'|'channel'|'other';
  tags?:string[];
  notes?:string;
  thumbnail?:string;
  source?:'youtube-dom'|'public-page'|'user-provided'|'youtube-data-api';
}
export const getSettings = async (): Promise<Settings> => {
  const stored = (await chrome.storage.local.get("settings")).settings;
  return {
    ...defaultSettings,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
};
export const saveSettings = async (settings: Settings) =>
  chrome.storage.local.set({ settings });
export const getSnapshot = async (): Promise<PageSnapshot | undefined> =>
  (await chrome.storage.local.get("snapshot")).snapshot as
    | PageSnapshot
    | undefined;
export const getSwipe = async (): Promise<SwipeItem[]> =>
  normalizeSwipeLibrary((await chrome.storage.local.get('swipe')).swipe);
let swipeWrites:Promise<unknown>=Promise.resolve();
function serializeSwipe<T>(operation:()=>Promise<T>):Promise<T>{
 const locked=async():Promise<T>=>{
  const locks=(globalThis as {navigator?:{locks?:LockManager}}).navigator?.locks;
  if(locks){let result!:T;await locks.request('prevlev-swipe-library',{mode:'exclusive'},async()=>{result=await operation();});return result;}
  if(typeof document!=='undefined')throw new Error('Este navegador não oferece bloqueio seguro entre janelas para salvar a biblioteca. Use uma versão atual do Chrome.');
  // Node fixtures have no DOM or Web Locks; the per-context queue remains testable.
  return operation();
 };
 const result=swipeWrites.then(locked,locked);swipeWrites=result.catch(()=>undefined);return result;
}
async function commitSwipe(items:SwipeItem[]):Promise<void>{
 const normalized=normalizeSwipeLibrary(items);ensureSwipeBudget(normalized);
 try{await chrome.storage.local.set({swipe:normalized});}
 catch{throw new Error('O navegador não conseguiu salvar a biblioteca local (cota ou acesso ao armazenamento). Exporte seus dados e libere espaço antes de tentar novamente.');}
}
/** One exclusive Web Lock spans read/mutate/write across same-origin extension views. */
export function updateSwipe(mutator:(items:SwipeItem[])=>SwipeItem[]|Promise<SwipeItem[]>):Promise<SwipeItem[]>{
 return serializeSwipe(async()=>{const current=await getSwipe(),next=await mutator(current);await commitSwipe(next);return normalizeSwipeLibrary(next);});
}
export const saveSwipe=(items:SwipeItem[]):Promise<void>=>serializeSwipe(()=>commitSwipe(items));
