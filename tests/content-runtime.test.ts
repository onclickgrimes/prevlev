// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/"}
import { expect, it, vi } from "vitest";

it("inicia sem alterar canal, oculta Shorts e responde somente à própria extensão", async () => {
  document.body.innerHTML = `<ytd-rich-item-renderer><a id="video-title" href="/watch?v=abcdefghijk">Vídeo longo</a><div id="metadata-line"><span>120 views</span><span>1 day ago</span></div></ytd-rich-item-renderer><ytd-rich-item-renderer><a id="video-title" href="/shorts/12345678901">Short carregado</a><div id="metadata-line"><span>200 views</span></div></ytd-rich-item-renderer><button aria-label="Heart">Coração</button>`;
  const heart = document.querySelector("button")!;
  const click = vi.fn();
  heart.addEventListener("click", click);
  type Listener = (
    message: { type: string; kind?: string; redact?: boolean },
    sender: chrome.runtime.MessageSender,
    reply: (response?: unknown) => void,
  ) => boolean | undefined;
  let listener: Listener | undefined;
  const set = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    runtime: {
      id: "prevlev-fixture",
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
      sendMessage: vi.fn(async () => ({ status: "ok" })),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: {
            hideShorts: true,
            showMetrics: true,
            backendUrl: "",
            backendToken: "",
          },
        })),
        set,
      },
      onChanged: { addListener: vi.fn() },
    },
  });
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  await import("../src/content/index");
  await vi.waitFor(() =>
    expect(document.querySelector("#prevlev-controls")).not.toBeNull(),
  );
  const shorts = document.querySelector('a[href*="shorts"]')!.parentElement!;
  expect(shorts.getAttribute("data-prevlev-hidden")).toBe("true");
  expect(click).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  const rejected = vi.fn();
  expect(
    listener?.({ type: "GET_SNAPSHOT" }, { id: "other-extension" }, rejected),
  ).toBe(false);
  expect(rejected).not.toHaveBeenCalled();
  const response = await new Promise<unknown>((resolve) =>
    listener?.({ type: "GET_SNAPSHOT" }, { id: "prevlev-fixture" }, resolve),
  );
  expect(response).toMatchObject({
    status: "ok",
    snapshot: { videos: [{ id: "abcdefghijk" }, { id: "12345678901" }] },
  });
  expect(set).toHaveBeenCalledOnce();
  const shadow = document.querySelector("#prevlev-controls")!.shadowRoot!;
  const query = shadow.querySelector<HTMLInputElement>("#query")!;
  query.value = "novo";
  query.dispatchEvent(new Event("input"));
  // Suspend an already-pending timer and the observer while the page enters bfcache.
  window.dispatchEvent(
    new PageTransitionEvent("pagehide", { persisted: true }),
  );
  const newCard = document.createElement("ytd-rich-item-renderer");
  newCard.innerHTML =
    '<a id="video-title" href="/watch?v=mnopqrstuvw">Novo vídeo</a><div id="metadata-line"><span>240 views</span><span>1 day ago</span></div>';
  document.body.append(newCard);
  document.dispatchEvent(new Event("yt-navigate-finish"));
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(newCard.querySelector("[data-prevlev-metric]")).toBeNull();
  window.dispatchEvent(
    new PageTransitionEvent("pageshow", { persisted: true }),
  );
  expect(newCard.querySelector("[data-prevlev-metric]")?.textContent).toContain(
    "VPH médio",
  );
  expect(newCard.hasAttribute("data-prevlev-hidden")).toBe(false);
  expect(shorts.getAttribute("data-prevlev-hidden")).toBe("true");
  // Metadata attributes can change without child mutations on a reused SPA card.
  window.history.replaceState({}, "", "/feed/subscriptions");
  newCard.querySelector("a")!.setAttribute("title", "Sem correspondência");
  document.dispatchEvent(new Event("yt-navigate-finish"));
  await vi.waitFor(() =>
    expect(newCard.getAttribute("data-prevlev-hidden")).toBe("true"),
  );
  window.dispatchEvent(
    new PageTransitionEvent("pageshow", { persisted: true }),
  );
  expect(document.querySelectorAll("#prevlev-controls")).toHaveLength(1);
  expect(newCard.querySelectorAll("[data-prevlev-metric]")).toHaveLength(1);
  expect(click).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(set).toHaveBeenCalledOnce();
  window.dispatchEvent(
    new PageTransitionEvent("pagehide", { persisted: false }),
  );
});
