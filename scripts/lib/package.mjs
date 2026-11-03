import {readFile,mkdir,writeFile,readdir,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
export const EXTENSION_FILES=Object.freeze(['background.js','content.js','manifest.json','popup.html','popup.js','ui.css','workspace.html','workspace.js']);
const sha256=value=>createHash('sha256').update(value).digest('hex');
/** ZIP32 store format: deterministic ordering/UTC epoch, UTF-8 names, no host metadata. */
export function createZip(input){
  if(!Array.isArray(input)||input.length>1000)throw new Error('Número inválido de arquivos no pacote.');
  const entries=[...input].sort((a,b)=>a.name.localeCompare(b.name,'en')),seen=new Set(),parts=[],central=[];let offset=0;
  for(const entry of entries){
    if(typeof entry.name!=='string'||!entry.name||entry.name.length>200||entry.name.startsWith('/')||entry.name.includes('\\')||entry.name.split('/').some(part=>!part||part==='.'||part==='..')||!/^[-\w./]+$/.test(entry.name)||seen.has(entry.name))throw new Error('Nome de arquivo inseguro ou duplicado.');seen.add(entry.name);
    const bytes=Buffer.from(entry.data),name=Buffer.from(entry.name,'utf8');if(bytes.length>50*1024*1024)throw new Error('Arquivo grande demais para o pacote.');
    const crc=crc32(bytes),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    parts.push(header,name,bytes);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x0800,8);directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(bytes.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(0x20,38);directory.writeUInt32LE(offset,42);central.push(directory,name);offset+=header.length+name.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);
}
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^(value&1?0xedb88320:0);}return(value^0xffffffff)>>>0;}
export async function packageExtension({root=process.cwd(),outputDir}={}){
  const base=resolve(root),dist=join(base,'dist'),destination=resolve(outputDir??join(base,'artifacts'));
  const actual=(await readdir(dist)).sort();if(JSON.stringify(actual)!==JSON.stringify([...EXTENSION_FILES].sort()))throw new Error('dist contém arquivos inesperados ou incompletos. Gere um build limpo antes de empacotar.');
  for(const name of EXTENSION_FILES){const file=await lstat(join(dist,name));if(!file.isFile()||file.isSymbolicLink())throw new Error('O pacote aceita somente arquivos regulares do build, sem links simbólicos.');}
  const manifest=JSON.parse(await readFile(join(dist,'manifest.json'),'utf8')),pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'));
  if(!/^\d+\.\d+\.\d+$/.test(pkg.version)||manifest.version!==pkg.version||manifest.manifest_version!==3)throw new Error('Manifesto e pacote precisam declarar a mesma versão MV3.');
  const entries=[];for(const name of EXTENSION_FILES)entries.push({name,data:await readFile(join(dist,name))});
  entries.push({name:'INSTALAR.txt',data:Buffer.from(`Prevlev ${pkg.version}\n\n1. Extraia todos os arquivos deste ZIP em uma pasta.\n2. Abra chrome://extensions no Chrome e ative Modo do desenvolvedor.\n3. Clique Carregar sem compactação e escolha a pasta que contém manifest.json.\n4. Recarregue suas abas YouTube/Studio. Use o ícone Prevlev para abrir o painel.\n\nAs ferramentas locais não exigem backend. IA e pesquisa oficial exigem configuração opcional do servidor conforme README do repositório. Nenhuma chave está incluída.\nPolíticas do seu navegador podem impedir extensões de desenvolvimento; este pacote não altera essas políticas.\n\nFonte e limites: https://github.com/onclickgrimes/prevlev\n`,'utf8')});
  const hashes=entries.map(({name,data})=>({name,bytes:data.length,sha256:sha256(data)}));
  entries.push({name:'SHA256SUMS.json',data:Buffer.from(JSON.stringify({version:pkg.version,files:hashes},null,2)+'\n')});
  const zip=createZip(entries),filename=`prevlev-extension-${pkg.version}.zip`,file=join(destination,filename);await mkdir(destination,{recursive:true});await writeFile(file,zip);await writeFile(`${file}.sha256`,`${sha256(zip)}  ${filename}\n`);return{file,sha256:sha256(zip),bytes:zip.length,files:hashes};
}
