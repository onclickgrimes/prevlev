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
import type { AiCatalogModel } from "../../src/shared/types";

const appOrigin = "http://localhost:9396";
const backendOrigin = "http://127.0.0.1:8787";
const sidecarOrigin = "http://127.0.0.1:7814";
const textModel: AiCatalogModel = {
  id: "fixture:text",
  provider: "fixture",
  label: "Texto fixture",
  inputModalities: ["text"],
  outputModalities: ["text"],
  operations: ["responses"],
  streaming: true,
  textSupported: true,
  imageSupported: false,
};
const imageModel: AiCatalogModel = {
  id: "fixture:image",
  provider: "fixture",
  label: "Imagem fixture",
  inputModalities: ["text"],
  outputModalities: ["image"],
  operations: ["images.generate"],
  streaming: false,
  textSupported: false,
  imageSupported: true,
};
interface FixtureWindow extends Window {
  __omniStore: Record<string, unknown>;
  __omniPermissions: string[][];
  __omniInjected?: boolean;
}
interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}
let browser: Browser;
let context: BrowserContext;
let page: Page;
let requests: RecordedRequest[];
let sidecarRequests: string[];
let models: AiCatalogModel[];
let catalogOrigin: string;
let catalogMode: "ok" | "offline" | "auth";
let delayedImageReply: Promise<void> | undefined;
const analyses = () =>
  requests.filter(
    (request) =>
      request.method === "POST" && request.url.endsWith("/v1/analyze"),
  );
