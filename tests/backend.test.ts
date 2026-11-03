import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { configFromEnv, createPrevlevServer } from "../server/index.mjs";
import { analyzeDataset } from "../server/analysis.mjs";
import { analyzeAi, validateProvider } from "../server/ai.mjs";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("rotas opcionais de pesquisa oficial e histórico local",()=>{
  const channelId=`UC${'a'.repeat(22)}`;
  const snippet={title:"Vídeo fixture",channelId,channelTitle:"Canal fixture",publishedAt:"2026-10-01T00:00:00Z",thumbnails:{default:{url:"https://i.ytimg.com/vi/aaaaaaaaaaa/default.jpg"}}};
  const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{"Content-Type":"application/json"}});
  const post=(base:string,path:string,input:unknown,headers:Record<string,string>={})=>fetch(`${base}${path}`,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(input)});
  async function historyDirectory(){const dataDir=await mkdtemp(join(tmpdir(),"prevlev-route-history-"));directories.push(dataDir);return dataDir;}
  it("inicia desativado sem acessar fonte ou expor chaves e valida retenção",async()=>{
    expect(configFromEnv({})).toMatchObject({youtubeEnabled:false,youtubeApiKey:"",historyMaxRecords:5000,mcpEnabled:false});
    expect(configFromEnv({YOUTUBE_ENABLED:"true",YOUTUBE_API_KEY:"fixture-official-key",MCP_ENABLED:"true",HISTORY_MAX_RECORDS:"100"})).toMatchObject({youtubeEnabled:true,youtubeApiKey:"fixture-official-key",mcpEnabled:true,historyMaxRecords:100});
    expect(configFromEnv({YOUTUBE_ENABLED:"yes",MCP_ENABLED:"1"})).toMatchObject({youtubeEnabled:false,mcpEnabled:false});
    for(const historyMaxRecords of [0,5001,NaN,1.5])expect(()=>createPrevlevServer({historyMaxRecords})).toThrow("HISTORY_MAX_RECORDS");
    const fetcher=vi.fn<typeof fetch>();const base=await start({youtubeEnabled:true,youtubeApiKey:"fixture-official-key",mcpEnabled:true},{fetcher});
    const health=await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({data:{youtubeEnabled:true,youtubeConfigured:true,youtubeSource:"youtube-data-api",youtubeReachable:null,historyMaxRecords:5000,mcpEnabled:true}});
    expect(JSON.stringify(health)).not.toMatch(/fixture-official-key|youtubeApiKey|remainingQuota|quotaRemaining|mcpRunning/);
    expect((await post(base,"/v1/mcp",{})).status).toBe(404);expect(fetcher).not.toHaveBeenCalled();
  });
  it("exige ativação, chave e consentimento explícito antes de qualquer busca",async()=>{
    const cases=[{options:{},apiConsent:true},{options:{youtubeEnabled:true},apiConsent:true},{options:{youtubeEnabled:false,youtubeApiKey:"fixture-official-key"},apiConsent:true},{options:{youtubeEnabled:true,youtubeApiKey:"fixture-official-key"},apiConsent:false}];
    for(const {options,apiConsent} of cases){const fetcher=vi.fn<typeof fetch>();const base=await start(options,{fetcher});
      expect(await (await post(base,"/v1/youtube/search",{q:"fixture",type:"video",apiConsent})).json()).toMatchObject({status:"not_configured",source:"youtube-data-api"});expect(fetcher).not.toHaveBeenCalled();}
  });
  it("aplica origem, autenticação, JSON e limite de corpo às duas rotas",async()=>{
    const origin="chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetcher=vi.fn<typeof fetch>();const base=await start({token:"fixture-client-token",allowedOrigins:[origin],dataDir:await historyDirectory()},{fetcher});
    const headers={Origin:origin,Authorization:"Bearer fixture-client-token"};
    for(const path of ["/v1/youtube/search","/v1/history"]){
      expect((await post(base,path,{}, {Origin:"https://evil.example",Authorization:headers.Authorization})).status).toBe(403);
      expect((await post(base,path,{}, {Origin:origin})).status).toBe(401);
      expect((await post(base,path,[],headers)).status).toBe(400);
      expect((await fetch(`${base}${path}`,{method:"POST",headers:{...headers,"Content-Type":"text/plain"},body:"{}"})).status).toBe(415);
      expect((await fetch(`${base}${path}`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"invalid json"})).status).toBe(400);
      expect((await post(base,path,{padding:"x".repeat(1024*1024)},headers)).status).toBe(413);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("mantém os dados oficiais separados e não cancela após o corpo normal terminar",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,options)=>{
      expect(options?.signal?.aborted).toBe(false);
      const url=new URL(String(input));
      if(url.pathname.endsWith('/search'))return json({items:[{id:{kind:"youtube#video",videoId:"aaaaaaaaaaa"},snippet}],nextPageToken:"next-fixture"});
      if(url.pathname.endsWith('/videos'))return json({items:[{id:"aaaaaaaaaaa",snippet,contentDetails:{duration:"PT5M"},statistics:{viewCount:"123",likeCount:"5"}}]});
      if(url.pathname.endsWith('/channels'))return json({items:[{id:channelId,snippet:{title:"Canal fixture"},statistics:{subscriberCount:"1200",hiddenSubscriberCount:false,viewCount:"123",videoCount:"4"}}]});
      throw new Error("Unexpected fixture route");
    });
    const base=await start({youtubeEnabled:true,youtubeApiKey:"fixture-official-key"},{fetcher});
    const response=await post(base,"/v1/youtube/search",{q:"fixture",type:"video",apiConsent:true,maxResults:10});
    const result=await response.json();expect(result).toMatchObject({status:"ok",source:"youtube-data-api",data:{source:"youtube-data-api",requestCount:3,nextPageToken:"next-fixture",videos:[{id:"aaaaaaaaaaa",viewCount:"123"}]}});
    expect(JSON.stringify(result)).not.toMatch(/fixture-official-key|"vph"|"outlier"|"estimatedRevenue"/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for(const [url,options] of fetcher.mock.calls){expect(String(url)).not.toContain("fixture-official-key");expect(options?.signal?.aborted).toBe(false);}
  });
  it("aborta a busca quando o cliente fecha a resposta e impede metadados seguintes",async()=>{
    let receivedSignal:AbortSignal|undefined;
    let entered:()=>void=()=>{};
    const firstRequest=new Promise<void>(resolve=>{entered=resolve;});
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,options)=>{
      receivedSignal=options?.signal??undefined;entered();
      return new Promise<Response>((_resolve,reject)=>{receivedSignal?.addEventListener('abort',()=>reject(new Error('Fixture aborted')),{once:true});});
    });
    const base=await start({youtubeEnabled:true,youtubeApiKey:"fixture-official-key"},{fetcher});
    const client=request(`${base}/v1/youtube/search`,{method:"POST",headers:{"Content-Type":"application/json"}});
    client.on('error',()=>{});client.end(JSON.stringify({q:"fixture",type:"video",apiConsent:true}));
    await firstRequest;expect(receivedSignal?.aborted).toBe(false);client.destroy();
    await vi.waitFor(()=>expect(receivedSignal?.aborted).toBe(true));expect(fetcher).toHaveBeenCalledOnce();
  });
  it("registra, consulta, exporta e exclui somente histórico local mediante confirmação",async()=>{
    const base=await start({dataDir:await historyDirectory()});
    const local={id:"abcdefghijk",title:"Fixture local",url:"https://www.youtube.com/watch?v=abcdefghijk",views:100,source:"youtube-dom"};
    expect(await (await post(base,"/v1/history",{action:"record",videos:[local]})).json()).toMatchObject({status:"ok",source:"prevlev:history",data:{recorded:1}});
    for(const action of ["list","get","export"]){const response=await post(base,"/v1/history",{action,videoId:local.id});const result=await response.json();expect(result).toMatchObject({status:"ok",source:"prevlev:history",data:{records:[{videoId:local.id}]}});}
    expect(await (await post(base,"/v1/history",{action:"record",videos:[{...local,source:"youtube-data-api"}]})).json()).toMatchObject({status:"error"});
    expect(await (await post(base,"/v1/history",{action:"delete",videoId:local.id})).json()).toMatchObject({status:"error"});
    expect(await (await post(base,"/v1/history",{action:"delete",videoId:local.id,confirm:true})).json()).toMatchObject({status:"ok",data:{deleted:1}});
    expect(await (await post(base,"/v1/history",{action:"list"})).json()).toMatchObject({status:"ok",data:{records:[]}});
  });
  it("compartilha o limite das novas rotas com catálogo e análise",async()=>{
    const fetcher=vi.fn<typeof fetch>();const base=await start({aiProvider:"openai-compatible",dataDir:await historyDirectory()},{fetcher});
    for(let index=0;index<10;index++){
      expect((await post(base,"/v1/youtube/search",{q:"fixture",apiConsent:false})).status).toBe(200);
      expect((await post(base,"/v1/history",{action:"list"})).status).toBe(200);
      expect((await fetch(`${base}/v1/ai/catalog`)).status).toBe(422);
    }
    expect((await post(base,"/v1/analyze",{feature:"niche",payload:{videos}})).status).toBe(429);expect(fetcher).not.toHaveBeenCalled();
  });
});
async function start(
  options: Parameters<typeof createPrevlevServer>[0] = {},
  dependencies: Parameters<typeof createPrevlevServer>[1] = {},
) {
  const server = createPrevlevServer(options, dependencies);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const videos = [
  {
    id: "one",
    title: "Python para dados",
    channel: "Dados",
    channelId: "dados",
    views: 100,
    publishedAt: "2026-10-01T00:00:00Z",
    isShort: false,
  },
  {
    id: "two",
    title: "Python para iniciantes",
    channel: "Código",
    channelId: "codigo",
    views: 300,
    isShort: true,
  },
  {
    id: "three",
    title: "Como cozinhar arroz",
    channel: "Cozinha",
    channelId: "cozinha",
  },
];

describe("análises próprias com dados observados", () => {
  it("recusa a amostra inteira com proveniência da API antes de qualquer análise ou projeção",async()=>{
    const api={id:"fixture-api-row",title:"API fixture",views:123,source:"youtube-data-api"};
    const features=["channel-report","channel-analytics","combined-analytics","search-analysis","niche","similar-videos","similar-channels","sponsorships","view-history","unknown-feature"];
    for(const feature of features){
      for(const payload of [{source:"youtube-data-api",videos,text:"Patrocinado por fixture"},{videos:[...videos,api],text:"Patrocinado por fixture"},{videos:[api,...videos],text:"Patrocinado por fixture"},{videos:[...videos,{...api,id:videos[0].id}],text:"Patrocinado por fixture"}]){
        await expect(analyzeDataset(feature,payload)).rejects.toThrow("youtube-data-api");
      }
    }
    const local=await analyzeDataset("channel-report",{source:"youtube-dom",videos:videos.map(video=>({...video,source:"youtube-dom"}))});
    expect(local).toMatchObject({status:"ok",data:{videoCount:3,totalObservedViews:400}});
  });
  it("calcula cobertura sem inventar views ausentes e remove vídeos repetidos", async () => {
    const result = await analyzeDataset(
      "channel-report",
      { videos: [...videos, videos[0]] },
      { now: Date.parse("2026-10-02T00:00:00Z") },
    );
    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({
      videoCount: 3,
      knownViewCount: 2,
      totalObservedViews: 400,
      medianViews: 200,
      viewsCoverage: 2 / 3,
      shorts: 1,
      longForm: 1,
      formatUnknown: 1,
    });
    expect(JSON.stringify(result.data)).not.toMatch(/revenue|rpm|geography/);
  });
  it("ranqueia somente similares com palavras compartilhadas e exclui o próprio alvo", async () => {
    const result = await analyzeDataset("similar-videos", {
      videos,
      targetId: "one",
    });
    expect(result.data).toMatchObject({
      results: [{ id: "two", score: 1 / 3, shared: ["python"] }],
    });
  });
  it("agrupa canais com pontuação explicável e calcula termos do nicho", async () => {
    const result = await analyzeDataset("similar-channels", {
      videos,
      targetId: "dados",
    });
    expect(result.data).toMatchObject({
      results: [{ id: "codigo", score: 1 / 3 }],
    });
    expect((await analyzeDataset("niche", { videos })).data).toMatchObject({
      channelCount: 3,
      terms: expect.arrayContaining([{ term: "python", count: 2 }]),
    });
  });
  it("identifica apenas marcadores textuais de patrocínio, sem estimar receita", async () => {
    const result = await analyzeDataset("sponsorships", {
      text: "Tutorial de hoje. Este vídeo é patrocinado pela Exemplo. Obrigado!",
    });
    expect(result.data).toMatchObject({
      mentions: [{ excerpt: "Este vídeo é patrocinado pela Exemplo." }],
      estimatedRevenue: null,
    });
  });
  it("persiste observações reais concorrentes sem preencher passado", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "prevlev-history-"));
    directories.push(dataDir);
    const empty = await analyzeDataset(
      "view-history",
      { videoId: "abc" },
      { dataDir, now: 1000 },
    );
    expect(empty.data).toMatchObject({ observations: [] });
    await Promise.all([
      analyzeDataset(
        "view-history",
        { videoId: "abc", views: 50 },
        { dataDir, now: 1000 },
      ),
      analyzeDataset(
        "view-history",
        { videoId: "abc", views: 75 },
        { dataDir, now: 2000 },
      ),
    ]);
    const result = await analyzeDataset(
      "view-history",
      { videoId: "abc" },
      { dataDir, now: 3000 },
    );
    expect(result.data).toMatchObject({
      observations: [
        { observedAt: "1970-01-01T00:00:01.000Z", views: 50 },
        { observedAt: "1970-01-01T00:00:02.000Z", views: 75 },
      ],
    });
  });
  it("rejeita caminhos arbitrários e recursos desconhecidos", async () => {
    await expect(
      analyzeDataset(
        "view-history",
        { videoId: "../../secret" },
        { dataDir: "/tmp" },
      ),
    ).rejects.toThrow("videoId");
    expect(await analyzeDataset("inexistente", {})).toMatchObject({
      status: "unsupported",
    });
  });
});

