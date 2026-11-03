import type { StudioRedactionCategory } from '../content/studio';

export const CAPTURE_REDACTION_CATEGORIES: readonly StudioRedactionCategory[] = [
  'channel', 'revenue', 'subscribers', 'views', 'video-info',
];

export function validateCaptureCategories(value: unknown): StudioRedactionCategory[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > CAPTURE_REDACTION_CATEGORIES.length ||
      value.some(item => typeof item !== 'string' || !CAPTURE_REDACTION_CATEGORIES.includes(item as StudioRedactionCategory)) ||
      new Set(value).size !== value.length) {
    throw new Error('Selecione categorias de ocultação válidas, sem repetições.');
  }
  return value as StudioRedactionCategory[];
}

/** Add category controls beside the existing redaction switch. */
export function initCaptureOptions(): () => StudioRedactionCategory[] {
  const toggle = document.querySelector<HTMLInputElement>('#redact');
  if (!toggle) throw new Error('Controle de ocultação não encontrado.');
  let fieldset = document.querySelector<HTMLFieldSetElement>('#capture-redaction-categories');
  if (!fieldset) {
    fieldset = document.createElement('fieldset');
    fieldset.id = 'capture-redaction-categories';
    const legend = document.createElement('legend');
    legend.textContent = 'Campos a ocultar no card capturado';
    fieldset.append(legend);
    const labels: Record<StudioRedactionCategory, string> = {
      channel: 'Canal', revenue: 'Receita', subscribers: 'Inscritos', views: 'Visualizações', 'video-info': 'Informações do vídeo',
    };
    for (const category of CAPTURE_REDACTION_CATEGORIES) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = category; checkbox.checked = true;
      label.append(checkbox, document.createTextNode(` ${labels[category]} `));
      fieldset.append(label);
    }
    const note = document.createElement('p');
    note.textContent = 'A ocultação cobre campos reconhecidos dentro do card; pode usar áreas maiores quando necessário. Revise a imagem antes de compartilhar: isso não garante anonimização completa.';
    fieldset.append(note);
    (toggle.closest('label') ?? toggle).insertAdjacentElement('afterend', fieldset);
  }
  const controls = fieldset;
  const sync = () => { controls.disabled = !toggle.checked; };
  toggle.addEventListener('change', sync);
  sync();
  return () => Array.from(controls.querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.value as StudioRedactionCategory);
}
