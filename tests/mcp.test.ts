import {afterEach,describe,expect,it,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {InMemoryTransport,type McpServer} from '@modelcontextprotocol/server';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createPrevlevMcpServer,mcpConfigFromEnv,type McpDependencies} from '../server/mcp.mjs';
import {handleHistory} from '../server/history.mjs';

const clients:Client[]=[];const servers:McpServer[]=[];const dirs:string[]=[];
afterEach(async()=>{await Promise.all(clients.splice(0).map(client=>client.close()));await Promise.all(servers.splice(0).map(server=>server.close()));await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));vi.unstubAllGlobals();vi.restoreAllMocks();});
async function directory(){const dir=await mkdtemp(join(tmpdir(),'prevlev-mcp-'));dirs.push(dir);return dir;}
async function connect(deps:McpDependencies={},dataDir?:string){
 const server=createPrevlevMcpServer({enabled:true,dataDir:dataDir??await directory()},deps);servers.push(server);
 const [a,b]=InMemoryTransport.createLinkedPair();const client=new Client({name:'prevlev-fixture',version:'1.0.0'});clients.push(client);
 await server.connect(b);await client.connect(a);return client;
}
const videos=[{id:'dQw4w9WgXcQ',title:'Python para iniciantes',channel:'Código',channelId:'code',views:300,source:'youtube-dom'},{id:'aqz-KE-bpKQ',title:'Python para dados',channel:'Dados',channelId:'data',views:100,source:'user-provided'}];
function structured(value:Awaited<ReturnType<Client['callTool']>>):Record<string,unknown>{return value.structuredContent as Record<string,unknown>;}

