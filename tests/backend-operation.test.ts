import {afterEach,describe,expect,it,vi} from 'vitest';
import {callBackendOperation} from '../src/shared/backend';
import {defaultSettings} from '../src/shared/types';
const settings={...defaultSettings,backendUrl:'http://127.0.0.1:8787',backendToken:'fixture-local-token'};
afterEach(()=>vi.unstubAllGlobals());
describe('explicit backend operations',()=>{
  it('stays offline without configuration and rejects unknown routes',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    expect(await callBackendOperation(defaultSettings,'/v1/history',{action:'list'})).toMatchObject({status:'not_configured'});
    await expect(callBackendOperation(settings,'/v1/private' as '/v1/history',{})).rejects.toThrow('desconhecida');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('posts only to the configured origin with an explicit payload and no browser credentials',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'ok',source:'prevlev:history',data:{records:[]}})));vi.stubGlobal('fetch',fetcher);
    expect(await callBackendOperation(settings,'/v1/history',{action:'list',limit:500})).toMatchObject({status:'ok'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,options]=fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/v1/history');
    expect(options).toMatchObject({method:'POST',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer fixture-local-token'}});
    expect(JSON.parse(options.body)).toEqual({action:'list',limit:500});
  });
  it('does not retry or expose transport secrets on an offline backend',async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error('https://secret.invalid?key=leaked'));vi.stubGlobal('fetch',fetcher);
    await expect(callBackendOperation(settings,'/v1/youtube/search',{})).rejects.toThrow('Nenhuma repetição');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels before sending an already aborted operation and preserves AbortError',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const controller=new AbortController();controller.abort();
    await expect(callBackendOperation(settings,'/v1/youtube/search',{},controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('propagates cancellation while reading and bounds streamed/declared bodies',async()=>{
    const controller=new AbortController();
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{controller.abort();return new Response('{}');}));
    await expect(callBackendOperation(settings,'/v1/youtube/search',{},controller.signal)).rejects.toMatchObject({name:'AbortError'});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{headers:{'Content-Length':String(13*1024*1024)}})));
    await expect(callBackendOperation(settings,'/v1/history',{})).rejects.toThrow('limite de leitura');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array(12*1024*1024+1))));
    await expect(callBackendOperation(settings,'/v1/history',{})).rejects.toThrow('limite de leitura');
  });
  it('rejects incompatible/truncated responses and preserves explicit unavailable states',async()=>{
    for(const body of ['[]','{}','{"status":"ok","source":']){
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body)));
      await expect(callBackendOperation(settings,'/v1/history',{})).rejects.toThrow();
    }
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'not_configured',source:'youtube-data-api',error:'Ative a fonte no servidor.'}))));
    expect(await callBackendOperation(settings,'/v1/youtube/search',{})).toMatchObject({status:'not_configured'});
  });
});
