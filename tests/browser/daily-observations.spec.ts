import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

test.use({ launchOptions: { executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), args: ["--no-sandbox"] } });

// Bundles only the isolated mount for the fixture. The production build is not modified.
test("manual report exposes scope, absence, conflicts and no network activity", async ({ page }) => {
  const bundled = await build({ stdin: { contents: 'import { mountDailyObservations } from "./src/ui/daily-observations"; mountDailyObservations(document.querySelector("#daily")!);', resolveDir: resolve("."), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser" });
  const requests: string[] = []; page.on("request", request => requests.push(request.url()));
  await page.setContent('<!doctype html><main id="daily"></main>');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.locator('[name="channelId"]').fill("channel_1");
  await page.locator('[name="date"]').fill("2020-01-01");
  await page.locator('[name="timeZone"]').fill("UTC");
  await page.locator('[name="completion"]').selectOption("complete");
  await page.locator('[name="sourceDescription"]').fill("<img src=x onerror=alert(1)>");
  await page.locator('[name="channelViews"]').fill("0");
  await page.locator('[name="videos"]').fill("alpha,10\nzero,0\nmissing,\nconflict,3\nconflict,4");
  await page.getByRole("button", { name: "Gerar relatório" }).click();
  const result = page.locator("#daily-result");
  await expect(result).toContainText("Origem: fornecido pelo usuário");
  await expect(result).toContainText("Views do canal no período: 0");
  await expect(result).toContainText("contagens conhecidas: 2; desconhecidas: 1; conflitos: 1");
  await expect(result.locator("ol li")).toHaveText(["alpha: 10", "zero: 0"]);
  await expect(result).toContainText("conflict: conflito entre linhas");
  await expect(result.locator("img")).toHaveCount(0);
  await expect(page.getByText(/Arquivos exportados ficam no dispositivo/)).toBeVisible();
  for (const [label, extension] of [["JSON", "json"], ["CSV", "csv"], ["Markdown", "md"]] as const) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Exportar ${label}` }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`prevlev-observacoes-diarias.${extension}`);
    const contents = await readFile(await download.path(), "utf8");
    expect(contents).toContain(extension === "md" ? "channel\\_1" : "channel_1");
    expect(contents).toContain("2020-01-01");
    if (extension === "json") {
      const parsed = JSON.parse(contents);
      expect(parsed).toMatchObject({ source: "user-provided", channelViews: 0, asOf: null });
      expect(parsed.videos).toContainEqual({ videoId: "conflict", views: null, status: "conflict", occurrences: 2 });
    } else if (extension === "csv") {
      expect(contents).toContain('"conflict","","conflict","2"');
    } else {
      expect(contents).toContain("&lt;img");
      expect(contents).not.toContain("<img");
    }
  }
  await page.locator('[name="date"]').fill("2020-01-02");
  await expect(result).toBeHidden();
  await expect(page.getByRole("button", { name: "Exportar JSON" })).toBeDisabled();
  await page.locator('[name="videos"]').fill("alpha,invalid");
  await page.getByRole("button", { name: "Gerar relatório" }).click();
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(page.getByRole("button", { name: "Exportar Markdown" })).toBeDisabled();
  await expect(page.locator("#daily-status")).toHaveText("Formulário e relatório visível foram limpos; arquivos exportados permanecem no dispositivo.");
  await expect(page.locator('[name="channelId"]')).toHaveValue("");
  expect(requests).toEqual([]);
});
