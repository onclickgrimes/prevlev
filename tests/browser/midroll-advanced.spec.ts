import { test, expect, chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";

let browser: Browser;
let bundle: string;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
  const result = await build({ stdin: { contents: `import {mountMidrollTools} from './src/ui/midroll-tools'; window.tools=mountMidrollTools(document,()=>window.changed++);`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  bundle = result.outputFiles[0].text;
});
test.afterAll(async () => { await browser?.close(); });

test("local planning and PCM analysis use explicit values and invalidate changes", async () => {
  const page = await browser.newPage();
  await page.setContent('<section id="studio"><input id="duration" value="600"><input id="interval" value="180"><label><input type="file" id="midroll-audio"></label><button id="audio-analyze">Analyze</button><p id="audio-info"></p></section>');
  await page.evaluate(() => { (window as unknown as { changed: number }).changed = 0; });
  await page.addScriptTag({ content: bundle });
  await page.locator("#midroll-mode").selectOption("quantity");
  await page.locator("#midroll-quantity").fill("2");
  await page.locator("#midroll-include-playhead").check();
  await page.locator("#midroll-playhead").fill("250");
  const plan = await page.evaluate(() => (window as unknown as { tools: { getPlan(): unknown } }).tools.getPlan());
  expect(plan).toMatchObject({ mode: "quantity", durationSeconds: 600, positions: [200, 250, 400], targets: 3 });
  expect(await page.evaluate(() => (window as unknown as { changed: number }).changed)).toBeGreaterThan(0);
  // A valid 1-second mono WAV with the first half quiet and the second half loud.
  const wav = Buffer.alloc(44 + 8000 * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  for (let i = 4000; i < 8000; i++) wav.writeInt16LE(16000, 44 + i * 2);
  await page.locator("#midroll-audio").setInputFiles({ name: "fixture.wav", mimeType: "audio/wav", buffer: wav });
  await page.locator("#midroll-min-silence").fill("400");
  await page.locator("#audio-analyze").click();
  await expect(page.locator("#audio-info")).toContainText("1 silêncios");
  expect(await page.locator("#midroll-progress").evaluate((element: HTMLProgressElement) => element.value)).toBe(1);
  expect(await page.locator("#midroll-waveform span").count()).toBeGreaterThan(0);
  await page.locator("#midroll-threshold").fill("5");
  await page.locator("#midroll-threshold").blur();
  expect(await page.locator("#midroll-waveform span").count()).toBe(0);
  await page.close();
});

test("rejects compressed and oversized WAV headers before audio decoding", async () => {
  const page = await browser.newPage();
  await page.setContent('<section id="studio"><input id="duration" value="600"><input id="interval" value="180"><label><input type="file" id="midroll-audio"></label><button id="audio-analyze">Analyze</button><p id="audio-info"></p></section>');
  await page.evaluate(() => {
    const original = window.AudioContext;
    (window as unknown as { decodeCalls: number }).decodeCalls = 0;
    window.AudioContext = class extends original {
      override decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
        (window as unknown as { decodeCalls: number }).decodeCalls++;
        return super.decodeAudioData(data);
      }
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.locator("#midroll-audio").setInputFiles({ name: "audio.mp3", mimeType: "audio/mpeg", buffer: Buffer.alloc(100, 1) });
  await page.locator("#audio-analyze").click();
  await expect(page.locator("#audio-info")).toContainText("WAV local PCM");
  expect(await page.evaluate(() => (window as unknown as { decodeCalls: number }).decodeCalls)).toBe(0);
  const sampleCount = 16_000_002;
  const wav = Buffer.alloc(44 + sampleCount);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(sampleCount, 40);
  await page.locator("#midroll-audio").setInputFiles({ name: "oversized.wav", mimeType: "audio/wav", buffer: wav });
  await page.locator("#audio-analyze").click();
  await expect(page.locator("#audio-info")).toContainText("16 milhões de amostras");
  expect(await page.evaluate(() => (window as unknown as { decodeCalls: number }).decodeCalls)).toBe(0);
  await page.close();
});
