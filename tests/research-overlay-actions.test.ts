// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountResearchOverlay} from '../src/content/research-overlay';
import {mountVideoActions} from '../src/ui/video-actions';
import type {CardFilter} from '../src/content/youtube';
import type {CollectionState} from '../src/content/collection';
import type {VideoRecord} from '../src/shared/types';
vi.mock('../src/ui/video-actions',()=>({mountVideoActions:vi.fn(()=>({close:vi.fn(),dispose:vi.fn()}))}));
let overlay:ReturnType<typeof mountResearchOverlay>|undefined;
afterEach(()=>{overlay?.dispose();overlay=undefined;document.body.replaceChildren();vi.mocked(mountVideoActions).mockClear();});
function fixture(count=2){
 const host=document.createElement('div');document.body.append(host);
 const sample={url:'https://www.youtube.com/results?search_query=observed',videos:Array.from({length:count},(_,index)=>({id:String(index).padStart(11,'0'),url:`https://www.youtube.com/watch?v=${String(index).padStart(11,'0')}`,title:`Vídeo ${index}`,source:'youtube-dom' as const}))as VideoRecord[],filter:{sort:'default'}as CardFilter};
 const state:CollectionState={phase:'idle',collectedCount:0,steps:0,maxItems:500,maxSteps:30,timeoutMs:60000,url:sample.url,reason:'Fixture',limitations:[]};
 overlay=mountResearchOverlay(host,{getVideos:()=>sample.videos,getFilter:()=>sample.filter,setFilter:next=>{sample.filter=next;},getUrl:()=>sample.url,collector:{status:()=>state,start:()=>state,cancel:()=>state,snapshot:()=>undefined,subscribe:()=>()=>{},dispose:()=>{}}});
 return{host,sample,overlay};
}
describe('per-article action lifecycle in the research overlay',()=>{
 it('passes a clone per item and disposes every old controller on refresh and once on teardown',()=>{
  const f=fixture();expect(mountVideoActions).toHaveBeenCalledTimes(2);const first=vi.mocked(mountVideoActions).mock.calls[0][1],old=vi.mocked(mountVideoActions).mock.results.map(result=>result.value);expect(first.video).toEqual(f.sample.videos[0]);expect(first.video).not.toBe(f.sample.videos[0]);
  f.overlay.refresh();for(const controller of old)expect(controller.dispose).toHaveBeenCalledOnce();expect(mountVideoActions).toHaveBeenCalledTimes(4);const current=vi.mocked(mountVideoActions).mock.results.slice(2).map(result=>result.value);f.overlay.dispose();f.overlay.dispose();for(const controller of current)expect(controller.dispose).toHaveBeenCalledOnce();expect(first.isCurrent(first.video)).toBe(false);
 });
 it.each(['id','url','title','source','context','filter']as const)('rejects an item whose %s changed without waiting for a rerender',field=>{
  const f=fixture(),options=vi.mocked(mountVideoActions).mock.calls[0][1];expect(options.isCurrent(options.video)).toBe(true);
  if(field==='id')f.sample.videos[0].id='bbbbbbbbbbb';if(field==='url')f.sample.videos[0].url='https://www.youtube.com/watch?v=bbbbbbbbbbb';if(field==='title')f.sample.videos[0].title='Reciclado';if(field==='source')f.sample.videos[0].source='youtube-data-api';if(field==='context')f.sample.url='https://www.youtube.com/results?search_query=other';if(field==='filter')f.sample.filter={...f.sample.filter,query:'does not match'};
  expect(options.isCurrent(options.video)).toBe(false);
 });
 it('replaces all page-one actions when paging existing observations and invalidates their revision',()=>{
  const f=fixture(102),old=vi.mocked(mountVideoActions).mock.results.map(result=>result.value),options=vi.mocked(mountVideoActions).mock.calls[0][1];expect(old).toHaveLength(100);f.host.querySelector<HTMLButtonElement>('#prevlev-research-next')!.click();expect(mountVideoActions).toHaveBeenCalledTimes(102);for(const controller of old)expect(controller.dispose).toHaveBeenCalledOnce();expect(options.isCurrent(options.video)).toBe(false);expect(f.host.querySelector('#prevlev-research-results article > [data-prevlev-research-video-title]')!.textContent).toBe('Vídeo 100');
 });
});
