import { getSettings, saveSettings } from "../shared/storage";
const status = document.querySelector<HTMLElement>("#status")!;
async function active() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
document.querySelector("#open")!.addEventListener("click", () => {
  void active().then((tab) =>
    chrome.tabs.create({
      url: chrome.runtime.getURL(`workspace.html?tab=${tab?.id ?? ""}`),
    }),
  );
});
document.querySelector("#scan")!.addEventListener("click", () => {
  void (async () => {
    try {
      const tab = await active();
      if (!tab?.id) throw new Error("Abra uma aba do YouTube.");
      const r = await chrome.tabs.sendMessage(tab.id, { type: "GET_SNAPSHOT" });
      if (r.status === "error") throw new Error(r.error);
      status.textContent = "Coleta concluída. Abra o espaço de trabalho.";
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  })();
});
void getSettings().then((settings) => {
  const input = document.querySelector<HTMLInputElement>("#shorts")!;
  input.checked = settings.hideShorts;
  input.addEventListener("change", () => {
    void saveSettings({ ...settings, hideShorts: input.checked });
  });
});
