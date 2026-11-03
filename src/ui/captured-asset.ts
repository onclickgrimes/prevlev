import type { SaveSwipeAssetMetadata } from "./swipe-assets";

export interface CapturedAssetOffer {
  blob: Blob;
  metadata: SaveSwipeAssetMetadata;
  /** Host guard for the validated capture's tab, video, crop and masking context. */
  isCurrent: () => boolean;
}
export interface CapturedAssetPanel {
  offer(value: CapturedAssetOffer): void;
  invalidate(): void;
  dispose(): void;
}

/** Offers already validated pixels. This panel never fetches, decodes, compresses or saves on mount/offer. */
export function mountCapturedAsset(host: HTMLElement, deps: {
  saveAsset: (blob: Blob, metadata: SaveSwipeAssetMetadata, guard: () => boolean) => Promise<string>;
}): CapturedAssetPanel {
  const doc = host.ownerDocument, panel = doc.createElement("div"); panel.className = "card captured-asset"; panel.hidden = true;
  panel.innerHTML = `<h3>Última captura validada</h3>
    <p>A captura permanece em memória até sua ação. Salvar usa os bytes recebidos, sem carregar prévia ou comprimir automaticamente. A biblioteca aceita até 3 MiB por imagem, dentro do orçamento total de 4 MiB; limites podem impedir o salvamento.</p>
    <dl class="captured-asset-provenance"></dl>
    <label>Título para a biblioteca <input class="captured-asset-title" maxlength="1000" autocomplete="off"></label>
    <div class="actions"><button type="button" class="captured-asset-save" disabled>Salvar última captura na biblioteca</button><button type="button" class="captured-asset-discard">Descartar</button></div>
    <p class="captured-asset-status" role="status" aria-live="polite"></p>`;
  host.append(panel);
  const title = panel.querySelector<HTMLInputElement>(".captured-asset-title")!, save = panel.querySelector<HTMLButtonElement>(".captured-asset-save")!, discard = panel.querySelector<HTMLButtonElement>(".captured-asset-discard")!;
  const provenance = panel.querySelector<HTMLDListElement>("dl")!, status = panel.querySelector<HTMLElement>("[role=status]")!;
  let active: CapturedAssetOffer | undefined, revision = 0, pending: { revision: number; offer: CapturedAssetOffer } | undefined, alive = true;
  function sourceCurrent(value: CapturedAssetOffer): boolean { try { return value.isCurrent() === true; } catch { return false; } }
  function message(value: string, error = false) { status.textContent = value; status.classList.toggle("error", error); }
  function controls() { save.disabled = !active || !!pending; title.disabled = !active; }
  function clearOffer() { revision++; active = undefined; pending = undefined; title.value = ""; provenance.replaceChildren(); controls(); }
  function invalidate() {
    if (!alive) return;
    clearOffer(); panel.hidden = true; message("");
  }
  function expired() {
    clearOffer(); panel.hidden = false; message("A origem da captura mudou ou não está mais disponível. Faça uma nova captura antes de salvar.", true);
  }
  function offer(value: CapturedAssetOffer) {
    if (!alive) return;
    clearOffer();
    const captured: CapturedAssetOffer = { blob: value.blob, metadata: { ...value.metadata, provenance: { ...value.metadata.provenance } }, isCurrent: value.isCurrent };
    if (!sourceCurrent(captured)) { expired(); return; }
    active = captured; title.value = captured.metadata.title;
    const row = (label: string, value: string) => { const term = doc.createElement("dt"), description = doc.createElement("dd"); term.textContent = label; description.textContent = value; provenance.append(term, description); };
    row("URL da captura declarada", captured.metadata.provenance.sourceUrl);
    row("URL da referência", captured.metadata.url);
    row("Tipo de ativo informado", captured.metadata.provenance.kind);
    row("Origem informada", captured.metadata.source ?? "Não informada");
    row("Tipo e tamanho dos bytes recebidos", `${captured.blob.type || "MIME não informado"} · ${captured.blob.size} bytes`);
    if (captured.metadata.provenance.videoId) row("ID de vídeo informado", captured.metadata.provenance.videoId);
    if (captured.metadata.provenance.createdAt) row("Data da captura informada", captured.metadata.provenance.createdAt);
    panel.hidden = false; controls(); message("Captura disponível somente em memória. Revise o título e escolha Salvar para enviar à biblioteca local.");
  }
  const edit = () => {
    if (!alive || !active) return;
    revision++; pending = undefined;
    if (!sourceCurrent(active)) { expired(); return; }
    controls(); message("Título alterado. O salvamento pendente anterior perdeu validade; clique em Salvar para usar este título.");
  };
  const discardOffer = () => {
    if (!alive) return;
    clearOffer(); panel.hidden = true; message("");
  };
  const saveOffer = () => {
    const captured = active;
    if (!alive || !captured || pending) return;
    if (!sourceCurrent(captured)) { expired(); return; }
    const rawTitle = title.value, savedTitle = rawTitle.trim();
    if (!savedTitle || rawTitle.length > 1000) { message("Informe um título de 1 a 1000 caracteres antes de salvar.", true); return; }
    const attempt = { revision: ++revision, offer: captured }; pending = attempt;
    const owns = () => alive && pending === attempt && active === captured && revision === attempt.revision;
    const guard = () => owns() && title.value === rawTitle && sourceCurrent(captured);
    const changedDuringSave = () => {
      if (!sourceCurrent(captured)) { expired(); return; }
      revision++; pending = undefined; controls(); message("Título alterado. O salvamento anterior perdeu validade; revise e salve novamente.");
    };
    const metadata: SaveSwipeAssetMetadata = { ...captured.metadata, title: savedTitle, provenance: { ...captured.metadata.provenance } };
    controls(); message("Validando e salvando a captura na biblioteca local…");
    void (async () => {
      try {
        if (!guard()) { if (owns()) changedDuringSave(); return; }
        await deps.saveAsset(captured.blob, metadata, guard);
        if (!owns()) return;
        if (!guard()) { changedDuringSave(); return; }
        // Consume the offered bytes only after a current save is confirmed.
        active = undefined; pending = undefined; revision++; controls();
        message("Captura salva na biblioteca local com os bytes e a procedência informados.");
      } catch (error) {
        if (!owns()) return;
        if (!guard()) { changedDuringSave(); return; }
        message(error instanceof DOMException && error.name === "AbortError" ? "O salvamento não foi confirmado. Revise a captura antes de tentar novamente." : error instanceof Error ? error.message : "Não foi possível salvar a captura na biblioteca local.", true);
      } finally {
        if (owns()) { pending = undefined; controls(); }
      }
    })();
  };
  for (const event of ["input", "change"]) title.addEventListener(event, edit);
  save.addEventListener("click", saveOffer); discard.addEventListener("click", discardOffer);
  controls();
  return { offer, invalidate, dispose() {
    if (!alive) return;
    clearOffer(); alive = false;
    for (const event of ["input", "change"]) title.removeEventListener(event, edit);
    save.removeEventListener("click", saveOffer); discard.removeEventListener("click", discardOffer); panel.remove();
  } };
}
