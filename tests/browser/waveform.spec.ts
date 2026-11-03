import { test, expect, chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";

let browser: Browser, bundle: string;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
  const result = await build({ stdin: { contents: `import {mountWaveformTools} from './src/ui/waveform'; window.waveform=mountWaveformTools(document);`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  bundle = result.outputFiles[0].text;
});
test.afterAll(async () => { await browser?.close(); });

test("requires explicit geometry; analyzes local PNG only after action and invalidates edits", async () => {
  const page = await browser.newPage();
  let requests = 0;
  page.on("request", () => requests++);
  await page.setContent('<section id="studio"></section>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("#waveform-analyze")).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { waveform: { getAnalysis(): unknown } }).waveform.getAnalysis())).toBeUndefined();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 6; canvas.height = 21;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#000"; context.fillRect(0, 0, 6, 21);
    context.fillStyle = "#fff";
    context.fillRect(0, 10, 2, 1); context.fillRect(2, 2, 2, 17); context.fillRect(4, 10, 2, 1);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#waveform-file").setInputFiles({ name: "local.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.locator("#waveform-status")).toContainText("6 × 21");
  await expect(page.locator("#waveform-fps")).toHaveValue("");
  for (const [field, value] of Object.entries({ baseline: "10", scale: "10", start: "100", end: "106", fps: "30", "min-duration": "1000" })) await page.locator(`#waveform-${field}`).fill(value);
  await page.locator("#waveform-analyze").click();
  await expect(page.locator("#waveform-status")).toContainText("Confira e confirme");
  await page.locator("#waveform-confirm-geometry").check();
  await page.locator("#waveform-analyze").click();
  await expect(page.locator("#waveform-status")).toContainText("Estimativa visual concluída");
  await expect(page.locator("#waveform-result")).toContainText("2 trechos visuais baixos");
  const result = await page.evaluate(() => (window as unknown as { waveform: { getAnalysis(): unknown } }).waveform.getAnalysis());
  expect(result).toMatchObject({ method: "visual-raster-estimate", quietIntervals: [{ start: 100, end: 102 }, { start: 104, end: 106 }], candidatePositions: [101, 105] });
  await page.locator("#waveform-end").fill("107");
  expect(await page.evaluate(() => (window as unknown as { waveform: { getAnalysis(): unknown } }).waveform.getAnalysis())).toBeUndefined();
  await expect(page.locator("#waveform-confirm-geometry")).not.toBeChecked();
  await expect(page.locator("#waveform-export")).toBeDisabled();
  expect(requests).toBe(0);
  await page.close();
});

test("rejects oversized PNG header before decoding and shows protected canvas failure", async () => {
  const page = await browser.newPage();
  await page.setContent('<section id="studio"></section>');
  await page.addScriptTag({ content: bundle });
  const bad = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bad); bad.writeUInt32BE(13, 8); bad.write("IHDR", 12); bad.writeUInt32BE(4001, 16); bad.writeUInt32BE(1000, 20);
  await page.locator("#waveform-file").setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: bad });
  await expect(page.locator("#waveform-status")).toContainText("4 milhões");
  await expect(page.locator("#waveform-analyze")).toBeDisabled();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 3;
    const context = canvas.getContext("2d")!; context.fillStyle = "black"; context.fillRect(0, 0, 2, 3); context.fillStyle = "white"; context.fillRect(0, 1, 2, 1);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#waveform-file").setInputFiles({ name: "small.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.locator("#waveform-status")).toContainText("2 × 3");
  for (const [field, value] of Object.entries({ baseline: "1", scale: "1", start: "0", end: "2", fps: "30" })) await page.locator(`#waveform-${field}`).fill(value);
  await page.locator("#waveform-confirm-geometry").check();
  await page.evaluate(() => { CanvasRenderingContext2D.prototype.getImageData = () => { throw new DOMException("Protected", "SecurityError"); }; });
  await page.locator("#waveform-analyze").click();
  await expect(page.locator("#waveform-status")).toContainText("Canvas protegido ou indisponível");
  await expect(page.locator("#waveform-export")).toBeDisabled();
  await page.close();
});

