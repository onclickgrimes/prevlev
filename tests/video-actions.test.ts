// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mountVideoActions,type VideoActions} from '../src/ui/video-actions';
import {downloadBlob,fetchThumbnail} from '../src/core/media';
import type {VideoRecord} from '../src/shared/types';
vi.mock('../src/core/media',()=>({downloadBlob:vi.fn(),fetchThumbnail:vi.fn(),loadImage:vi.fn()}));
function png(width=2,height=3):Blob {const bytes=new Uint8Array(57),view=new DataView(bytes.buffer);bytes.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);view.setUint32(16,width);view.setUint32(20,height);bytes[24]=8;bytes[25]=6;bytes.set(new TextEncoder().encode('IDAT'),37);bytes.set(new TextEncoder().encode('IEND'),49);return new Blob([bytes],{type:'image/png'});}
const source=():VideoRecord=>({id:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Título da amostra',source:'youtube-dom'});
let mounted:VideoActions[]=[];
const writeText=vi.fn(async(_text:string)=>{}),write=vi.fn(async(_items:ClipboardItem[])=>{}),closeBitmap=vi.fn();
let bitmap:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.mocked(downloadBlob).mockClear();vi.mocked(fetchThumbnail).mockReset();writeText.mockClear();write.mockClear();closeBitmap.mockClear();
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText,write}});
 Object.defineProperty(window,'ClipboardItem',{configurable:true,value:class{types:string[];constructor(data:Record<string,Blob>){this.types=Object.keys(data);}}});
 bitmap=vi.fn(async()=>({width:2,height:3,close:closeBitmap}));vi.stubGlobal('createImageBitmap',bitmap);
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({drawImage:vi.fn()})as unknown as CanvasRenderingContext2D);
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(png()));
});
afterEach(()=>{for(const controller of mounted)controller.dispose();mounted=[];document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture(video=source(),thumbnail=vi.fn(async(_id:string,_signal:AbortSignal)=>png())){
 const host=document.createElement('div');document.body.append(host);let current={...video};const notice=vi.fn();
 const controller=mountVideoActions(host,{video,isCurrent:captured=>current.id===captured.id&&current.url===captured.url&&current.title===captured.title&&current.source===captured.source,notice,thumbnail});mounted.push(controller);
 const open=()=>host.querySelector<HTMLButtonElement>('[data-video-actions-trigger]')!.click();
 const button=(action:string)=>host.querySelector<HTMLButtonElement>(`[data-video-action="${action}"]`)!;
 return{host,video,notice,thumbnail,controller,open,button,replace:(next:VideoRecord)=>{current=next;}};
}
describe('explicit immutable per-item metadata actions',()=>{
 it('does nothing at mount, open or hover and copies only the chosen captured fields',async()=>{
  const f=fixture();expect(f.thumbnail).not.toHaveBeenCalled();f.open();f.host.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));expect(f.thumbnail).not.toHaveBeenCalled();expect(bitmap).not.toHaveBeenCalled();
  for(const key of ['copy-title','copy-id','copy-thumbnail-url']){f.button(key).click();await vi.waitFor(()=>expect(f.button(key).disabled).toBe(false));}
  expect(writeText.mock.calls.map(call=>call[0])).toEqual(['Título da amostra','abcdefghijk','https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg']);expect(f.thumbnail).not.toHaveBeenCalled();
  const lens=f.host.querySelector<HTMLAnchorElement>('[data-video-actions-lens]')!;expect(lens.target).toBe('_blank');expect(lens.rel).toContain('noopener');expect(new URL(lens.href).searchParams.get('url')).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
 });
 it('refuses a mutated input object even if a stale caller callback still accepts its clone',async()=>{
  const f=fixture();f.open();f.video.title='Objeto reciclado';f.button('copy-title').click();await Promise.resolve();expect(writeText).not.toHaveBeenCalled();expect(f.thumbnail).not.toHaveBeenCalled();
 });
 it('renders untrusted title as text without markup or media access',()=>{
  const f=fixture({...source(),title:'<img src="https://evil.invalid" onerror="pwned()">'});f.open();expect(f.host.querySelector('img,script')).toBeNull();expect(f.host.textContent).toContain('<img src=');expect(f.thumbnail).not.toHaveBeenCalled();
 });
 it.each(['javascript://www.youtube.com/watch?v=abcdefghijk','https://example.invalid/watch?v=abcdefghijk','https://www.youtube.com/watch?v=bbbbbbbbbbb','https://user:secret@www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com/channel/fake?v=abcdefghijk','https://www.youtube.com/shorts/bbbbbbbbbbb?v=abcdefghijk','https://www.youtube.com:8443/watch?v=abcdefghijk'])('refuses mismatched or unsafe item URL %s',url=>{
  const f=fixture({...source(),url});f.open();expect(f.button('copy-id').disabled).toBe(true);expect(f.host.querySelector('[data-video-actions-lens]')).toBeNull();expect(writeText).not.toHaveBeenCalled();expect(f.thumbnail).not.toHaveBeenCalled();
 });
 it('refuses recycled metadata before clipboard write or Lens navigation',async()=>{
  const f=fixture();f.open();const lens=f.host.querySelector<HTMLAnchorElement>('[data-video-actions-lens]')!;f.replace({...source(),id:'bbbbbbbbbbb',url:'https://www.youtube.com/watch?v=bbbbbbbbbbb'});
  f.button('copy-title').click();await Promise.resolve();expect(writeText).not.toHaveBeenCalled();const event=new MouseEvent('click',{bubbles:true,cancelable:true});lens.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);expect(f.thumbnail).not.toHaveBeenCalled();
 });
 it('blocks assets and Lens for API records while preserving raw title/ID copies',async()=>{
  const f=fixture({...source(),source:'youtube-data-api'});f.open();for(const key of ['copy-thumbnail-url','download-png','copy-png'])expect(f.button(key).disabled).toBe(true);expect(f.host.querySelector('[data-video-actions-lens]')).toBeNull();expect(f.host.textContent).toContain('YouTube Data API');f.button('copy-id').click();await vi.waitFor(()=>expect(writeText).toHaveBeenCalledWith('abcdefghijk'));expect(f.thumbnail).not.toHaveBeenCalled();expect(bitmap).not.toHaveBeenCalled();
 });
});
describe('bounded image actions and recycled item guards',()=>{
 it('uses the bounded default transport only after an explicit asset action',async()=>{
  vi.mocked(fetchThumbnail).mockResolvedValue(png());const host=document.createElement('div');document.body.append(host);const controller=mountVideoActions(host,{video:source(),isCurrent:captured=>Object.isFrozen(captured)});mounted.push(controller);host.querySelector<HTMLButtonElement>('[data-video-actions-trigger]')!.click();expect(fetchThumbnail).not.toHaveBeenCalled();host.querySelector<HTMLButtonElement>('[data-video-action="download-png"]')!.click();await vi.waitFor(()=>expect(downloadBlob).toHaveBeenCalledOnce());expect(fetchThumbnail).toHaveBeenCalledWith('abcdefghijk',expect.any(AbortSignal));
 });
 it('validates before decode, normalizes PNG, and checks each final action',async()=>{
  const f=fixture();f.open();f.button('download-png').click();await vi.waitFor(()=>expect(downloadBlob).toHaveBeenCalledOnce());expect(f.thumbnail).toHaveBeenCalledWith('abcdefghijk',expect.any(AbortSignal));expect(bitmap).toHaveBeenCalledOnce();expect(closeBitmap).toHaveBeenCalledOnce();expect(vi.mocked(downloadBlob).mock.calls[0][0].type).toBe('image/png');expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('prevlev-abcdefghijk.png');
  await vi.waitFor(()=>expect(f.button('copy-png').disabled).toBe(false));f.button('copy-png').click();await vi.waitFor(()=>expect(write).toHaveBeenCalledOnce());expect(write.mock.calls[0][0][0].types).toEqual(['image/png']);expect(f.thumbnail).toHaveBeenCalledTimes(2);
 });
 it.each(['oversized','mime','unsupported']as const)('rejects %s bytes before any decoder, image URL, clipboard or download',async kind=>{
  const blob=kind==='oversized'?png(8000,8000):kind==='mime'?new Blob([png()],{type:'image/jpeg'}):new Blob(['GIF89a'],{type:'image/gif'}),f=fixture(source(),vi.fn(async()=>blob));f.open();f.button('download-png').click();await vi.waitFor(()=>expect(f.notice).toHaveBeenCalledWith(expect.any(String),true));expect(bitmap).not.toHaveBeenCalled();expect(downloadBlob).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 });
 it('discards a thumbnail response after the row identity changes',async()=>{
  let resolve!:(blob:Blob)=>void;const f=fixture(source(),vi.fn(()=>new Promise<Blob>(done=>{resolve=done;})));f.open();f.button('download-png').click();await vi.waitFor(()=>expect(f.thumbnail).toHaveBeenCalledOnce());f.replace({...source(),url:'https://www.youtube.com/watch?v=bbbbbbbbbbb',id:'bbbbbbbbbbb'});resolve(png());await vi.waitFor(()=>expect(f.host.querySelector<HTMLElement>('[data-video-actions-menu]')!.hidden).toBe(true));expect(bitmap).not.toHaveBeenCalled();expect(downloadBlob).not.toHaveBeenCalled();
 });
 it('discards completed decoding and closes the bitmap when the item changes during decode',async()=>{
  let resolve!:(value:unknown)=>void;bitmap.mockImplementation(()=>new Promise(done=>{resolve=done;}));const f=fixture();f.open();f.button('copy-png').click();await vi.waitFor(()=>expect(bitmap).toHaveBeenCalledOnce());f.replace({...source(),title:'Outra identidade editorial'});resolve({width:2,height:3,close:closeBitmap});await vi.waitFor(()=>expect(closeBitmap).toHaveBeenCalledOnce());expect(write).not.toHaveBeenCalled();expect(downloadBlob).not.toHaveBeenCalled();
 });
 it.each(['close','dispose','detach']as const)('does not publish a late result after %s',async action=>{
  let resolve!:(blob:Blob)=>void;const f=fixture(source(),vi.fn(()=>new Promise<Blob>(done=>{resolve=done;})));f.open();f.button('download-png').click();await vi.waitFor(()=>expect(f.thumbnail).toHaveBeenCalledOnce());if(action==='detach')f.host.remove();else f.controller[action]();resolve(png());await new Promise(done=>setTimeout(done,15));expect(bitmap).not.toHaveBeenCalled();expect(downloadBlob).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 });
});
