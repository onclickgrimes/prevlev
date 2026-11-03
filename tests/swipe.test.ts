import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSwipeReference,editSwipeReference,exportSwipeCsv,exportSwipeJson,filterSwipe,inferSwipeType,mergeSwipeImport,normalizeSwipeLibrary,parseSwipeCsv,parseSwipeImport,parseSwipeTags,safeReferenceUrl,SWIPE_MAX_BYTES} from '../src/core/swipe';
import {getSwipe,updateSwipe,saveSwipe,type SwipeItem} from '../src/shared/storage';

const now='2026-11-03T00:00:00.000Z';
const legacy={id:'old-id',folder:'Roteiros',title:'Título antigo',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',createdAt:now};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function storage(initial:unknown=undefined){const store:Record<string,unknown>={swipe:initial};const set=vi.fn(async(data:Record<string,unknown>)=>{Object.assign(store,structuredClone(data));});vi.stubGlobal('chrome',{storage:{local:{get:vi.fn(async(key:string)=>({[key]:structuredClone(store[key])})),set}}});return {store,set};}

describe('reference validation and legacy compatibility',()=>{
 it('normalizes legacy references without inventing dates, changing IDs or writing storage',async()=>{
   const {set,store}=storage([legacy]);const items=await getSwipe();expect(items).toEqual([{...legacy,type:'video',tags:[],notes:''}]);expect(set).not.toHaveBeenCalled();expect(store.swipe).toEqual([legacy]);
   const missing=parseSwipeImport([{title:'Sem metadados antigos',url:'https://example.com'}]);expect(missing[0].createdAt).toBe('');expect(parseSwipeImport([{title:'Sem metadados antigos',url:'https://example.com'}])[0].id).toBe(missing[0].id);
 });
 it('accepts safe references and infers videos/channels from URLs',()=>{
   expect(inferSwipeType(legacy.url)).toBe('video');expect(inferSwipeType('https://www.youtube.com/@Example')).toBe('channel');expect(inferSwipeType('https://example.com/reference')).toBe('other');
   expect(safeReferenceUrl('https://EXAMPLE.com/a#section')).toBe('https://example.com/a#section');
   for(const url of ['javascript:alert(1)','data:text/html,<script/>','http://example.com','https://u:secret@example.com','https://example.com/\\path','https://example.com/\npath'])expect(()=>safeReferenceUrl(url)).toThrow('HTTPS');
 });
 it('validates bounds and rejects API source without silent field truncation',()=>{
   expect(()=>createSwipeReference({title:'x'.repeat(1001),url:legacy.url})).toThrow('1000');
   expect(()=>createSwipeReference({title:'API',url:legacy.url,source:'youtube-data-api'})).toThrow('youtube-data-api');
   expect(()=>parseSwipeImport([{...legacy,source:'youtube-data-api'}])).toThrow('youtube-data-api');
   expect(()=>parseSwipeTags(Array.from({length:21},(_,index)=>`tag ${index}`))).toThrow('20');
   expect(parseSwipeTags('Edição, edicao, Roteiro,')).toEqual(['Edição','Roteiro']);
   expect(()=>normalizeSwipeLibrary(Array.from({length:5001},()=>legacy))).toThrow('5000');
   expect(()=>normalizeSwipeLibrary([{...legacy,image:'data:image/png;base64,'+'A'.repeat(SWIPE_MAX_BYTES)}])).toThrow('4 MiB');
 });
 it('round-trips JSON v2 metadata and preserves IDs and creation on edit/move',()=>{
   const item=createSwipeReference({title:'Referência',url:legacy.url,folder:'Ideias',tags:['Edição'],notes:'Uma nota',thumbnail:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'},now);
   const edited=editSwipeReference(item,{title:'Editada',url:item.url,folder:'Produção',tags:item.tags,notes:'Nova nota'},'2026-11-04T00:00:00.000Z');expect(edited.id).toBe(item.id);expect(edited.createdAt).toBe(now);expect(edited.updatedAt).toBe('2026-11-04T00:00:00.000Z');expect(edited.thumbnail).toBe(item.thumbnail);
   expect(parseSwipeImport(JSON.parse(exportSwipeJson([edited],now)))).toEqual([edited]);expect(()=>parseSwipeImport({version:99,items:[]})).toThrow('versão 2');
 });
 it('deduplicates imports by stable ID and canonical video identity without overwriting local notes',()=>{
   const existing={...legacy,notes:'Minha versão local'};
   const imported=[{...legacy,title:'Outra nota',notes:'Importada'},{...legacy,id:'different',url:'https://youtu.be/dQw4w9WgXcQ'},{...legacy,url:'https://example.com/conflict'},{...legacy,id:'new',url:'https://example.com/new'}];
   const merged=mergeSwipeImport([existing],imported);expect(merged).toMatchObject({added:1,duplicates:2,conflicts:1});expect(merged.items).toHaveLength(2);expect(merged.items[0].notes).toBe('Minha versão local');expect(merged.items[0].id).toBe('old-id');
 });
 it('searches accents/case and notes with exact normalized folder/tag/type filters',()=>{
   const input=[{...legacy,notes:'Ideia de introdução',tags:['Edição']},{...legacy,id:'other',url:'https://example.com/a',title:'Outros',folder:'Outra',tags:['Roteiro']}];
   expect(filterSwipe(input,{query:'TITULO introducao',folder:'roteiros',tag:'edicao',type:'video'}).map(item=>item.id)).toEqual(['old-id']);expect(filterSwipe(input,{type:'channel'})).toEqual([]);
   const csv=exportSwipeCsv([{...legacy,title:'=HYPERLINK("bad")',notes:'+formula',tags:['<script>']}]);expect(csv).toContain("'=HYPERLINK");expect(csv).toContain("'+formula");expect(csv).toContain('tags');
 });
 it('imports bounded CSV with quoted commas/newlines and rejects malformed schema atomically',()=>{
   const source={...legacy,title:'Título, com "aspas"',notes:'Linha um\nLinha dois',tags:['Uma tag','Outra']};expect(parseSwipeCsv(exportSwipeCsv([source]))).toEqual(normalizeSwipeLibrary([source]));
   expect(parseSwipeCsv('title,url\r\n"Outra referência",https://example.com/ref\r\n')[0].title).toBe('Outra referência');
   for(const input of ['title,url\n"unclosed,https://example.com','title,title,url\na,b,c','title,url,path\na,https://example.com,/etc/passwd','title,url\na,https://example.com,extra'])expect(()=>parseSwipeCsv(input)).toThrow();
   expect(()=>parseSwipeCsv('title,url,source\na,https://example.com,youtube-data-api')).toThrow('youtube-data-api');
 });
});

describe('atomic local storage actions',()=>{
 it('serializes read-modify-write and recovers after a failed mutation',async()=>{
   const {store}=storage([legacy]);
   const first=createSwipeReference({title:'Primeira',url:'https://example.com/one'},now),second=createSwipeReference({title:'Segunda',url:'https://example.com/two'},now);
   await Promise.all([updateSwipe(current=>[...current,first]),updateSwipe(current=>[...current,second])]);expect((store.swipe as SwipeItem[]).map(item=>item.id)).toEqual(['old-id',first.id,second.id]);
   await expect(updateSwipe(()=>{throw new Error('fixture');})).rejects.toThrow('fixture');await saveSwipe([legacy]);expect((store.swipe as SwipeItem[])).toHaveLength(1);
 });
 it('does not write on invalid import/budget and reports browser quota errors without losing prior data',async()=>{
   const {set,store}=storage([legacy]);await expect(updateSwipe(current=>[...current,{...legacy,id:'oversized',notes:'x'.repeat(10001)}])).rejects.toThrow('10000');expect(set).not.toHaveBeenCalled();expect(store.swipe).toEqual([legacy]);
   set.mockRejectedValueOnce(new Error('QUOTA_BYTES secret-internal-error'));await expect(saveSwipe([])).rejects.toThrow('cota');expect(store.swipe).toEqual([legacy]);
 });
});
