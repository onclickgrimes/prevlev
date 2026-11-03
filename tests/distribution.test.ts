import {describe,it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createZip,packageExtension,EXTENSION_FILES} from '../scripts/lib/package.mjs';
import {diagnose} from '../scripts/lib/doctor.mjs';
const dirs:string[]=[];async function root(){const p=await mkdtemp(join(tmpdir(),'prevlev-dist-'));dirs.push(p);return p;}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const manifestFixture={manifest_version:3,version:'0.5.0',background:{service_worker:'background.js',type:'module'},action:{default_popup:'popup.html'},options_page:'workspace.html',content_scripts:[{matches:['https://www.youtube.com/*'],js:['content.js']}]};
async function fixture(){const dir=await root();await mkdir(join(dir,'dist'));await writeFile(join(dir,'package.json'),'{"version":"0.5.0"}');for(const file of EXTENSION_FILES)await writeFile(join(dir,'dist',file),file==='manifest.json'?JSON.stringify(manifestFixture):file.endsWith('.html')?`<!doctype html><p>Own fixture ${file}</p><link rel="stylesheet" href="ui.css"><script src="${file==='popup.html'?'popup.js':'workspace.js'}"></script>`:file.endsWith('.css')?':root { --fixture: "own CSS"; }':`void ${JSON.stringify(`own fixture ${file}`)};`);await writeFile(join(dir,'.env'),'PREVLEV_TOKEN=PRIVATE_DO_NOT_DISTRIBUTE');return dir;}
describe('reproducible local distribution',()=>{
 it('produces identical ZIP/hash despite input order or file modification times',async()=>{
  expect(createZip([{name:'b',data:'two'},{name:'a',data:'one'}])).toEqual(createZip([{name:'a',data:'one'},{name:'b',data:'two'}]));
  const dir=await fixture(),a=await packageExtension({root:dir});const bytes=await readFile(a.file);await utimes(join(dir,'dist','content.js'),new Date(),new Date());const b=await packageExtension({root:dir});expect(b.sha256).toBe(a.sha256);expect(await readFile(b.file)).toEqual(bytes);
  expect(bytes.includes(Buffer.from('PRIVATE_DO_NOT_DISTRIBUTE'))).toBe(false);expect(bytes.includes(Buffer.from('INSTALAR.txt'))).toBe(true);expect(bytes.includes(Buffer.from('SHA256SUMS.json'))).toBe(true);expect(a.files.map(f=>f.name)).toContain('manifest.json');expect(await readFile(`${a.file}.sha256`,'utf8')).toContain(a.sha256);
 });
 it('rejects unexpected files, symlinks and version mismatches before creating an archive',async()=>{
  const dir=await fixture();await writeFile(join(dir,'dist','.env'),'secret');await expect(packageExtension({root:dir})).rejects.toThrow('inesperados');await rm(join(dir,'dist','.env'));
  await writeFile(join(dir,'dist','manifest.json'),'{"manifest_version":3,"version":"0.4.0"}');await expect(packageExtension({root:dir})).rejects.toThrow('mesma versão');
  await rm(join(dir,'dist','content.js'));await symlink(join(dir,'.env'),join(dir,'dist','content.js'));await expect(packageExtension({root:dir})).rejects.toThrow('links simbólicos');
 });
 it.each(['../.env','/absolute','a/../x','a\\x','a//x'])('refuses unsafe archive name %s',name=>{expect(()=>createZip([{name,data:'secret'}])).toThrow('inseguro');});
 it('does not emit diagnostics secrets or contact a port by default',async()=>{
  const dir=await fixture(),connect=vi.fn();const report=await diagnose({root:dir,env:{PORT:'8787',OMNI_BASE_URL:'http://user:PRIVATE@127.0.0.1:7814',AI_API_KEY:'PRIVATE_AI',YOUTUBE_API_KEY:'PRIVATE_YOUTUBE'},nodeVersion:'24.19.0',connect});
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE|user:/);expect(connect).not.toHaveBeenCalled();expect(report.networkProbed).toBe(false);expect(report.ok).toBe(false);
  expect(report.checks.find(c=>c.id==='omni')?.status).toBe('error');
 });
 it('distinguishes static configuration from runtime and catches unsupported Node/invalid port',async()=>{
  const dir=await root(),report=await diagnose({root:dir,env:{PORT:'99999',YOUTUBE_ENABLED:'true'},nodeVersion:'22.0.0'});
  expect(report.ok).toBe(false);expect(report.checks.filter(c=>c.status==='error').map(c=>c.id)).toEqual(['node','backend-port','youtube']);expect(report.checks.find(c=>c.id==='omni')?.message).toContain('não foram consultados');
 });
});

