import {test,expect,chromium,type Browser,type Page,type BrowserContext} from "@playwright/test";
import {build} from "esbuild";
import {existsSync} from "node:fs";
let browser:Browser,context:BrowserContext,page:Page,bundle:string;
test.beforeAll(async()=>{
  bundle=(await build({stdin:{contents:`import {mountRemoteImages} from './src/ui/remote-images';
window.renderer=mountRemoteImages(document.querySelector('#images'));
window.srcCount=0; const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){window.srcCount++;src.set.call(this,value);}});
window.tiny=()=>new Promise(resolve=>{const c=document.createElement('canvas');c.width=2;c.height=2;c.getContext('2d').fillRect(0,0,2,2);resolve(c.toDataURL().split(',')[1]);});`,resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"iife"})).outputFiles[0].text;
  browser=await chromium.launch({executablePath:existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
  context=await browser.newContext(); await context.route('**/*',route=>{
    if(route.request().url()==='https://preview.test/')return route.fulfill({contentType:'text/html',body:'<div id="images"></div><script src="/fixture.js"></script>'});
    if(route.request().url()==='https://preview.test/fixture.js')return route.fulfill({contentType:'text/javascript',body:bundle});
    return route.abort();
  }); page=await context.newPage(); await page.goto('https://preview.test/');
});
test.afterEach(async()=>{await context.close();});
type Fixture=Window&{renderer:ReturnType<typeof import('../../src/ui/remote-images').mountRemoteImages>;tiny:()=>Promise<string>;srcCount:number};
test('backend oversized pixels, malformed bytes, URLs and multiple results never reach img.src',async()=>{
  const result=await page.evaluate(async()=>{
    const win=window as unknown as Fixture,small=await win.tiny(),bytes=Uint8Array.from(atob(small),c=>c.charCodeAt(0));
    new DataView(bytes.buffer).setUint32(16,8000);new DataView(bytes.buffer).setUint32(20,8000);
    const huge=btoa(String.fromCharCode(...bytes));
    const cases=[[{mime:'image/png',base64:huge}],[{mime:'image/png',base64:'aW52YWxpZA=='}],[{url:'https://never-fetch.test/image.png'}],[{mime:'image/png',base64:small},{mime:'image/png',base64:small}]];
    const errors=[]; for(const images of cases){try{await win.renderer.validate({status:'ok',source:'fixture',data:{images}},true);}catch(error){errors.push((error as Error).message);}}
    return {errors,src:win.srcCount};
  }); expect(result.errors).toHaveLength(4);expect(result.src).toBe(0);await expect(page.locator('#images img')).toHaveCount(0);
});
test('a validated response reopens locally and replacement clears old preview before waiting',async()=>{
  const result=await page.evaluate(async()=>{
    const win=window as unknown as Fixture,response={status:'ok' as const,source:'fixture',data:{images:[{mime:'image/png',base64:await win.tiny()}]}};
    await win.renderer.show(response); const before=document.querySelectorAll('#images img').length;
    const original=HTMLImageElement.prototype.decode;let finish!:()=>void;
    HTMLImageElement.prototype.decode=()=>new Promise<void>(resolve=>{finish=resolve;});
    const pending=win.renderer.show(response);await new Promise(resolve=>setTimeout(resolve,20));
    const during=document.querySelectorAll('#images img').length;win.renderer.invalidate();finish();await pending;
    HTMLImageElement.prototype.decode=original;
    await win.renderer.show(response);
    return {before,during,after:document.querySelectorAll('#images img').length};
  });expect(result).toEqual({before:1,during:0,after:1});
});
