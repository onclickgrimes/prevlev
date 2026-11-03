import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {exportSwipeJson,mergeSwipeImport,normalizeSwipeLibrary,parseSwipeImport} from '../src/core/swipe';
import {getSwipe,updateSwipe,type SwipeItem} from '../src/shared/storage';
import {handleLibrary} from '../server/library.mjs';
const validImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=';
const png=Buffer.from(validImage.split(',')[1],'base64');
const bomb=Buffer.from(png);bomb.writeUInt32BE(8000,16);bomb.writeUInt32BE(8000,20);
const malformed='data:image/png;base64,'+Buffer.from('PRIVATE_INLINE_BYTES').toString('base64');
const fixtures=[
 {name:'malformed container',image:malformed},
 {name:'8000x8000 dimensions',image:'data:image/png;base64,'+bomb.toString('base64')},
 {name:'MIME mismatch',image:'data:image/jpeg;base64,'+png.toString('base64')},
 {name:'noncanonical base64',image:'data:image/png;base64,AB=='},
];
const reference=(id='legacy',image?:string):SwipeItem=>({id,title:'Referência preservada',url:'https://example.test/'+id,folder:'Legado',createdAt:'',source:'user-provided',...(image?{image}:{})});
const directories:string[]=[];
const directory=async()=>{const path=await mkdtemp(join(tmpdir(),'prevlev-inline-boundary-'));directories.push(path);return path;};
const data=(result:Awaited<ReturnType<typeof handleLibrary>>)=>result.data as {items:SwipeItem[];revision:string};
let network:ReturnType<typeof vi.fn<()=>void>>,decoder:ReturnType<typeof vi.fn<()=>void>>;
beforeEach(()=>{network=vi.fn<()=>void>();decoder=vi.fn<()=>void>();vi.stubGlobal('fetch',network);vi.stubGlobal('createImageBitmap',decoder);vi.stubGlobal('Image',class{constructor(){decoder();throw new Error('No decoder allowed in boundary tests');}});});
afterEach(async()=>{vi.unstubAllGlobals();vi.restoreAllMocks();await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
function browserStore(items:SwipeItem[]){const store={swipe:structuredClone(items)};const set=vi.fn(async(next:{swipe:SwipeItem[]})=>{store.swipe=structuredClone(next.swipe);});vi.stubGlobal('chrome',{storage:{local:{get:vi.fn(async()=>({swipe:structuredClone(store.swipe)})),set}}});return{store,set};}

describe('existing JSON import validates every inline image without requiring asset metadata',()=>{
 for(const fixture of fixtures)for(const format of ['legacy-list','json-v2']as const)it(`rejects ${fixture.name} in ${format} atomically`,async()=>{
  const original=[reference('saved')],{store,set}=browserStore(original),incoming=[reference('valid-prefix',validImage),reference('bad',fixture.image)],payload=format==='legacy-list'?incoming:{format:'prevlev-swipe',version:2,items:incoming},before=JSON.stringify(payload);
  expect(()=>parseSwipeImport(payload)).toThrow();expect(JSON.stringify(payload)).toBe(before);
  await expect(updateSwipe(current=>mergeSwipeImport(current,parseSwipeImport(payload)).items)).rejects.toThrow();expect(set).not.toHaveBeenCalled();expect(store.swipe).toEqual(original);expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
 it('accepts a valid old-style inline PNG without synthesizing metadata or requesting a URL',()=>{
  const item=reference('valid',validImage);for(const payload of [[item],{format:'prevlev-swipe',version:2,items:[item]}]){const parsed=parseSwipeImport(payload);expect(parsed[0].image).toBe(validImage);expect(parsed[0]).not.toHaveProperty('asset');expect(parsed[0]).not.toHaveProperty('folderId');}expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
});

describe('explicit backend commit applies the same pure image boundary before writing',()=>{
 it('refuses all malformed inline variants without altering a prior library or exposing bytes',async()=>{
  const dataDir=await directory(),first=await handleLibrary({action:'read'},{dataDir}),saved=await handleLibrary({action:'commit',baseRevision:data(first).revision,items:[reference('saved')]},{dataDir});expect(saved.status).toBe('ok');const file=join(dataDir,'library-v1.json'),before=await readFile(file,'utf8'),errors:string[]=[];
  for(const fixture of fixtures){const result=await handleLibrary({action:'commit',baseRevision:data(saved).revision,items:[reference('valid-prefix',validImage),reference('bad',fixture.image)]},{dataDir});expect(result.status).toBe('error');expect(result).not.toHaveProperty('data');errors.push(result.error as string);expect(await readFile(file,'utf8')).toBe(before);expect(data(await handleLibrary({action:'read'},{dataDir})).revision).toBe(data(saved).revision);}
  expect(new Set(errors).size).toBe(1);for(const error of errors){expect(error).not.toMatch(/data:image|PRIVATE_INLINE|8000|iVBOR/);expect(error).not.toContain(dataDir);}expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
 it('does not create a missing library directory after rejecting a new write',async()=>{
  const dataDir=join(await directory(),'not-created'),first=await handleLibrary({action:'read'},{dataDir});expect((await handleLibrary({action:'commit',baseRevision:data(first).revision,items:[reference('bad',fixtures[1].image)]},{dataDir})).status).toBe('error');await expect(stat(dataDir)).rejects.toMatchObject({code:'ENOENT'});expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
 it('commits a valid inline legacy image and preserves an external URL as an unfetched reference',async()=>{
  const dataDir=await directory(),first=await handleLibrary({action:'read'},{dataDir}),external='https://external.example.test/reference.png',saved=await handleLibrary({action:'commit',baseRevision:data(first).revision,items:[reference('inline',validImage),reference('external',external)]},{dataDir});expect(saved.status).toBe('ok');const loaded=await handleLibrary({action:'read'},{dataDir});expect(data(loaded).items.map(item=>item.image)).toEqual([validImage,external]);for(const item of data(loaded).items){expect(item).not.toHaveProperty('asset');expect(item).not.toHaveProperty('folderId');}expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
});

describe('legacy reads and exports remain non-destructive data operations',()=>{
 it('preserves malformed/oversized inline images in normalize/getSwipe/JSON export without migration or writes',async()=>{
  const original=[reference('malformed',malformed),reference('bomb',fixtures[1].image),reference('external','https://external.example.test/old.png')],{store,set}=browserStore(original),before=JSON.stringify(original),items=await getSwipe(),backup=JSON.parse(exportSwipeJson(items));
  expect(items.map(item=>item.image)).toEqual(original.map(item=>item.image));expect(backup.items.map((item:SwipeItem)=>item.image)).toEqual(original.map(item=>item.image));expect(set).not.toHaveBeenCalled();expect(store.swipe).toEqual(original);expect(JSON.stringify(original)).toBe(before);for(const item of normalizeSwipeLibrary(original)){expect(item).not.toHaveProperty('asset');expect(item).not.toHaveProperty('folderId');}expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
 it('reads an existing legacy backend file unchanged but refuses a new explicit commit of its invalid image',async()=>{
  const dataDir=await directory(),items=normalizeSwipeLibrary([reference('legacy-invalid',malformed)]),revision=createHash('sha256').update(JSON.stringify(items)).digest('hex'),file=join(dataDir,'library-v1.json'),stored=JSON.stringify({version:1,revision,items});await writeFile(file,stored,'utf8');
  const read=await handleLibrary({action:'read'},{dataDir});expect(read.status).toBe('ok');expect(data(read)).toMatchObject({revision,items});expect(await readFile(file,'utf8')).toBe(stored);expect(JSON.parse(exportSwipeJson(data(read).items)).items[0].image).toBe(malformed);
  const refused=await handleLibrary({action:'commit',baseRevision:revision,items:data(read).items},{dataDir});expect(refused.status).toBe('error');expect(await readFile(file,'utf8')).toBe(stored);expect((await handleLibrary({action:'read'},{dataDir})).status).toBe('ok');expect(network).not.toHaveBeenCalled();expect(decoder).not.toHaveBeenCalled();
 });
});