test("cancels scanning without retaining a partial estimate", async () => {
  const page = await browser.newPage();
  await page.setContent('<section id="studio"></section>');
  await page.addScriptTag({ content: bundle });
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2000; canvas.height = 3;
    const context = canvas.getContext("2d")!; context.fillStyle = "black"; context.fillRect(0, 0, 2000, 3); context.fillStyle = "white"; context.fillRect(0, 1, 2000, 1);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#waveform-file").setInputFiles({ name: "local.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.locator("#waveform-status")).toContainText("2000 × 3");
  for (const [field, value] of Object.entries({ baseline: "1", scale: "1", start: "0", end: "20", fps: "30" })) await page.locator(`#waveform-${field}`).fill(value);
  await page.locator("#waveform-confirm-geometry").check();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#waveform-analyze")!.click();
    document.querySelector<HTMLButtonElement>("#waveform-cancel")!.click();
  });
  await expect(page.locator("#waveform-status")).toContainText("Análise visual cancelada");
  await expect(page.locator("#waveform-result")).toBeEmpty();
  await expect(page.locator("#waveform-export")).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { waveform: { getAnalysis(): unknown } }).waveform.getAnalysis())).toBeUndefined();
  await page.close();
});

test("serializes PNG decoding and retains only the latest queued selection", async () => {
  const page = await browser.newPage();
  await page.setContent('<section id="studio"></section>');
  await page.addScriptTag({ content: bundle });
  const images = await page.evaluate(() => [2, 4, 6].map(width => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = 3;
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window);
    const state = { calls: [] as string[], active: 0, peak: 0, closed: [] as string[], releases: {} as Record<string, () => void> };
    (window as unknown as { decodes: typeof state }).decodes = state;
    window.createImageBitmap = async (source: ImageBitmapSource) => {
      const name = (source as File).name;
      state.calls.push(name); state.active++; state.peak = Math.max(state.peak, state.active);
      try {
        await new Promise<void>(resolve => { state.releases[name] = resolve; });
        const bitmap = await original(source), close = bitmap.close.bind(bitmap);
        bitmap.close = () => { state.closed.push(name); close(); };
        return bitmap;
      } finally { state.active--; }
    };
  });
  const upload = (index: number, name: string) => page.locator("#waveform-file").setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(images[index], "base64") });
  await upload(0, "first.png");
  await expect.poll(() => page.evaluate(() => (window as unknown as { decodes: { calls: string[] } }).decodes.calls)).toEqual(["first.png"]);
  await upload(1, "middle.png");
  await upload(2, "latest.png");
  expect(await page.evaluate(() => (window as unknown as { decodes: { calls: string[]; peak: number } }).decodes.calls)).toEqual(["first.png"]);
  await page.evaluate(() => (window as unknown as { decodes: { releases: Record<string, () => void> } }).decodes.releases["first.png"]());
  await expect.poll(() => page.evaluate(() => (window as unknown as { decodes: { calls: string[] } }).decodes.calls)).toEqual(["first.png", "latest.png"]);
  await expect(page.locator("#waveform-preview")).toBeHidden();
  await expect(page.locator("#waveform-analyze")).toBeDisabled();
  await page.evaluate(() => (window as unknown as { decodes: { releases: Record<string, () => void> } }).decodes.releases["latest.png"]());
  await expect(page.locator("#waveform-status")).toContainText("6 × 3");
  const state = await page.evaluate(() => {
    const { calls, active, peak, closed } = (window as unknown as { decodes: { calls: string[]; active: number; peak: number; closed: string[] } }).decodes;
    return { calls, active, peak, closed };
  });
  expect(state).toEqual({ calls: ["first.png", "latest.png"], active: 0, peak: 1, closed: ["first.png", "latest.png"] });
  await page.close();
});

test("skips a superseded PNG before decoding after its delayed header read", async () => {
  const page = await browser.newPage();
  await page.setContent('<section id="studio"></section>');
  await page.addScriptTag({ content: bundle });
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 3;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.evaluate(() => {
    const originalRead = Blob.prototype.arrayBuffer;
    const originalDecode = window.createImageBitmap.bind(window);
    const state = { waiting: false, calls: [] as string[], release: () => {} };
    (window as unknown as { headers: typeof state }).headers = state;
    Blob.prototype.arrayBuffer = async function () {
      if (!state.waiting) {
        state.waiting = true;
        await new Promise<void>(resolve => { state.release = resolve; });
      }
      return originalRead.call(this);
    };
    window.createImageBitmap = async (source: ImageBitmapSource) => {
      state.calls.push((source as File).name);
      return originalDecode(source);
    };
  });
  const upload = (name: string) => page.locator("#waveform-file").setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await upload("obsolete.png");
  await expect.poll(() => page.evaluate(() => (window as unknown as { headers: { waiting: boolean } }).headers.waiting)).toBe(true);
  await upload("current.png");
  await page.evaluate(() => (window as unknown as { headers: { release(): void } }).headers.release());
  await expect(page.locator("#waveform-status")).toContainText("2 × 3");
  expect(await page.evaluate(() => (window as unknown as { headers: { calls: string[] } }).headers.calls)).toEqual(["current.png"]);
  await page.close();
});