describe('MCP optional local protocol',()=>{
 it('is disabled by default and does not accept truthy nonboolean config',()=>{
   expect(mcpConfigFromEnv({})).toMatchObject({enabled:false});expect(mcpConfigFromEnv({MCP_ENABLED:'1'}).enabled).toBe(false);expect(mcpConfigFromEnv({MCP_ENABLED:'true'}).enabled).toBe(true);
   expect(()=>createPrevlevMcpServer()).toThrow('desativado');expect(()=>createPrevlevMcpServer({enabled:false})).toThrow('desativado');
 });
 it('disabled CLI/import has no stdout or local data side effects',async()=>{
   const dir=await directory(),script=resolve('server/mcp.mjs');
   let outcome:unknown;
   try{execFileSync(process.execPath,[script],{cwd:dir,env:{MCP_ENABLED:'false',DATA_DIR:join(dir,'missing'),OMNI_API_KEY:'inherited-secret-fixture'},encoding:'utf8',stdio:'pipe'});}catch(error){outcome=error;}
   expect(outcome).toMatchObject({status:1,stdout:'',stderr:expect.stringContaining('desativado')});expect(String((outcome as {stderr:string}).stderr)).not.toContain('inherited-secret-fixture');
   const output=execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(script).href)})`],{cwd:dir,env:{MCP_ENABLED:'true',DATA_DIR:join(dir,'missing')},encoding:'utf8'});
   expect(output).toBe('');expect(await readdir(dir)).toEqual([]);
 });
 it('performs actual initialization, lists only readonly tools, and calls local analysis with zero fetch',async()=>{
   const fetcher=vi.fn().mockRejectedValue(new Error('network forbidden'));vi.stubGlobal('fetch',fetcher);
   const client=await connect();expect(client.getServerVersion()?.name).toBe('prevlev-local');
   const tools=await client.listTools();expect(tools.tools.map(tool=>tool.name)).toEqual(['prevlev_capabilities','analyze_dataset','history_list','history_get','history_export']);
   for(const tool of tools.tools)expect(tool.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,openWorldHint:false});
   const capabilities=structured(await client.callTool({name:'prevlev_capabilities',arguments:{}}));expect(capabilities.data).toMatchObject({network:false,ai:false,readOnly:true,channelMutations:false});
   const result=structured(await client.callTool({name:'analyze_dataset',arguments:{feature:'channel-report',videos}}));expect(result).toMatchObject({status:'ok',source:'prevlev:dataset',data:{videoCount:2,totalObservedViews:400}});expect(fetcher).not.toHaveBeenCalled();
 });
 it('rejects unknown tools, fields, oversized input and API-derived metrics before running analysis',async()=>{
   const analyze=vi.fn<NonNullable<McpDependencies['analyzeDataset']>>().mockResolvedValue({status:'ok',source:'fixture'});const client=await connect({analyzeDataset:analyze});
   for(const input of [{feature:'thumbnail-generation',videos},{feature:'channel-report',videos,path:'/etc/passwd'},{feature:'channel-report',videos:Array.from({length:501},()=>videos[0])},{feature:'sponsorships',text:'x'.repeat(100001)}]){
     const result=await client.callTool({name:'analyze_dataset',arguments:input});expect(result.isError).toBe(true);
   }
   await expect(client.callTool({name:'history_delete',arguments:{}})).rejects.toThrow();
   const excluded=await client.callTool({name:'analyze_dataset',arguments:{feature:'channel-report',videos:[{...videos[0],source:'youtube-data-api'}]}});expect(excluded.isError).toBe(true);expect(JSON.stringify(excluded)).toContain('youtube-data-api');expect(analyze).not.toHaveBeenCalled();
 });
 it('preserves validated text provenance without accepting undeclared transcript or metadata fields',async()=>{
   const fetcher=vi.fn().mockRejectedValue(new Error('network forbidden'));vi.stubGlobal('fetch',fetcher);
   const client=await connect();
   const result=structured(await client.callTool({name:'analyze_dataset',arguments:{feature:'sponsorships',text:'Sponsored by Acme.',source:'public-page'}}));
   expect(result).toMatchObject({status:'ok',data:{inputSource:'public-page'}});
   for(const extra of [{metadata:{source:'user-provided'}},{transcript:{videoId:'abcdefghijk',segments:[{start:10,text:'Sponsored by Acme.'}]}}])expect((await client.callTool({name:'analyze_dataset',arguments:{feature:'sponsorships',text:'Sponsored by Acme.',source:'user-provided',...extra}})).isError).toBe(true);
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('history methods share only read helper, cap output, never expose paths or inherited provider keys',async()=>{
   const dataDir=await directory(),read=vi.fn<NonNullable<McpDependencies['readHistory']>>().mockResolvedValue({status:'ok',source:'prevlev:history',data:{records:[{videoId:'dQw4w9WgXcQ',views:40,source:'youtube-dom'}],total:1},limitations:['Fixture local']});
   const client=await connect({readHistory:read},dataDir);
   expect((await client.callTool({name:'history_list',arguments:{limit:500}})).isError).not.toBe(true);
   expect(read).toHaveBeenLastCalledWith({limit:500},{dataDir,historyMaxRecords:5000});
   await client.callTool({name:'history_get',arguments:{videoId:'dQw4w9WgXcQ',limit:2}});expect(read).toHaveBeenLastCalledWith({videoId:'dQw4w9WgXcQ',limit:2},{dataDir,historyMaxRecords:5000});
   const exported=await client.callTool({name:'history_export',arguments:{limit:1}});expect(structured(exported).data).toMatchObject({bounded:true,format:'json',limit:1});expect(JSON.stringify(exported)).not.toContain(dataDir);expect(await readdir(dataDir)).toEqual([]);
   const count=read.mock.calls.length;expect((await client.callTool({name:'history_list',arguments:{limit:501}})).isError).toBe(true);expect(read).toHaveBeenCalledTimes(count);
   read.mockRejectedValue(new Error('OMNI_KEY=secret /private/credentials'));const failed=await client.callTool({name:'history_list',arguments:{}});expect(failed.isError).toBe(true);expect(JSON.stringify(failed)).not.toMatch(/OMNI_KEY|credentials|secret/);
 });
 it('reads an absent real history store without creating directories',async()=>{
   const dir=await directory(),dataDir=join(dir,'absent');const client=await connect({},dataDir);
   const response=await client.callTool({name:'history_list',arguments:{limit:2}});expect(structured(response)).toMatchObject({status:'ok',data:{records:[]}});expect(await readdir(dir)).toEqual([]);
 });
 it('reads and exports real fixture observations without changing existing history',async()=>{
   const dataDir=await directory();
   const recorded=await handleHistory({action:'record',videos}, {dataDir},Date.parse('2026-11-03T00:00:00.000Z'));expect(recorded.status).toBe('ok');
   const filename=join(dataDir,'observations-v1.json'),before=await readFile(filename,'utf8');
   const fetcher=vi.fn().mockRejectedValue(new Error('external calls forbidden'));vi.stubGlobal('fetch',fetcher);
   const client=await connect({},dataDir);
   const listed=structured(await client.callTool({name:'history_list',arguments:{limit:1}}));expect(listed).toMatchObject({status:'ok',data:{total:2}});expect((listed.data as {records:unknown[]}).records).toHaveLength(1);
   const got=structured(await client.callTool({name:'history_get',arguments:{videoId:'dQw4w9WgXcQ'}}));expect(got).toMatchObject({status:'ok',data:{total:1,records:[{videoId:'dQw4w9WgXcQ',views:300,source:'youtube-dom'}]}});
   const exported=structured(await client.callTool({name:'history_export',arguments:{limit:500}}));expect(exported).toMatchObject({status:'ok',data:{bounded:true,total:2}});
   expect(await readFile(filename,'utf8')).toBe(before);expect(fetcher).not.toHaveBeenCalled();
 });
 it('supports actual stdio client initialize/list/call without npm banner or external service',async()=>{
   const dataDir=await directory();await writeFile(join(dataDir,'fixture-marker'),'unchanged');
   const transport=new StdioClientTransport({command:process.execPath,args:[resolve('server/mcp.mjs')],env:{MCP_ENABLED:'true',DATA_DIR:dataDir,OMNI_API_KEY:'never-expose-inherited-key'},stderr:'pipe'});
   const client=new Client({name:'prevlev-stdio-fixture',version:'1.0.0'});clients.push(client);await client.connect(transport);
   expect((await client.listTools()).tools).toHaveLength(5);const response=await client.callTool({name:'prevlev_capabilities',arguments:{}});expect(structured(response).status).toBe('ok');expect(JSON.stringify(response)).not.toContain('never-expose-inherited-key');expect(await readdir(dataDir)).toEqual(['fixture-marker']);
 });
 it('also negotiates the current 2026-07-28 protocol over the official stdio factory',async()=>{
   const dataDir=await directory();
   const transport=new StdioClientTransport({command:process.execPath,args:[resolve('server/mcp.mjs')],env:{MCP_ENABLED:'true',DATA_DIR:dataDir},stderr:'pipe'});
   const client=new Client({name:'prevlev-modern-fixture',version:'1.0.0'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});clients.push(client);
   await client.connect(transport);expect(client.getProtocolEra()).toBe('modern');expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
   expect((await client.listTools()).tools).toHaveLength(5);expect(structured(await client.callTool({name:'history_list',arguments:{limit:1}}))).toMatchObject({status:'ok',data:{records:[]}});expect(await readdir(dataDir)).toEqual([]);
 });
});
