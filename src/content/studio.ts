import { parseCount, parseDuration } from "../core/parse";
import type { MidrollRemovalObservation } from "../core/midroll-removal";

/** DOM adapters only. No account changes run during module initialization. */
export type StudioAction =
  | "hearts-add"
  | "hearts-remove"
  | "skip-monetization"
  | "midrolls";
export interface StudioInput {
  limit?: number;
  positions?: number[];
  /** Explicit frame rate for the modern H:MM:SS:FF toolbar, never inferred. */
  fps?: number;
}
export interface StudioMetricSource {selector:string;label:string;raw:string;}
export interface StudioPeriod {label:string;selector:string;start?:string;end?:string;}
export interface StudioMetrics {
 source:'studio-dom';observedAt:string;revenue?:number;currency?:string;currencyCode?:string;videoCount?:number;period?:StudioPeriod;
 sources:{revenue?:StudioMetricSource;currency?:StudioMetricSource;videoCount?:StudioMetricSource;period?:StudioMetricSource};warnings:string[];
}
export interface StudioPlan {
  readonly id: string;
  readonly action: StudioAction;
  readonly status: "ready" | "unsupported";
  readonly targetCount: number;
  readonly slotsToCreate?: number;
  readonly positions?: readonly string[];
  readonly targets: readonly {
    control: string;
    context: string;
    value?: string;
  }[];
  readonly description: string;
  readonly warnings: readonly string[];
  readonly expiresAt: string;
}
export interface StudioExecution {
  status: "completed" | "cancelled" | "stale" | "unsupported" | "error";
  submitted: number;
  total: number;
  created?: number;
  addClicks?: number;
  message: string;
}
interface Step {
  element: HTMLElement;
  signature: string;
  value?: string;
  comment?: CommentContext;
}
interface CommentContext {
  container: HTMLElement;
  thread: HTMLElement;
  fingerprint: string;
  preview: string;
}
interface MidrollContext {
  editor: HTMLElement;
  fingerprint: string;
  addButton?: HTMLElement;
  addSignature?: string;
  positions: readonly number[];
  initialFields: HTMLInputElement[];
}
interface ModernMidrollContext {
 panel:HTMLElement;toolbar:HTMLElement;timeControl:HTMLElement;field:HTMLInputElement;addButton:HTMLElement;
 fingerprint:string;addSignature:string;fieldSignature:string;positions:readonly number[];fps:number;
}
interface StoredPlan {
  publicPlan: StudioPlan;
  document: Document;
  url: string;
  expires: number;
  steps: Step[];
  guards: Step[];
  midroll?: MidrollContext;
  modernMidroll?:ModernMidrollContext;
  controller: AbortController;
  state: "pending" | "running";
}
const plans = new Map<string, StoredPlan>();
const maxActions = 50;
const ttl = 120_000;
const warnings = [
  "O layout do Studio pode mudar. Controles desconhecidos são recusados.",
  "Alterações já enviadas não são desfeitas ao cancelar.",
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
function label(element: Element): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.textContent ??
    ""
  ).trim();
}
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"]'))
    return false;
  for(let node:HTMLElement|null=element;node;node=node.parentElement){const style=element.ownerDocument.defaultView?.getComputedStyle(node);if(style?.display==='none'||style?.visibility==='hidden')return false;}
  return true;
}
function enabled(element: HTMLElement): boolean {
  return (
    visible(element) &&
    !element.hasAttribute("disabled") &&
    !element.matches(':disabled') &&
    !element.closest('[aria-disabled="true"]')
  );
}
function signature(element: HTMLElement): string {
  const value =
    element.tagName === "INPUT"
      ? `${(element as HTMLInputElement).value}|${(element as HTMLInputElement).checked}`
      : "";
  return [
    element.tagName,
    element.id,
    label(element),
    element.getAttribute("aria-pressed"),
    element.getAttribute("aria-checked"),
    value,
  ].join("|");
}
function studioDocument(doc: Document): boolean {
  return doc.location?.hostname === "studio.youtube.com";
}
function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
function heartState(element: HTMLElement): boolean | undefined {
  const text = normalize(label(element));
  if (
    /^(remove heart|unheart|remover coracao|retirar coracao|remove creator heart)/.test(
      text,
    )
  )
    return true;
  if (
    /^(heart|give heart|add heart|coracao|marcar com coracao|adicionar coracao)(\s|$)/.test(
      text,
    )
  ) {
    const pressed = element.getAttribute("aria-pressed");
    return pressed === "true";
  }
  return undefined;
}
function findHeartButtons(doc: Document): HTMLElement[] {
  const comments = Array.from(
    doc.querySelectorAll(
      "ytcp-comment-thread, ytcp-comment, ytcp-comment-thread-row",
    ),
  );
  const candidates = unique(
    comments.flatMap((comment) =>
      Array.from(
        comment.querySelectorAll<HTMLElement>(
          'button, ytcp-icon-button, [role="button"]',
        ),
      ),
    ),
  ).filter((button) => enabled(button) && heartState(button) !== undefined);
  // A custom button can wrap another labeled button. Never toggle the same reaction twice.
  return candidates.filter(
    (button) =>
      !candidates.some((other) => other !== button && button.contains(other)),
  );
}
function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
function commentContext(button: HTMLElement): CommentContext | undefined {
  const container = button.closest<HTMLElement>(
    "ytcp-comment, ytcp-comment-thread-row, ytcp-comment-thread",
  );
  if (!container || !visible(container)) return undefined;
  const thread =
    container.closest<HTMLElement>(
      "ytcp-comment-thread, ytcp-comment-thread-row",
    ) ?? container;
  const authorElement = container.querySelector<HTMLElement>(
    '[id="author-text"], [id="author-name"], .author-text, .author-name, [data-author]',
  );
  const textElement = container.querySelector<HTMLElement>(
    '[id="content-text"], [id="comment-text"], .comment-text, .content-text, ytcp-comment-text, [data-comment-text]',
  );
  const author = compactText(authorElement?.textContent);
  const authorUrl =
    authorElement?.getAttribute("href") ??
    authorElement?.querySelector("a")?.getAttribute("href") ??
    "";
  const text = compactText(textElement?.textContent);
  const identity = [container, thread].map((element) => [
    element.tagName,
    element.id,
    element.getAttribute("comment-id"),
    element.getAttribute("data-comment-id"),
    element.getAttribute("data-thread-id"),
  ]);
  const permalink =
    container.querySelector('a[href*="lc="]')?.getAttribute("href") ?? "";
  // An anonymous control-only row cannot identify the comment the user reviewed.
  if (!author || !text) return undefined;
  return {
    container,
    thread,
    fingerprint: JSON.stringify({
      identity,
      permalink,
      author,
      authorUrl,
      text,
    }),
    preview: `${author}: ${text}`,
  };
}
function stepIsCurrent(step: Step): boolean {
  if (!enabled(step.element) || signature(step.element) !== step.signature)
    return false;
  if (!step.comment) return true;
  const current = commentContext(step.element);
  return (
    current?.container === step.comment.container &&
    current.thread === step.comment.thread &&
    current.fingerprint === step.comment.fingerprint
  );
}

