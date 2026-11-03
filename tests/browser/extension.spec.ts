import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
let context: BrowserContext;
let profile: string;
let id: string;
const policy = "/etc/chromium/policies/managed/extensions.json";
const blocked =
  existsSync(policy) &&
  JSON.parse(readFileSync(policy, "utf8")).ExtensionInstallBlocklist?.includes(
    "*",
  );
test.skip(
  Boolean(blocked),
  "Política gerenciada ExtensionInstallBlocklist=[*] bloqueia a instalação de extensões neste executor.",
);
const fixture = `<!doctype html><html><head><title>Fixture YouTube</title></head><body><ytd-rich-item-renderer><a id="video-title" href="/watch?v=abcdefghijk">Estúdio criativo em casa</a><ytd-channel-name><a href="/channel/canal1">Canal Fixture</a></ytd-channel-name><div id="metadata-line"><span>12 mil visualizações</span><span>há 2 dias</span></div></ytd-rich-item-renderer><ytd-rich-item-renderer><a id="video-title" href="/shorts/lmnopqrstuv">Short de teste</a><div id="metadata-line"><span>3 mil visualizações</span><span>há 1 dia</span></div></ytd-rich-item-renderer><ytd-comment-thread-renderer><span id="author-text">Pessoa Fixture</span><span id="content-text">Como montar um estúdio?</span><span id="vote-count-middle">4</span></ytd-comment-thread-renderer><ytd-transcript-segment-renderer><span class="segment-timestamp">0:03</span><span class="segment-text">Uma transcrição de teste.</span></ytd-transcript-segment-renderer></body></html>`;
test.beforeAll(async () => {
  profile = await mkdtemp(resolve(tmpdir(), "prevlev-chrome-"));
  context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.PREVLEV_CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--no-sandbox",
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  });
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  id = worker.url().split("/")[2];
});
test.afterAll(async () => {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
});
test("loaded MV3 extension scans fixture, filters, saves reference and refuses unconfigured IA", async () => {
  const youtube = await context.newPage();
  await youtube.goto("https://www.youtube.com/");
  await expect(youtube.locator("#prevlev-controls")).toBeVisible();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/workspace.html`);
  await expect(page.locator("#tab-select option")).toHaveCount(1);
  await page.locator("#scan").click();
  await expect(page.locator("#video-rows tr")).toHaveCount(2);
  await expect(page.locator("#notice")).toContainText("Coletados 2 vídeos");
  await page.locator("#video-filter").fill("criativo");
  await expect(page.locator("#video-rows tr")).toHaveCount(1);
  await expect(page.locator("#video-rows")).toContainText("12 mil");
  await page.locator("#video-rows button").click();
  await page.locator('[data-page="swipe"]').click();
  await expect(page.locator("#swipe-list")).toContainText("Estúdio criativo");
  await page.locator('[data-page="transcript"]').click();
  await expect(page.locator("#transcript-text")).toHaveValue(
    "Uma transcrição de teste.",
  );
  await page.locator('[data-ai="transcript-summary"]').click();
  await expect(page.locator("#transcript-result")).toContainText(
    "not_configured",
  );
  await page.locator('[data-page="studio"]').click();
  await page.locator("#revenue").fill("1000");
  await page.locator("#cost").fill("100");
  await page.locator("#video-total").fill("3");
  await page.locator("#profit").click();
  await expect(page.locator("#profit-output")).toContainText("700");
  await page.locator("#studio-preview").click();
  await expect(page.locator("#studio-plan")).toContainText("unsupported");
  await expect(page.locator("#studio-confirm")).toBeDisabled();
  await page.locator('[data-page="connection"]').click();
  await page.locator("#backend-url").fill("https://api.nexlev.io");
  await page.locator("#save-settings").click();
  await expect(page.locator("#notice")).toContainText("próprio backend");
  expect(errors).toEqual([]);
});
test("local thumbnail composer and compressor work in a real browser canvas", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/workspace.html`);
  await page.locator('[data-page="images"]').click();
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 450;
    const x = c.getContext("2d")!;
    x.fillStyle = "#24a67d";
    x.fillRect(0, 0, 800, 450);
    return c.toDataURL().split(",")[1];
  });
  await page
    .locator("#image-file")
    .setInputFiles({
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
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#compress").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("prevlev-thumbnail.jpg");
  await expect(page.locator("#image-info")).toContainText("Saída:");
});
