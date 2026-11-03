import {afterEach,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dirs:string[]=[];
const moduleUrl=pathToFileURL(resolve('server/library.mjs')).href;
const directory=async()=>{const path=await mkdtemp(join(tmpdir(),'prevlev-library-native-'));dirs.push(path);return path;};
const sentinels=`let network=0,decoders=0;globalThis.fetch=()=>{network++;throw new Error('Unexpected network');};globalThis.createImageBitmap=()=>{decoders++;throw new Error('Unexpected decoder');};globalThis.Image=class{constructor(){decoders++;throw new Error('Unexpected image');}};`;
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
describe('Node24 native library module without a bundler or test-module resolver',()=>{
 it('imports from an empty temp cwd without creating library data, a listener or image/network work',async()=>{
  const cwd=await directory();
  const result=execFileSync(process.execPath,['--input-type=module','-e',`${sentinels}const api=await import(${JSON.stringify(moduleUrl)});process.stdout.write(JSON.stringify({loaded:typeof api.handleLibrary,network,decoders}));`],{cwd,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{...process.env,DATA_DIR:join(cwd,'must-not-be-created')}});
  expect(JSON.parse(result)).toEqual({loaded:'function',network:0,decoders:0});expect(await readdir(cwd)).toEqual([]);
 });
 it('commits and reads valid JSON assets natively, rejects invalid legacy bytes atomically and never decodes or fetches',async()=>{
  const cwd=await directory();
  const script=`${sentinels}
const {handleLibrary}=await import(${JSON.stringify(moduleUrl)});
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=';
const options={dataDir:process.cwd()+'/library'};
const asset={version:1,id:'asset_native',kind:'file',mime:'image/png',bytes:Buffer.from(image.split(',')[1],'base64').length,width:1,height:1,createdAt:'2026-11-03T00:00:00.000Z',sourceUrl:'https://example.test/owned',fileName:'owned.png'};
const base={id:'native',title:'Fixture local',url:'https://example.test/owned',folder:'Local',createdAt:'2026-11-03T00:00:00.000Z',source:'user-provided'};
const first=await handleLibrary({action:'read'},options);
const saved=await handleLibrary({action:'commit',baseRevision:first.data.revision,items:[{...base,image,asset},{...base,id:'external',url:'https://example.test/reference',image:'https://external.example.test/reference.png'}]},options);
const read=await handleLibrary({action:'read'},options);
const refused=await handleLibrary({action:'commit',baseRevision:read.data.revision,items:[{...base,id:'bad',image:'data:image/png;base64,AAAA'}]},options);
const after=await handleLibrary({action:'read'},options);
process.stdout.write(JSON.stringify({saved:saved.status,read:read.status,items:read.data.items.length,assetId:read.data.items[0].asset.id,width:read.data.items[0].asset.width,inlinePreserved:read.data.items[0].image===image,external:read.data.items[1].image,refused:refused.status,sameRevision:after.data.revision===read.data.revision,error:refused.error,network,decoders}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd,encoding:'utf8',timeout:10000,maxBuffer:1024*1024}));
  expect(result).toMatchObject({saved:'ok',read:'ok',items:2,assetId:'asset_native',width:1,inlinePreserved:true,external:'https://external.example.test/reference.png',refused:'error',sameRevision:true,network:0,decoders:0});expect(result.error).not.toMatch(/AAAA|data:image|prevlev-library-native/);
 });
});
