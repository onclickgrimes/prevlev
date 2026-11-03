import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,stat,readdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {handleHistory,readHistory,legacyHistory} from '../server/history.mjs';
import type {Observation} from '../server/history.mjs';

const directories:string[]=[];
const directory=async()=>{const dir=await mkdtemp(join(tmpdir(),'prevlev-history-v1-'));directories.push(dir);return dir;};
const videos=(views?:number)=>[{id:'abcdefghijk',title:'Observado',url:'https://www.youtube.com/watch?v=abcdefghijk',source:'youtube-dom',...(views===undefined?{}:{views})}];
const data=(result:Awaited<ReturnType<typeof handleHistory>>)=>result.data as {records:Observation[];total:number;recorded:number;duplicates:number;evicted:number;skippedApi:number;skippedUnknown:number;deleted:number;legacyFilesDeleted:number;legacyFilesSkipped:number;observations?:unknown[]};
afterEach(async()=>{await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));vi.unstubAllGlobals();});

describe('histórico próprio de observações locais',()=>{
  it('lê sem criar arquivos e recusa persistência de métricas da API oficial',async()=>{
    const dir=await directory(),dataDir=join(dir,'not-created');const network=vi.fn();vi.stubGlobal('fetch',network);
    expect(data(await readHistory({}, {dataDir})).records).toEqual([]);
    const rejected=await handleHistory({action:'record',videos:[{...videos(10)[0],source:'youtube-data-api'}]},{dataDir},1000);
    expect(rejected).toMatchObject({status:'error',error:expect.stringContaining('youtube-data-api'),data:{recorded:0,skippedApi:1}});
    await expect(stat(dataDir)).rejects.toMatchObject({code:'ENOENT'});expect(network).not.toHaveBeenCalled();
  });
  it('registra zeros reais, marca a gravação e não preenche contagens ausentes',async()=>{
    const dataDir=await directory();
    const recorded=await handleHistory({action:'record',videos:[{...videos(0)[0],subscribers:0},{id:'second',title:'Só inscritos',source:'public-page',subscribers:1234},...videos()]},{dataDir},1000);
    expect(recorded.status).toBe('ok');expect(data(recorded)).toMatchObject({recorded:2,skippedUnknown:1});
    const stored=data(await readHistory({}, {dataDir})).records;
    expect(stored.find(row=>row.videoId==='abcdefghijk')).toMatchObject({views:0,subscribers:0,observedAt:'1970-01-01T00:00:01.000Z',recordedAt:'1970-01-01T00:00:01.000Z',source:'youtube-dom'});
    expect(stored.find(row=>row.videoId==='second')).not.toHaveProperty('views');expect(stored[0].id).toMatch(/^[a-f\d-]{36}$/);
    expect(JSON.parse(await readFile(join(dataDir,'observations-v1.json'),'utf8')).version).toBe(1);
    if(process.platform!=='win32')expect((await stat(join(dataDir,'observations-v1.json'))).mode&0o777).toBe(0o600);
    expect((await readdir(dataDir)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
  });
  it('omite fontes oficiais em lote misto e não cria registro sem contagens',async()=>{
    const dir=await directory(),dataDir=join(dir,'unknown');
    expect(data(await handleHistory({action:'record',videos:videos()},{dataDir},1000))).toMatchObject({recorded:0,skippedUnknown:1});await expect(stat(dataDir)).rejects.toMatchObject({code:'ENOENT'});
    const result=await handleHistory({action:'record',videos:[...videos(20),{...videos(30)[0],source:'youtube-data-api'}]},{dataDir},1000);
    expect(data(result)).toMatchObject({recorded:1,skippedApi:1});expect(data(await readHistory({}, {dataDir})).records).toHaveLength(1);
  });
  it('preserva o instante de coleta e não inventa outro ponto ao salvar uma amostra antiga de novo',async()=>{
    const dataDir=await directory(),sample=videos(20).map(video=>({...video,observedAt:'1970-01-01T00:00:01Z'}));
    const first=await handleHistory({action:'record',videos:sample},{dataDir},2000);expect(data(first).records[0]).toMatchObject({observedAt:'1970-01-01T00:00:01Z',recordedAt:'1970-01-01T00:00:02.000Z'});
    expect(data(await handleHistory({action:'record',videos:sample},{dataDir},3000))).toMatchObject({recorded:0,duplicates:1});
    expect(data(await readHistory({}, {dataDir})).records).toHaveLength(1);
    for(const observedAt of ['2040-01-01T00:00:00Z','1970-02-30T00:00:00Z','1970-01-01','1970-01-01T00:00:01'])expect(await handleHistory({action:'record',videos:videos(30).map(video=>({...video,observedAt}))},{dataDir},4000)).toMatchObject({status:'error'});
    const exported=data(await handleHistory({action:'export'},{dataDir})).records;expect(exported[0].observedAt).toBe('1970-01-01T00:00:01Z');expect(exported[0].recordedAt).toBe('1970-01-01T00:00:02.000Z');
  });
  it('serializa gravações concorrentes e só deduplica a mesma amostra no mesmo instante',async()=>{
    const dataDir=await directory();
    const results=await Promise.all(Array.from({length:20},(_,index)=>handleHistory({action:'record',videos:videos(index)},{dataDir},1000+index)));
    expect(results.every(result=>result.status==='ok')).toBe(true);expect(data(await readHistory({}, {dataDir})).records).toHaveLength(20);
    expect(data(await handleHistory({action:'record',videos:videos(19)},{dataDir},1019))).toMatchObject({recorded:0,duplicates:1});
    expect(data(await handleHistory({action:'record',videos:videos(19)},{dataDir},2000))).toMatchObject({recorded:1});
    const all=data(await handleHistory({action:'get',videoId:'abcdefghijk'},{dataDir})).records;expect(all).toHaveLength(21);expect(all[0].observedAt).toBe('1970-01-01T00:00:02.000Z');
  });
  it('aplica retenção e exporta JSON sem caminhos internos',async()=>{
    const dataDir=await directory();for(let i=0;i<5;i++)await handleHistory({action:'record',videos:videos(i)},{dataDir,historyMaxRecords:3},1000+i);
    const listed=await readHistory({limit:2},{dataDir});expect(data(listed).records.map(row=>row.views)).toEqual([4,3]);expect(data(listed).total).toBe(3);
    const exported=await handleHistory({action:'export'},{dataDir});expect(data(exported).records.map(row=>row.views)).toEqual([4,3,2]);expect(JSON.stringify(exported)).not.toContain(dataDir);
    expect(await readHistory({limit:501},{dataDir})).toMatchObject({status:'error'});expect(await handleHistory({action:'list'},{dataDir,historyMaxRecords:5001})).toMatchObject({status:'error'});
  });
  it('não conta como gravada uma amostra antiga descartada imediatamente pela retenção',async()=>{
    const dataDir=await directory(),config={dataDir,historyMaxRecords:1};
    await handleHistory({action:'record',videos:videos(20).map(video=>({...video,observedAt:'1970-01-01T00:00:02Z'}))},config,3000);
    const older=await handleHistory({action:'record',videos:videos(10).map(video=>({...video,observedAt:'1970-01-01T00:00:01Z'}))},config,4000);
    expect(data(older)).toMatchObject({recorded:0,evicted:1,records:[]});expect(data(await readHistory({},config)).records.map(row=>row.views)).toEqual([20]);
  });
  it('valida o lote antes da gravação e não revela detalhes de erros',async()=>{
    const dataDir=await directory();await handleHistory({action:'record',videos:videos(10)},{dataDir},1000);const original=await readFile(join(dataDir,'observations-v1.json'),'utf8');
    for(const views of [-1,Infinity,'10'])expect(await handleHistory({action:'record',videos:[{...videos(10)[0],views}]},{dataDir},2000)).toMatchObject({status:'error'});
    expect(await handleHistory({action:'record',videos:[{...videos(10)[0],id:'../../private-token'}]},{dataDir},2000)).toMatchObject({status:'error',error:expect.not.stringContaining(dataDir)});
    expect(await handleHistory({action:'record',videos:[{...videos(10)[0],url:'file:///private'}]},{dataDir},2000)).toMatchObject({status:'error'});
    expect(await readFile(join(dataDir,'observations-v1.json'),'utf8')).toBe(original);
  });
  it('não sobrescreve JSON inválido, arquivos enormes ou links simbólicos',async()=>{
    const dataDir=await directory(),file=join(dataDir,'observations-v1.json');await writeFile(file,'{invalid');
    expect(await handleHistory({action:'record',videos:videos(10)},{dataDir},1000)).toMatchObject({status:'error'});expect(await readFile(file,'utf8')).toBe('{invalid');
    await writeFile(file,'x'.repeat(10*1024*1024+1));expect(await readHistory({}, {dataDir})).toMatchObject({status:'error',error:expect.stringContaining('10 MiB')});
    await rm(file);const outside=join(dataDir,'private.json');await writeFile(outside,'PRIVATE_TOKEN');await symlink(outside,file);
    const rejected=await readHistory({}, {dataDir});expect(rejected.status).toBe('error');expect(JSON.stringify(rejected)).not.toContain('PRIVATE_TOKEN');expect(await readFile(outside,'utf8')).toBe('PRIVATE_TOKEN');
  });
  it('preserva arquivos antigos, combina por ID e exclui somente arquivos reconhecidos após confirmação',async()=>{
    const dataDir=await directory(),id='abcdefghijk',filename=join(dataDir,`${createHash('sha256').update(id).digest('hex')}.json`),legacy=JSON.stringify([{observedAt:'1970-01-01T00:00:01.000Z',views:50,source:'user-provided-observation'}]);
    await writeFile(filename,legacy);await handleHistory({action:'record',videos:videos(75)},{dataDir},2000);
    const combined=await handleHistory({action:'get',videoId:id},{dataDir});expect(data(combined).records.map(row=>row.views)).toEqual([75,50]);expect(await readFile(filename,'utf8')).toBe(legacy);
    expect(data(await readHistory({}, {dataDir})).records).toHaveLength(1);expect(data(await legacyHistory({videoId:id},dataDir,3000)).observations).toEqual([{observedAt:'1970-01-01T00:00:01.000Z',views:50,source:'user-provided-observation'},{observedAt:'1970-01-01T00:00:02.000Z',views:75,source:'youtube-dom'}]);
    expect(await handleHistory({action:'delete',videoId:id},{dataDir})).toMatchObject({status:'error'});expect(data(await handleHistory({action:'get',videoId:id},{dataDir})).records).toHaveLength(2);
    await writeFile(join(dataDir,'unrelated.txt'),'KEEP');const unrelatedHash=join(dataDir,`${'a'.repeat(64)}.json`);await writeFile(unrelatedHash,'{"private":"KEEP"}');
    expect(data(await handleHistory({action:'delete',videoId:id,confirm:true},{dataDir}))).toMatchObject({deleted:1,legacyFilesDeleted:1});await expect(stat(filename)).rejects.toMatchObject({code:'ENOENT'});
    expect(data(await handleHistory({action:'delete',confirm:true},{dataDir}))).toMatchObject({legacyFilesSkipped:1});expect(await readFile(join(dataDir,'unrelated.txt'),'utf8')).toBe('KEEP');expect(await readFile(unrelatedHash,'utf8')).toContain('KEEP');
  });
});
