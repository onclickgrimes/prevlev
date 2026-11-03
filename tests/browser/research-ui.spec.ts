import {
  test,
  expect,
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type TestMessage = { type: string; [key: string]: unknown };
type ResearchFixtureWindow = Window & {
  __researchSend: (message: TestMessage) => Promise<unknown>;
  __researchDispatch: (message: TestMessage) => Promise<unknown>;
  __researchRequests: TestMessage[];
};
const sourceUrl = "https://www.youtube.com/watch?v=abcdefghijk";
const appOrigin = "http://localhost:9395";
const cardData = [
  {
    id: "abcdefghijk",
    title: "Estúdio Alpha base",
    views: 1000,
    subscribers: 10000,
    duration: "1:00",
  },
  {
    id: "bcdefghijkl",
    title: "Estúdio Alpha par dois",
    views: 2000,
    subscribers: 10000,
    duration: "2:00",
  },
  {
    id: "cdefghijklm",
    title: "Estúdio Alpha par três",
    views: 3000,
    subscribers: 10000,
    duration: "3:00",
  },
  {
    id: "defghijklmn",
    title: "Estúdio Alpha destaque",
    views: 10000,
    subscribers: 10000,
    duration: "4:00",
  },
  { id: "efghijklmno", title: "Estúdio Alpha dados ausentes" },
];
const sourceFixture = `<!doctype html><html><head><meta charset="UTF-8"><title>Pesquisa fixture - YouTube</title><style>ytd-video-renderer{display:block;min-height:50px}video{width:320px;height:180px}</style></head><body><h1>Fixture própria de pesquisa</h1><video class="html5-main-video"></video><main id="fixture-cards">${cardData.map((card) => `<ytd-video-renderer data-fixture-id="${card.id}"><a id="video-title" href="/watch?v=${card.id}">${card.title}</a><ytd-channel-name><a href="/channel/UCabcdefghijklmnopqrstuv">Canal Alpha</a></ytd-channel-name><div id="metadata-line">${card.views === undefined ? "" : `<span>${card.views} views</span><span>2026-01-01</span>`}</div>${card.subscribers === undefined ? "" : `<span id="subscriber-count">${card.subscribers} subscribers</span>`}${card.duration ? `<ytd-thumbnail-overlay-time-status-renderer>${card.duration}</ytd-thumbnail-overlay-time-status-renderer>` : ""}</ytd-video-renderer>`).join("")}</main><ytd-transcript-segment-renderer><span class="segment-timestamp">0:03</span><span class="segment-text">Introdução do estúdio.</span></ytd-transcript-segment-renderer><ytd-transcript-segment-renderer><span class="segment-timestamp">0:45</span><span class="segment-text">Iluminação da cena.</span></ytd-transcript-segment-renderer></body></html>`;
let browser: Browser;
let context: BrowserContext;
let source: Page;
let workspace: Page;

test.beforeAll(async () => {
  browser = await chromium.launch({
    executablePath:
      process.env.PREVLEV_CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
});
test.afterAll(async () => {
  await browser?.close();
});
test.beforeEach(async () => {
  context = await browser.newContext({
    viewport: { width: 1500, height: 1100 },
  });
  // Every URL is intercepted. Responses below exist only in this test harness.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://www.youtube.com")
      return route.fulfill({ body: sourceFixture, contentType: "text/html" });
    const filename = url.pathname.slice(1);
    if (
      url.origin !== appOrigin ||
      !["workspace.html", "workspace.js", "ui.css"].includes(filename)
    )
      return route.abort();
    return route.fulfill({
      body: await readFile(resolve("dist", filename)),
      contentType: filename.endsWith(".js")
        ? "text/javascript"
        : filename.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
  });
  await context.exposeBinding(
    "__researchSend",
    async (_sender, message: TestMessage) =>
      source.evaluate(
        (message) =>
          (window as unknown as ResearchFixtureWindow).__researchDispatch(
            message,
          ),
        message,
      ),
  );
  await context.addInitScript(
    ({ appOrigin, sourceUrl }) => {
      const fixtureWindow = window as unknown as ResearchFixtureWindow;
      fixtureWindow.__researchRequests = [];
      const store: Record<string, unknown> = {
        settings: {
          hideShorts: false,
          showMetrics: false,
          backendUrl: "",
          backendToken: "",
        },
      };
      let listener:
        | ((
            message: TestMessage,
            sender: { id: string },
            reply: (response: unknown) => void,
          ) => unknown)
        | undefined;
      fixtureWindow.__researchDispatch = (message) =>
        new Promise((resolve) =>
          listener?.(message, { id: "research-browser-fixture" }, resolve),
        );
      Object.defineProperty(globalThis, "chrome", {
        value: {
          runtime: {
            id: "research-browser-fixture",
            getURL: (path: string) => `${appOrigin}/${path}`,
            onMessage: {
              addListener: (callback: typeof listener) => {
                listener = callback;
              },
            },
            sendMessage: async (message: TestMessage) => {
              fixtureWindow.__researchRequests.push(message);
              if (message.type === "CHANNEL_RESEARCH")
                return {
                  status: "ok",
                  data: {
                    channelUrl: "https://www.youtube.com/@alpha",
                    channelName: "Canal Alpha fixture",
                    warnings: ["Somente primeira resposta fixture."],
                    videos: [
                      {
                        id: "abcdefghijk",
                        title: "Canal Alpha atualizado",
                        url: "https://www.youtube.com/watch?v=abcdefghijk",
                        channel: "Canal Alpha",
                        channelUrl: "https://www.youtube.com/@alpha",
                        views: 99000,
                        publishedAt: "2026-01-01T00:00:00Z",
                        isShort: false,
                      },
                      {
                        id: "fghijklmnop",
                        title: "Canal Alpha novidade",
                        url: "https://www.youtube.com/watch?v=fghijklmnop",
                        channel: "Canal Alpha",
                        channelUrl: "https://www.youtube.com/@alpha",
                        views: 7000,
                        publishedAt: "2026-02-01T00:00:00Z",
                        isShort: false,
                      },
                    ],
                  },
                };
              if (message.type === "SAMPLE_MONETIZATION")
                return {
                  status: "ok",
                  data: {
                    status: "unknown",
                    checked: 2,
                    confidence: "low",
                    explanation:
                      "Marcadores não confirmam monetização nem receita.",
                    results: [
                      { videoId: "abcdefghijk", status: "unknown" },
                      { videoId: "fghijklmnop", status: "unknown" },
                    ],
                  },
                };
              return {
                status: "unsupported",
                error: "Mensagem fora do escopo desta fixture.",
              };
            },
          },
          tabs: {
            query: async () => [
              { id: 1, title: "YouTube fixture", url: sourceUrl },
            ],
            sendMessage: async (_id: number, message: TestMessage) => {
              fixtureWindow.__researchRequests.push(message);
              return fixtureWindow.__researchSend(message);
            },
          },
          storage: {
            local: {
              get: async (key: string) => ({ [key]: store[key] }),
              set: async (data: Record<string, unknown>) =>
                Object.assign(store, data),
              remove: async (keys: string[]) =>
                keys.forEach((key) => delete store[key]),
            },
            onChanged: { addListener: () => {} },
          },
          permissions: { request: async () => true, remove: async () => true },
        },
      });
    },
    { appOrigin, sourceUrl },
  );
  source = await context.newPage();
  await source.goto(sourceUrl);
  await source.evaluate(() => {
    const video = document.querySelector("video")!;
    let paused = true;
    Object.defineProperties(video, {
      duration: { value: 120, configurable: true },
      currentTime: { value: 10, writable: true, configurable: true },
      paused: { get: () => paused, configurable: true },
      play: {
        value: async () => {
          paused = false;
          video.dispatchEvent(new Event("play"));
        },
      },
      pause: {
        value: () => {
          paused = true;
          video.dispatchEvent(new Event("pause"));
        },
      },
    });
  });
  await source.addScriptTag({ path: resolve("dist/content.js") });
  await expect(source.locator("#prevlev-controls")).toBeVisible();
  workspace = await context.newPage();
  await workspace.goto(`${appOrigin}/workspace.html`);
  await expect(workspace.locator("#tab-select")).toHaveValue("1");
  await workspace.locator("#scan").click();
  await expect(workspace.locator("#video-rows tr")).toHaveCount(5);
});
test.afterEach(async () => {
  await context?.close();
});

test("research UI validates full ranges and applies/clears the same filter in the actual content bundle", async () => {
  const errors: string[] = [];
  workspace.on("pageerror", (error) => errors.push(error.message));
  await workspace.locator(".advanced-filters summary").click();
  // Unknown subscriber/duration metrics do not become zero under an active threshold.
  await workspace.locator("#min-subscribers").fill("1");
  await expect(workspace.locator("#video-rows tr")).toHaveCount(4);
  await workspace.locator("#min-views").fill("9000");
  await workspace.locator("#max-views").fill("11000");
  await workspace.locator("#video-filter").fill("estúdio");
  await workspace.locator("#channel-filter").fill("alpha");
  for (const [id, value] of [
    ["min-subscribers", "9000"],
    ["max-subscribers", "11000"],
    ["min-duration", "230"],
    ["max-duration", "250"],
    ["min-vph", "0.1"],
    ["max-vph", "10000"],
    ["min-outlier", "4"],
    ["max-outlier", "6"],
    ["published-after", "2026-01-01"],
    ["published-before", "2026-01-01"],
  ])
    await workspace.locator(`#${id}`).fill(value);
  await workspace.locator("#short-filter").selectOption("long");
  await workspace.locator("#sort").selectOption("outlier");
  await expect(workspace.locator("#video-rows a")).toHaveText([
    "Estúdio Alpha destaque",
  ]);
  // The outlier reference remains all comparable loaded videos, not this one-row result.
  await expect(workspace.locator("#video-rows tr")).toContainText("5.0×");
  await workspace.locator("#apply-page-filter").click();
  await expect(workspace.locator("#notice")).toContainText("1 de 5");
  await expect(
    source.locator('ytd-video-renderer:not([data-prevlev-hidden="true"])'),
  ).toHaveCount(1);
  await expect(
    source.locator('ytd-video-renderer:not([data-prevlev-hidden="true"])'),
  ).toHaveAttribute("data-fixture-id", "defghijklmn");
  const payload = await workspace.evaluate(() =>
    (window as unknown as ResearchFixtureWindow).__researchRequests.find(
      (message) => message.type === "APPLY_FILTER",
    ),
  );
  expect(payload).toMatchObject({
    filter: {
      query: "estúdio",
      channel: "alpha",
      minViews: 9000,
      maxViews: 11000,
      minSubscribers: 9000,
      maxSubscribers: 11000,
      minDurationSeconds: 230,
      maxDurationSeconds: 250,
      minVph: 0.1,
      maxVph: 10000,
      minOutlier: 4,
      maxOutlier: 6,
      publishedAfter: "2026-01-01",
      publishedBefore: "2026-01-01",
      shorts: "exclude",
      sort: "outlier",
    },
  });
  await workspace.locator("#clear-page-filter").click();
  await expect(
    source.locator('ytd-video-renderer:not([data-prevlev-hidden="true"])'),
  ).toHaveCount(5);
  await workspace.locator("#reset-filters").click();
  await workspace.locator("#min-views").fill("5000");
  await workspace.locator("#max-views").fill("1000");
  await expect(workspace.locator("#notice")).toHaveClass(/error/);
  const before = await workspace.evaluate(
    () =>
      (window as unknown as ResearchFixtureWindow).__researchRequests.filter(
        (message) => message.type === "APPLY_FILTER",
      ).length,
  );
  await workspace.locator("#apply-page-filter").click();
  expect(
    await workspace.evaluate(
      () =>
        (window as unknown as ResearchFixtureWindow).__researchRequests.filter(
          (message) => message.type === "APPLY_FILTER",
        ).length,
    ),
  ).toBe(before);
  await workspace.locator("#reset-filters").click();
  await expect(workspace.locator("#video-rows tr")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("public-channel UI shows sample limits, keeps unknown monetization and deduplicates collection", async () => {
  await workspace.locator('[data-page="channel"]').click();
  await workspace
    .locator("#channel-url")
    .fill("https://www.youtube.com/@alpha");
  await workspace.locator("#channel-load").click();
  await expect(workspace.locator("#channel-source")).toContainText(
    "primeira resposta pública",
  );
  await expect(workspace.locator("#channel-source")).toContainText(
    "Somente primeira resposta fixture.",
  );
  await expect(workspace.locator("#channel-recent a")).toHaveText([
    "Canal Alpha novidade",
    "Canal Alpha atualizado",
  ]);
  await expect(workspace.locator("#channel-popular a")).toHaveText([
    "Canal Alpha atualizado",
    "Canal Alpha novidade",
  ]);
  await workspace.locator("#monetization-count").fill("5");
  await workspace.locator("#sample-monetization").click();
  await expect(workspace.locator("#channel-monetization")).toContainText(
    '"status": "unknown"',
  );
  await expect(workspace.locator("#channel-monetization")).toContainText(
    "não confirmam monetização",
  );
  const requests = await workspace.evaluate(
    () => (window as unknown as ResearchFixtureWindow).__researchRequests,
  );
  expect(
    requests.find((message) => message.type === "CHANNEL_RESEARCH"),
  ).toMatchObject({ channelUrl: "https://www.youtube.com/@alpha" });
  expect(
    requests.find((message) => message.type === "SAMPLE_MONETIZATION"),
  ).toMatchObject({ maxSamples: 5 });
  await workspace.locator("#channel-use").click();
  await workspace.locator('[data-page="research"]').click();
  await expect(workspace.locator("#video-rows tr")).toHaveCount(6);
  await expect(workspace.locator("#video-rows a")).toContainText([
    "Canal Alpha atualizado",
  ]);
  await workspace.locator('[data-page="channel"]').click();
  await workspace.locator("#channel-use").click();
  await workspace.locator('[data-page="research"]').click();
  await expect(workspace.locator("#video-rows tr")).toHaveCount(6);
});

test("timeline UI controls the actual fixture player with expected identity and refuses an SPA video change", async () => {
  await workspace.locator('[data-page="transcript"]').click();
  await workspace.locator("#timeline-refresh").click();
  await expect(workspace.locator("#timeline-state")).toContainText(
    "0:10 / 2:00",
  );
  await expect(workspace.locator("#timeline-range")).toHaveAttribute(
    "max",
    "120",
  );
  await workspace.locator("#timeline-query").fill("Iluminação");
  await expect(workspace.locator("#timeline-segments button")).toHaveCount(1);
  await workspace.locator("#timeline-segments button").click();
  await expect
    .poll(() =>
      source
        .locator("video")
        .evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBe(45);
  await workspace.locator("#timeline-forward").click();
  await expect
    .poll(() =>
      source
        .locator("video")
        .evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBe(50);
  await workspace.locator("#timeline-frame-back").click();
  await expect
    .poll(() =>
      source
        .locator("video")
        .evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(50 - 1 / 30, 6);
  await workspace.locator("#timeline-toggle").click();
  await expect
    .poll(() =>
      source
        .locator("video")
        .evaluate((video) => (video as HTMLVideoElement).paused),
    )
    .toBe(false);
  const requests = await workspace.evaluate(
    () => (window as unknown as ResearchFixtureWindow).__researchRequests,
  );
  expect(
    requests
      .filter((message) => message.type === "SEEK_VIDEO")
      .every((message) => message.expectedVideoId === "abcdefghijk"),
  ).toBe(true);
  expect(
    requests.find((message) => message.type === "TOGGLE_PLAYBACK"),
  ).toMatchObject({ expectedVideoId: "abcdefghijk" });
  const before = await source
    .locator("video")
    .evaluate((video) => (video as HTMLVideoElement).currentTime);
  await source.evaluate(() =>
    history.pushState(null, "", "/watch?v=zzzzzzzzzzz"),
  );
  await workspace.locator("#timeline-forward").click();
  await expect(workspace.locator("#notice")).toContainText(
    "vídeo da aba mudou",
  );
  expect(
    await source
      .locator("video")
      .evaluate((video) => (video as HTMLVideoElement).currentTime),
  ).toBe(before);
});
