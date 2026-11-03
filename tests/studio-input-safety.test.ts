// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {cancelStudioPlan,executeStudioPlan,previewStudioAction,readStudioMetrics} from '../src/content/studio';
import {initProfitTools} from '../src/ui/profit';
import type {PageSnapshot} from '../src/shared/types';
const open: JSDOM[]=[];
function fixture(html:string){const dom=new JSDOM(html,{url:'https://studio.youtube.com/video/abcdefghijk/analytics'});open.push(dom);return dom.window.document;}
function editor(value='0:00:00:00',fps=30){return fixture(`<main data-video-id="abcdefghijk"><ytve-ad-breaks-editor-options-panel data-fps="${fps}"></ytve-ad-breaks-editor-options-panel><ytve-toolbar><ytcp-media-timestamp-input fps="${fps}"><input aria-label="Timestamp" placeholder="H:MM:SS:FF" value="${value}"></ytcp-media-timestamp-input></ytve-toolbar><button id="add-ad-break">Add ad break</button><button id="save">Save</button><button id="continue">Continue</button></main>`);}
const money=(raw:string,attributes:string)=>`<div id="TOTAL_ESTIMATED_EARNINGS-tab" ${attributes}><span id="metric-total">${raw}</span></div>`;
afterEach(()=>{for(const dom of open.splice(0))dom.window.close();document.body.replaceChildren();vi.restoreAllMocks();});
describe('D03 current native frame timestamp validation',()=>{
 it.each([
  ['0:00:00:30',30],['0:00:00:60',60],['0:00:00:24',24],['0:60:00:00',30],['0:00:60:00',30],['100:59:59:30',30],['',30],
 ]as const)('refuses native value %s at %i FPS before any input, Add or final action',async(value,fps)=>{
  const doc=editor(value,fps),change=vi.fn(),click=vi.fn();doc.querySelector('input')!.addEventListener('input',change);doc.querySelector('input')!.addEventListener('change',change);for(const button of doc.querySelectorAll('button'))button.addEventListener('click',click);
  const plan=previewStudioAction('midrolls',{positions:[180],fps},doc);
  expect(plan.status).toBe('unsupported');expect(plan.warnings.join(' ')).toContain('timestamp atual');expect((await executeStudioPlan(plan.id)).status).toBe('unsupported');expect(change).not.toHaveBeenCalled();expect(click).not.toHaveBeenCalled();expect(doc.querySelector<HTMLInputElement>('input')!.value).toBe(value);
 });
 it('preserves valid three-digit hours and fractional target frames without Save or Continue',async()=>{
  const doc=editor('100:59:59:29'),sent:string[]=[],final=vi.fn();doc.querySelector('#add-ad-break')!.addEventListener('click',()=>sent.push(doc.querySelector<HTMLInputElement>('input')!.value));doc.querySelector('#save')!.addEventListener('click',final);doc.querySelector('#continue')!.addEventListener('click',final);
  const plan=previewStudioAction('midrolls',{positions:[360000.5,360001+1/30],fps:30},doc);expect(plan).toMatchObject({status:'ready',positions:['100:00:00:15','100:00:01:01']});expect(await executeStudioPlan(plan.id)).toMatchObject({status:'completed',submitted:2});expect(sent).toEqual(['100:00:00:15','100:00:01:01']);expect(final).not.toHaveBeenCalled();
 });
 it('refuses a native timestamp that becomes invalid between preview and execution',async()=>{
  const doc=editor(),input=doc.querySelector<HTMLInputElement>('input')!,change=vi.fn(),add=vi.fn();const plan=previewStudioAction('midrolls',{positions:[180.5],fps:30},doc);input.value='0:00:00:30';input.addEventListener('input',change);doc.querySelector('#add-ad-break')!.addEventListener('click',add);expect(await executeStudioPlan(plan.id)).toMatchObject({status:'stale',submitted:0});expect(change).not.toHaveBeenCalled();expect(add).not.toHaveBeenCalled();
 });
 it.each([['0:00:00:23',24],['0:00:00:24',25],['0:00:00:29',30],['0:00:00:47',48],['0:00:00:49',50],['999:59:59:59',60]]as const)('accepts the highest native frame for %s at %i FPS', (value,fps)=>{
  const plan=previewStudioAction('midrolls',{positions:[180],fps},editor(value,fps));expect(plan.status).toBe('ready');cancelStudioPlan(plan.id);
 });
});
describe('D05 conflicting rendered currency evidence',()=>{
 it.each([
  ['R$ 1.234,56','data-currency="USD"'],['US$ 1,234.56','currency="BRL"'],['€ 1.234,56','data-currency="GBP"'],['£ 1,234.56','currency="EUR"'],['1.234,56','data-currency="BRL" currency="USD"'],['R$ 1.234,56 / US$ 200.00',''],
 ])('refuses %s with contradictory declarations %s instead of relabeling revenue', (raw,attributes)=>{
  const data=readStudioMetrics(fixture(money(raw,attributes)));expect(data.revenue).toBeUndefined();expect(data.currency).toBeUndefined();expect(data.currencyCode).toBeUndefined();expect(data.sources.revenue).toBeUndefined();expect(data.sources.currency).toBeUndefined();expect(data.warnings.join(' ')).toContain('moeda conflitantes');expect(data.warnings.join(' ')).toContain('Declare manualmente');
 });
 it('does not replace a conflicting documented anchor with another generic revenue card',()=>{
  const data=readStudioMetrics(fixture(money('R$ 1.234,56','data-currency="USD"')+'<yta-key-metric-card data-metric="revenue" data-currency="BRL"><b id="metric-value">R$ 1.234,56</b></yta-key-metric-card><span id="date-range-label">Últimos 28 dias</span>'));expect(data.revenue).toBeUndefined();expect(data.currencyCode).toBeUndefined();expect(data.period?.label).toBe('Últimos 28 dias');expect(data.warnings.join(' ')).toContain('sem escolher outro card');
 });
 it('checks conflicting currency attributes on the documented value ancestry',()=>{
  const data=readStudioMetrics(fixture('<main currency="USD">'+money('R$ 1.234,56','data-currency="BRL"')+'</main>'));expect(data.revenue).toBeUndefined();expect(data.warnings.join(' ')).toContain('conflitantes');
 });
 it.each([
  ['R$ 1.234,56','data-currency="BRL" currency="BRL"','BRL','R$'],['US$ 1,234.56','data-currency="USD"','USD','US$'],['€ 1.234,56','currency="EUR"','EUR','€'],['£ 1,234.56','','GBP','£'],['$1,234.56','data-currency="CAD"','CAD','$'],
 ])('retains compatible evidence for %s and %s', (raw,attributes,currencyCode,currency)=>{
  const data=readStudioMetrics(fixture(money(raw,attributes)));expect(data).toMatchObject({revenue:1234.56,currencyCode,currency});expect(data.warnings.join(' ')).not.toContain('conflitantes');
 });
 it('ignores hidden conflicting cards and keeps an ambiguous dollar symbol unknown without a code',()=>{
  const data=readStudioMetrics(fixture('<div hidden>'+money('R$1,234.56','data-currency="USD"')+'</div><yta-key-metric-card data-metric="revenue"><b id="metric-value">$12.00</b></yta-key-metric-card>'));expect(data).toMatchObject({revenue:12,currency:'$'});expect(data.currencyCode).toBeUndefined();expect(data.warnings.join(' ')).not.toContain('conflitantes');
 });
 it('leaves calculator values empty until a manual revenue/currency/period declaration is confirmed',()=>{
  const studio=readStudioMetrics(fixture(money('R$1.234,56','data-currency="USD"'))),snapshot:PageSnapshot={url:'https://studio.youtube.com/video/abcdefghijk/analytics',title:'Fixture',videoId:'abcdefghijk',videos:[],comments:[],transcript:[],warnings:[],studio};
  document.body.innerHTML='<input id="revenue" type="number"><input id="cost" type="number" value="100"><input id="video-total" type="number" value="1"><button id="profit">Calcular</button><output id="profit-output"></output>';initProfitTools({snapshot:()=>snapshot});
  expect((document.getElementById('revenue')as HTMLInputElement).value).toBe('');expect((document.getElementById('profit-currency')as HTMLInputElement).value).toBe('');document.getElementById('profit')!.click();expect(document.getElementById('profit-output')!.textContent).toBe('');expect(document.getElementById('profit-status')!.textContent).not.toContain('Custos totais');
 });
});
