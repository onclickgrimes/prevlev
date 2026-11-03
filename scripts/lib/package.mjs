import {readFile,mkdir,writeFile,readdir,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
export const EXTENSION_FILES=Object.freeze(['background.js','content.js','manifest.json','popup.html','popup.js','ui.css','workspace.html','workspace.js']);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const SCRIPT_FILES=new Set(['background.js','content.js','popup.js','workspace.js']);
const HTML_FILES=new Set(['popup.html','workspace.html']);
const TOKEN_PATTERNS=[
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}(?![A-Za-z0-9_])/,
  /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/,
  /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{48}(?![A-Za-z0-9_-])/,
];
function contentError(name){return new Error(`Conteúdo de credencial privada reconhecível em ${name}; pacote não criado.`);}
function scanCredentials(name,text){
  // Handle both a literal PEM and the ordinary escaped newlines of a JS/JSON string.
  const normalized=text.replace(/\\[rn]/g,'\n');
  const privatePem=/-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----[ \t\r\n]*[A-Za-z0-9+/= \t\r\n]{40,}-----END \1-----/;
  if(privatePem.test(normalized)||TOKEN_PATTERNS.some(pattern=>pattern.test(text)))throw contentError(name);
}
function assertSource(value,allowed,name){
  const source=typeof value==='string'&&value.startsWith('./')?value.slice(2):value;
  if(typeof source!=='string'||!allowed.has(source))throw new Error(`Referência de código fora da lista permitida em ${name}; pacote não criado.`);
}
function assertSources(value,allowed,name){if(!Array.isArray(value)||!value.length)throw new Error(`Lista de fontes incompatível em ${name}; pacote não criado.`);for(const source of value)assertSource(source,allowed,name);}
function manifestSources(manifest){
  if(manifest.background?.service_worker!==undefined)assertSource(manifest.background.service_worker,SCRIPT_FILES,'manifest.json');
  if(manifest.background?.scripts!==undefined)assertSources(manifest.background.scripts,SCRIPT_FILES,'manifest.json');
  if(manifest.background?.page!==undefined)assertSource(manifest.background.page,HTML_FILES,'manifest.json');
  for(const value of [manifest.action?.default_popup,manifest.browser_action?.default_popup,manifest.options_page,manifest.options_ui?.page,manifest.devtools_page,manifest.side_panel?.default_path])if(value!==undefined)assertSource(value,HTML_FILES,'manifest.json');
  if(manifest.content_scripts!==undefined){if(!Array.isArray(manifest.content_scripts))throw new Error('Lista de fontes incompatível no manifest.json; pacote não criado.');for(const item of manifest.content_scripts){if(item.js!==undefined)assertSources(item.js,SCRIPT_FILES,'manifest.json');if(item.css!==undefined)assertSources(item.css,new Set(['ui.css']),'manifest.json');}}
  if(manifest.sandbox?.pages!==undefined)assertSources(manifest.sandbox.pages,HTML_FILES,'manifest.json');
  if(manifest.chrome_url_overrides!==undefined)for(const page of Object.values(manifest.chrome_url_overrides))assertSource(page,HTML_FILES,'manifest.json');
  if(manifest.web_accessible_resources!==undefined){if(!Array.isArray(manifest.web_accessible_resources))throw new Error('Lista de fontes incompatível no manifest.json; pacote não criado.');for(const group of manifest.web_accessible_resources)assertSources(group.resources,new Set(EXTENSION_FILES),'manifest.json');}
}
function noSourceMap(comment,name){if(/^\s*\/[/*]\s*[#@]\s*sourceMappingURL\s*=/i.test(comment))throw new Error(`Referência sourceMappingURL não permitida em ${name}; este pacote não inclui mapas.`);}
function javascriptSources(name,text){
  const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.parseDiagnostics.length)throw new Error(`JavaScript incompatível em ${name}; gere novamente o build antes de empacotar.`);
  const nodes=[source],comments=new Set();
  while(nodes.length){
    const node=nodes.pop();
    for(const range of [...(ts.getLeadingCommentRanges(text,node.pos)??[]),...(ts.getTrailingCommentRanges(text,node.end)??[])]){
      if(comments.has(range.pos))continue;comments.add(range.pos);noSourceMap(text.slice(range.pos,range.end),name);
    }
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)assertSource(ts.isStringLiteralLike(node.moduleSpecifier)?node.moduleSpecifier.text:undefined,SCRIPT_FILES,name);
    if(ts.isCallExpression(node)){
      const call=node.expression,isImport=call.kind===ts.SyntaxKind.ImportKeyword;
      const isImportScripts=ts.isIdentifier(call)&&call.text==='importScripts'||ts.isPropertyAccessExpression(call)&&ts.isIdentifier(call.expression)&&['self','globalThis'].includes(call.expression.text)&&call.name.text==='importScripts';
      if(isImport||isImportScripts){if(!node.arguments.length)throw new Error(`Carregador de código incompatível em ${name}; pacote não criado.`);for(const argument of isImport?[node.arguments[0]]:node.arguments)assertSource(ts.isStringLiteralLike(argument)?argument.text:undefined,SCRIPT_FILES,name);}
    }
    if(ts.isNewExpression(node)){
      const call=node.expression,isWorker=ts.isIdentifier(call)&&['Worker','SharedWorker'].includes(call.text)||ts.isPropertyAccessExpression(call)&&ts.isIdentifier(call.expression)&&['self','globalThis'].includes(call.expression.text)&&['Worker','SharedWorker'].includes(call.name.text);
      if(isWorker){const argument=node.arguments?.[0];assertSource(argument&&ts.isStringLiteralLike(argument)?argument.text:undefined,SCRIPT_FILES,name);}
    }
    nodes.push(...node.getChildren(source));
  }
}
function htmlSources(name,text){
  // jsdom parses inertly by default: no runScripts, resources or network loader is enabled.
  const dom=new JSDOM(text);
  try{
    const doc=dom.window.document;
    if(doc.querySelector('base[href]'))throw new Error(`Origem base de código incompatível em ${name}; pacote não criado.`);
    for(const script of doc.querySelectorAll('script'))assertSource(script.getAttribute('src'),new Set([name==='popup.html'?'popup.js':'workspace.js']),name);
    for(const link of doc.querySelectorAll('link[href]')){
      const rel=(link.getAttribute('rel')??'').toLowerCase().split(/\s+/),as=(link.getAttribute('as')??'').toLowerCase();
      if(rel.includes('stylesheet'))assertSource(link.getAttribute('href'),new Set(['ui.css']),name);
      else if(rel.includes('modulepreload')||rel.includes('preload')&&['script','worker','style'].includes(as))assertSource(link.getAttribute('href'),as==='style'?new Set(['ui.css']):SCRIPT_FILES,name);
    }
    for(const frame of doc.querySelectorAll('iframe,object,embed')){
      if(frame.hasAttribute('srcdoc'))throw new Error(`Código HTML embutido incompatível em ${name}; pacote não criado.`);
      assertSource(frame.getAttribute(frame.tagName.toLowerCase()==='object'?'data':'src'),HTML_FILES,name);
    }
  }finally{dom.window.close();}
}
function cssSources(name,text){
  // CSS quotes are data; only real comments/directives outside them are inspected.
  for(let index=0;index<text.length;index++){
    if(text[index]==='"'||text[index]==="'"){const quote=text[index];while(++index<text.length){if(text[index]==='\\')index++;else if(text[index]===quote)break;}continue;}
    if(text.startsWith('/*',index)){const end=text.indexOf('*/',index+2);if(end<0)throw new Error(`CSS incompatível em ${name}; pacote não criado.`);noSourceMap(text.slice(index,end+2),name);index=end+1;continue;}
    if(text[index]==='@'&&/^@import(?:\s|["'(])/i.test(text.slice(index)))throw new Error(`Importação CSS adicional não permitida em ${name}; pacote não criado.`);
  }
}
function validatePackageContents(entries,manifest){
  manifestSources(manifest);
  for(const {name,data}of entries){
    const text=data.toString('utf8');
    if(name.endsWith('.js'))javascriptSources(name,text);
    else if(name.endsWith('.html'))htmlSources(name,text);
    else if(name.endsWith('.css'))cssSources(name,text);
  }
}
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
  for(const name of EXTENSION_FILES){const file=await lstat(join(dist,name));if(!file.isFile()||file.isSymbolicLink())throw new Error('O pacote aceita somente arquivos regulares do build, sem links simbólicos.');if(!file.size||file.size>50*1024*1024)throw new Error('Arquivo vazio ou grande demais para o pacote.');}
  const entries=[];for(const name of EXTENSION_FILES)entries.push({name,data:await readFile(join(dist,name))});
  for(const entry of entries)scanCredentials(entry.name,entry.data.toString('utf8'));
  let manifest,pkg;
  try{manifest=JSON.parse(entries.find(entry=>entry.name==='manifest.json').data.toString('utf8'));pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'));}
  catch{throw new Error('Manifesto ou package.json inválido; pacote não criado.');}
  if(!/^\d+\.\d+\.\d+$/.test(pkg.version)||manifest.version!==pkg.version||manifest.manifest_version!==3)throw new Error('Manifesto e pacote precisam declarar a mesma versão MV3.');
  validatePackageContents(entries,manifest);
  entries.push({name:'INSTALAR.txt',data:Buffer.from(`Prevlev ${pkg.version}\n\n1. Extraia todos os arquivos deste ZIP em uma pasta.\n2. Abra chrome://extensions no Chrome e ative Modo do desenvolvedor.\n3. Clique Carregar sem compactação e escolha a pasta que contém manifest.json.\n4. Recarregue suas abas YouTube/Studio. Use o ícone Prevlev para abrir o painel.\n\nAs ferramentas locais não exigem backend. IA e pesquisa oficial exigem configuração opcional do servidor conforme README do repositório. Nenhuma chave está incluída.\nPolíticas do seu navegador podem impedir extensões de desenvolvimento; este pacote não altera essas políticas.\n\nFonte e limites: https://github.com/onclickgrimes/prevlev\n`,'utf8')});
  const hashes=entries.map(({name,data})=>({name,bytes:data.length,sha256:sha256(data)}));
  entries.push({name:'SHA256SUMS.json',data:Buffer.from(JSON.stringify({version:pkg.version,files:hashes},null,2)+'\n')});
  const zip=createZip(entries),filename=`prevlev-extension-${pkg.version}.zip`,file=join(destination,filename);await mkdir(destination,{recursive:true});await writeFile(file,zip);await writeFile(`${file}.sha256`,`${sha256(zip)}  ${filename}\n`);return{file,sha256:sha256(zip),bytes:zip.length,files:hashes};
}