const editorSelector =
  "ytcp-ad-breaks-editor, ytcp-ad-break-editor, ytcp-video-ad-breaks-editor";
function modernParts(doc:Document):Omit<ModernMidrollContext,'fingerprint'|'addSignature'|'fieldSignature'|'positions'|'fps'>|undefined{
 const panels=Array.from(doc.querySelectorAll<HTMLElement>('ytve-ad-breaks-editor-options-panel')).filter(visible);
 const times=Array.from(doc.querySelectorAll<HTMLElement>('ytve-toolbar ytcp-media-timestamp-input')).filter(visible);
 const additions=Array.from(doc.querySelectorAll<HTMLElement>('#add-ad-break')).filter(enabled);
 if(panels.length!==1||times.length!==1||additions.length!==1)return undefined;
 const fields=Array.from(times[0].querySelectorAll<HTMLInputElement>('input')).filter(visible),toolbar=times[0].closest<HTMLElement>('ytve-toolbar');
 if(fields.length!==1||!toolbar||!writable(fields[0]))return undefined;
 const format=fields[0].value||fields[0].placeholder;
 if(!/^\d{1,3}:\d{2}:\d{2}:\d{2}$/.test(format)&&!/^h{1,3}:mm:ss:ff$/i.test(format))return undefined;
 return {panel:panels[0],toolbar,timeControl:times[0],field:fields[0],addButton:additions[0]};
}
function modernFingerprint(parts:ReturnType<typeof modernParts>,doc:Document):string{
 if(!parts)return '';
 const identity=(element:Element)=>[element.tagName,...['id','video-id','data-video-id','channel-id','data-channel-id','aria-label','data-fps','fps','frame-rate'].map(key=>element.getAttribute(key))];
 const scope=parts.panel.closest('[video-id],[data-video-id],[channel-id],[data-channel-id]')??doc.body;
 return JSON.stringify([identity(parts.panel),identity(parts.toolbar),identity(parts.timeControl),identity(scope),dateIdentity(parts.field),parts.field.placeholder,compactText(doc.querySelector('#entity-snapshot-title')?.textContent)]);
}
function validModernFps(parts:NonNullable<ReturnType<typeof modernParts>>,fps:unknown):fps is number{
 if(typeof fps!=='number'||![24,25,30,48,50,60].includes(fps))return false;
 const declared=[parts.panel,parts.timeControl].flatMap(element=>['data-fps','fps','frame-rate'].flatMap(key=>element.hasAttribute(key)?[Number(element.getAttribute(key))]:[]));
 return declared.every(value=>value===fps);
}
function frameTimestamp(seconds:number,fps:number):string{
 const frames=Math.round(seconds*fps),whole=Math.floor(frames/fps);return `${Math.floor(whole/3600)}:${String(Math.floor(whole/60)%60).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}:${String(frames%fps).padStart(2,'0')}`;
}
function frameSeconds(value:string,fps:number):number|undefined{
 const match=/^(\d{1,3}):(\d{2}):(\d{2}):(\d{2})$/.exec(value);if(!match)return undefined;const [,hours,minutes,seconds,frames]=match.map(Number);if(minutes>59||seconds>59||frames>=fps)return undefined;return hours*3600+minutes*60+seconds+frames/fps;
}
function modernIsCurrent(context:ModernMidrollContext,doc:Document,replaceField=false):boolean{
 const parts=modernParts(doc);return !!parts&&parts.panel===context.panel&&parts.toolbar===context.toolbar&&parts.timeControl===context.timeControl&&parts.addButton===context.addButton&&modernFingerprint(parts,doc)===context.fingerprint&&validModernFps(parts,context.fps)&&frameSeconds(parts.field.value,context.fps)!==undefined&&signature(parts.addButton)===context.addSignature&&(replaceField||parts.field===context.field&&signature(parts.field)===context.fieldSignature);
}
function midrollEditors(doc: Document): HTMLElement[] {
  const editors = Array.from(
    doc.querySelectorAll<HTMLElement>(editorSelector),
  ).filter(visible);
  return editors.filter(
    (editor) =>
      !editors.some((other) => other !== editor && other.contains(editor)),
  );
}
function midrollFields(editor: HTMLElement): HTMLInputElement[] {
  return Array.from(editor.querySelectorAll<HTMLInputElement>("input")).filter(
    (field) =>
      enabled(field) &&
      !field.readOnly &&
      ["text", "time"].includes(field.type) &&
      (field.type === "time" ||
        /time|horario|inicio|timestamp/.test(normalize(label(field))) ||
        /^\d{1,2}:\d{2}(?::\d{2})?$/.test(field.value || field.placeholder)),
  );
}
function addMidrollButtons(
  editor: HTMLElement,
  requireEnabled = true,
): HTMLElement[] {
  const candidates = Array.from(
    editor.querySelectorAll<HTMLElement>(
      'button, ytcp-button, [role="button"]',
    ),
  ).filter(
    (button) =>
      (requireEnabled ? enabled(button) : visible(button)) &&
      /^(insert ad slot|insert ad break|add ad slot|add ad break|inserir intervalo(?: de anuncios?)?|adicionar intervalo(?: de anuncios?)?|inserir anuncio)$/.test(
        normalize(label(button)),
      ),
  );
  return candidates.filter(
    (button) =>
      !candidates.some((other) => other !== button && button.contains(other)),
  );
}
function editorFingerprint(editor: HTMLElement): string {
  const scope =
    editor.closest(
      "ytcp-video-monetization, ytcp-video-monetization-editor, ytcp-uploads-dialog",
    ) ?? editor;
  const identity = (element: Element) => [
    element.tagName,
    element.id,
    element.getAttribute("video-id"),
    element.getAttribute("data-video-id"),
    element.getAttribute("channel-id"),
    element.getAttribute("data-channel-id"),
    element.getAttribute("aria-label"),
  ];
  const title = compactText(
    scope.querySelector("#video-title, #video-name, [data-video-title]")
      ?.textContent,
  );
  return JSON.stringify({
    editor: identity(editor),
    scope: identity(scope),
    title,
  });
}
function midrollContextIsCurrent(
  context: MidrollContext,
  doc: Document,
): boolean {
  const editors = midrollEditors(doc);
  return (
    editors.length === 1 &&
    editors[0] === context.editor &&
    editorFingerprint(context.editor) === context.fingerprint &&
    (!context.addButton ||
      (visible(context.addButton) &&
        context.editor.contains(context.addButton) &&
        signature(context.addButton) === context.addSignature &&
        addMidrollButtons(context.editor, false).length === 1))
  );
}
function timestamp(seconds: number): string {
  const rounded = Math.floor(seconds);
  return [
    Math.floor(rounded / 3600),
    Math.floor((rounded % 3600) / 60),
    rounded % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

const removalNodeIdentities = new WeakMap<Element, number>();
let removalNodeSequence = 0;
function removalNodeIdentity(element: Element): number {
  let value = removalNodeIdentities.get(element);
  if (value === undefined) { value = ++removalNodeSequence; removalNodeIdentities.set(element, value); }
  return value;
}

/** Read-only observation using the same legacy editor/input anchors as insertion.
 * The modern timestamp toolbar is a playhead and is never interpreted as a slot list.
 * No removal control or interruptive marker is documented, so neither is inferred.
 */
export function observeStudioMidrollSlots(doc: Document = document): MidrollRemovalObservation | undefined {
  if (!studioDocument(doc)) return undefined;
  const editors = midrollEditors(doc);
  if (editors.length !== 1 || Array.from(doc.querySelectorAll<HTMLElement>("ytve-ad-breaks-editor-options-panel")).some(visible)) return undefined;
  const editor = editors[0], fields = midrollFields(editor);
  if (!fields.length || fields.length > 500) return undefined;
  const routeVideo = /^\/video\/([^/]+)/.exec(doc.location.pathname)?.[1];
  const scope = editor.closest("[video-id],[data-video-id]");
  const declaredVideo = scope?.getAttribute("video-id") ?? scope?.getAttribute("data-video-id");
  if (!routeVideo || declaredVideo && declaredVideo !== routeVideo) return undefined;
  const slots = fields.map(field => {
    const seconds = parseDuration(field.value);
    return seconds !== undefined && seconds <= 604_800 ? { id: `observed-slot-${removalNodeIdentity(field)}`, seconds, displayedTime: field.value } : undefined;
  });
  if (slots.some(slot => !slot)) return undefined;
  return {
    source: "studio-dom",
    contextKey: JSON.stringify([doc.location.href, editorFingerprint(editor), removalNodeIdentity(editor), slots]),
    contextLabel: `vídeo ${routeVideo}`,
    observedAt: new Date().toISOString(),
    slots: slots as NonNullable<(typeof slots)[number]>[],
    limitations: ["Somente campos de horário visíveis reconhecidos no editor legado; a lista pode ser parcial.", "Leitura validada em fixtures locais; funcionamento em conta real não verificado.", "Nenhum seletor de remoção ou marcador interruptivo foi inferido."],
  };
}

function displayedMoney(value: string): number | undefined {
  if (/\d\s*(?:[kmb]|mil|milhao|milhão|million)\b/i.test(value))
    return parseCount(value);
  const raw = value.match(/-?\d[\d.,\s]*/)?.[0].replace(/\s/g, "");
  if (!raw) return undefined;
  const lastSeparator = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  const decimalLength = lastSeparator < 0 ? 0 : raw.length - lastSeparator - 1;
  const normalized =
    lastSeparator >= 0 && decimalLength > 0 && decimalLength <= 2
      ? raw.slice(0, lastSeparator).replace(/[.,]/g, "") +
        "." +
        raw.slice(lastSeparator + 1)
      : raw.replace(/[.,]/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
}

/** Only reads rendered cards; hidden reports/private Studio APIs are not queried. */
export function readStudioMetrics(doc: Document = document):StudioMetrics {
 const result:StudioMetrics={source:'studio-dom',observedAt:new Date().toISOString(),sources:{},warnings:[]};
 if(!studioDocument(doc)){result.warnings.push('Abra o YouTube Studio para ler métricas exibidas.');return result;}
 const revenueCandidates:{value:number;currency?:string;code?:string;source:StudioMetricSource}[]=[];
 const quantityCandidates:{value:number;source:StudioMetricSource}[]=[];
 let currencyConflict=false;
 const addRevenue=(element:HTMLElement,selector:string,metricLabel:string)=>{
  if(!visible(element))return;const raw=compactText(element.textContent),value=displayedMoney(raw);if(value===undefined)return;
  const symbols=raw.match(/R\$|US\$|€|£|\$/g)??[],currency=symbols[0];
  const symbolCodes:Record<string,string>={'R$':'BRL','US$':'USD','€':'EUR','£':'GBP'},codes=new Set<string>();
  for(const symbol of symbols)if(symbolCodes[symbol])codes.add(symbolCodes[symbol]);
  // Only the existing documented currency attributes on this value's ancestry
  // are evidence. Conflicting declarations must not be masked by precedence.
  for(let scope:HTMLElement|null=element;scope;scope=scope.parentElement){
   for(const attribute of ['data-currency','currency']){const declared=scope.getAttribute(attribute);if(declared&&/^[A-Z]{3}$/.test(declared))codes.add(declared);}
  }
  if(codes.size>1){currencyConflict=true;return;}
  const code=codes.values().next().value;
  revenueCandidates.push({value,currency,code,source:{selector,label:metricLabel,raw}});
 };
 for(const element of doc.querySelectorAll<HTMLElement>('#TOTAL_ESTIMATED_EARNINGS-tab #metric-total'))addRevenue(element,'#TOTAL_ESTIMATED_EARNINGS-tab #metric-total','Receita estimada exibida');
 for(const card of doc.querySelectorAll<HTMLElement>('yta-key-metric-card, yta-key-metric-block, [data-metric]')){
  if(!visible(card))continue;const metricLabel=compactText(card.getAttribute('data-metric')??card.querySelector('#title, #metric-title, .metric-title, [data-label]')?.textContent);
  const valueElement=card.querySelector<HTMLElement>('#metric-value, #metric-total, #value, .metric-value, [data-value]');if(!valueElement||!visible(valueElement))continue;
  if(/estimated revenue|receita estimada|^revenue$|^receita$/.test(normalize(metricLabel)))addRevenue(valueElement,`${card.tagName.toLowerCase()} #metric-value/#metric-total`,metricLabel);
  if(/^videos$|video count|quantidade de videos/.test(normalize(metricLabel))){const raw=compactText(valueElement.textContent),value=parseCount(raw);if(value!==undefined&&Number.isInteger(value)&&value>=0)quantityCandidates.push({value,source:{selector:`${card.tagName.toLowerCase()} #metric-value/#metric-total`,label:metricLabel,raw}});}
 }
 const revenueKeys=new Set(revenueCandidates.map(item=>JSON.stringify([item.value,item.currency??'',item.code??''])));
 if(currencyConflict)result.warnings.push('Há evidências de moeda conflitantes em uma receita visível. Receita e moeda permanecem desconhecidas, sem escolher outro card como substituto. Declare manualmente receita, moeda, origem e vínculo do período antes de calcular.');
 else if(revenueKeys.size===1){const candidate=revenueCandidates[0];result.revenue=candidate.value;result.currency=candidate.currency;result.currencyCode=candidate.code;result.sources.revenue=candidate.source;if(candidate.currency||candidate.code)result.sources.currency=candidate.source;if(candidate.currency==='$'&&!candidate.code)result.warnings.push('O símbolo $ não identifica sozinho a moeda; nenhum código ISO foi presumido.');}
 else if(revenueKeys.size>1)result.warnings.push('Mais de um valor de receita visível diverge. A receita permanece desconhecida; escolha o valor e o período manualmente.');
 const quantities=new Set(quantityCandidates.map(item=>item.value));if(quantities.size===1){result.videoCount=quantityCandidates[0].value;result.sources.videoCount=quantityCandidates[0].source;}else if(quantities.size>1)result.warnings.push('Há quantidades de vídeos divergentes na página; nenhuma foi escolhida automaticamente.');
 const periods=Array.from(doc.querySelectorAll<HTMLElement>('#date-range-label, yta-date-range-selector #label, yta-date-range-picker #label')).filter(visible).map(element=>({element,raw:compactText(element.textContent)})).filter(item=>item.raw);
 const periodLabels=new Set(periods.map(item=>item.raw));if(periodLabels.size===1){const first=periods[0],selector=first.element.id==='date-range-label'?'#date-range-label':`${first.element.parentElement?.tagName.toLowerCase()} #label`;result.period={label:first.raw,selector};result.sources.period={selector,label:'Período exibido no Studio',raw:first.raw};}else if(periodLabels.size>1)result.warnings.push('Mais de um período visível foi encontrado; nenhum foi associado à receita.');
 if(result.revenue===undefined)result.warnings.push('Receita não identificada em um card visível. Informe o valor manualmente na calculadora.');
 if(result.videoCount===undefined)result.warnings.push('Quantidade de vídeos não identificada em um card explícito. O valor 1 da calculadora é padrão do usuário, não uma contagem lida.');
 if(!result.period)result.warnings.push('Período das métricas não identificado em um rótulo visível. Campos de data em edição não comprovam o período aplicado.');
 result.warnings.push('Somente métricas atualmente renderizadas; nenhuma consulta privada ao Studio foi feita.');return result;
}

/** The returned plan is a short-lived preview, not an authorization to run on load. */
export function previewStudioAction(
  action: StudioAction,
  input: StudioInput = {},
  doc: Document = document,
): StudioPlan {
  const now = Date.now();
  for (const [id, stored] of plans)
    if (stored.state === "pending" && stored.expires <= now) plans.delete(id);
  const steps: Step[] = [];
  const guards: Step[] = [];
  let midroll: MidrollContext | undefined;
  let modernMidroll:ModernMidrollContext|undefined;
  const notes = [...warnings];
  let description = "";
  let unsupported = "";
  if (!studioDocument(doc))
    unsupported = "Esta ação exige uma página aberta em studio.youtube.com.";
  else if (action === "hearts-add" || action === "hearts-remove") {
    const desired = action === "hearts-add";
    const limit = Math.min(
      maxActions,
      Math.max(1, Math.floor(input.limit ?? 20)),
    );
    const targets = findHeartButtons(doc)
      .filter((button) => heartState(button) !== desired)
      .slice(0, limit);
    for (const element of targets) {
      const comment = commentContext(element);
      if (comment)
        steps.push({ element, signature: signature(element), comment });
    }
    description = `${desired ? "Dar" : "Remover"} coração em ${steps.length} comentários visíveis.`;
    notes.push(
      "Cada clique pode publicar a reação no canal. Apenas os comentários visíveis da prévia serão processados.",
    );
    if (steps.length !== targets.length)
      notes.push(
        "Comentários sem autor e texto reconhecidos foram excluídos da prévia.",
      );
    if (steps.length === 0)
      unsupported =
        "Nenhum comentário com autor, texto e botão de coração reconhecidos foi encontrado.";
  } else if (action === "skip-monetization") {
    const step = doc.querySelector<HTMLElement>(
      "ytcp-video-monetization, ytcp-video-monetization-editor, #monetization-step",
    );
    const nextButtons =
      step &&
      Array.from(
        doc.querySelectorAll<HTMLElement>(
          'ytcp-button, button, [role="button"]',
        ),
      ).filter(
        (button) =>
          enabled(button) &&
          /^(next|proximo|avancar)$/.test(normalize(label(button))),
      );
    const next = nextButtons?.length === 1 ? nextButtons[0] : undefined;
    const selected = step?.querySelector<HTMLElement>(
      '[aria-checked="true"], input[type="radio"]:checked',
    );
    if (!step || !visible(step) || !next || !selected)
      unsupported =
        "Abra a etapa Monetização, escolha a opção desejada e deixe o botão Próximo visível.";
    else {
      steps.push({ element: next, signature: signature(next) });
      guards.push({ element: selected, signature: signature(selected) });
      description =
        "Avançar uma etapa usando a escolha de monetização já selecionada.";
      notes.push(
        "Não seleciona monetização nem preenche declarações de adequação. Revise a opção selecionada antes de confirmar.",
      );
    }
  } else if (action === "midrolls") {
    const positions = input.positions ?? [];
    if (
      positions.length === 0 ||
      positions.length > maxActions ||
      positions.some(
        (value, index) =>
          !Number.isFinite(value) ||
          value < 1 ||
          (index > 0 && value <= positions[index - 1]),
      )
    ) {
      unsupported =
        "Informe de 1 a 50 posições positivas em segundos, distintas e em ordem crescente.";
    } else {
      // Frame-based controls must never fall through to the seconds-only adapter.
      const modernPresent=!!doc.querySelector('ytve-ad-breaks-editor-options-panel, ytve-toolbar ytcp-media-timestamp-input, #add-ad-break');
      const modern=modernParts(doc);
      if(modernPresent){
        if(!modern)unsupported='O editor moderno exige um painel, um timestamp H:MM:SS:FF editável e um único controle #add-ad-break visível.';
        else if(!validModernFps(modern,input.fps))unsupported='O timestamp usa frames. Informe explicitamente FPS 24, 25, 30, 48, 50 ou 60 e confira se corresponde ao editor; FPS ausente, fracionário ou divergente não é presumido.';
        else if(frameSeconds(modern.field.value,input.fps)===undefined)unsupported='O timestamp atual não é válido para o FPS declarado. Use H:MM:SS:FF com minutos e segundos de 00 a 59 e frames menores que FPS; nenhum campo ou clique foi enviado.';
        else if(positions.some(value=>Math.abs(value*input.fps!-Math.round(value*input.fps!))>1e-7))unsupported='Uma posição está fora da grade do FPS declarado. A prévia não arredonda posições manuais para outro frame.';
        else if(positions.some((value,index)=>index>0&&Math.round(value*input.fps!)<=Math.round(positions[index-1]*input.fps!)))unsupported='As posições devem ocupar frames distintos e em ordem crescente na grade do FPS declarado.';
        else{
          modernMidroll={...modern,fingerprint:modernFingerprint(modern,doc),addSignature:signature(modern.addButton),fieldSignature:signature(modern.field),positions:Object.freeze([...positions]),fps:input.fps};
          description=`Posicionar o cursor e solicitar ${positions.length} intervalos a ${input.fps} FPS: ${positions.map(value=>frameTimestamp(value,input.fps!)).join(', ')}.`;
          notes.push('Usa os controles visíveis de timestamp e Adicionar intervalo. Intervalos existentes não são deduplicados; revise a timeline antes de confirmar.','A execução conta cliques enviados, sem inventar confirmação da criação dos intervalos. Não clica em Continuar, Salvar ou questionários.');
        }
      }else{
      const editors = midrollEditors(doc);
      if(positions.some(value=>!Number.isInteger(value)))unsupported='O editor legado HH:MM:SS não aceita posições fracionárias. Escolha segundos inteiros explicitamente ou abra um editor com frames e FPS comprovado.';
      else if (editors.length !== 1)
        unsupported = `Abra um único editor de intervalos reconhecido. Foram encontrados ${editors.length} editores visíveis.`;
      else if(Array.from(editors[0].querySelectorAll<HTMLInputElement>('input')).some(field=>visible(field)&&/^\d{1,3}:\d{2}:\d{2}:\d{2}$/.test(field.value||field.placeholder)))unsupported='O editor contém timestamps com frames, mas não possui o conjunto de controles modernos reconhecido. Nenhum FPS foi presumido.';
      else {
        const editor = editors[0];
        const fields = midrollFields(editor);
        const missing = positions.length - fields.length;
        const addButtons = addMidrollButtons(editor);
        if (missing < 0)
          unsupported = `O editor contém ${fields.length} intervalos; a prévia possui ${positions.length} posições. Nenhum intervalo será apagado automaticamente.`;
        else if (missing > 0 && addButtons.length !== 1)
          unsupported = `São necessários ${missing} novos intervalos, mas não há um único botão Inserir intervalo reconhecido dentro do editor. Foram encontrados ${addButtons.length} controles elegíveis.`;
        else {
          midroll = {
            editor,
            fingerprint: editorFingerprint(editor),
            ...(missing > 0
              ? {
                  addButton: addButtons[0],
                  addSignature: signature(addButtons[0]),
                }
              : {}),
            positions: Object.freeze([...positions]),
            initialFields: fields,
          };
          steps.push(
            ...fields.map((element, index) => ({
              element,
              signature: signature(element),
              value: timestamp(positions[index]),
            })),
          );
          description = `Preencher ${positions.length} intervalos (${missing} a criar): ${positions.map(timestamp).join(", ")}.`;
          notes.push(
            "Cria somente rascunhos por controles reconhecidos e preenche os horários. Não clica em Continuar nem Salvar; revise o resultado no Studio. A entrega de anúncios não é garantida.",
          );
        }
      }
      }
    }
  } else unsupported = "Ação de Studio desconhecida.";
  if (unsupported) notes.unshift(unsupported);
  const publicPlan: StudioPlan = Object.freeze({
    id: globalThis.crypto.randomUUID(),
    action,
    status: unsupported ? "unsupported" : "ready",
    targetCount: unsupported ? 0 : (modernMidroll?.positions.length??midroll?.positions.length ?? steps.length),
    ...(modernMidroll?{slotsToCreate:modernMidroll.positions.length,positions:Object.freeze(modernMidroll.positions.map(value=>frameTimestamp(value,modernMidroll!.fps)))}:midroll
      ? {
          slotsToCreate:
            midroll.positions.length - midroll.initialFields.length,
          positions: Object.freeze(midroll.positions.map(timestamp)),
        }
      : {}),
    targets: Object.freeze(
      unsupported
        ? []
        : modernMidroll?modernMidroll.positions.map(position=>Object.freeze({control:'#add-ad-break + ytcp-media-timestamp-input',context:description,value:frameTimestamp(position,modernMidroll!.fps)})):midroll
          ? midroll.positions.map((position, index) =>
              Object.freeze({
                control:
                  index < midroll.initialFields.length
                    ? label(midroll.initialFields[index])
                    : `Criar: ${label(midroll.addButton!)}`,
                context: description,
                value: timestamp(position),
              }),
            )
          : steps.map((step) =>
              Object.freeze({
                control: label(step.element),
                context: (step.comment?.preview ?? description)
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 220),
                ...(step.value ? { value: step.value } : {}),
              }),
            ),
    ),
    description: description || unsupported,
    warnings: Object.freeze(notes),
    expiresAt: new Date(now + ttl).toISOString(),
  });
  if (!unsupported)
    plans.set(publicPlan.id, {
      publicPlan,
      document: doc,
      url: doc.location.href,
      expires: now + ttl,
      steps,
      guards,
      midroll,
      modernMidroll,
      controller: new AbortController(),
      state: "pending",
    });
  return publicPlan;
}

function wait(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

class StudioContextChanged extends Error {}

function setFieldValue(
  doc: Document,
  field: HTMLInputElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    doc.defaultView!.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Campo sem setter de valor reconhecido.");
  setter.call(field, value);
  field.dispatchEvent(new doc.defaultView!.Event("input", { bubbles: true }));
  field.dispatchEvent(new doc.defaultView!.Event("change", { bubbles: true }));
}

async function executeMidrolls(stored: StoredPlan): Promise<StudioExecution> {
  const context = stored.midroll!;
  const doc = stored.document;
  const signal = stored.controller.signal;
  const total = context.positions.length;
  let submitted = 0;
  let created = 0;
  let addClicks = 0;
  let expected = [...context.initialFields];
  const signatures = new Map(
    expected.map((field) => [field, signature(field)]),
  );
  const result = (
    status: StudioExecution["status"],
    message: string,
  ): StudioExecution => ({
    status,
    submitted,
    total,
    created,
    addClicks,
    message,
  });
  const checkContext = () => {
    if (signal.aborted) throw new Error("cancelled");
    if (
      doc.location.href !== stored.url ||
      !midrollContextIsCurrent(context, doc)
    )
      throw new StudioContextChanged(
        "O vídeo, editor ou botão de inserir mudou. A rotina foi interrompida.",
      );
  };
  const checkFields = (allowNew = false): HTMLInputElement[] => {
    checkContext();
    const current = midrollFields(context.editor);
    const oldInCurrentOrder = current.filter((field) =>
      expected.includes(field),
    );
    if (
      oldInCurrentOrder.length !== expected.length ||
      oldInCurrentOrder.some((field, index) => field !== expected[index]) ||
      expected.some((field) => signature(field) !== signatures.get(field)) ||
      current.length < expected.length ||
      current.length > expected.length + (allowNew ? 1 : 0)
    ) {
      throw new StudioContextChanged(
        "Os campos de intervalo mudaram ou surgiram controles inesperados. Confira os rascunhos antes de continuar manualmente.",
      );
    }
    return current;
  };
  try {
    for (let index = 0; index < total; index++) {
      checkFields();
      let field = context.initialFields[index];
      if (!field) {
        const add = context.addButton;
        if (!add || !enabled(add))
          throw new StudioContextChanged(
            "O botão Inserir intervalo não está disponível. Nenhum próximo clique será enviado.",
          );
        add.click();
        addClicks++;
        const deadline = Date.now() + 1000;
        while (true) {
          const current = checkFields(true);
          const added = current.filter((item) => !expected.includes(item));
          if (added.length === 1) {
            field = added[0];
            expected = current;
            signatures.set(field, signature(field));
            created++;
            break;
          }
          if (Date.now() >= deadline)
            throw new Error(
              "O clique Inserir foi enviado, mas um único campo novo não apareceu em até 1 segundo. O estado do rascunho é incerto; confira o Studio. Nenhum próximo clique foi enviado.",
            );
          await wait(Math.min(25, deadline - Date.now()), signal);
        }
      }
      checkFields();
      setFieldValue(doc, field, timestamp(context.positions[index]));
      submitted++;
      if (
        !field.isConnected ||
        parseDuration(field.value) !== Math.floor(context.positions[index])
      )
        throw new StudioContextChanged(
          "O campo não preservou o horário preenchido. A rotina foi interrompida; confira o rascunho.",
        );
      signatures.set(field, signature(field));
      checkFields();
      if (index + 1 < total) await wait(150, signal);
    }
    return result(
      "completed",
      "Intervalos criados/preenchidos em rascunho. Revise e use Continuar/Salvar manualmente no Studio; isto não confirma aceitação do servidor nem entrega de anúncios.",
    );
  } catch (error) {
    return result(
      signal.aborted
        ? "cancelled"
        : error instanceof StudioContextChanged
          ? "stale"
          : "error",
      signal.aborted
        ? "Execução cancelada. Um clique de inserção já enviado ainda pode criar um rascunho; confira o Studio. Nenhuma ação posterior foi enviada."
        : error instanceof Error
          ? error.message
          : "Falha ao preencher intervalos.",
    );
  }
}

/** Call only from the explicit confirm action after displaying the complete preview. */
async function executeModernMidrolls(stored:StoredPlan):Promise<StudioExecution>{
 const context=stored.modernMidroll!,doc=stored.document,signal=stored.controller.signal,total=context.positions.length;let submitted=0,addClicks=0;
 const check=(replaceField=false)=>{if(signal.aborted)throw new Error('cancelled');if(doc.location.href!==stored.url||!modernIsCurrent(context,doc,replaceField))throw new StudioContextChanged('O vídeo, o painel moderno, FPS ou os controles mudaram; nenhum próximo clique foi enviado.');};
 try{
  for(const position of context.positions){
   check();const value=frameTimestamp(position,context.fps),expected=frameSeconds(value,context.fps);if(expected===undefined)throw new Error('Posição fora do formato de timestamp reconhecido.');
   const setter=Object.getOwnPropertyDescriptor(doc.defaultView!.HTMLInputElement.prototype,'value')?.set;if(!setter)throw new Error('Setter nativo do timestamp indisponível.');
   setter.call(context.field,value);context.field.dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));check(true);
   let field=modernParts(doc)!.field;if(frameSeconds(field.value,context.fps)!==expected)throw new StudioContextChanged('O timestamp não preservou a posição; a rotina foi interrompida antes de adicionar o intervalo.');
   field.dispatchEvent(new doc.defaultView!.Event('change',{bubbles:true}));check(true);field=modernParts(doc)!.field;
   if(frameSeconds(field.value,context.fps)!==expected)throw new StudioContextChanged('O Studio alterou o timestamp durante a edição; confira o cursor antes de continuar.');
   context.field=field;context.fieldSignature=signature(field);check();context.addButton.click();addClicks++;submitted++;check();
   if(submitted<total)await wait(150,signal);
  }
  return {status:'completed',submitted,total,addClicks,message:'Posições preenchidas e cliques Adicionar enviados. A criação dos intervalos não foi confirmada por este adaptador. Revise a timeline e use Continuar/Salvar manualmente; nenhuma entrega de anúncios é garantida.'};
 }catch(error){return {status:signal.aborted?'cancelled':error instanceof StudioContextChanged?'stale':'error',submitted,total,addClicks,message:signal.aborted?'Execução cancelada. Um clique já enviado pode ter criado um rascunho; confira o Studio. Nenhum próximo clique foi enviado.':error instanceof Error?error.message:'Não foi possível operar o editor moderno.'};}
}

export async function executeStudioPlan(
  planId: string,
  signal?: AbortSignal,
): Promise<StudioExecution> {
  const stored = plans.get(planId);
  if (!stored)
    return {
      status: "unsupported",
      submitted: 0,
      total: 0,
      message:
        "Prévia ausente, cancelada ou já consumida. Gere uma nova prévia.",
    };
  if (stored.state === "running")
    return {
      status: "unsupported",
      submitted: 0,
      total: stored.modernMidroll?.positions.length??stored.midroll?.positions.length ?? stored.steps.length,
      message: "Esta prévia já está em execução.",
    };
  const { document: doc, steps, controller } = stored;
  const total = stored.modernMidroll?.positions.length??stored.midroll?.positions.length ?? steps.length;
  if (
    Date.now() > stored.expires ||
    doc.location.href !== stored.url ||
    [...steps, ...stored.guards].some((step) => !stepIsCurrent(step)) ||
    (stored.modernMidroll&&!modernIsCurrent(stored.modernMidroll,doc))||
    (stored.midroll &&
      (!midrollContextIsCurrent(stored.midroll, doc) ||
        midrollFields(stored.midroll.editor).length !==
          stored.midroll.initialFields.length ||
        midrollFields(stored.midroll.editor).some(
          (field, index) => field !== stored.midroll!.initialFields[index],
        )))
  ) {
    plans.delete(planId);
    return {
      status: "stale",
      submitted: 0,
      total,
      message:
        "A página ou os controles mudaram. Gere uma nova prévia antes de confirmar.",
    };
  }
  // Keep the record during execution so cancellation remains available.
  stored.state = "running";
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let submitted = 0;
  try {
    if(stored.modernMidroll)return await executeModernMidrolls(stored);
    if (stored.midroll) return await executeMidrolls(stored);
    for (const step of steps) {
      if (controller.signal.aborted)
        return {
          status: "cancelled",
          submitted,
          total: steps.length,
          message:
            "Execução cancelada. Comandos anteriores podem já ter sido aplicados pelo YouTube.",
        };
      if (
        doc.location.href !== stored.url ||
        !stepIsCurrent(step) ||
        stored.guards.some((guard) => !stepIsCurrent(guard))
      )
        return {
          status: "stale",
          submitted,
          total: steps.length,
          message:
            "Um controle mudou durante a execução. A rotina foi interrompida; confira o resultado no Studio.",
        };
      if (step.value !== undefined) {
        setFieldValue(doc, step.element as HTMLInputElement, step.value);
      } else step.element.click();
      submitted++;
      if (submitted < steps.length) await wait(150, controller.signal);
    }
    return {
      status: "completed",
      submitted,
      total: steps.length,
      message:
        stored.publicPlan.action === "midrolls"
          ? "Campos preenchidos. Revise e salve manualmente no Studio."
          : "Cliques enviados. Confira o estado final no Studio; o envio não confirma a aceitação do servidor.",
    };
  } catch (error) {
    return {
      status: controller.signal.aborted ? "cancelled" : "error",
      submitted,
      total: steps.length,
      message: controller.signal.aborted
        ? "Execução cancelada; confira alterações já enviadas."
        : error instanceof Error
          ? error.message
          : "Falha ao operar o controle do Studio.",
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    plans.delete(planId);
  }
}

export function cancelStudioPlan(planId: string): boolean {
  const stored = plans.get(planId);
  if (!stored) return false;
  stored.controller.abort();
  plans.delete(planId);
  return true;
}

export interface StudioPeriodResult {status:'ready'|'unsupported';message:string;filled?:number;source?:'studio-dom';}
const validStudioDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function dateIdentity(field:HTMLInputElement):string{return JSON.stringify(['id','name','type','aria-label','min','max','step'].map(name=>field.getAttribute(name)));}
function writable(field:HTMLInputElement):boolean{return enabled(field)&&!field.readOnly&&field.getAttribute('aria-readonly')!=='true'&&!field.closest('ytcp-media-timestamp-input[disabled],ytcp-media-timestamp-input[readonly]');}
function openDateDialog(doc:Document):{dialog:HTMLElement;fields:HTMLInputElement[]}|undefined{
 const dialogs=Array.from(doc.querySelectorAll<HTMLElement>('yta-date-range-dialog, yta-date-picker-dialog, yta-date-range-picker, [role="dialog"]')).filter(visible);
 const candidates=dialogs.map(dialog=>({dialog,fields:Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="date"]')).filter(visible)})).filter(item=>item.fields.length===2);
 const inner=candidates.filter(item=>!candidates.some(other=>other!==item&&item.dialog.contains(other.dialog)));
 return inner.length===1?inner[0]:undefined;
}
function periodContext(doc:Document,dialog:HTMLElement):string{
 const root=dialog.closest('[video-id],[data-video-id],[channel-id],[data-channel-id]')??dialog;
 return JSON.stringify({url:doc.location?.href,dialog:['id','role','aria-label','data-date-context','data-period','data-context-id'].map(key=>dialog.getAttribute(key)),root:[root.tagName,...['id','video-id','data-video-id','channel-id','data-channel-id'].map(key=>root.getAttribute(key))]});
}
function fillPeriod(start:string,end:string,doc:Document):{result:StudioPeriodResult;verify?:()=>boolean}{
 const bad=(message:string,filled=0)=>({result:{status:'unsupported' as const,message,filled,source:'studio-dom' as const}});
 if(!validStudioDate(start)||!validStudioDate(end)||start>end)return bad('Use datas válidas no formato AAAA-MM-DD, com início anterior ao fim.');
 if(!studioDocument(doc))return bad('Abra o YouTube Studio.');
 const initial=openDateDialog(doc);if(!initial||initial.fields.some(field=>!writable(field)))return bad('Abra um único seletor de período personalizado com dois campos nativos de data editáveis. Campos somente leitura, desativados ou desconhecidos não são alterados.');
 const context=periodContext(doc,initial.dialog),identities=initial.fields.map(dateIdentity),originalValues=initial.fields.map(field=>field.value);let filled=0;
 const current=()=>{const next=openDateDialog(doc);if(!next||next.dialog!==initial.dialog||periodContext(doc,next.dialog)!==context||next.fields.some((field,index)=>!writable(field)||dateIdentity(field)!==identities[index]))throw new Error('O diálogo, a identidade do canal/vídeo ou os controles de data mudaram.');return next.fields;};
 const setter=Object.getOwnPropertyDescriptor(doc.defaultView!.HTMLInputElement.prototype,'value')?.set;
 if(!setter)return bad('O setter nativo dos campos de data não está disponível.');
 try{
  for(let index=0;index<2;index++){
   let fields=current();if(fields[index].value!==originalValues[index])throw new Error('O contexto dos valores de data mudou antes do preenchimento.');
   const value=index===0?start:end;setter.call(fields[index],value);filled++;
   fields[index].dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));
   fields=current();if(fields[index].value!==value)throw new Error('O campo não preservou a data após o evento input.');
   fields[index].dispatchEvent(new doc.defaultView!.Event('change',{bubbles:true}));
   fields=current();if(fields[index].value!==value||index===1&&fields[0].value!==start)throw new Error('O período foi alterado pela página durante o preenchimento.');
  }
  const verify=()=>{try{const fields=current();return fields[0].value===start&&fields[1].value===end;}catch{return false;}};
  return {result:{status:'ready',message:'Período preenchido. Revise e clique em Aplicar manualmente no Studio.',filled,source:'studio-dom'},verify};
 }catch(error){return bad(`${error instanceof Error?error.message:'O preenchimento foi interrompido.'} ${filled?'Pode haver preenchimento parcial; confira as duas datas no Studio.':'Nenhum campo foi preenchido.'} Nenhum botão Aplicar foi acionado.`,filled);}
}
/** Synchronous compatibility helper, checked after every dispatched native event. */
export function setStudioPeriod(start:string,end:string,doc:Document=document):StudioPeriodResult{return fillPeriod(start,end,doc).result;}
/** Production path: also catches deferred DOM replacement/reset before reporting readiness. */
export async function setStudioPeriodVerified(start:string,end:string,doc:Document=document):Promise<StudioPeriodResult>{
 const operation=fillPeriod(start,end,doc);if(operation.result.status!=='ready')return operation.result;
 await new Promise<void>(resolve=>setTimeout(resolve,40));
 if(!operation.verify?.())return {status:'unsupported',source:'studio-dom',filled:operation.result.filled,message:'O Studio refez ou alterou o período após o preenchimento. O estado pode ser parcial; confira as datas e aplique manualmente. Nenhum botão Aplicar foi acionado.'};
 return operation.result;
}

export function getStudioScreenshotTargets(kind:'analytics'|'latest-performance',doc:Document=document):HTMLElement[]{
 if(!studioDocument(doc))return [];
 const selectors=kind==='latest-performance'?['.main #video-snapshot','ytcp-video-performance-card,ytcp-latest-video-card,ytcd-video-snapshot']:['#top-section','ytcp-analytics-section,ytcp-channel-analytics,#analytics-content'];
 for(const selector of selectors){const candidates=unique(Array.from(doc.querySelectorAll<HTMLElement>(selector))).filter(visible);if(candidates.length===1)return candidates;if(candidates.length>1)return [];}
 return [];
}
export function getStudioScreenshotTarget(kind:'analytics'|'latest-performance',doc:Document=document):HTMLElement|undefined{return getStudioScreenshotTargets(kind,doc)[0];}

export type StudioRedactionCategory='channel'|'revenue'|'subscribers'|'views'|'video-info';
export interface StudioRedactionDetails {elements:HTMLElement[];coarse:boolean;coarseSelectors:string[];categories:StudioRedactionCategory[];}
export function getStudioRedactionDetails(doc:Document=document,categories:readonly StudioRedactionCategory[]=['channel','revenue','subscribers','views','video-info']):StudioRedactionDetails{
 const selected=new Set(categories),elements:HTMLElement[]=[],coarseSelectors:string[]=[];
 const add=(selector:string,coarse=false)=>{const found=Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(visible);elements.push(...found);if(coarse&&found.length)coarseSelectors.push(selector);};
 if(!studioDocument(doc))return {elements:[],coarse:false,coarseSelectors:[],categories:[]};
 if(selected.has('channel')){add('#channel-name, #channel-avatar, ytcp-avatar');if(!elements.length)add('#right-side-bar',true);}
 if(selected.has('video-info'))add('#entity-snapshot-title');
 if(selected.has('revenue'))add('#TOTAL_ESTIMATED_EARNINGS-tab #metric-total');
 const allMetrics=['revenue','subscribers','views'].every(category=>selected.has(category as StudioRedactionCategory));
 for(const card of doc.querySelectorAll<HTMLElement>('yta-key-metric-card, yta-key-metric-block, [data-metric]')){
  if(!visible(card))continue;const metric=normalize(card.getAttribute('data-metric')??card.querySelector('#title,#metric-title,.metric-title,[data-label]')?.textContent??'');
  if(selected.has('revenue')&&/revenue|receita/.test(metric)||selected.has('subscribers')&&/subscribers|inscritos/.test(metric)||selected.has('views')&&/views|visualiz/.test(metric))elements.push(card);
  else if(allMetrics&&!metric){elements.push(card);coarseSelectors.push('card de métricas sem rótulo reconhecido');}
 }
 if(allMetrics)add('#key-metric-header',true);
 if(selected.size===5)add('[data-prevlev-sensitive]',true);
 return {elements:unique(elements),coarse:coarseSelectors.length>0,coarseSelectors:unique(coarseSelectors),categories:[...selected]};
}
export function getStudioRedactionTargets(doc:Document=document,categories?:readonly StudioRedactionCategory[]):HTMLElement[]{return getStudioRedactionDetails(doc,categories).elements;}
