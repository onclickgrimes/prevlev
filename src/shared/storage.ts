import { defaultSettings, type Settings, type PageSnapshot } from "./types";
export interface SwipeItem {
  id: string;
  folder: string;
  title: string;
  url: string;
  image?: string;
  createdAt: string;
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
  ((await chrome.storage.local.get("swipe")).swipe as SwipeItem[]) ?? [];
export const saveSwipe = async (items: SwipeItem[]) =>
  chrome.storage.local.set({ swipe: items });
