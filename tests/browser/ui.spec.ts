import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
let context: BrowserContext;
// Only this test harness supplies data and browser APIs. No fixture is packaged into dist/.
test.beforeAll(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.PREVLEV_CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await context.route("http://localhost:9393/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (
      ![
        "workspace.html",
        "workspace.js",
        "popup.html",
        "popup.js",
        "ui.css",
      ].includes(path)
    )
      return route.abort();
    const file = await readFile(resolve("dist", path));
    return route.fulfill({
      body: file,
      contentType: path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
  });
  await context.addInitScript(() => {
    const snapshot = {
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      title: "Estúdio de teste",
      videoId: "abcdefghijk",
      videos: [
        {
          id: "abcdefghijk",
          title: "Estúdio criativo em casa",
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          views: 12000,
          publishedAt: "2026-01-01T00:00:00Z",
          channel: "Canal Fixture",
          channelId: "canal1",
          isShort: false,
        },
        {
          id: "lmnopqrstuv",
          title: "Short de teste",
          url: "https://www.youtube.com/shorts/lmnopqrstuv",
          views: 3000,
          isShort: true,
        },
      ],
      comments: [
        {
          id: "1",
          author: "Pessoa Fixture",
          text: "Como montar um estúdio?",
          likes: 4,
          replies: 1,
        },
      ],
      transcript: [
        { start: 3, duration: 4, text: "Uma transcrição de teste." },
      ],
      warnings: ["Dados de fixture de teste."],
    };
    const store: Record<string, unknown> = { snapshot };
    Object.defineProperty(globalThis, "chrome", {
      value: {
        runtime: {
          id: "test",
          getURL: (path: string) => `http://localhost:9393/${path}`,
          sendMessage: async () => ({
            status: "not_configured",
            source: "test:fixture",
            error: "Configure um backend próprio.",
          }),
        },
        tabs: {
          query: async () => [
            { id: 1, title: "Fixture YouTube", url: snapshot.url },
          ],
          sendMessage: async (_tab: number, msg: { type: string }) =>
            msg.type === "GET_SNAPSHOT"
              ? { status: "ok", snapshot }
              : msg.type === "STUDIO_PREVIEW"
                ? {
                    id: "fixture",
                    status: "unsupported",
                    warnings: ["Fixture sem Studio"],
                  }
                : { status: "ok" },
        },
        storage: {
          local: {
            get: async (key: string) => ({ [key]: store[key] }),
            set: async (data: Record<string, unknown>) =>
              Object.assign(store, data),
            remove: async (keys: string[]) =>
              keys.forEach((k) => delete store[k]),
          },
        },
        permissions: { request: async () => true, remove: async () => true },
      },
    });
  });
});
test.afterAll(async () => {
  await context?.browser()?.close();
});
test("UI with browser-API fixture scans, filters, saves, exports and reports IA configuration", async () => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:9393/workspace.html");
  await page.locator("#scan").click();
  await expect(page.locator("#video-rows tr")).toHaveCount(2);
  await page.locator("#video-filter").fill("criativo");
  await expect(page.locator("#video-rows tr")).toHaveCount(1);
  await page.locator("#video-rows button").click();
  await page.locator('[data-page="swipe"]').click();
  await expect(page.locator("#swipe-list")).toContainText("Estúdio criativo");
  const downloading = page.waitForEvent("download");
  await page.locator("#swipe-export").click();
  expect((await downloading).suggestedFilename()).toBe("prevlev-swipe.json");
  await page.locator('[data-page="transcript"]').click();
  await expect(page.locator("#transcript-text")).toHaveValue(
    "Uma transcrição de teste.",
  );
  await page.locator('[data-ai="transcript-summary"]').click();
  await expect(page.locator("#transcript-ai-state")).toContainText(
    "Configure um backend próprio",
  );
  await expect(page.locator("#transcript-result")).toBeEmpty();
  await page.locator('[data-page="comments"]').click();
  await expect(page.locator("#comment-list")).toContainText("Como montar");
  await page.locator("#comment-likes").fill("10");
  await expect(page.locator("#comment-list")).toContainText(
    "Nenhum comentário",
  );
  await page.locator('[data-page="studio"]').click();
  await page.locator("#revenue").fill("1000");
  await page.locator("#cost").fill("100");
  await page.locator("#video-total").fill("3");
  await page.locator("#profit").click();
  await expect(page.locator("#profit-output")).toContainText("700");
  await page.locator("#studio-preview").click();
  await expect(page.locator("#studio-confirm")).toBeDisabled();
  await page.locator('[data-page="connection"]').click();
  await page.locator("#backend-url").fill("https://api.nexlev.io");
  await page.locator("#save-settings").click();
  await expect(page.locator("#notice")).toContainText("próprio backend");
  expect(errors).toEqual([]);
});
test("UI uses actual canvas for compression and thumbnail-title composition", async () => {
  const page = await context.newPage();
  await page.goto("http://localhost:9393/workspace.html");
  await page.locator('[data-page="images"]').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#24a67d";
    ctx.fillRect(0, 0, 800, 450);
    return canvas.toDataURL().split(",")[1];
  });
  await page.locator("#image-file").setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.locator("#preview-title").fill("Thumbnail de teste local");
  await page.locator("#image-preview").click();
  await expect(page.locator("#image-output")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#image-output")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1280);
  const downloading = page.waitForEvent("download");
  await page.locator("#compress").click();
  expect((await downloading).suggestedFilename()).toBe("prevlev-thumbnail.jpg");
  await expect(page.locator("#image-info")).toContainText("Saída:");
  await page.screenshot({
    path: "artifacts/ui-workshop-fixture.png",
    fullPage: true,
  });
});

test("clearing the real workspace collection removes the niche report and disables exports", async () => {
  const page = await context.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("http://localhost:9393/workspace.html");
  await page.locator("#scan").click();
  await page.locator('[data-page="niche"]').click();
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos")).toContainText("Estúdio criativo");
  await expect(page.locator("#niche-export-json")).toBeEnabled();
  await page.locator('[data-page="connection"]').click();
  await page.locator("#clear-data").click();
  await expect(page.locator("#notice")).toContainText("Dados locais apagados");
  await page.locator('[data-page="niche"]').click();
  await expect(page.locator("#niche-videos")).toBeEmpty();
  await expect(page.locator("#niche-export-json")).toBeDisabled();
  await page.close();
});
