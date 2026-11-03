import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] }); });
test.afterAll(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage({ acceptDownloads: true }), requests: string[] = [];
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<section id="channel-report"></section><button id="change-sample">Alterar amostra</button><button id="exclude-sample">Apenas API</button>');
  const bundle = await build({ stdin: { contents: `import {mountChannelReport} from './src/ui/channel-report';
    let videos=[{id:'abcdefghijk',title:'Título observado',channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',source:'youtube-dom'},{id:'bcdefghijkl',title:'Outro vídeo',channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',source:'user-provided'}];
    const mounted=mountChannelReport(document.querySelector('#channel-report'),()=>videos);
    document.querySelector('#change-sample').addEventListener('click',()=>{videos=videos.map(video=>({...video,title:video.title+' alterado'}));mounted.invalidate();});
    document.querySelector('#exclude-sample').addEventListener('click',()=>{videos=videos.map(video=>({...video,source:'youtube-data-api'}));mounted.invalidate();});`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return { page, requests };
}
const editor = (page: Page) => page.locator(".channel-report-entry-form");
const main = (page: Page) => page.locator("#channel-report > .card > form");
async function declaration(page: Page) {
  await editor(page).locator('[name="group"]').selectOption("strategy"); await editor(page).locator('[name="target"]').selectOption("video:abcdefghijk");
  await editor(page).locator('[name="statement"]').fill("Estratégia declarada: entrevistas"); await editor(page).locator('[name="coverage"]').selectOption("unknown");
  await editor(page).locator('[name="sourceLabel"]').fill("Declaração própria"); await editor(page).locator('button[type="submit"]').click();
}

test("grupos manuais, edição e exports preservam proveniência e desconhecidos sem rede", async () => {
  const { page, requests } = await fixture();
  await expect(page.locator(".channel-report-result")).toBeHidden(); await expect(page.locator('[data-channel-report-export="json"]')).toBeDisabled();
  await declaration(page); await main(page).locator('button[type="submit"]').click();
  await expect(page.locator('[data-report-group="strategy"]')).toContainText("Estratégia declarada: entrevistas"); await expect(page.locator('[data-report-group="niche"]')).toContainText("Desconhecido");
  await page.getByRole("button", { name: "Editar anotação", exact: true }).click(); await expect(page.locator(".channel-report-result")).toBeHidden();
  await editor(page).locator('[name="statement"]').fill('<img src="https://invalid.example/image"> interpretação declarada'); await editor(page).locator('button[type="submit"]').click(); await main(page).locator('button[type="submit"]').click();
  await expect(page.locator(".channel-report-result img")).toHaveCount(0);
  for (const format of ["json", "csv", "md"]) {
    const waiting = page.waitForEvent("download"); await page.locator(`[data-channel-report-export="${format}"]`).click(); const download = await waiting, content = await readFile((await download.path())!, "utf8");
    expect(content).toContain("interpretação declarada"); expect(content).toContain("Declaração própria");
    if (format === "json") expect(JSON.parse(content).structured.groups).toHaveLength(8);
    if (format === "md") { expect(content).not.toContain("<img"); expect(content).toContain("Desconhecido"); }
  }
  expect(requests).toEqual([]); await page.close();
});

test("transcrição só vira material por ação explícita e o trecho deve existir na fonte fornecida", async () => {
  const { page, requests } = await fixture();
  await main(page).locator('[name="videoId"]').fill("abcdefghijk"); await main(page).locator('[name="text"]').fill("Falamos sobre jardim e plantas."); await main(page).locator('[name="duration"]').fill("60"); await main(page).locator('[name="coverage"]').selectOption("partial");
  await expect(editor(page).locator('[name="sourceText"]')).toHaveValue(""); await page.getByRole("button", { name: "Usar transcrição informada acima como material" }).click();
  await editor(page).locator('[name="group"]').selectOption("topics"); await editor(page).locator('[name="statement"]').fill("Tópico declarado: plantas"); await editor(page).locator('[name="quote"]').fill("Não existe"); await editor(page).locator('button[type="submit"]').click();
  await expect(page.locator(".channel-report-entry-status")).toContainText("presente"); await expect(page.locator(".channel-report-entry-list li")).toHaveCount(0);
  await editor(page).locator('[name="quote"]').fill("jardim e plantas"); await editor(page).locator('button[type="submit"]').click(); await main(page).locator('button[type="submit"]').click();
  await expect(page.locator('[data-report-group="topics"] blockquote')).toHaveText("jardim e plantas"); await expect(page.locator(".channel-report-result")).toContainText("5 palavras / 60 segundos ≈ 5");
  const waitReport = page.waitForEvent("download"); await page.locator('[data-channel-report-export="json"]').click(); const report = await readFile((await (await waitReport).path())!, "utf8"); expect(report).not.toContain("Falamos sobre jardim e plantas.");
  const waitBackup = page.waitForEvent("download"); await page.getByRole("button", { name: "Baixar backup das anotações" }).click(); const backup = await readFile((await (await waitBackup).path())!, "utf8"); expect(backup).toContain("Falamos sobre jardim e plantas.");
  await main(page).locator('button[type="reset"]').click(); await expect(page.locator(".channel-report-entry-list li")).toHaveCount(0);
  await page.locator(".channel-report-draft-import").setInputFiles({ name: "anotacoes.json", mimeType: "application/json", buffer: Buffer.from(backup) }); await expect(page.locator(".channel-report-entry-list li")).toHaveCount(1);
  expect(requests).toEqual([]); await page.close();
});

test("amostra alterada bloqueia relatório e exige reassociação explícita, sem aceitar alvos API", async () => {
  const { page } = await fixture(); await declaration(page); await main(page).locator('button[type="submit"]').click();
  await page.locator("#change-sample").click(); await expect(page.locator(".channel-report-result")).toBeHidden(); await expect(page.locator('[data-channel-report-export="json"]')).toBeDisabled();
  await main(page).locator('button[type="submit"]').click(); await expect(page.locator(".channel-report-status")).toContainText("reassocie");
  await page.getByRole("button", { name: "Revisar e reassociar anotações à amostra atual" }).click(); await main(page).locator('button[type="submit"]').click(); await expect(page.locator('[data-report-group="strategy"]')).toContainText("entrevistas");
  await page.locator("#exclude-sample").click(); await page.getByRole("button", { name: "Revisar e reassociar anotações à amostra atual" }).click(); await expect(page.locator(".channel-report-entry-status")).toContainText("elegível");
  await main(page).locator('button[type="submit"]').click(); await expect(page.locator(".channel-report-result")).toBeHidden(); await page.close();
});