describe("servidor HTTP real em loopback", () => {
  it("recusa datasets mistos pela rota HTTP sem devolver métricas parciais",async()=>{
    const fetcher=vi.fn<typeof fetch>();const base=await start({}, {fetcher});
    for(const [feature,payload] of [
      ["channel-report",{videos:[...videos,{id:"fixture-api-row",title:"API fixture",views:123,source:"youtube-data-api"}]}],
      ["sponsorships",{source:"youtube-data-api",text:"Patrocinado por fixture"}],
      ["unknown-feature",{source:"youtube-data-api",videos}],
    ] as const){
      const response=await fetch(`${base}/v1/analyze`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feature,payload})});
      expect(response.status).toBe(400);const result=await response.json();expect(result).toMatchObject({status:"error",error:expect.stringContaining("amostra inteira")});
      expect(result).not.toHaveProperty("data");expect(JSON.stringify(result)).not.toMatch(/totalObservedViews|medianViews|mentions|score/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("responde health e exige origem exata e token para análise", async () => {
    const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const base = await start({ token: "test-token", allowedOrigins: [origin] });
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(
      (
        await fetch(`${base}/v1/analyze`, {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ feature: "niche", payload: { videos } }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/v1/analyze`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    const result = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ feature: "search-analysis", payload: { videos } }),
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(await result.json()).toMatchObject({
      status: "ok",
      data: { videoCount: 3 },
    });
  });
  it("rejeita bind público sem autenticação e origem com curinga", () => {
    expect(() => createPrevlevServer({ bind: "0.0.0.0" })).toThrow(
      "PREVLEV_TOKEN",
    );
    expect(() => createPrevlevServer({ allowedOrigins: ["*"] })).toThrow(
      "ALLOWED_ORIGINS",
    );
  });
  it("valida JSON, tipo de conteúdo, recurso e limite de corpo", async () => {
    const base = await start();
    const post = (body: string, contentType = "application/json") =>
      fetch(`${base}/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post("bad")).status).toBe(400);
    expect(
      (await post(JSON.stringify({ feature: "unknown", payload: {} }))).status,
    ).toBe(422);
    expect(
      (
        await post(
          JSON.stringify({ feature: "niche", payload: { videos: [] } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await post(JSON.stringify({ padding: "x".repeat(1024 * 1024) }))).status,
    ).toBe(413);
  });
  it("responde not_configured para IA sem fazer requisição externa", async () => {
    const fetcher = vi.fn();
    const server = createPrevlevServer({}, { fetcher });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const result = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: "comment-analysis",
          payload: { comments: [{ text: "Teste" }] },
        }),
      },
    );
    expect(await result.json()).toMatchObject({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aplica limite de análises por endereço", async () => {
    const base = await start();
    const statuses = [];
    for (let index = 0; index < 31; index++)
      statuses.push(
        (
          await fetch(`${base}/v1/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feature: "niche", payload: { videos } }),
          })
        ).status,
      );
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("adaptador de IA configurável sem consumo externo nos testes", () => {
  it("nega Nexlev, credenciais na URL, HTTP remoto e parâmetros", () => {
    for (const url of [
      "https://api.nexlev.io/v1",
      "http://ai.example/v1",
      "https://name:token@ai.example/v1",
      "https://ai.example/v1?token=bad",
    ])
      expect(() => validateProvider(url)).toThrow();
    expect(validateProvider("http://127.0.0.1:8080/v1/")).toBe(
      "http://127.0.0.1:8080/v1",
    );
  });
  it("envia contrato de chat ao provedor explícito e preserva resultado como gerado", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "local-test",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "Resumo de exemplo" },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await analyzeAi(
      "transcript-summary",
      { transcript: [{ start: 0, text: "Conteúdo de teste" }] },
      {
        aiProvider: "openai-compatible",
        aiBaseUrl: "http://127.0.0.1:9000/v1",
        aiModel: "local-test",
      },
      fetcher,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://127.0.0.1:9000/v1/chat/completions",
    );
    expect(result).toMatchObject({
      status: "ok",
      data: { text: "Resumo de exemplo", generated: true },
    });
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].content).toContain("Conteúdo de teste");
  });
  it("propaga falhas explícitas e rejeita resposta sem imagem", async () => {
    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    expect(
      await analyzeAi(
        "comment-analysis",
        { comments: [{ text: "teste" }] },
        {
          aiProvider: "openai-compatible",
          aiBaseUrl: "http://localhost:9000/v1",
          aiModel: "test",
        },
        failed,
      ),
    ).toMatchObject({
      status: "error",
      error: "O provedor de IA respondeu HTTP 429.",
    });
    const empty = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
      );
    await expect(
      analyzeAi(
        "thumbnail-generation",
        { prompt: "thumbnail original" },
        {
          aiProvider: "openai-compatible",
          aiBaseUrl: "http://localhost:9000/v1",
          aiImageModel: "test",
        },
        empty,
      ),
    ).rejects.toThrow("imagem compatível");
  });
  it("aceita texto somente com modelo confirmado, uma escolha completa e nenhuma chamada de ferramenta", async () => {
    const model = "fixture-exact-model";
    const message = { role: "assistant", content: "Texto de fixture" };
    const valid = { model, choices: [{ finish_reason: "stop", message }] };
    const cases = [
      { ...valid, model: "another-model" },
      { choices: valid.choices },
      { ...valid, choices: [] },
      { ...valid, choices: [valid.choices[0], valid.choices[0]] },
      { ...valid, choices: [{ finish_reason: "length", message }] },
      { ...valid, choices: [{ message }] },
      {
        ...valid,
        choices: [
          {
            finish_reason: "stop",
            message: { ...message, tool_calls: [{ id: "tool-fixture" }] },
          },
        ],
      },
      {
        ...valid,
        choices: [
          {
            finish_reason: "stop",
            message: { ...message, function_call: { name: "tool-fixture" } },
          },
        ],
      },
      {
        ...valid,
        choices: [
          { finish_reason: "stop", message: { ...message, role: "user" } },
        ],
      },
      {
        ...valid,
        choices: [
          { finish_reason: "stop", message: { ...message, content: "" } },
        ],
      },
    ];
    for (const response of cases) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify(response), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      await expect(
        analyzeAi(
          "transcript-summary",
          { text: "Conteúdo de fixture" },
          {
            aiProvider: "openai-compatible",
            aiBaseUrl: "http://localhost:9000/v1",
            aiModel: model,
          },
          fetcher,
        ),
      ).rejects.toThrow();
    }
  });
  it("não afirma identidade do modelo de imagem quando o contrato não a devolve", async () => {
    const model = "fixture-image";
    const config = {
      aiProvider: "openai-compatible" as const,
      aiBaseUrl: "http://localhost:9000/v1",
      aiImageModel: model,
    };
    const image = { data: [{ b64_json: "aW1hZ2UtZml4dHVyZQ==" }] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(image), {
            headers: { "Content-Type": "application/json" },
          }),
      );
    const result = await analyzeAi(
      "thumbnail-generation",
      { prompt: "Imagem de fixture" },
      config,
      fetcher,
    );
    expect(result).toMatchObject({
      status: "ok",
      data: { requestedModel: model, modelVerified: false, generated: true },
    });
    expect(result.data).not.toHaveProperty("model");
    const wrong = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...image, model: "another-model" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    await expect(
      analyzeAi(
        "thumbnail-generation",
        { prompt: "Imagem de fixture" },
        config,
        wrong,
      ),
    ).rejects.toThrow("difere");
  });
  it("descarta detalhes externos de JSON inválido, falha de rede, leitura e timeout", async () => {
    const marker = "PRIVATE_KEY_FROM_PROVIDER";
    const config = {
      aiProvider: "openai-compatible" as const,
      aiBaseUrl: "http://localhost:9000/v1",
      aiModel: "fixture-model",
    };
    const fetchers = [
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(`{"${marker}":`, {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      vi.fn<typeof fetch>().mockRejectedValue(new Error(`network ${marker}`)),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(`body ${marker}`));
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          Object.assign(new Error(marker), { name: "TimeoutError" }),
        ),
    ];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const fetcher of fetchers) {
        const error = await analyzeAi(
          "transcript-summary",
          { text: "Transcrição de fixture" },
          config,
          fetcher,
        ).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(marker);
        expect((error as Error).message).toMatch(/provedor|JSON/);
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe("configuração e rotas Omni, sem serviço ou conta real", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const catalog = {
    object: "list",
    data: [
      {
        id: "fixture:text",
        owned_by: "fixture",
        x_omni: {
          label: "Texto fixture",
          capabilities: {
            input_modalities: ["text"],
            output_modalities: ["text"],
            operations: ["responses"],
            streaming: false,
          },
        },
      },
    ],
  };
  it("seleciona Omni 7814 por padrão e mantém credenciais somente no servidor", async () => {
    const defaults = configFromEnv({});
    expect(defaults).toMatchObject({
      aiProvider: "omni",
      omniBaseUrl: "http://127.0.0.1:7814",
      omniApiKey: "",
      omniTimeoutMs: 120000,
    });
    expect(
      configFromEnv({
        AI_PROVIDER: "openai-compatible",
        OMNI_BASE_URL: "http://localhost:9000",
        OMNI_API_KEY: "server-fixture",
        OMNI_TIMEOUT_MS: "90000",
      }),
    ).toMatchObject({
      aiProvider: "openai-compatible",
      omniBaseUrl: "http://localhost:9000",
      omniApiKey: "server-fixture",
      omniTimeoutMs: 90000,
    });
    const fetcher = vi.fn<typeof fetch>();
    const base = await start(
      {
        omniApiKey: "omni-secret-fixture",
        aiApiKey: "generic-secret-fixture",
        token: "backend-secret-fixture",
      },
      { fetcher },
    );
    const response = await fetch(`${base}/health`);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "ok",
      data: {
        aiProvider: "omni",
        aiOrigin: "http://127.0.0.1:7814",
        aiConfigurationConfigured: true,
        aiReachable: null,
        aiSelectionRequired: true,
        aiTextConfigured: false,
        aiImageConfigured: false,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /omni-secret-fixture|generic-secret-fixture|backend-secret-fixture|omniApiKey|aiApiKey/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejeita origem Omni inválida, provedor desconhecido, timeout inválido e origem CORS não exata", () => {
    for (const omniBaseUrl of [
      "http://remote.example",
      "http://127.0.0.1:7814/api",
      "https://name:secret@omni.example",
      "https://omni.example?token=secret",
      "https://api.nexlev.io",
    ])
      expect(() => createPrevlevServer({ omniBaseUrl })).toThrow();
    for (const omniTimeoutMs of [0, 300001, NaN])
      expect(() => createPrevlevServer({ omniTimeoutMs })).toThrow(
        "OMNI_TIMEOUT_MS",
      );
    expect(() =>
      createPrevlevServer(configFromEnv({ AI_PROVIDER: "unknown" })),
    ).toThrow("AI_PROVIDER");
    for (const origin of [
      "https://name:secret@example.com",
      "https://example.com?key=secret",
      "https://example.com/",
      "*",
    ])
      expect(() => createPrevlevServer({ allowedOrigins: [origin] })).toThrow(
        "ALLOWED_ORIGINS",
      );
  });
  it("protege catálogo com origem exata e token antes de descobrir modelos", async () => {
    const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetcher = vi.fn<typeof fetch>();
    const base = await start(
      { token: "fixture-token", allowedOrigins: [origin] },
      { fetcher },
    );
    expect(
      (
        await fetch(`${base}/v1/ai/catalog`, {
          headers: {
            Origin: "https://evil.example",
            Authorization: "Bearer fixture-token",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${base}/v1/ai/catalog`, { headers: { Origin: origin } }))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/v1/ai/catalog`, {
          headers: { Origin: origin, Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    const preflight = await fetch(`${base}/v1/ai/catalog`, {
      method: "OPTIONS",
      headers: { Origin: origin },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retorna catálogo normalizado e gera pelo modelo exato após nova validação do catálogo", async () => {
    const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith("/v1/models")
          ? json(catalog)
          : json({
              model: "fixture:text",
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: "Resumo de fixture" }],
                },
              ],
            }),
      );
    const base = await start(
      {
        omniApiKey: "fixture-server-key",
        token: "fixture-client-token",
        allowedOrigins: [origin],
      },
      { fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
    const listed = await fetch(`${base}/v1/ai/catalog`, {
      headers: { Origin: origin, Authorization: "Bearer fixture-client-token" },
    });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const listing = await listed.json();
    expect(listing).toMatchObject({
      status: "ok",
      source: "prevlev:omni",
      data: {
        origin: "http://127.0.0.1:7814",
        models: [
          { id: "fixture:text", textSupported: true, imageSupported: false },
        ],
      },
    });
    expect(JSON.stringify(listing)).not.toMatch(
      /fixture-server-key|fixture-client-token/,
    );
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: {
        Origin: origin,
        Authorization: "Bearer fixture-client-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        feature: "transcript-summary",
        payload: {
          model: "fixture:text",
          text: "Transcrição de fixture",
          stream: false,
        },
      }),
    });
    expect(await response.json()).toMatchObject({
      status: "ok",
      source: "prevlev:omni",
      data: {
        model: "fixture:text",
        text: "Resumo de fixture",
        generated: true,
      },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:7814/v1/models",
      "http://127.0.0.1:7814/v1/models",
      "http://127.0.0.1:7814/v1/responses",
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options?.credentials).toBe("omit");
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({
        Authorization: "Bearer fixture-server-key",
      });
    }
    const sent = JSON.parse(String(fetcher.mock.calls[2][1]?.body));
    expect(sent).toMatchObject({
      model: "fixture:text",
      store: false,
      stream: false,
    });
    expect(JSON.stringify(sent)).not.toMatch(
      /fixture-server-key|fixture-client-token/,
    );
  });
  it("expõe offline e HTTP401 do sidecar como indisponibilidade sem vazar erro sensível", async () => {
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("connect refused fixture-server-key"));
    const offlineBase = await start(
      { omniApiKey: "fixture-server-key" },
      { fetcher: offline },
    );
    const result = await (await fetch(`${offlineBase}/v1/ai/catalog`)).json();
    expect(result).toMatchObject({
      status: "not_configured",
      source: "prevlev:omni",
    });
    expect(result.error).toContain("catálogo");
    expect(JSON.stringify(result)).not.toContain("fixture-server-key");
    expect(offline).toHaveBeenCalledOnce();
    const denied = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ secret: "never echo" }, 401));
    const deniedBase = await start(
      { omniApiKey: "fixture-server-key" },
      { fetcher: denied },
    );
    const unauthorized = await (
      await fetch(`${deniedBase}/v1/ai/catalog`)
    ).json();
    expect(unauthorized).toMatchObject({
      status: "not_configured",
      error: expect.stringContaining("HTTP 401"),
    });
    expect(JSON.stringify(unauthorized)).not.toMatch(
      /never echo|fixture-server-key/,
    );
  });
  it("rejeita modelo removido sem enviar geração e não escolhe alternativa", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json(catalog));
    const base = await start({}, { fetcher });
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: "transcript-summary",
        payload: { model: "fixture:removed", text: "Texto de fixture" },
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: "unsupported",
      source: "prevlev:omni",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:7814/v1/models");
  });
  it("redige segredos conhecidos se uma falha do adaptador compatível alcançar a rota", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          "failed fixture-generic-key fixture-client-token Bearer another-fixture",
        ),
      );
    const base = await start(
      {
        aiProvider: "openai-compatible",
        aiBaseUrl: "http://localhost:9000/v1",
        aiModel: "fixture-text",
        aiApiKey: "fixture-generic-key",
        token: "fixture-client-token",
      },
      { fetcher },
    );
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-client-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        feature: "transcript-summary",
        payload: { text: "Texto de fixture" },
      }),
    });
    const result = await response.json();
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-generic-key|fixture-client-token|another-fixture/,
    );
    expect(result.error).toContain("conectar ao provedor");
  });
  it("não expõe corpo JSON inválido do provedor no erro da rota HTTP", async () => {
    const marker = "PRIVATE_KEY_FROM_PROVIDER";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(`{"${marker}":`, {
          headers: { "Content-Type": "application/json" },
        }),
      );
    const base = await start(
      {
        aiProvider: "openai-compatible",
        aiBaseUrl: "http://localhost:9000/v1",
        aiModel: "fixture-model",
      },
      { fetcher },
    );
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: "transcript-summary",
        payload: { text: "Transcrição de fixture" },
      }),
    });
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "error",
      error:
        "O provedor retornou JSON inválido; o conteúdo da resposta foi descartado.",
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });
  it("compartilha a cota do catálogo com análise e não supõe contrato Omni no modo compatível", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const base = await start({ aiProvider: "openai-compatible" }, { fetcher });
    for (let index = 0; index < 30; index++)
      expect((await fetch(`${base}/v1/ai/catalog`)).status).toBe(422);
    expect(
      (
        await fetch(`${base}/v1/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feature: "niche", payload: { videos } }),
        })
      ).status,
    ).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("não infere provedor compatível só porque AI_BASE_URL foi fornecida", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await analyzeAi(
        "transcript-summary",
        { text: "Texto real de fixture" },
        { aiBaseUrl: "http://localhost:9000/v1", aiModel: "legacy-model" },
        fetcher,
      ),
    ).toMatchObject({ status: "not_configured", source: "prevlev:omni" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
