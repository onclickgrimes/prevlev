import {describe,it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createZip,packageExtension,EXTENSION_FILES} from '../scripts/lib/package.mjs';
import {diagnose} from '../scripts/lib/doctor.mjs';
const dirs:string[]=[];async function root(){const p=await mkdtemp(join(tmpdir(),'prevlev-dist-'));dirs.push(p);return p;}
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function fixture(){const dir=await root();await mkdir(join(dir,'dist'));await writeFile(join(dir,'package.json'),'{"version":"0.5.0"}');for(const file of EXTENSION_FILES)await writeFile(join(dir,'dist',file),file==='manifest.json'?'{"manifest_version":3,"version":"0.5.0"}':`own fixture ${file}`);await writeFile(join(dir,'.env'),'PREVLEV_TOKEN=PRIVATE_DO_NOT_DISTRIBUTE');return dir;}
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
