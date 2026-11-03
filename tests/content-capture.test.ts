// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://studio.youtube.com/channel/fixture/analytics"}
import {expect,it,vi} from 'vitest';

it('recusa ocultação sem alvos, usa a âncora real do Studio e invalida mudanças durante a captura',async()=>{
  document.body.innerHTML='<div id="top-section"></div><button id="outside">Fora do card</button>';
  const rect=(x:number,y:number,width:number,height:number)=>({x,y,width,height,top:y,left:x,right:x+width,bottom:y+height,toJSON:()=>({})}),analytics=document.getElementById('top-section')!;
  analytics.getBoundingClientRect=()=>rect(20,20,300,200);
  type Listener=(message:Record<string,unknown>,sender:chrome.runtime.MessageSender,reply:(value:unknown)=>void)=>boolean|undefined;let listener:Listener|undefined;
  vi.stubGlobal('chrome',{runtime:{id:'capture-fixture',onMessage:{addListener:(fn:Listener)=>{listener=fn;}},sendMessage:vi.fn()},storage:{local:{get:vi.fn(async()=>({settings:{hideShorts:false,showMetrics:false,backendUrl:'',backendToken:''}})),set:vi.fn()},onChanged:{addListener:vi.fn()}}});
  await import('../src/content/index');await vi.waitFor(()=>expect(document.querySelector('#prevlev-controls')).not.toBeNull());
  const request=()=>new Promise<Record<string,unknown>>(resolve=>listener?.({type:'CAPTURE_CARD',kind:'analytics',redact:true},{id:'capture-fixture'},result=>resolve(result as Record<string,unknown>)));
  expect(await request()).toMatchObject({status:'error',error:expect.stringContaining('Nenhum campo sensível')});
  const sensitive=document.createElement('span');sensitive.dataset.prevlevSensitive='';analytics.append(sensitive);sensitive.getBoundingClientRect=()=>rect(30,40,80,30);
  expect(await request()).toMatchObject({status:'ok',redactions:[{x:30,y:40,width:80,height:30}],coarse:true,coarseSelectors:['[data-prevlev-sensitive]']});
  const stamp=async()=>(await request()).captureStamp;const stable=await stamp();expect(await stamp()).toBe(stable);
  const width=innerWidth;Object.defineProperty(window,'innerWidth',{configurable:true,value:width+1});expect(await stamp()).not.toBe(stable);Object.defineProperty(window,'innerWidth',{configurable:true,value:width});
  const beforeScroll=await stamp();Object.defineProperty(window,'scrollY',{configurable:true,value:25});expect(await stamp()).not.toBe(beforeScroll);Object.defineProperty(window,'scrollY',{configurable:true,value:0});
  const beforeMove=await stamp();sensitive.getBoundingClientRect=()=>rect(50,40,80,30);expect(await stamp()).not.toBe(beforeMove);
  const outside=document.getElementById('outside')!,beforeText=await stamp();outside.firstChild!.nodeValue='Outra identidade de texto';expect(await stamp()).not.toBe(beforeText);
  const beforeAttribute=await stamp();outside.setAttribute('aria-label','Novo atributo');expect(await stamp()).not.toBe(beforeAttribute);
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
});