const catalogs = () =>
  requests.filter(
    (request) =>
      request.method === "GET" && request.url.endsWith("/v1/ai/catalog"),
  );

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
  requests = [];
  sidecarRequests = [];
  models = [textModel, imageModel];
  catalogOrigin = sidecarOrigin;
  catalogMode = "ok";
  delayedImageReply = undefined;
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  // All network traffic is intercepted. No sidecar, key, provider or account is used.
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === sidecarOrigin || url.port === "7814") {
      sidecarRequests.push(url.href);
      return route.abort();
    }
    if (
      url.origin === backendOrigin ||
      url.origin === "http://127.0.0.1:8788"
    ) {
      const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "authorization,content-type",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      requests.push({
        url: url.href,
        method: request.method(),
        headers: request.headers(),
        ...(request.postData()
          ? { body: JSON.parse(request.postData()!) as Record<string, unknown> }
          : {}),
      });
      if (url.pathname === "/v1/ai/catalog") {
        if (catalogMode === "offline") return route.abort("connectionrefused");
        if (catalogMode === "auth")
          return route.fulfill({
            status: 401,
            headers,
            body: JSON.stringify({
              status: "error",
              source: "prevlev:fixture",
              error: "Token Prevlev inválido (HTTP 401). Confira a conexão.",
            }),
          });
        return route.fulfill({
          headers,
          body: JSON.stringify({
            status: "ok",
            source: "prevlev:omni-fixture",
            data: {
              origin: catalogOrigin,
              models,
              warnings: ["Capacidades fixture; não comprova saldo."],
            },
          }),
        });
      }
      if (url.pathname === "/v1/analyze") {
        if (requests.at(-1)?.body?.feature === "thumbnail-generation") await delayedImageReply;
        return route.fulfill({
          headers,
          body: JSON.stringify({
            status: "ok",
            source: "prevlev:omni-fixture",
            data: {
              text: 'Resultado de fixture <img src=x onerror="window.__omniInjected=true">',
              model: (requests.at(-1)?.body?.payload as Record<string, unknown>)
                ?.model,
              generated: true,
              ...(requests.at(-1)?.body?.feature === "thumbnail-generation" ? {images:[{mime:"image/png",base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGv8AAAAASUVORK5CYII="}]} : {}),
              transport: "fixture-final-only",
            },
          }),
        });
      }
      return route.fulfill({
        status: 404,
        headers,
        body: JSON.stringify({
          status: "error",
          source: "prevlev:fixture",
          error: "Endpoint fora do escopo da fixture.",
        }),
      });
    }
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
  await context.addInitScript(
    ({ appOrigin }) => {
      const fixtureWindow = window as unknown as FixtureWindow;
      const snapshot = {
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        title: "Vídeo fixture Omni",
        videoId: "abcdefghijk",
        videos: [
          {
            id: "abcdefghijk",
            title: "Vídeo fixture Omni",
            url: "https://www.youtube.com/watch?v=abcdefghijk",
            views: 200,
          },
        ],
        comments: [
          {
            id: "first",
            author: "Pessoa fixture",
            text: "Como aplicar a técnica?",
            likes: 3,
            replies: 0,
          },
          {
            id: "second",
            author: "Outra fixture",
            text: "Olá",
            likes: 0,
            replies: 0,
          },
        ],
        transcript: [
          { start: 2, duration: 3, text: "Transcrição real desta fixture." },
        ],
        warnings: ["Somente dados sintéticos de teste."],
      };
      fixtureWindow.__omniStore = {
        snapshot,
        settings: {
          hideShorts: false,
          showMetrics: true,
          backendUrl: "",
          backendToken: "",
          aiModel: "",
          aiStreaming: false,
          aiOrigin: "http://127.0.0.1:7814",
        },
      };
      fixtureWindow.__omniPermissions = [];
      Object.defineProperty(globalThis, "chrome", {
        value: {
          runtime: {
            id: "omni-ui-fixture",
            getURL: (path: string) => `${appOrigin}/${path}`,
            sendMessage: async () => {
              throw new Error(
                "IA não deve passar pelo service worker nesta fixture.",
              );
            },
          },
          tabs: {
            query: async () => [
              { id: 1, title: "YouTube fixture", url: snapshot.url },
            ],
            sendMessage: async () => ({ status: "ok", snapshot }),
          },
          storage: {
            local: {
              get: async (key: string) => ({
                [key]: fixtureWindow.__omniStore[key],
              }),
              set: async (data: Record<string, unknown>) =>
                Object.assign(fixtureWindow.__omniStore, data),
              remove: async (keys: string[]) =>
                keys.forEach((key) => delete fixtureWindow.__omniStore[key]),
            },
          },
          permissions: {
            request: async ({ origins }: { origins: string[] }) => {
              fixtureWindow.__omniPermissions.push(origins);
              return true;
            },
            remove: async () => true,
          },
        },
      });
    },
    { appOrigin },
  );
  page = await context.newPage();
  await page.goto(`${appOrigin}/workspace.html`);
  await expect(page.locator("#tab-select")).toHaveValue("1");
});
test.afterEach(async () => {
  expect(sidecarRequests).toEqual([]);
  await context?.close();
});

async function connect(origin = backendOrigin) {
  await page.locator('[data-page="connection"]').click();
  await page.locator("#backend-url").fill(origin);
  await page.locator("#backend-token").fill("fixture-prevlev-token");
  await page.locator("#save-settings").click();
  await expect(page.locator("#notice")).toContainText("Configuração salva");
}
async function discover() {
  await page.locator("#ai-discover").click();
  await expect(page.locator("#ai-catalog-status")).toContainText(
    "modelos anunciados",
  );
}
async function selectModel(id: string) {
  await page.locator("#ai-provider-select").selectOption("fixture");
  await expect(page.locator("#ai-model-select")).toBeEnabled();
  await page.locator("#ai-model-select").selectOption(id);
  await expect(page.locator("#ai-catalog-status")).toContainText(
    `Seleção salva: ${id}`,
  );
}

test("explicit catalog and exact text selection send task data only through the own backend", async () => {
  expect(requests).toEqual([]);
  await connect();
  expect(requests).toEqual([]);
  await expect(page.locator("#ai-origin")).toHaveAttribute("readonly", "");
  await discover();
  expect(catalogs()).toHaveLength(1);
  expect(analyses()).toHaveLength(0);
  await expect(page.locator("#ai-model-select")).toHaveValue("");
  await expect(page.locator('[data-ai="transcript-summary"]')).toBeDisabled();
  await selectModel("fixture:text");
  await expect(page.locator("#ai-stream")).toBeEnabled();
  await page.locator("#ai-stream").check();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__omniStore.settings,
      ),
    )
    .toMatchObject({
      aiModel: "fixture:text",
      aiStreaming: true,
      aiOrigin: sidecarOrigin,
    });
  await page.locator('[data-page="transcript"]').click();
  await page.locator('[data-ai="transcript-summary"]').click();
  await expect(page.locator("#transcript-result")).toContainText(
    "Resultado de fixture <img",
  );
  await expect(page.locator("#transcript-result img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as FixtureWindow).__omniInjected,
    ),
  ).toBeUndefined();
  expect(analyses()[0].body).toEqual({
    feature: "transcript-summary",
    payload: {
      text: "Transcrição real desta fixture.",
      model: "fixture:text",
      stream: true,
      expectedOrigin: sidecarOrigin,
    },
  });
  await page.locator('[data-page="comments"]').click();
  await page.locator("#comment-likes").fill("1");
  await page.locator("#comments-ai").click();
  await expect(page.locator("#remote-result")).toContainText(
    "Resultado de fixture",
  );
  expect(analyses()[1].body).toMatchObject({
    feature: "comment-analysis",
    payload: {
      comments: [{ id: "first", text: "Como aplicar a técnica?", likes: 3 }],
      model: "fixture:text",
      stream: true,
      expectedOrigin: sidecarOrigin,
    },
  });
  expect(
    analyses()[1].body?.payload as Record<string, unknown>,
  ).not.toHaveProperty("videos");
  await page.locator("#remote-feature").selectOption("thumbnail-generation");
  await expect(page.locator("#remote-run")).toBeDisabled();
  expect(analyses()).toHaveLength(2);
  expect(
    requests.every(
      (request) =>
        request.headers.authorization === "Bearer fixture-prevlev-token",
    ),
  ).toBe(true);
  expect(
    requests.every(
      (request) =>
        !JSON.stringify(request.body ?? {}).includes("fixture-prevlev-token"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as FixtureWindow).__omniPermissions,
    ),
  ).toEqual([[`${backendOrigin}/*`]]);
});

