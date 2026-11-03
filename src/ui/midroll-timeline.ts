import { midrollPositionGrid, type MidrollPositionPrecision } from '../core/midroll';

export interface LocalMidrollTimelinePlan {
  durationSeconds: number;
  positions: readonly number[];
  precision: MidrollPositionPrecision;
  fps?: number;
  playheadSeconds?: number;
}

/** An independent visual cursor. It never searches for or clicks native Studio/player geometry. */
export function mountMidrollTimeline(doc: Document, host: HTMLElement) {
  const panel = doc.createElement('section'); panel.id = 'midroll-local-timeline';
  panel.innerHTML = `<h4>Timeline da prévia local</h4>
    <p>Marcadores e cursor pertencem a esta prévia. Navegar aqui não busca, reproduz nem controla o Studio ou um player real.</p>
    <div id="midroll-timeline-track" role="group" aria-label="Marcadores planejados da prévia local" style="position:relative;height:80px;background:#8993a333;border:1px solid currentColor;margin:16px 8px"></div>
    <label>Cursor da prévia local <input id="midroll-timeline-cursor" type="range" min="0" value="0"></label>
    <label>Ir para (segundos da prévia) <input id="midroll-timeline-position" type="number" min="0" step="1" value="0"></label>
    <button type="button" id="midroll-timeline-seek">Mover cursor local</button>
    <button type="button" id="midroll-timeline-previous">Marcador anterior</button>
    <button type="button" id="midroll-timeline-next">Próximo marcador</button>
    <p id="midroll-timeline-selected" role="status"></p>`;
  host.append(panel);
  const track = panel.querySelector<HTMLElement>('#midroll-timeline-track')!;
  const slider = panel.querySelector<HTMLInputElement>('#midroll-timeline-cursor')!;
  const position = panel.querySelector<HTMLInputElement>('#midroll-timeline-position')!;
  const status = panel.querySelector<HTMLElement>('#midroll-timeline-selected')!;
  const previous = panel.querySelector<HTMLButtonElement>('#midroll-timeline-previous')!;
  const next = panel.querySelector<HTMLButtonElement>('#midroll-timeline-next')!;
  let plan: LocalMidrollTimelinePlan | undefined, cursor = 0, selected: number | undefined;
  const label = (seconds: number) => Number(seconds.toFixed(6)).toString();
  const showCursor = () => {
    if (!plan) return;
    slider.value = String(cursor); position.value = String(cursor);
    const line = track.querySelector<HTMLElement>('[data-local-cursor]')!;
    line.style.left = `${cursor / plan.durationSeconds * 100}%`;
    for (const marker of track.querySelectorAll<HTMLButtonElement>('[data-position]')) marker.setAttribute('aria-pressed', String(Number(marker.dataset.position) === selected));
    const index = selected === undefined ? -1 : plan.positions.indexOf(selected);
    const precision = plan.precision === 'frames' ? `${plan.fps} FPS declarados` : 'segundos inteiros';
    status.textContent = `Cursor local: ${label(cursor)} s de ${label(plan.durationSeconds)} s; ${precision}. ${index >= 0 ? `Marcador ${index + 1}/${plan.positions.length} selecionado: ${label(selected!)} s.` : `${plan.positions.length} marcadores planejados; nenhum selecionado.`}`;
    previous.disabled = !plan.positions.some(value => value < cursor);
    next.disabled = !plan.positions.some(value => value > cursor);
  };
  const seek = (value: number, marker?: number) => {
    if (!plan) return;
    const grid = midrollPositionGrid(plan.precision, plan.fps);
    if (!Number.isFinite(value) || value < 0 || value > plan.durationSeconds || Math.abs(value * grid.ticksPerSecond - Math.round(value * grid.ticksPerSecond)) > 1e-7) {
      status.textContent = 'Cursor fora da duração ou da grade de precisão declarada; a prévia manteve a posição anterior.'; return;
    }
    cursor = Number((Math.round(value * grid.ticksPerSecond) / grid.ticksPerSecond).toFixed(12)); selected = marker; showCursor();
  };
  panel.querySelector<HTMLButtonElement>('#midroll-timeline-seek')!.addEventListener('click', () => seek(position.value.trim() ? Number(position.value) : Number.NaN));
  slider.addEventListener('input', () => { if (plan) { const grid = midrollPositionGrid(plan.precision, plan.fps); seek(Math.round(Number(slider.value) * grid.ticksPerSecond) / grid.ticksPerSecond); } });
  previous.addEventListener('click', () => { const value = plan?.positions.filter(value => value < cursor).at(-1); if (value !== undefined) seek(value, value); });
  next.addEventListener('click', () => { const value = plan?.positions.find(value => value > cursor); if (value !== undefined) seek(value, value); });
  return {
    render(input: LocalMidrollTimelinePlan) {
      const grid = midrollPositionGrid(input.precision, input.fps);
      if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 480 || input.durationSeconds > 7200 || input.positions.length > 50 || input.positions.some((value, index) => !Number.isFinite(value) || value < 1 || value > input.durationSeconds - 1 || Math.abs(value * grid.ticksPerSecond - Math.round(value * grid.ticksPerSecond)) > 1e-7 || index > 0 && value <= input.positions[index - 1]) || input.playheadSeconds !== undefined && (!Number.isFinite(input.playheadSeconds) || input.playheadSeconds < 0 || input.playheadSeconds > input.durationSeconds || Math.abs(input.playheadSeconds * grid.ticksPerSecond - Math.round(input.playheadSeconds * grid.ticksPerSecond)) > 1e-7)) throw new Error('Plano inválido para a timeline local.');
      const old = plan; plan = { ...input, positions: [...input.positions] };
      if (input.playheadSeconds !== undefined) { if (cursor !== input.playheadSeconds) selected = undefined; cursor = input.playheadSeconds; }
      else if (!old || old.precision !== input.precision || old.fps !== input.fps || cursor > input.durationSeconds) cursor = 0;
      if (!plan.positions.includes(selected!)) selected = undefined;
      slider.max = String(Math.floor(input.durationSeconds * grid.ticksPerSecond) / grid.ticksPerSecond); slider.step = String(1 / grid.ticksPerSecond);
      position.max = String(input.durationSeconds); position.step = slider.step;
      for (const control of panel.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = false;
      const line = doc.createElement('span'); line.dataset.localCursor = 'true'; line.style.cssText = 'position:absolute;top:0;bottom:0;border-left:2px solid #e64a76;pointer-events:none';
      track.replaceChildren(line);
      input.positions.forEach((value, index) => {
        const marker = doc.createElement('button'); marker.type = 'button'; marker.dataset.position = String(value);
        marker.textContent = String(index + 1); marker.title = `${label(value)} segundos da prévia local`;
        marker.setAttribute('aria-label', `Selecionar marcador ${index + 1}: ${label(value)} segundos da prévia local`);
        marker.style.cssText = `position:absolute;left:${value / input.durationSeconds * 100}%;top:${index % 2 ? 42 : 8}px;transform:translateX(-50%);min-width:24px;padding:2px`;
        marker.addEventListener('click', () => seek(value, value)); track.append(marker);
      });
      if (!Number.isFinite(cursor) || cursor < 0 || cursor > input.durationSeconds || Math.abs(cursor * grid.ticksPerSecond - Math.round(cursor * grid.ticksPerSecond)) > 1e-7) cursor = 0;
      showCursor();
    },
    clear(message = 'Informe parâmetros válidos para visualizar o plano local.') {
      plan = undefined; selected = undefined; track.replaceChildren();
      for (const control of panel.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = true;
      status.textContent = message;
    },
    getPosition: () => plan ? cursor : undefined,
  };
}
