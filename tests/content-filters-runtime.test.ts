// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/"}
import { expect, it, vi } from "vitest";

it("aplica filtros completos no DOM, recebe inscritos por ação e preserva anúncios ao ordenar", async () => {
  const rows = [
    ["ccccccccccc", "Vídeo C", 200, 120],
    ["aaaaaaaaaaa", "Alfa destaque", 1000, 600],
    ["ddddddddddd", "Vídeo D", 300, 300],
    ["bbbbbbbbbbb", "Vídeo B", 100, 60],
  ] as const;
  const card = ([id, title, views, duration]: readonly [
    string,
    string,
    number,
    number,
  ]) =>
    `<ytd-rich-item-renderer data-video="${id}"><a id="video-title" href="/watch?v=${id}">${title}</a><ytd-channel-name><a href="/@CanalAzul">Canal azul</a></ytd-channel-name><div id="metadata-line"><span>${views} views</span><span>2026-11-01</span></div><span data-duration>PT${duration}S</span></ytd-rich-item-renderer>`;
  document.body.innerHTML = `<div id="grid">${card(rows[0])}<aside id="advertisement">Publicidade</aside>${rows.slice(1).map(card).join("")}</div><button id="heart" aria-label="Heart">Coração</button>`;
  type Message = {
    type: string;
    filter?: unknown;
    videos?: unknown;
    kind?: string;
    redact?: boolean;
  };
  type Listener = (
    message: Message,
    sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => boolean | undefined;
  let listener: Listener | undefined;
  const set = vi.fn(async () => {}),
    network = vi.fn(),
    heart = vi.fn();
  document.querySelector("#heart")!.addEventListener("click", heart);
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "own",
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: {
            hideShorts: false,
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
  await import("../src/content/index");
  await vi.waitFor(() =>
    expect(document.querySelector("#prevlev-controls")).not.toBeNull(),
  );
  const send = async (message: Message) =>
    await new Promise<Record<string, unknown>>((resolve) =>
      listener?.(message, { id: "own" }, (value) =>
        resolve(value as Record<string, unknown>),
      ),
    );
  const visible = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-video]"))
      .filter((el) => !el.hasAttribute("data-prevlev-hidden"))
      .map((el) => el.dataset.video);
  expect(
    await send({
      type: "APPLY_FILTER",
      filter: { minSubscribers: 1, sort: "subscribers" },
    }),
  ).toMatchObject({ status: "ok", visible: 0 });
  expect(
    await send({
      type: "SET_ENRICHMENT",
      videos: [
        { channelUrl: "https://www.youtube.com/@CanalAzul", subscribers: 1000 },
      ],
    }),
  ).toMatchObject({ status: "ok" });
  expect(visible()).toHaveLength(4);
  expect(
    document
      .querySelector("[data-prevlev-metric]")
      ?.textContent?.replace(/\s/g, " "),
  ).toContain("1 mil inscritos");
  const filter = {
    query: "Alfa",
    channel: "@CanalAzul",
    minViews: 200,
    maxViews: 1500,
    minSubscribers: 900,
    maxSubscribers: 1100,
    minDurationSeconds: 100,
    maxDurationSeconds: 700,
    minVph: 0,
    maxVph: 1e6,
    minOutlier: 4,
    maxOutlier: 6,
    publishedAfter: "2026-10-31",
    publishedBefore: "2026-11-02",
    shorts: "exclude",
    sort: "outlier",
  };
  expect(await send({ type: "APPLY_FILTER", filter })).toMatchObject({
    status: "ok",
    visible: 1,
    total: 4,
  });
  expect(visible()).toEqual(["aaaaaaaaaaa"]);
  const shadow = document.querySelector("#prevlev-controls")!.shadowRoot!;
  expect(shadow.querySelector<HTMLInputElement>("#max-views")!.value).toBe(
    "1500",
  );
  expect(
    await send({
      type: "APPLY_FILTER",
      filter: { minViews: 2000, maxViews: 1 },
    }),
  ).toMatchObject({ status: "error" });
  expect(visible()).toEqual(["aaaaaaaaaaa"]);
  const min = shadow.querySelector<HTMLInputElement>("#min-views")!;
  min.value = "2000";
  min.dispatchEvent(new Event("input"));
  expect(shadow.querySelector("#status")!.textContent).toContain("mínimo");
  expect(visible()).toEqual(["aaaaaaaaaaa"]);
  expect(
    await send({
      type: "APPLY_FILTER",
      filter: { minViews: 200, sort: "duration" },
    }),
  ).toMatchObject({ status: "ok", visible: 3 });
  expect(visible()).toEqual(["aaaaaaaaaaa", "ddddddddddd", "ccccccccccc"]);
  expect(document.querySelector("#grid")!.children[1].id).toBe("advertisement");
  expect(await send({ type: "CLEAR_FILTER" })).toMatchObject({
    status: "ok",
    visible: 4,
  });
  expect(visible()).toEqual(rows.map((row) => row[0]));
  expect(document.querySelector("#grid")!.children[1].id).toBe("advertisement");
  expect(shadow.querySelector<HTMLInputElement>("#max-views")!.value).toBe("");
  expect(shadow.querySelector<HTMLSelectElement>("#sort")!.value).toBe(
    "default",
  );
  expect(network).not.toHaveBeenCalled();
  expect(heart).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  window.dispatchEvent(
    new PageTransitionEvent("pagehide", { persisted: false }),
  );
});
