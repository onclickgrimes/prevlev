import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {lifetimeVph,outlierScore} from '../src/core/metrics';
import {buildAnalyticsReport} from '../src/core/analytics';
import {analyzeDataset} from '../server/analysis.mjs';
import type {VideoRecord} from '../src/shared/types';
const now=Date.parse('2026-11-03T02:00:00Z');
const video=(id:string,extra:Partial<VideoRecord>={}):VideoRecord=>({id,title:id,url:`https://www.youtube.com/watch?v=${id}`,views:100,publishedAt:'2026-11-03T01:30:00Z',...extra});
describe('shared observation semantics in browser and own backend',()=>{
  it.each(['2026-11-03T01:30:00Z','2026-11-03T02:00:00Z','2026-11-03T02:01:00Z','2026-02-30T00:00:00Z','not a date'])('keeps the same VPH for %s without a minimum one-hour age',async publishedAt=>{
    const v=video('aaaaaaaaaaa',{publishedAt});
    const server=await analyzeDataset('channel-report',{videos:[v]},{now});
    expect((server.data as {medianLifetimeVph:number|null}).medianLifetimeVph).toBe(lifetimeVph(v,now)??null);
    expect(buildAnalyticsReport([v],{now}).totals.medianLifetimeVph).toBe(lifetimeVph(v,now));
    if(publishedAt.endsWith('01:30:00Z'))expect(lifetimeVph(v,now)).toBe(200);
  });
  it('does not merge same-name channels with different IDs or contradictory identity URLs',async()=>{
    const videos=[video('aaaaaaaaaaa',{channel:'Same',channelId:'one'}),video('bbbbbbbbbbb',{channel:'Same',channelId:'two'}),video('ccccccccccc',{channel:'Same',channelId:'one',channelUrl:'https://www.youtube.com/channel/two'})];
    const local=buildAnalyticsReport(videos,{now}),server=await analyzeDataset('channel-report',{videos},{now});
    const channels=(server.data as {channels:{key:string;videoCount:number}[]}).channels;
    expect(channels.map(x=>[x.key,x.videoCount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))).toEqual(local.channels.map(x=>[x.key,x.videoCount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    expect(channels).toHaveLength(2);
    expect(outlierScore(videos[2],[...videos,...videos])).toBeUndefined();
  });
  it('bridges only explicit co-observed handle-to-ID aliases identically',async()=>{
    const videos=[video('aaaaaaaaaaa',{channelId:'one',channelUrl:'https://www.youtube.com/@Known'}),video('bbbbbbbbbbb',{channelUrl:'https://www.youtube.com/@known'}),video('ccccccccccc',{channel:'KNOWN'})];
    const local=buildAnalyticsReport(videos,{now}),server=await analyzeDataset('channel-report',{videos},{now});
    expect((server.data as {channels:{key:string;videoCount:number}[]}).channels.map(x=>[x.key,x.videoCount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))).toEqual(local.channels.map(x=>[x.key,x.videoCount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  });
  it('imports actual standalone TypeScript from the Node24 server without a bundler',()=>{
    const output=execFileSync(process.execPath,['--input-type=module','-e',"import {analyzeDataset} from './server/analysis.mjs';const r=await analyzeDataset('channel-report',{videos:[{id:'fixture',views:100,publishedAt:'2026-11-03T01:30:00Z'}]},{now:Date.parse('2026-11-03T02:00:00Z')});process.stdout.write(String(r.data.medianLifetimeVph))"],{cwd:process.cwd(),encoding:'utf8'});
    expect(output).toBe('200');
  });
});
