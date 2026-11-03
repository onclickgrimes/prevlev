import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectSwipeAssetDataUrl,normalizeSwipeAsset} from '../src/core/swipe-assets';
import {exportSwipeCsv,exportSwipeJson,moveSwipeItem,normalizeSwipeLibrary,normalizeSwipeItem,parseSwipeImport,renameSwipeFolder} from '../src/core/swipe';
import {handleLibrary} from '../server/library.mjs';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=';
const rawAsset={version:1,id:'asset_fixture',kind:'file',mime:'image/png',bytes:Buffer.from(image.split(',')[1],'base64').length,width:1,height:1,sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',fileName:'local.png',createdAt:'2026-11-03T00:00:00Z'};
const reference={id:'reference_fixture',folder:'Originais',title:'Uma referência',url:rawAsset.sourceUrl,createdAt:'2026-11-03T00:00:00.000Z',notes:'Nota preservada',tags:['Local'],image,asset:normalizeSwipeAsset(rawAsset,image)};
const directories:string[]=[];afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
describe('bounded inline assets and personal-library compatibility',()=>{
 it('round-trips validated bytes, asset provenance and folder IDs in JSON without read migrations',()=>{
  const legacy={id:'old',folder:'Antiga',title:'Legado',url:'https://example.test/old',createdAt:''};expect(normalizeSwipeLibrary([legacy])[0]).not.toHaveProperty('folderId');
  const item=normalizeSwipeItem({...reference,folderId:'folder_fixture'}),backup=JSON.parse(exportSwipeJson([item]));expect(parseSwipeImport(backup)).toEqual([item]);expect(backup.items[0].image).toBe(image);expect(backup.items[0].asset.id).toBe('asset_fixture');
  const csv=exportSwipeCsv([item]);expect(csv).toContain('folderId');expect(csv).not.toContain('base64');expect(csv).not.toContain('asset_fixture');
 });
 it('rejects invalid containers, canonical base64, mismatched metadata and official sources on explicit imports',()=>{
  expect(()=>parseSwipeImport([{...reference,asset:undefined,image:'data:image/png;base64,AAAA'}])).toThrow(/Cabeçalho/);
  for(const changed of [{bytes:1},{width:2},{mime:'image/webp'},{sourceUrl:'https://user:secret@example.test/'},{fileName:'bad\nname'},{id:'../path'},{createdAt:'2026-02-30T00:00:00Z'}])expect(()=>normalizeSwipeItem({...reference,asset:{...rawAsset,...changed}})).toThrow();
  expect(()=>inspectSwipeAssetDataUrl('data:image/png;base64,AB==')).toThrow(/inválido/);
  expect(()=>normalizeSwipeItem({...reference,source:'youtube-data-api'})).toThrow(/youtube-data-api/);
  expect(()=>normalizeSwipeLibrary([{...reference,image:'data:image/png;base64,'+'A'.repeat(4*1024*1024)}])).toThrow(/4 MiB/);
 });
 it('assigns folder identity only on explicit organization and preserves it, item IDs and images through rename/move',()=>{
  const input=[reference,{...reference,id:'second',image:undefined,asset:undefined,folder:'Destino'}],before=JSON.stringify(input),renamed=renameSwipeFolder(input,'Originais','Renomeada');expect(JSON.stringify(input)).toBe(before);expect(renamed[0].folderId).toBeTruthy();
  const again=renameSwipeFolder(renamed,'Renomeada','Nome novo');expect(again[0].folderId).toBe(renamed[0].folderId);expect(again[0]).toMatchObject({id:reference.id,createdAt:reference.createdAt,image,notes:'Nota preservada'});
  const moved=moveSwipeItem(again,reference.id,'Destino');expect(moved[0].folderId).toBe(moved[1].folderId);expect(moved[0].image).toBe(image);expect(()=>renameSwipeFolder(again,'Nome novo','Destino')).toThrow(/Já existe/);
  expect(()=>normalizeSwipeLibrary([{...reference,folderId:'same'},{...reference,id:'second',folder:'Outra',folderId:'same'}])).toThrow(/conflitantes/);
 });
 it('existing personal backend advertises schema support and persists exact asset/identity metadata through revisions',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'prevlev-assets-'));directories.push(dataDir);
  const first=await handleLibrary({action:'read'},{dataDir}),data=first.data as {revision:string;assetSchemaVersion:number;folderIdentityVersion:number};expect(data.assetSchemaVersion).toBe(1);expect(data.folderIdentityVersion).toBe(1);
  const item=normalizeSwipeItem({...reference,folderId:'folder_fixture'}),saved=await handleLibrary({action:'commit',baseRevision:data.revision,items:[item]},{dataDir});expect(saved.status).toBe('ok');
  const loaded=await handleLibrary({action:'read'},{dataDir});expect((loaded.data as {items:unknown[]}).items).toEqual([item]);expect(JSON.stringify(loaded)).toContain('asset_fixture');
 });
});