test("removed model stays invalid without fallback and changed sidecar origin requires a new selection", async () => {
  await connect();
  await discover();
  await selectModel("fixture:text");
  models = [imageModel];
  await discover();
  await expect(page.locator("#ai-model-select")).toHaveValue("fixture:text");
  await expect(page.locator("#ai-capabilities")).toContainText(
    "modelo salvo não está disponível",
  );
  await expect(page.locator('[data-ai="transcript-summary"]')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__omniStore.settings,
      ),
    )
    .toMatchObject({ aiModel: "fixture:text" });
  expect(analyses()).toHaveLength(0);
  models = [textModel, imageModel];
  catalogOrigin = "http://127.0.0.1:7815";
  await page.locator("#ai-discover").click();
  await expect(page.locator("#ai-catalog-status")).toContainText(
    "origem do OmniProviders mudou",
  );
  await expect(page.locator("#ai-model-select")).toHaveValue("");
  await expect(page.locator('[data-ai="transcript-summary"]')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__omniStore.settings,
      ),
    )
    .toMatchObject({ aiModel: "", aiStreaming: false });
  await selectModel("fixture:text");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__omniStore.settings,
      ),
    )
    .toMatchObject({
      aiModel: "fixture:text",
      aiOrigin: "http://127.0.0.1:7815",
    });
  await connect("http://127.0.0.1:8788");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__omniStore.settings,
      ),
    )
    .toMatchObject({
      backendUrl: "http://127.0.0.1:8788",
      aiModel: "",
      aiStreaming: false,
    });
  expect(analyses()).toHaveLength(0);
});

