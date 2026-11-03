import type {McpServer} from '@modelcontextprotocol/server';
import type {RemoteResponse} from '../src/shared/types';
export interface McpConfig {enabled?:boolean;dataDir?:string;historyMaxRecords?:number;}
export interface McpDependencies {
 analyzeDataset?:(feature:string,payload:Record<string,unknown>)=>Promise<RemoteResponse>;
 readHistory?:(payload:{videoId?:string;limit?:number},options:{dataDir:string;historyMaxRecords?:number})=>Promise<RemoteResponse>;
}
export function mcpConfigFromEnv(env?:Record<string,string|undefined>):Required<McpConfig>;
export function createPrevlevMcpServer(config?:McpConfig,dependencies?:McpDependencies):McpServer;
export const serverMcp:typeof createPrevlevMcpServer;
