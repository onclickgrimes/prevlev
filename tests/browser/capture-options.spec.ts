import {test,expect,chromium,type Browser} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';

let browser:Browser,script:string;
test.beforeAll(async()=>{
  script=(await build({stdin:{contents:`import {initCaptureOptions} from './src/ui/capture-options'; Object.assign(window,{getCategories:initCaptureOptions()});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
  browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test('category controls are usable, scoped and make no network requests',async()=>{
  const context=await browser.newContext();const external:string[]=[];
  await context.route('**/*',route=>{const url=route.request().url();if(url==='http://localhost:9398/')return route.fulfill({contentType:'text/html',body:'<label><input id="redact" type="checkbox" checked> Ocultar</label><script src="/fixture.js"></script>'});if(url==='http://localhost:9398/fixture.js')return route.fulfill({contentType:'text/javascript',body:script});external.push(url);return route.abort();});
  const page=await context.newPage();await page.goto('http://localhost:9398/');
  await expect(page.getByText('Campos a ocultar no card capturado')).toBeVisible();
  await expect(page.getByText(/não garante anonimização completa/)).toBeVisible();
  await page.getByLabel('Canal',{exact:true}).uncheck();await page.getByLabel('Receita',{exact:true}).uncheck();
  expect(await page.evaluate(()=>(window as unknown as {getCategories:()=>string[]}).getCategories())).toEqual(['subscribers','views','video-info']);
  await page.locator('#redact').uncheck();await expect(page.getByLabel('Visualizações',{exact:true})).toBeDisabled();
  expect(external).toEqual([]);await context.close();
});
