// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://studio.youtube.com/channel/fixture/analytics"}
import {expect,it,vi} from 'vitest';
import {initCaptureOptions,validateCaptureCategories} from '../src/ui/capture-options';

it('selects categories explicitly, disables controls with the switch and validates input',()=>{
  document.body.innerHTML='<label><input id="redact" type="checkbox" checked>Ocultar</label>';
  const get=initCaptureOptions();
  expect(get()).toEqual(['channel','revenue','subscribers','views','video-info']);
  const fieldset=document.querySelector<HTMLFieldSetElement>('#capture-redaction-categories')!;
  fieldset.querySelector<HTMLInputElement>('[value="channel"]')!.checked=false;
  expect(get()).toEqual(['revenue','subscribers','views','video-info']);
  const toggle=document.querySelector<HTMLInputElement>('#redact')!;toggle.checked=false;toggle.dispatchEvent(new Event('change'));
  expect(fieldset.disabled).toBe(true);
  for (const invalid of [[],['views','views'],['unknown'],'views',null]) expect(()=>validateCaptureCategories(invalid)).toThrow();
  expect(validateCaptureCategories(['views'])).toEqual(['views']);
});

it('binds category selection and sensitive geometry into the stamp and rejects missing or off-card categories',async()=>{
  document.body.innerHTML='<div id="top-section"><div data-metric="views">Views</div><div data-metric="revenue">Revenue</div></div><div id="channel-name">Outside</div>';
  const rect=(x:number,y:number,width:number,height:number)=>({x,y,width,height,top:y,left:x,right:x+width,bottom:y+height,toJSON:()=>({})});
  const card=document.querySelector<HTMLElement>('#top-section')!,views=document.querySelector<HTMLElement>('[data-metric="views"]')!,revenue=document.querySelector<HTMLElement>('[data-metric="revenue"]')!,channel=document.querySelector<HTMLElement>('#channel-name')!;
  card.getBoundingClientRect=()=>rect(20,20,300,200);views.getBoundingClientRect=()=>rect(30,30,80,30);revenue.getBoundingClientRect=()=>rect(30,80,80,30);channel.getBoundingClientRect=()=>rect(500,30,80,30);
  type Listener=(message:Record<string,unknown>,sender:chrome.runtime.MessageSender,reply:(value:unknown)=>void)=>boolean|undefined;let listener:Listener|undefined;
  vi.stubGlobal('chrome',{runtime:{id:'capture-fixture',onMessage:{addListener:(fn:Listener)=>{listener=fn;}},sendMessage:vi.fn()},storage:{local:{get:vi.fn(async()=>({settings:{hideShorts:false,showMetrics:false,backendUrl:'',backendToken:''}})),set:vi.fn()},onChanged:{addListener:vi.fn()}}});
  await import('../src/content/index');await vi.waitFor(()=>expect(document.querySelector('#prevlev-controls')).not.toBeNull());
  const request=(categories:unknown)=>new Promise<Record<string,unknown>>(resolve=>listener?.({type:'CAPTURE_CARD',kind:'analytics',redact:true,redactionCategories:categories},{id:'capture-fixture'},result=>resolve(result as Record<string,unknown>)));
  const result=await request(['views']);expect(result).toMatchObject({status:'ok',redactions:[{x:30,y:30,width:80,height:30}]});
  expect(await request(['views','channel'])).toMatchObject({status:'error',error:expect.stringContaining('channel')});
  channel.remove();const sidebar=document.createElement('div');sidebar.id='right-side-bar';card.append(sidebar);sidebar.getBoundingClientRect=()=>rect(40,120,80,30);
  expect(await request(['channel'])).toMatchObject({status:'error',error:expect.stringContaining('channel')});
  expect(await request(['views','unknown'])).toMatchObject({status:'error'});
  expect((await request(['revenue'])).captureStamp).not.toBe(result.captureStamp);
  views.getBoundingClientRect=()=>rect(55,30,80,30);expect((await request(['views'])).captureStamp).not.toBe(result.captureStamp);
  expect(listener?.({type:'CAPTURE_CARD'},{id:'other'},()=>{})).toBe(false);
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
});

it('forwards identical validated categories to both measurements and rejects unknown categories before capture',async()=>{
  type Listener=(message:unknown,sender:chrome.runtime.MessageSender,reply:(value:unknown)=>void)=>boolean|undefined;let listener:Listener|undefined;
  const tab={id:2,windowId:1,url:'https://studio.youtube.com/channel/fixture/analytics'},measure=vi.fn(async (..._args:[number,unknown])=>({status:'ok',captureStamp:'stable',rect:{x:1,y:1,width:20,height:20},viewportWidth:100,redactions:[]})),capture=vi.fn(async()=>'data:image/png;base64,fixture');
  vi.stubGlobal('chrome',{runtime:{id:'capture-fixture',getURL:(path:string)=>`chrome-extension://capture-fixture/${path}`,onMessage:{addListener:(fn:Listener)=>{listener=fn;}}},tabs:{get:vi.fn(async()=>tab),query:vi.fn(async()=>[tab]),update:vi.fn(async()=>tab),sendMessage:measure,captureVisibleTab:capture}});
  await import('../src/background');
  const sender={id:'capture-fixture',url:'chrome-extension://capture-fixture/workspace.html'};
  const send=(categories:unknown)=>new Promise<Record<string,unknown>>(resolve=>listener?.({type:'CAPTURE_SCREENSHOT',tabId:2,kind:'analytics',redact:true,redactionCategories:categories},sender,result=>resolve(result as Record<string,unknown>)));
  expect(await send(['views','revenue'])).toMatchObject({status:'ok'});
  expect(measure).toHaveBeenCalledTimes(2);expect(measure.mock.calls.map(call=>call[1])).toEqual([{type:'CAPTURE_CARD',kind:'analytics',redact:true,redactionCategories:['views','revenue']},{type:'CAPTURE_CARD',kind:'analytics',redact:true,redactionCategories:['views','revenue']}]);
  expect(await send(['invalid'])).toMatchObject({status:'error'});expect(capture).toHaveBeenCalledTimes(1);
});