describe('material content and code-source checks before packaging',()=>{
 const syntheticTokens=[
  ['github-classic','ghp_'+'a'.repeat(36)],
  ['github-oauth','gho_'+'B'.repeat(36)],
  ['github-fine-grained','github_pat_'+'a'.repeat(22)+'_'+'b'.repeat(59)],
  ['google-api-key','AIza'+'C'.repeat(35)],
  ['aws-access-key-id','AKIA'+'A1'.repeat(8)],
  ['aws-session-key-id','ASIA'+'B2'.repeat(8)],
  ['openai-legacy','sk-'+'D'.repeat(48)],
 ] as const;
 it.each(syntheticTokens)('refuses fabricated %s material injected into allowed content.js without echoing it',async(_kind,secret)=>{
  const dir=await fixture();await writeFile(join(dir,'dist','content.js'),`const fabricatedCredential=${JSON.stringify(secret)};`);
  const error=await packageExtension({root:dir}).then(()=>undefined,error=>error as Error);
  expect(error).toBeInstanceOf(Error);expect(error?.message).toContain('credencial privada');expect(error?.message).not.toContain(secret);
  await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it.each(['PRIVATE KEY','RSA PRIVATE KEY','EC PRIVATE KEY','DSA PRIVATE KEY','OPENSSH PRIVATE KEY','ENCRYPTED PRIVATE KEY'])('refuses a fabricated complete %s PEM, including escaped newlines',async label=>{
  const dir=await fixture(),secret=`-----BEGIN ${label}-----\n${Buffer.alloc(48,67).toString('base64')}\n-----END ${label}-----`;
  await writeFile(join(dir,'dist','content.js'),`const fabricatedPem=${JSON.stringify(secret)};`);
  const error=await packageExtension({root:dir}).then(()=>undefined,error=>error as Error);
  expect(error?.message).toContain('credencial privada');expect(error?.message).not.toContain('Q0ND');expect(error?.message).not.toContain(secret);
  await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('permits ordinary names, warnings, placeholders and code-looking message strings without executing them',async()=>{
  const dir=await fixture(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  try{
   await writeFile(join(dir,'dist','content.js'),`const messages=${JSON.stringify({Nexlev:'Sem integração Nexlev',secrets:'Não compartilhe secrets ou credenciais',env:'OMNI_API_KEY=CHAVE_EXISTENTE',pem:'Não importe -----BEGIN PRIVATE KEY-----',example:'ghp_EXEMPLO_NAO_E_TOKEN',mapping:'//# sourceMappingURL=https://example.invalid/message.map',loader:'importScripts("https://example.invalid/message.js")'})};globalThis.__packageMustNotExecute='executed';`);
   await writeFile(join(dir,'dist','ui.css'),'p::before { content: "@import url(https://example.invalid/message.css)"; }');
   const result=await packageExtension({root:dir});expect(result.bytes).toBeGreaterThan(0);expect(fetcher).not.toHaveBeenCalled();expect((globalThis as typeof globalThis&{__packageMustNotExecute?:string}).__packageMustNotExecute).toBeUndefined();
  }finally{vi.unstubAllGlobals();}
 });
 it.each(['//# sourceMappingURL=https://example.invalid/hidden.map','//@ sourceMappingURL=content.js.map','/*# sourceMappingURL=data:application/json;base64,e30= */'])('refuses active source-map directive %s',async directive=>{
  const dir=await fixture();await writeFile(join(dir,'dist','content.js'),`void 0;\n${directive}`);await expect(packageExtension({root:dir})).rejects.toThrow('sourceMappingURL');await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('refuses source maps as extra archive inputs and CSS map directives',async()=>{
  const dir=await fixture();await writeFile(join(dir,'dist','content.js.map'),'{}');await expect(packageExtension({root:dir})).rejects.toThrow('inesperados');await rm(join(dir,'dist','content.js.map'));
  await writeFile(join(dir,'dist','ui.css'),'p { color:red } /*# sourceMappingURL=https://example.invalid/ui.css.map */');await expect(packageExtension({root:dir})).rejects.toThrow('sourceMappingURL');await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it.each(['import("https://example.invalid/remote.js");','importScripts("https://example.invalid/remote.js");','self.importScripts("not-bundled.js");','import value from "./not-bundled.js";','const modulePath="content.js";import(modulePath);','new Worker("https://example.invalid/worker.js");','new SharedWorker("not-packaged.js");'])('refuses non-allowlisted or unverifiable code-loading expression',async code=>{
  const dir=await fixture();await writeFile(join(dir,'dist','content.js'),code);await expect(packageExtension({root:dir})).rejects.toThrow('Referência de código');await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('validates manifest and inert HTML/CSS references without fetching or following them',async()=>{
  const dir=await fixture();await writeFile(join(dir,'dist','manifest.json'),JSON.stringify({...manifestFixture,background:{service_worker:'https://example.invalid/remote.js'}}));await expect(packageExtension({root:dir})).rejects.toThrow('Referência de código');
  await writeFile(join(dir,'dist','manifest.json'),JSON.stringify(manifestFixture));
  await writeFile(join(dir,'dist','popup.html'),'<script src="https://example.invalid/remote.js"></script>');await expect(packageExtension({root:dir})).rejects.toThrow('Referência de código');
  await writeFile(join(dir,'dist','popup.html'),'<base href="https://example.invalid/"><script src="popup.js"></script>');await expect(packageExtension({root:dir})).rejects.toThrow('Origem base');
  await writeFile(join(dir,'dist','popup.html'),'<link rel="stylesheet" href="https://example.invalid/remote.css"><script src="popup.js"></script>');await expect(packageExtension({root:dir})).rejects.toThrow('Referência de código');
  await writeFile(join(dir,'dist','popup.html'),'<script src="popup.js"></script>');await writeFile(join(dir,'dist','ui.css'),'@import url("https://example.invalid/remote.css");');await expect(packageExtension({root:dir})).rejects.toThrow('Importação CSS');
  await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('allows only packaged static module references and reports malformed JSON without private text',async()=>{
  const dir=await fixture();await writeFile(join(dir,'dist','content.js'),'import("./popup.js");');expect((await packageExtension({root:dir})).bytes).toBeGreaterThan(0);
  await rm(join(dir,'artifacts'),{recursive:true});await writeFile(join(dir,'dist','manifest.json'),'{PRIVATE_MARKER_NOT_FOR_ERRORS');const error=await packageExtension({root:dir}).then(()=>undefined,error=>error as Error);expect(error?.message).toContain('inválido');expect(error?.message).not.toContain('PRIVATE_MARKER');await expect(access(join(dir,'artifacts'))).rejects.toMatchObject({code:'ENOENT'});
 });
});
