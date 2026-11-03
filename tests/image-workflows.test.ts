import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildCyclicVersions,compressToTarget,findCompressionCandidate,type CompressionCandidate} from '../src/core/image-workflows';

afterEach(()=>vi.useRealTimers());
const blob=(bytes:number,type='image/jpeg')=>new Blob([new Uint8Array(bytes)],{type});
describe('bounded search for actual encoded byte sizes',()=>{
  it('rejects a tiny 64MP PNG before invoking the browser decoder or allocating a canvas',async()=>{
    const data=new Uint8Array(57),view=new DataView(data.buffer);
    data.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);data.set(new TextEncoder().encode('IHDR'),12);view.setUint32(16,8000);view.setUint32(20,8000);data[24]=8;data[25]=6;data.set(new TextEncoder().encode('IDAT'),37);data.set(new TextEncoder().encode('IEND'),49);
    const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode);
    try{await expect(compressToTarget(new Blob([data],{type:'image/png'}),{targetBytes:10000})).rejects.toThrow('32 megapixels');expect(decode).not.toHaveBeenCalled();}
    finally{vi.unstubAllGlobals();}
  });
  it('uses actual bytes, aspect-preserving dimensions and stops once target is met',async()=>{
    const encode=vi.fn(async()=>blob(900));
    const result=await findCompressionCandidate({width:1920,height:1080},{targetBytes:1000,maxWidth:1280,maxHeight:720,quality:0.9},encode);
    expect(result).toMatchObject({targetMet:true,bytes:900,width:1280,height:720,quality:0.9,iterations:1,reason:'target-met'});expect(encode).toHaveBeenCalledOnce();
  });
  it('reports an impossible target honestly at the iteration bound',async()=>{
    const encode=vi.fn(async(_candidate:CompressionCandidate)=>blob(1200));
    const result=await findCompressionCandidate({width:800,height:450},{targetBytes:1,maxIterations:3,quality:0.9},encode);
    expect(result).toMatchObject({targetMet:false,bytes:1200,iterations:3,reason:'iteration-limit'});expect(encode).toHaveBeenCalledTimes(3);
    expect(encode.mock.calls.map(([candidate])=>candidate.quality)).toEqual([0.9,0.7,0.5]);
  });
  it('reduces resolution for PNG without pretending quality controls its bytes',async()=>{
    const candidates:Array<{width:number;height:number;quality?:number}>=[];
    const result=await findCompressionCandidate({width:100,height:50},{targetBytes:1,type:'image/png',maxIterations:3},async candidate=>{candidates.push(candidate);return blob(candidate.width*candidate.height,'image/png');});
    expect(candidates).toEqual([{width:100,height:50,type:'image/png'},{width:80,height:40,type:'image/png'},{width:64,height:32,type:'image/png'}]);
    expect(result).toMatchObject({targetMet:false,bytes:2048,width:64,height:32,iterations:3});expect(result.quality).toBeUndefined();
  });
  it('keeps the best measured candidate if the codec is not monotonic',async()=>{
    const sizes=[3000,1500,2400],encode=vi.fn(async()=>blob(sizes.shift()!));
    const result=await findCompressionCandidate({width:800,height:450},{targetBytes:1,maxIterations:3,quality:0.9},encode);
    expect(result).toMatchObject({bytes:1500,quality:0.7,targetMet:false});
  });
  it('returns the measured best effort on timeout and does not start another encode',async()=>{
    vi.useFakeTimers();let calls=0;
    const execution=findCompressionCandidate({width:800,height:450},{targetBytes:1,maxDurationMs:20},async()=>{calls++;return calls===1?blob(1200):new Promise<Blob>(()=>{});});
    await vi.advanceTimersByTimeAsync(21);expect(await execution).toMatchObject({targetMet:false,bytes:1200,reason:'time-limit',iterations:2});expect(calls).toBe(2);
  });
  it('honors cancellation before and during the codec without exposing a result',async()=>{
    const controller=new AbortController();controller.abort();const encode=vi.fn(async()=>blob(100));
    await expect(findCompressionCandidate({width:100,height:100},{targetBytes:200,signal:controller.signal},encode)).rejects.toMatchObject({name:'AbortError'});expect(encode).not.toHaveBeenCalled();
    const running=new AbortController();const work=findCompressionCandidate({width:100,height:100},{targetBytes:1,signal:running.signal},async()=>{running.abort();return blob(500);});
    await expect(work).rejects.toMatchObject({name:'AbortError'});
  });
  it('rejects invalid work bounds and unsupported codec fallbacks',async()=>{
    const encode=vi.fn(async()=>blob(10));
    for(const config of [{targetBytes:0},{targetBytes:1,maxIterations:41},{targetBytes:1,maxDurationMs:15001},{targetBytes:1,quality:0}])await expect(findCompressionCandidate({width:100,height:100},config,encode)).rejects.toThrow();
    expect(encode).not.toHaveBeenCalled();
    await expect(findCompressionCandidate({width:100,height:100},{targetBytes:100,type:'image/webp'},async()=>blob(10,'image/png'))).rejects.toThrow('formato solicitado');
  });
});
describe('cyclic image/title combinations',()=>{
  it('uses max counts and cycles each index instead of a Cartesian product',()=>{
    const images=[blob(1),blob(2),blob(3)];
    const variants=buildCyclicVersions(images,['Primeiro','Segundo'],'Canal');
    expect(variants).toHaveLength(3);expect(variants.map(item=>item.image)).toEqual(images);expect(variants.map(item=>item.title)).toEqual(['Primeiro','Segundo','Primeiro']);
    const titles=buildCyclicVersions(images.slice(0,2),['1','2','3','4']);expect(titles).toHaveLength(4);expect(titles.map(item=>item.image)).toEqual([images[0],images[1],images[0],images[1]]);
  });
  it('handles title-only changes, empty images and bounded inputs explicitly',()=>{
    const image=blob(1);expect(buildCyclicVersions([image],['A','B'])).toHaveLength(2);expect(buildCyclicVersions([],['A'])).toEqual([]);
    expect(()=>buildCyclicVersions(Array.from({length:7},()=>image),['A'])).toThrow('até 6');
    expect(()=>buildCyclicVersions([image],Array.from({length:7},()=> 'A'))).toThrow('até 6');
  });
});
