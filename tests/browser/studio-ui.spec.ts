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

type FixtureWindow = Window & {
  __fixtureSend: (message: unknown) => Promise<unknown>;
  __fixtureDispatch: (message: unknown) => Promise<unknown>;
  __fixtureClicks: number;
};
let browser: Browser;
let context: BrowserContext;
let studio: Page;
let workspace: Page;
const studioUrl = "https://studio.youtube.com/channel/UCfixture/comments";
const fixture = `<!doctype html><html><head><title>Studio fixture</title></head><body>${Array.from({ length: 4 }, (_, index) => `<ytcp-comment-thread><ytcp-comment data-comment-id="comment-${index}"><span id="author-text">Author ${index}</span><span id="content-text">Comment ${index}</span><button aria-label="Heart" aria-pressed="false" id="heart-${index}">Heart ${index}</button></ytcp-comment></ytcp-comment-thread>`).join("")}</body></html>`;

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
    viewport: { width: 1440, height: 1000 },
  });
  // This harness intercepts every URL. It never contacts YouTube or an account.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://studio.youtube.com")
      return route.fulfill({ body: fixture, contentType: "text/html" });
    const filename = url.pathname.slice(1);
    if (
      url.origin !== "http://localhost:9394" ||
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
    "__fixtureSend",
    async (_source, message: unknown) =>
      studio.evaluate(
        (message) =>
          new Promise((resolve) =>
            (window as unknown as FixtureWindow)
              .__fixtureDispatch(message)
              .then(resolve),
          ),
        message,
      ),
  );
  await context.addInitScript(() => {
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
          message: unknown,
          sender: { id: string },
          reply: (response: unknown) => void,
        ) => unknown)
      | undefined;
    (window as unknown as FixtureWindow).__fixtureDispatch = (
      message: unknown,
    ) =>
      new Promise((resolve) =>
        listener?.(message, { id: "studio-browser-fixture" }, resolve),
      );
    Object.defineProperty(globalThis, "chrome", {
      value: {
        runtime: {
          id: "studio-browser-fixture",
          onMessage: {
            addListener: (callback: typeof listener) => {
              listener = callback;
            },
          },
          sendMessage: async () => ({ status: "ok" }),
        },
        tabs: {
          query: async () => [
            {
              id: 1,
              title: "Studio fixture",
              url: "https://studio.youtube.com/channel/UCfixture/comments",
            },
          ],
          sendMessage: async (_id: number, message: unknown) =>
            (window as unknown as FixtureWindow).__fixtureSend(message),
        },
        storage: {
          local: {
            get: async (key: string) => ({ [key]: store[key] }),
            set: async (value: Record<string, unknown>) =>
              Object.assign(store, value),
          },
          onChanged: { addListener: () => {} },
        },
      },
    });
  });
  studio = await context.newPage();
  await studio.goto(studioUrl);
  await studio.evaluate(() => {
    (window as unknown as FixtureWindow).__fixtureClicks = 0;
    for (const button of document.querySelectorAll("ytcp-comment button"))
      button.addEventListener("click", () => {
        (window as unknown as FixtureWindow).__fixtureClicks++;
        button.setAttribute("aria-pressed", "true");
      });
  });
  // Execute only Prevlev's own built content script on our intercepted fixture.
  await studio.addScriptTag({ path: resolve("dist/content.js") });
  await expect(studio.locator("#prevlev-controls")).toBeVisible();
  workspace = await context.newPage();
  await workspace.goto("http://localhost:9394/workspace.html");
  await expect(workspace.locator("#tab-select")).toHaveValue("1");
  await workspace.locator('[data-page="studio"]').click();
});
test.afterEach(async () => {
  await context?.close();
});

test("actual Studio UI requires preview and explicit confirmation, then disables replay", async () => {
  expect(
    await studio.evaluate(
      () => (window as unknown as FixtureWindow).__fixtureClicks,
    ),
  ).toBe(0);
  await expect(workspace.locator("#studio-confirm")).toBeDisabled();
  await workspace.locator("#action-limit").fill("2");
  await workspace.locator("#studio-preview").click();
  await expect(workspace.locator("#studio-plan")).toContainText(
    '"targetCount": 2',
  );
  await expect(workspace.locator("#studio-confirm")).toBeEnabled();
  expect(
    await studio.evaluate(
      () => (window as unknown as FixtureWindow).__fixtureClicks,
    ),
  ).toBe(0);
  await workspace.locator("#studio-confirm").click();
  await expect(workspace.locator("#studio-plan")).toContainText(
    '"status": "completed"',
  );
  expect(
    await studio.evaluate(
      () => (window as unknown as FixtureWindow).__fixtureClicks,
    ),
  ).toBe(2);
  await expect(workspace.locator("#studio-confirm")).toBeDisabled();
});

