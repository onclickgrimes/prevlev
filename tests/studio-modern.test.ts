// @vitest-environment jsdom
import {describe,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {readStudioMetrics,setStudioPeriod,setStudioPeriodVerified,getStudioScreenshotTargets,getStudioRedactionDetails,previewStudioAction,executeStudioPlan,cancelStudioPlan} from '../src/content/studio';
const fixture=(html:string)=>new JSDOM(html,{url:'https://studio.youtube.com/video/dQw4w9WgXcQ/analytics'}).window.document;
const dates=()=>fixture('<div role="dialog" id="period" data-date-context="channel"><input id="from" aria-label="Start date" type="date"><input id="to" aria-label="End date" type="date"><button id="apply">Apply</button></div>');
function modern(){return fixture('<main data-video-id="dQw4w9WgXcQ"><ytve-ad-breaks-editor-options-panel data-fps="30"></ytve-ad-breaks-editor-options-panel><ytve-toolbar><ytcp-media-timestamp-input fps="30"><input aria-label="Timestamp" value="0:00:00:00"></ytcp-media-timestamp-input></ytve-toolbar><button id="add-ad-break">Add ad break</button><button id="continue">Continue</button><button id="save">Save</button></main>');}

describe('rendered Studio metadata and proven screenshot anchors',()=>{
 it('reads actual estimated earnings anchor with currency, period and explicit quantity sources',()=>{
  const doc=fixture('<div id="TOTAL_ESTIMATED_EARNINGS-tab" data-currency="BRL"><span id="metric-total">R$ 1.234,56</span></div><span id="date-range-label">Últimos 28 dias</span><yta-key-metric-card data-metric="Quantidade de vídeos"><b id="metric-value">12</b></yta-key-metric-card>');
  expect(readStudioMetrics(doc)).toMatchObject({source:'studio-dom',revenue:1234.56,currency:'R$',currencyCode:'BRL',videoCount:12,period:{label:'Últimos 28 dias'},sources:{revenue:{selector:'#TOTAL_ESTIMATED_EARNINGS-tab #metric-total',raw:'R$ 1.234,56'},videoCount:{raw:'12'},period:{raw:'Últimos 28 dias'}}});
 });
 it('does not invent currency, count, applied period or choose conflicting visible revenue',()=>{
  const doc=fixture('<div id="TOTAL_ESTIMATED_EARNINGS-tab"><span id="metric-total">$12.00</span></div><div role="dialog"><input type="date" value="2026-01-01"><input type="date" value="2026-02-01"></div>');
  const metrics=readStudioMetrics(doc);expect(metrics.revenue).toBe(12);expect(metrics.currencyCode).toBeUndefined();expect(metrics.videoCount).toBeUndefined();expect(metrics.period).toBeUndefined();expect(metrics.warnings.join(' ')).toContain('padrão do usuário');
  doc.body.insertAdjacentHTML('beforeend','<yta-key-metric-card data-metric="revenue"><b id="metric-value">$999</b></yta-key-metric-card>');expect(readStudioMetrics(doc).revenue).toBeUndefined();
 });
 it('ignores metrics hidden through an ancestor and resolves actual snapshot/top-section anchors',()=>{
  const doc=fixture('<div style="display:none"><div id="TOTAL_ESTIMATED_EARNINGS-tab"><b id="metric-total">$999</b></div></div><div class="main"><article id="video-snapshot"><b id="entity-snapshot-title">Private title</b></article></div><section id="top-section"><div id="key-metric-header"><yta-key-metric-card data-metric="views"><b id="metric-value">100</b></yta-key-metric-card></div></section><aside id="right-side-bar">Channel</aside>');
  expect(readStudioMetrics(doc).revenue).toBeUndefined();expect(getStudioScreenshotTargets('latest-performance',doc).map(item=>item.id)).toEqual(['video-snapshot']);expect(getStudioScreenshotTargets('analytics',doc).map(item=>item.id)).toEqual(['top-section']);
  const narrow=getStudioRedactionDetails(doc,['views']);expect(narrow.coarse).toBe(false);expect(narrow.elements).toHaveLength(1);const broad=getStudioRedactionDetails(doc);expect(broad.coarse).toBe(true);expect(broad.coarseSelectors).toContain('#key-metric-header');expect(broad.elements.map(item=>item.id)).toContain('entity-snapshot-title');
 });
});

describe('native period edits fail closed on readonly or stale DOM',()=>{
 it('uses the native setter and never clicks Apply',()=>{
  const doc=dates(),first=doc.querySelector<HTMLInputElement>('#from')!,apply=vi.fn();doc.querySelector('#apply')!.addEventListener('click',apply);
  const native=Object.getOwnPropertyDescriptor(doc.defaultView!.HTMLInputElement.prototype,'value')!;Object.defineProperty(first,'value',{get:()=>native.get!.call(first),set:()=>{throw new Error('instance setter must not run');}});
  expect(setStudioPeriod('2026-01-01','2026-02-01',doc)).toMatchObject({status:'ready',filled:2});expect(first.value).toBe('2026-01-01');expect(apply).not.toHaveBeenCalled();
 });
 it('refuses readonly, disabled, aria-readonly or disabled-fieldset fields before writing',()=>{
  for(const mode of ['readonly','disabled','aria-readonly','fieldset']){
   const doc=dates(),second=doc.querySelector<HTMLInputElement>('#to')!;if(mode==='fieldset'){const fieldset=doc.createElement('fieldset');fieldset.disabled=true;second.replaceWith(fieldset);fieldset.append(second);}else second.setAttribute(mode,mode==='aria-readonly'?'true':'');
   expect(setStudioPeriod('2026-01-01','2026-02-01',doc).status).toBe('unsupported');expect(doc.querySelector<HTMLInputElement>('#from')!.value).toBe('');
  }
 });
 it('re-resolves the second field after first-field rerender',()=>{
  const doc=dates(),old=doc.querySelector<HTMLInputElement>('#to')!,oldChange=vi.fn();old.addEventListener('change',oldChange);
  doc.querySelector('#from')!.addEventListener('input',()=>old.replaceWith(old.cloneNode(true)));
  expect(setStudioPeriod('2026-01-01','2026-02-01',doc).status).toBe('ready');expect(doc.querySelector<HTMLInputElement>('#to')!.value).toBe('2026-02-01');expect(old.value).toBe('');expect(oldChange).not.toHaveBeenCalled();
 });
 it('stops before second write on identity/date-context change and catches deferred reset',async()=>{
  const doc=dates();doc.querySelector('#from')!.addEventListener('input',()=>{doc.querySelector<HTMLElement>('#period')!.dataset.dateContext='another-channel';});expect(setStudioPeriod('2026-01-01','2026-02-01',doc)).toMatchObject({status:'unsupported',filled:1});expect(doc.querySelector<HTMLInputElement>('#to')!.value).toBe('');
  const deferred=dates();deferred.querySelector('#from')!.addEventListener('input',()=>queueMicrotask(()=>{deferred.querySelector<HTMLInputElement>('#to')!.value='';}));expect(await setStudioPeriodVerified('2026-01-01','2026-02-01',deferred)).toMatchObject({status:'unsupported',message:expect.stringContaining('refez')});
 });
});

describe('modern toolbar midroll actions with explicit FPS',()=>{
 it('preserves distinct frames within the same second and refuses off-grid fractions',()=>{
  const doc=modern(),click=vi.fn();doc.querySelector('#add-ad-break')!.addEventListener('click',click);
  const ready=previewStudioAction('midrolls',{positions:[250.5,250+16/30],fps:30},doc);expect(ready).toMatchObject({status:'ready',positions:['0:04:10:15','0:04:10:16']});cancelStudioPlan(ready.id);
  const invalid=previewStudioAction('midrolls',{positions:[250.51],fps:30},doc);expect(invalid.status).toBe('unsupported');expect(invalid.warnings.join(' ')).toContain('grade');expect(click).not.toHaveBeenCalled();
  expect(previewStudioAction('midrolls',{positions:[250.5,250.500000000001],fps:30},doc).status).toBe('unsupported');
 });
 it('requires a declared compatible FPS and previews without any click',()=>{
  const doc=modern(),click=vi.fn();doc.querySelector('#add-ad-break')!.addEventListener('click',click);
  for(const fps of [undefined,29.97,25])expect(previewStudioAction('midrolls',{positions:[180],fps},doc).status).toBe('unsupported');
  const plan=previewStudioAction('midrolls',{positions:[180.5,360],fps:30},doc);expect(plan).toMatchObject({status:'ready',targetCount:2,positions:['0:03:00:15','0:06:00:00']});expect(click).not.toHaveBeenCalled();cancelStudioPlan(plan.id);
 });
 it('fills frame timestamps and counts only sent Add clicks, with Save/Continue remaining manual',async()=>{
  const doc=modern(),sent:string[]=[],finalSave=vi.fn();doc.querySelector('#add-ad-break')!.addEventListener('click',()=>sent.push(doc.querySelector<HTMLInputElement>('input')!.value));doc.querySelector('#save')!.addEventListener('click',finalSave);doc.querySelector('#continue')!.addEventListener('click',finalSave);
  const plan=previewStudioAction('midrolls',{positions:[180.5,360],fps:30},doc),result=await executeStudioPlan(plan.id);expect(result).toMatchObject({status:'completed',submitted:2,addClicks:2});expect(result.created).toBeUndefined();expect(sent).toEqual(['0:03:00:15','0:06:00:00']);expect(finalSave).not.toHaveBeenCalled();expect((await executeStudioPlan(plan.id)).status).toBe('unsupported');
 });
 it('rejects stale controls/FPS/video identity and cancels after the first sent click',async()=>{
  for(const mutation of ['fps','identity','value','readonly']){const doc=modern(),click=vi.fn();doc.querySelector('#add-ad-break')!.addEventListener('click',click);const plan=previewStudioAction('midrolls',{positions:[180],fps:30},doc);if(mutation==='fps')doc.querySelector('ytcp-media-timestamp-input')!.setAttribute('fps','60');if(mutation==='identity')doc.querySelector<HTMLElement>('main')!.dataset.videoId='another';if(mutation==='value')doc.querySelector<HTMLInputElement>('input')!.value='0:01:00:00';if(mutation==='readonly')doc.querySelector<HTMLInputElement>('input')!.readOnly=true;expect((await executeStudioPlan(plan.id)).status).toBe('stale');expect(click).not.toHaveBeenCalled();}
  const doc=modern(),controller=new AbortController();doc.querySelector('#add-ad-break')!.addEventListener('click',()=>controller.abort());const plan=previewStudioAction('midrolls',{positions:[180,360],fps:30},doc);expect(await executeStudioPlan(plan.id,controller.signal)).toMatchObject({status:'cancelled',submitted:1,addClicks:1});
 });
});