test("image capability enables only explicit image submission and never silently chooses a text alternative", async () => {
  await connect();
  await discover();
  await selectModel("fixture:image");
  await expect(page.locator("#ai-stream")).toBeDisabled();
  await expect(page.locator('[data-ai="transcript-summary"]')).toBeDisabled();
  await page.locator('[data-page="remote"]').click();
  await page.locator("#remote-feature").selectOption("thumbnail-generation");
  await expect(page.locator("#remote-run")).toBeEnabled();
  await page
    .locator("#remote-query")
    .fill("Uma thumbnail original de astronomia");
  await page.locator("#remote-run").click();
  await expect(page.locator("#remote-result")).toContainText(
    "Resultado de fixture",
  );
  expect(analyses()).toHaveLength(1);
  expect(analyses()[0].body).toEqual({
    feature: "thumbnail-generation",
    payload: {
      prompt: "Uma thumbnail original de astronomia",
      model: "fixture:image",
      stream: false,
      expectedOrigin: sidecarOrigin,
    },
  });
  // Streaming is a text preference: a model offering both text and images still uses image JSON.
  models = [
    {
      ...textModel,
      id: "fixture:hybrid",
      outputModalities: ["text", "image"],
      operations: ["responses", "images.generate"],
      imageSupported: true,
    },
  ];
  await page.locator('[data-page="connection"]').click();
  await discover();
  await selectModel("fixture:hybrid");
  await page.locator("#ai-stream").check();
  await page.locator('[data-page="remote"]').click();
  await page.locator("#remote-run").click();
  await expect.poll(() => analyses().length).toBe(2);
  expect(analyses()[1].body).toMatchObject({
    feature: "thumbnail-generation",
    payload: { model: "fixture:hybrid", stream: false },
  });
});

test("chat-only model keeps JSON text enabled but cannot request Responses streaming", async () => {
  models = [
    {
      ...textModel,
      id: "fixture:chat",
      operations: ["chat.completions"],
      streaming: true,
    },
  ];
  await connect();
  await discover();
  await selectModel("fixture:chat");
  await expect(page.locator("#ai-stream")).toBeDisabled();
  await expect(page.locator("#ai-stream")).not.toBeChecked();
  await expect(page.locator('[data-ai="transcript-summary"]')).toBeEnabled();
  await page.locator('[data-page="transcript"]').click();
  await page.locator('[data-ai="transcript-summary"]').click();
  await expect(page.locator("#transcript-result")).toContainText(
    "Resultado de fixture",
  );
  expect(analyses()).toHaveLength(1);
  expect(analyses()[0].body).toEqual({
    feature: "transcript-summary",
    payload: {
      text: "Transcrição real desta fixture.",
      model: "fixture:chat",
      stream: false,
      expectedOrigin: sidecarOrigin,
    },
  });
});

test("catalog auth and offline failures remain visible without generation or invented models", async () => {
  await connect();
  catalogMode = "auth";
  await page.locator("#ai-discover").click();
  await expect(page.locator("#ai-catalog-status")).toContainText("HTTP 401");
  await expect(page.locator("#notice")).toContainText("Token Prevlev inválido");
  await expect(page.locator("#ai-model-select")).toHaveValue("");
  catalogMode = "offline";
  await page.locator("#ai-discover").click();
  await expect(page.locator("#ai-catalog-status")).toContainText(
    "backend Prevlev está offline",
  );
  await expect(page.locator("#ai-capabilities")).toContainText(
    "Capacidades ainda não consultadas",
  );
  expect(catalogs()).toHaveLength(2);
  expect(analyses()).toHaveLength(0);
});

