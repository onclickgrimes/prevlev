/** A declared accounting period. Observed relative labels are bound to one collection. */
export type ProfitPeriod =
  | { kind: "dates"; start: string; end: string }
  | { kind: "observed"; label: string; observation: string };

export interface ProfitSource {
  kind: "manual" | "studio-dom";
  description: string;
  observation?: string;
}

export interface ProfitInput {
  revenue: number;
  currency: string;
  costPerVideo: number;
  costCurrency: string;
  videoCount: number;
  period: ProfitPeriod;
  countPeriod: ProfitPeriod;
  source: ProfitSource;
  revenuePeriodConfirmed: boolean;
  countConfirmed: boolean;
  collection: string;
}

export interface BoundProfit {
  readonly revenue: number;
  readonly totalCost: number;
  readonly profit: number;
  readonly currency: string;
  readonly period: string;
  readonly source: string;
  readonly binding: string;
}

function bounded(value: string, field: string): string {
  const result = value.trim();
  if (!result || result.length > 2000) throw new Error(`${field} deve ser informado e ter até 2000 caracteres.`);
  return result;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function profitPeriodKey(period: ProfitPeriod): string {
  if (period.kind === "dates") {
    if (!validDate(period.start) || !validDate(period.end) || period.start > period.end) throw new Error("Informe início e fim válidos para o mesmo período contábil.");
    return JSON.stringify(["dates", period.start, period.end]);
  }
  return JSON.stringify(["observed", bounded(period.label, "Período observado"), bounded(period.observation, "Identidade da observação")]);
}

function currency(value: string): string {
  const label = bounded(value, "Moeda").toUpperCase();
  if (label === "$") throw new Error("O símbolo $ é ambíguo. Informe a moeda, por exemplo USD, CAD ou BRL.");
  if (label.length > 40) throw new Error("A identificação da moeda deve ter até 40 caracteres.");
  return label;
}

/** No exchange conversion, calendar inference or channel-wide count fallback. */
export function calculateBoundProfit(input: ProfitInput): BoundProfit {
  const period = profitPeriodKey(input.period);
  if (period !== profitPeriodKey(input.countPeriod)) throw new Error("A quantidade e a receita devem pertencer ao mesmo período.");
  if (!input.revenuePeriodConfirmed) throw new Error("Confirme que a receita pertence ao período declarado; a página exibir um período não comprova esse vínculo.");
  if (!input.countConfirmed) throw new Error("Confirme a quantidade manual de vídeos do mesmo período e a moeda dos custos.");
  const normalizedCurrency = currency(input.currency);
  if (normalizedCurrency !== currency(input.costCurrency)) throw new Error("Receita e custos devem estar na mesma moeda; não há conversão automática.");
  if (!Number.isFinite(input.revenue) || input.revenue < 0 || !Number.isFinite(input.costPerVideo) || input.costPerVideo < 0) throw new Error("Informe receita e custo finitos, maiores ou iguais a zero.");
  if (!Number.isSafeInteger(input.videoCount) || input.videoCount < 0) throw new Error("Informe uma quantidade inteira de vídeos, maior ou igual a zero.");
  const source = bounded(input.source.description, "Origem da receita");
  const collection = bounded(input.collection, "Identidade da coleta");
  if (input.source.kind === "studio-dom") bounded(input.source.observation ?? "", "Identidade da receita observada");
  const totalCost = input.costPerVideo * input.videoCount;
  const profit = input.revenue - totalCost;
  if (!Number.isFinite(totalCost) || !Number.isFinite(profit)) throw new Error("Os valores excedem o limite numérico da calculadora.");
  const binding = JSON.stringify([input.revenue, normalizedCurrency, input.costPerVideo, input.videoCount, period, input.source.kind, source, input.source.observation ?? "", collection]);
  return Object.freeze({ revenue: input.revenue, totalCost, profit, currency: normalizedCurrency, period, source, binding });
}

/** A previous result cannot survive changed inputs or a new collection. */
export function isProfitResultCurrent(result: BoundProfit, input: ProfitInput): boolean {
  try { return calculateBoundProfit(input).binding === result.binding; } catch { return false; }
}
