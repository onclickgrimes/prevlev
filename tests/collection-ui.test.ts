// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {initCollectionTools} from '../src/ui/collection';
import type {PageSnapshot} from '../src/shared/types';
const old:PageSnapshot={url:'https://www.youtube.com/results?search_query=x',title:'x',videos:[],comments:[{id:'old',author:'old',text:'keep'}],transcript:[],warnings:[]};
const snapshot:PageSnapshot={...old,videos:[{id:'abcdefghijk',title:'collected',url:'https://www.youtube.com/watch?v=abcdefghijk'}],comments:[]};
const running={jobId:'fixture-job',kind:'videos',phase:'running',collectedCount:1,steps:0,maxItems:100,maxSteps:10,url:old.url,limitations:[]};
let send:ReturnType<typeof vi.fn<(m:{type:string})=>Promise<unknown>>>,adopt:ReturnType<typeof vi.fn<(s:PageSnapshot)=>Promise<void>>>,notice:ReturnType<typeof vi.fn<(message:string,error?:boolean)=>void>>;
const click=(id:string)=>document.getElementById(id)!.click();
const button=(id:string)=>document.getElementById(id) as HTMLButtonElement;
function deferred<T>() { let resolve!:(value:T)=>void,reject!:(error:Error)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
function changeTab(value='2') { const select=document.getElementById('tab-select') as HTMLSelectElement; select.value=value;select.dispatchEvent(new Event('change')); }
const flush=()=>vi.advanceTimersByTimeAsync(0);
beforeEach(()=>{vi.useFakeTimers();document.body.innerHTML='<section id="research"></section><select id="tab-select"><option>1</option><option>2</option></select>';send=vi.fn().mockImplementation(async(m: {type:string})=>m.type==='START_COLLECTION'?{status:'ok',collection:running}:m.type==='CANCEL_COLLECTION'?{status:'ok',collection:{...running,phase:'cancelled'}}:{status:'ok',collection:{...running,phase:'completed'},snapshot});adopt=vi.fn().mockResolvedValue(undefined);notice=vi.fn();vi.stubGlobal('chrome',{tabs:{sendMessage:async(_id:number,m:unknown)=>send(m as {type:string})}});initCollectionTools({targetTab:()=>1,snapshot:()=>old,adopt,notice});});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.unstubAllGlobals();});
describe('workspace collection integration',()=>{
 it('keeps progress separate from storage, then merges only an explicitly accepted same-context result',async()=>{expect(send).not.toHaveBeenCalled();click('collection-start');await vi.advanceTimersByTimeAsync(500);expect(adopt).not.toHaveBeenCalled();expect((document.getElementById('collection-use') as HTMLButtonElement).disabled).toBe(false);click('collection-use');await vi.advanceTimersByTimeAsync(0);expect(adopt.mock.calls[0][0]).toMatchObject({videos:snapshot.videos,comments:old.comments});});
 it('retrieves a partial result after cancellation and never repeats start',async()=>{click('collection-start');await vi.advanceTimersByTimeAsync(0);click('collection-cancel');await vi.advanceTimersByTimeAsync(0);expect(send.mock.calls.map(x=>x[0].type)).toEqual(['START_COLLECTION','CANCEL_COLLECTION','COLLECTION_STATUS']);expect((document.getElementById('collection-use') as HTMLButtonElement).disabled).toBe(false);});
 it('cancels the old tab and discards its pending result when selection changes',async()=>{click('collection-start');await vi.advanceTimersByTimeAsync(0);document.getElementById('tab-select')!.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(0);expect(send.mock.calls.some(x=>x[0].type==='CANCEL_COLLECTION')).toBe(true);expect((document.getElementById('collection-use') as HTMLButtonElement).disabled).toBe(true);expect(adopt).not.toHaveBeenCalled();});
 it('validates bounds before any tab message',async()=>{(document.getElementById('collection-max') as HTMLInputElement).value='501';click('collection-start');await vi.advanceTimersByTimeAsync(0);expect(send).not.toHaveBeenCalled();expect(notice).toHaveBeenCalledWith(expect.stringContaining('limites válidos'),true);});
 it('discards and cancels a START reply that arrives after changing tabs',async()=>{
  const first=deferred<unknown>();send.mockImplementationOnce(()=>first.promise);
  click('collection-start');expect(button('collection-start').disabled).toBe(true);expect(button('collection-cancel').disabled).toBe(false);expect((document.getElementById('collection-max') as HTMLInputElement).disabled).toBe(true);
  changeTab();expect(button('collection-start').disabled).toBe(false);
  first.resolve({status:'ok',collection:{...running,phase:'completed'},snapshot});await flush();
  expect(send.mock.calls.map(x=>x[0].type)).toEqual(['START_COLLECTION','CANCEL_COLLECTION']);
  expect(send).toHaveBeenLastCalledWith({type:'CANCEL_COLLECTION',jobId:'fixture-job'});
  expect(button('collection-start').disabled).toBe(false);expect(button('collection-use').disabled).toBe(true);expect(adopt).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('can cancel during START and never makes its late completed result adoptable',async()=>{
  const first=deferred<unknown>();send.mockImplementationOnce(()=>first.promise);
  click('collection-start');click('collection-cancel');expect(button('collection-start').disabled).toBe(false);expect(button('collection-cancel').disabled).toBe(true);
  first.resolve({status:'ok',collection:{...running,phase:'completed'},snapshot});await flush();
  expect(button('collection-use').disabled).toBe(true);expect(send).toHaveBeenLastCalledWith({type:'CANCEL_COLLECTION',jobId:'fixture-job'});expect(adopt).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('pagehide invalidates a pending START even when its reply arrives after pageshow and a new start',async()=>{
  const first=deferred<unknown>(),second=deferred<unknown>();send.mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise);
  click('collection-start');window.dispatchEvent(new Event('pagehide'));
  expect(button('collection-start').disabled).toBe(true);expect(button('collection-use').disabled).toBe(true);
  window.dispatchEvent(new Event('pageshow'));click('collection-start');
  first.resolve({status:'ok',collection:{...running,phase:'completed'},snapshot});await flush();
  expect(button('collection-start').disabled).toBe(true);expect(button('collection-cancel').disabled).toBe(false);expect(button('collection-use').disabled).toBe(true);
  second.resolve({status:'ok',collection:{...running,jobId:'new-job',phase:'completed'},snapshot});await flush();
  expect(button('collection-start').disabled).toBe(false);expect(button('collection-use').disabled).toBe(false);click('collection-use');await flush();expect(adopt).toHaveBeenCalledOnce();
 });
 it('a stale START rejection cannot unlock or clear a newer pending start',async()=>{
  const first=deferred<unknown>(),second=deferred<unknown>();send.mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise);
  click('collection-start');changeTab();click('collection-start');first.reject(new Error('old failure'));await flush();
  expect(button('collection-start').disabled).toBe(true);expect(button('collection-cancel').disabled).toBe(false);expect(notice).not.toHaveBeenCalled();
  click('collection-start');expect(send).toHaveBeenCalledTimes(2);
  second.resolve({status:'ok',collection:{...running,jobId:'new-job',phase:'completed'},snapshot});await flush();expect(button('collection-use').disabled).toBe(false);
 });
 it('a stale START completion cannot replace a newer running job or its timer',async()=>{
  const first=deferred<unknown>();send.mockImplementationOnce(()=>first.promise).mockImplementationOnce(async()=>({status:'ok',collection:{...running,jobId:'new-job'}}));
  click('collection-start');changeTab();click('collection-start');await flush();
  first.resolve({status:'ok',collection:{...running,phase:'completed'},snapshot});await flush();
  expect(button('collection-start').disabled).toBe(true);expect(button('collection-use').disabled).toBe(true);expect(vi.getTimerCount()).toBe(1);
  expect(send).toHaveBeenLastCalledWith({type:'CANCEL_COLLECTION',jobId:'fixture-job'});
 });
 it('a stale poll rejection cannot clear a newer job or stop its timer',async()=>{
  const oldPoll=deferred<unknown>();send.mockImplementation(async(message)=>message.type==='START_COLLECTION'?{status:'ok',collection:{...running,jobId:'new-job'}}:message.type==='CANCEL_COLLECTION'?{status:'ok',collection:{...running,phase:'cancelled'}}:{status:'ok',collection:{...running,jobId:'new-job'}});
  send.mockImplementationOnce(async()=>({status:'ok',collection:running})).mockImplementationOnce(()=>oldPoll.promise);
  click('collection-start');await vi.advanceTimersByTimeAsync(400);changeTab();click('collection-start');await flush();oldPoll.reject(new Error('old poll failure'));await flush();
  expect(button('collection-start').disabled).toBe(true);expect(button('collection-cancel').disabled).toBe(false);expect(vi.getTimerCount()).toBe(1);expect(notice).not.toHaveBeenCalled();
 });
 it('a stale cancel rejection cannot clear a newer job or stop its timer',async()=>{
  const oldCancel=deferred<unknown>();let starts=0;send.mockImplementation(async(message)=>message.type==='START_COLLECTION'?{status:'ok',collection:{...running,jobId:++starts===1?'fixture-job':'new-job'}}:message.type==='CANCEL_COLLECTION'?{status:'ok',collection:{...running,phase:'cancelled'}}:{status:'ok',collection:{...running,jobId:'new-job'}});
  click('collection-start');await flush();send.mockImplementationOnce(()=>oldCancel.promise);click('collection-cancel');changeTab();click('collection-start');await flush();oldCancel.reject(new Error('old cancel failure'));await flush();
  expect(button('collection-start').disabled).toBe(true);expect(button('collection-cancel').disabled).toBe(false);expect(vi.getTimerCount()).toBe(1);expect(notice).not.toHaveBeenCalled();
 });
 it('checks the captured selection before accepting START even without a change event',async()=>{
  const first=deferred<unknown>();send.mockImplementationOnce(()=>first.promise);click('collection-start');(document.getElementById('tab-select') as HTMLSelectElement).value='2';
  first.resolve({status:'ok',collection:{...running,phase:'completed'},snapshot});await flush();
  expect(button('collection-start').disabled).toBe(false);expect(button('collection-use').disabled).toBe(true);expect(send).toHaveBeenLastCalledWith({type:'CANCEL_COLLECTION',jobId:'fixture-job'});
 });
});