test("workspace Thumbnail Lab pins the saved backend, sends only briefing text and reports preflight changes", async () => {
  await connect(); await discover(); await selectModel("fixture:image");
  // Editing the connection form does not change the saved transport or its journal label.
  await page.locator("#backend-url").fill("http://127.0.0.1:8788");
  await page.locator('[data-page="thumbnail-lab"]').click();
  expect(analyses()).toHaveLength(0);
  await expect(page.locator("#thumbnail-lab-model")).toContainText(`backend: ${backendOrigin}`);
  await page.locator('#thumbnail-lab-form [name="title"]').fill("Astronomia observada");
  await page.locator("#thumbnail-lab-ref-url").fill("https://example.invalid/referencia-local.png");
  await page.locator("#thumbnail-lab-add-url").click();
  await page.locator("#thumbnail-lab-generate").click();
  await expect(page.locator("#thumbnail-lab-history")).toContainText("Resposta de imagem recebida");
  expect(analyses()).toHaveLength(1);
  expect(analyses()[0].url).toBe(`${backendOrigin}/v1/analyze`);
  expect(analyses()[0].body).toMatchObject({feature:"thumbnail-generation",payload:{model:"fixture:image",expectedOrigin:sidecarOrigin,stream:false}});
  expect(Object.keys(analyses()[0].body?.payload as object).sort()).toEqual(["expectedOrigin","model","prompt","stream"]);
  expect(JSON.stringify(analyses()[0].body)).not.toContain("example.invalid");
  await page.locator("#thumbnail-lab-history button").click();
  await expect(page.locator("#remote-images img")).toHaveCount(1);
  expect(analyses()).toHaveLength(1);
  // Another workspace can change persisted settings while this lab remains open.
  await page.evaluate(() => { const settings=(window as unknown as FixtureWindow).__omniStore.settings as Record<string,unknown>; settings.backendUrl="http://127.0.0.1:8788"; });
  await page.locator('[data-page="thumbnail-lab"]').click();
  await page.locator("#thumbnail-lab-generate").click();
  await expect(page.locator("#thumbnail-lab-status")).toContainText("Solicitação não enviada");
  await expect(page.locator("#thumbnail-lab-history li").first()).toContainText("Erro da solicitação");
  expect(analyses()).toHaveLength(1);
});

test("clearing the collection discards a pending backend image preview", async () => {
  await connect();await discover();await selectModel("fixture:image");
  let release!:()=>void;delayedImageReply=new Promise<void>(resolve=>{release=resolve;});
  await page.locator('[data-page="remote"]').click();await page.locator("#remote-feature").selectOption("thumbnail-generation");
  await page.locator("#remote-query").fill("Imagem própria em fixture");await page.locator("#remote-run").click();
  await expect.poll(()=>analyses().length).toBe(1);
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('[data-page="connection"]').click();await page.locator('#clear-data').click();
  await expect(page.locator('#notice')).toContainText('Dados locais apagados');release();
  await page.locator('[data-page="remote"]').click();await expect(page.locator('#remote-run')).toBeEnabled();
  await expect(page.locator('#remote-images img')).toHaveCount(0);
  await expect(page.locator('#notice')).toContainText('Dados locais apagados');
});

test("switching backend invalidates transcript AI cache even after reselecting identical model and Omni origin",async()=>{
  await connect();await discover();await selectModel('fixture:text');
  await page.locator('[data-page="transcript"]').click();await page.locator('[data-ai="transcript-summary"]').click();
  await expect(page.locator('#transcript-ai-state')).toContainText('concluído');
  await page.locator('[data-ai="transcript-summary"]').click();await expect(page.locator('#transcript-ai-state')).toContainText('cache');expect(analyses()).toHaveLength(1);
  await connect('http://127.0.0.1:8788');await discover();await selectModel('fixture:text');
  await page.locator('[data-page="transcript"]').click();await expect(page.locator('#transcript-copy-summary')).toBeDisabled();
  await page.locator('[data-ai="transcript-summary"]').click();await expect(page.locator('#transcript-ai-state')).toContainText('concluído');
  expect(analyses()).toHaveLength(2);expect(analyses()[1].url).toBe('http://127.0.0.1:8788/v1/analyze');
  await connect('http://127.0.0.1:8788');await page.locator('[data-page="transcript"]').click();
  await expect(page.locator('#transcript-copy-summary')).toBeDisabled();
});