test("actual Studio UI cancellation clears a preview and the adapter rejects an SPA target change", async () => {
  await workspace.locator("#studio-preview").click();
  await expect(workspace.locator("#studio-confirm")).toBeEnabled();
  await workspace.locator("#studio-cancel").click();
  await expect(workspace.locator("#studio-confirm")).toBeDisabled();
  expect(
    await studio.evaluate(
      () => (window as unknown as FixtureWindow).__fixtureClicks,
    ),
  ).toBe(0);
  await workspace.locator("#studio-preview").click();
  await expect(workspace.locator("#studio-confirm")).toBeEnabled();
  await studio.evaluate(() =>
    history.pushState(null, "", "/channel/UCother/comments"),
  );
  await workspace.locator("#studio-confirm").click();
  await expect(workspace.locator("#studio-plan")).toContainText(
    '"status": "stale"',
  );
  expect(
    await studio.evaluate(
      () => (window as unknown as FixtureWindow).__fixtureClicks,
    ),
  ).toBe(0);
});

test("Studio UI creates confirmed midroll draft slots and leaves saving manual", async () => {
  await studio.evaluate(() => {
    document.body.innerHTML =
      '<ytcp-ad-breaks-editor data-video-id="video-1"><button id="insert" aria-label="Insert ad slot">Insert ad slot</button></ytcp-ad-breaks-editor><button id="continue">Continue</button><button id="save">Save</button>';
    (window as unknown as FixtureWindow).__fixtureClicks = 0;
    document.body.dataset.saveClicks = "0";
    const editor = document.querySelector("ytcp-ad-breaks-editor")!;
    document.querySelector("#insert")!.addEventListener("click", () => {
      (window as unknown as FixtureWindow).__fixtureClicks++;
      const field = document.createElement("input");
      field.setAttribute("aria-label", "Ad slot start time");
      field.value = "00:00:00";
      editor.append(field);
    });
    for (const button of document.querySelectorAll("#save, #continue"))
      button.addEventListener("click", () => {
        document.body.dataset.saveClicks = String(
          Number(document.body.dataset.saveClicks) + 1,
        );
      });
  });
  await workspace.locator("#studio-action").selectOption("midrolls");
  await workspace.locator("#duration").fill("900");
  await workspace.locator("#interval").fill("180");
  await workspace.locator("#studio-preview").click();
  await expect(workspace.locator("#studio-plan")).toContainText(
    '"slotsToCreate": 4',
  );
  expect(await studio.locator("ytcp-ad-breaks-editor input").count()).toBe(0);
  await workspace.locator("#studio-confirm").click();
  await expect(workspace.locator("#studio-plan")).toContainText(
    '"status": "completed"',
  );
  await expect(workspace.locator("#studio-plan")).toContainText('"created": 4');
  expect(
    await studio
      .locator("ytcp-ad-breaks-editor input")
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      ),
  ).toEqual(["00:03:00", "00:06:00", "00:09:00", "00:12:00"]);
  expect(await studio.locator("body").getAttribute("data-save-clicks")).toBe(
    "0",
  );
});

test("Studio UI refuses a recycled comment that preserved its button and URL", async () => {
  await workspace.locator("#action-limit").fill("1");
  await workspace.locator("#studio-preview").click();
  await expect(workspace.locator("#studio-confirm")).toBeEnabled();
  await studio.evaluate(() => {
    const button = document.querySelector("#heart-0")!;
    button
      .closest("ytcp-comment")!
      .querySelector('[id="content-text"]')!.textContent =
      "A new unrelated comment in a recycled row";
  });
  await workspace.locator("#studio-confirm").click();
  await expect(workspace.locator("#studio-plan")).toContainText(
    '"status": "stale"',
  );
  expect(
    await studio.evaluate(
      () => (window as unknown as FixtureWindow).__fixtureClicks,
    ),
  ).toBe(0);
});
