/** Pure literal evidence extraction. Never fetches links, infers contracts or estimates money. */
export type SponsorshipKind = 'sponsor-marker'|'brand'|'coupon-code'|'affiliate'|'disclosure'|'url';
export interface SponsorshipEvidence {id:string;kind:SponsorshipKind;quote:string;start:number;end:number;line:number;column:number;negated:boolean;}
export interface SponsorshipEntity {id:string;value:string;evidenceIds:string[];}
export interface SponsorshipLink extends SponsorshipEntity {url:string;contextBrandIds:string[];contextEvidenceIds:string[];contextBasis:'same-line-text'|'unattributed';}
export interface SponsorshipMention {evidenceId:string;brandId:string|null;brandState:'literal-name'|'unknown'|'negated';}
export interface SponsorshipReport {version:1;source:'literal-text-evidence';inputSource:string;inputCharacters:number;evidence:SponsorshipEvidence[];brands:SponsorshipEntity[];coupons:SponsorshipEntity[];links:SponsorshipLink[];indicators:(SponsorshipEntity&{kind:'affiliate'|'disclosure';negated:boolean})[];sponsorMentions:SponsorshipMention[];mentions:{excerpt:string;start:number;end:number;line:number;evidenceIds:string[]}[];estimatedRevenue:null;truncated:boolean;ignoredUnsafeLinks:number;limitations:string[];warnings:string[];}
export interface SponsorshipInput {text:string;source?:unknown;metadata?:unknown;provenance?:unknown;}
interface Candidate {key:string;kind:SponsorshipKind;start:number;end:number;negated:boolean;}
const MAX_TEXT=100000, MAX_EVIDENCE=200;
const plain=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function guardApi(value:unknown):void {
  const stack:{value:unknown;tagged:boolean}[]=[{value,tagged:false}], seen=new WeakSet<object>();let count=0;
  while(stack.length){if(++count>5000)throw new Error('Metadados de origem acima do limite.');const current=stack.pop()!;
    if(typeof current.value==='string'){const normalized=current.value.toLowerCase().replace(/[\s_]+/g,'-');if(current.tagged&&(['youtube-data-api','youtube-api'].includes(normalized)||/^https:\/\/www\.googleapis\.com\/youtube\/v3(?:\/|$)/i.test(current.value)))throw new Error('Dados identificados como youtube-data-api não podem alimentar esta análise textual local.');continue;}
    if(current.value===null||typeof current.value!=='object'||seen.has(current.value))continue;seen.add(current.value);
    if(Array.isArray(current.value)){for(const child of current.value)if(child&&typeof child==='object'||current.tagged)stack.push({value:child,tagged:current.tagged});}
    else for(const [key,child]of Object.entries(current.value))if(child&&typeof child==='object'||/source|provenance|origin/i.test(key))stack.push({value:child,tagged:current.tagged||/source|provenance|origin/i.test(key)});
  }
}
const normalized=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
function lineStarts(text:string):number[]{const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\r'){if(text[i+1]==='\n')i++;starts.push(i+1);}else if(text[i]==='\n')starts.push(i+1);return starts;}
function location(starts:number[],offset:number){let low=0,high=starts.length;while(low+1<high){const middle=(low+high)>>1;if(starts[middle]<=offset)low=middle;else high=middle;}return {line:low+1,column:offset-starts[low]+1};}
function negated(text:string,start:number):boolean{return /(?:n[aã]o(?:\s+(?:[ée]|foi|est[aá]))?|not|never)\s*$/iu.test(text.slice(Math.max(0,start-50),start));}
const genericBrand=new Set(['você','vocês','voce','voces','you','your','nós','nos','ninguem','ninguém','alguém','alguem','ningu','nobody','anyone','someone','empresa','marca','brand','fabricante','companhia','company','canal','channel','this','este','esta','esse','essa','nosso','nossa','our','um','uma','the','a','an','patrocínio','patrocinio','sponsor','sponsored']);
const stops=new Set(['use','using','utilize','acesse','visite','visit','ganhe','compre','confira','clique','saiba','para','for','with','que','agora','hoje','today','thanks','obrigado','obrigada','desconto','discount','link','links','em','no','na','e','and','com','por','oferece','oferecem','offers','oferecendo','making','supporting','more','mais','is','are']);
function brandAfter(text:string,offset:number,marker:string):{start:number;end:number}|undefined {
  let start=offset;const spacing=/^[ \t]*(?::|[-–—])?[ \t]*(?:(?:a|o|as|os)\s+)?/.exec(text.slice(start));start+=spacing?.[0].length??0;
  const sample=text.slice(start,start+160);if(!sample||/^https?:\/\//i.test(sample))return undefined;
  const quotePairs:Record<string,string>={'"':'"',"'":"'",'“':'”','‘':'’'};
  if(quotePairs[sample[0]]){const end=sample.indexOf(quotePairs[sample[0]],1),value=sample.slice(1,end);if(end>1&&end<=101&&/[\p{L}]/u.test(value)&&!/[<>\r\n]/.test(value)&&!/^https?:/i.test(value))return {start:start+1,end:start+end};return undefined;}
  const words=[...sample.matchAll(/[^\s,;:!?\r\n]+/g)];let end=start, accepted=0;
  for(let index=0;index<Math.min(words.length,8);index++){
    const token=words[index][0],clean=token.replace(/[.)\]}]+$/,'');if(!clean||/[<>/=]/.test(clean)||/^https?:/i.test(token)||!/^[\p{L}\p{N}@&][\p{L}\p{N}_.@&+'’™®-]*$/u.test(clean))break;
    const fold=normalized(clean),connector=['de','da','do','das','dos','&'].includes(fold);
    const namedThe=fold==='the'&&/^The$/.test(clean)&&/^\p{Lu}/u.test(words[index+1]?.[0]??'');
    if(index===0&&((genericBrand.has(fold)&&!namedThe)||/^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}$/u.test(clean)))break;
    if(stops.has(fold))break;
    if(index>0&&!connector&&/^[a-zà-ÿ]/.test(clean)&&!['corp','inc','ltd','co'].includes(fold))break;
    if(index===0&&/^oferecimento$/i.test(marker)&&/^[a-zà-ÿ]/.test(clean))break;
    end=start+(words[index].index??0)+clean.length;accepted++;
    if(clean!==token)break;
  }
  const value=text.slice(start,end);return accepted&&/[\p{L}]/u.test(value)?{start,end}:undefined;
}
function safeUrl(raw:string):string|undefined {
  try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname||raw.length>2000)return undefined;
    for(const key of url.searchParams.keys())if(/token|api.?key|secret|password|authorization|signature|credential|session|^auth$|^sig$|^jwt$|^bearer$|^x-amz-/i.test(key))return undefined;
    if(/(?:token|api.?key|secret|password|authorization|signature|credential|session|auth)=/i.test(url.hash))return undefined;
    return url.href;
  }catch{return undefined;}
}
function urlEnd(raw:string):string {let value=raw.replace(/[.,;:!?]+$/,'');for(const [open,close]of [['(',')'],['[',']'],['{','}']])while(value.endsWith(close)&&value.split(close).length>value.split(open).length)value=value.slice(0,-1);return value;}
function sentence(text:string,offset:number):{start:number;end:number} {let start=offset,end=offset;while(start>0&&!/[.!?\r\n]/.test(text[start-1])&&offset-start<500)start--;while(end<text.length&&!/[.!?\r\n]/.test(text[end])&&end-offset<500)end++;if(/[.!?]/.test(text[end]??''))end++;while(start<end&&/\s/.test(text[start]))start++;while(end>start&&/\s/.test(text[end-1]))end--;return {start,end};}

export function extractSponsorships(input:SponsorshipInput):SponsorshipReport {
  guardApi(input);const text=plain(input).text;if(typeof text!=='string'||!text.trim())throw new Error('Cole texto real para examinar as evidências de divulgação.');if(text.length>MAX_TEXT)throw new Error('O texto excede o limite de 100 mil caracteres; ele não foi truncado.');
  const starts=lineStarts(text),candidates:Candidate[]=[],counts=new Map<SponsorshipKind,number>(),unsafeSpans:{start:number;end:number}[]=[];let serial=0,truncated=false,ignoredUnsafeLinks=0;
  const add=(kind:SponsorshipKind,start:number,end:number,negative=false)=>{const count=counts.get(kind)??0;if(count>=MAX_EVIDENCE){truncated=true;return undefined;}counts.set(kind,count+1);const key=`candidate-${++serial}`;candidates.push({key,kind,start,end,negated:negative});return key;};
  const rawMentions:{markerKey:string;brandKey?:string;brandValue?:string;negated:boolean}[]=[];
  const markers=/(?<![\p{L}\p{N}_])(?:patrocinad[oa]\s+(?:por|pel[ao]s?)|sponsored\s+by|(?:paid\s+)?partnership\s+with|parceria(?:\s+paga)?\s+com|oferecimento(?:\s+d[aeo])?|brought\s+to\s+you\s+by)(?![\p{L}\p{N}_])/giu;
  for(const match of text.matchAll(markers)){const negative=negated(text,match.index),markerKey=add('sponsor-marker',match.index,match.index+match[0].length,negative);if(!markerKey)break;const brand=negative?undefined:brandAfter(text,match.index+match[0].length,match[0]);const brandKey=brand?add('brand',brand.start,brand.end):undefined;rawMentions.push({markerKey,brandKey,brandValue:brand?text.slice(brand.start,brand.end):undefined,negated:negative});}
  const indicatorPatterns:[SponsorshipKind,RegExp][]=[['affiliate',/(?<![\p{L}\p{N}_])(?:links?\s+(?:de\s+)?afiliad[oa]s?|affiliate\s+links?|sou\s+afiliad[oa]|I\s+am\s+an?\s+affiliate|#affiliate)(?![\p{L}\p{N}_])/giu],['disclosure',/(?<![\p{L}\p{N}_])(?:parceria\s+paga|paid\s+partnership|paid\s+promotion|(?:conte[uú]do|v[ií]deo)\s+patrocinad[oa]|#(?:ad|publi|publicidade|an[uú]ncio))(?![\p{L}\p{N}_])/giu]];
  for(const [kind,pattern]of indicatorPatterns)for(const match of text.matchAll(pattern))if(!add(kind,match.index,match.index+match[0].length,negated(text,match.index)))break;
  const couponPattern=/(?<![\p{L}\p{N}_])(?:cupom(?:\s+de\s+desconto)?|c[oó]digo(?:\s+de\s+desconto)?|(?:use|using)\s+(?:the\s+)?code|promo(?:tional)?\s+code|coupon(?:\s+code)?)(?![\p{L}\p{N}_])/giu;
  const couponStops=new Set(['PARA','DE','DESCONTO','EXEMPLO','NO','NA','EM','USE','LINK','ABAIXO','CODIGO','CÓDIGO','FONTE','IS','THE','AT','YOUR','IN','ON','FOR','CODE','HERE','NONE']);
  for(const match of text.matchAll(couponPattern)){
    if(!add('disclosure',match.index,match.index+match[0].length,negated(text,match.index)))break;
    let start=match.index+match[0].length;const spacing=/^[ \t]*(?::|=|\bé\b|\bis\b)?[ \t]*/i.exec(text.slice(start));start+=spacing?.[0].length??0;const quote=/^["'“‘]/.test(text[start]??'');if(quote)start++;
    const code=/^[\p{L}\p{N}_-]{2,40}/u.exec(text.slice(start));if(!code||!/[\p{L}]/u.test(code[0])||couponStops.has(code[0].toUpperCase())||(!quote&&!/^[A-Z\d_-]+$/.test(code[0])&&!/\d/.test(code[0]))||/[\p{L}\p{N}_-]/u.test(text[start+code[0].length]??''))continue;
    add('coupon-code',start,start+code[0].length,negated(text,match.index));
  }
  const urls=new Map<string,string>();
  for(const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)){
    const raw=urlEnd(match[0]),prefix=text.slice(Math.max(0,match.index-200),match.index),previous=text[match.index-1]??'';
    const value=/[\p{L}\p{N}:+.-]/u.test(previous)||/(?:javascript|data|file):[^\s]*$/i.test(prefix)?undefined:safeUrl(raw);
    if(!value){ignoredUnsafeLinks++;unsafeSpans.push({start:match.index,end:match.index+raw.length});continue;}const key=add('url',match.index,match.index+raw.length);if(!key)break;urls.set(key,value);
  }
  candidates.sort((a,b)=>a.start-b.start||a.end-b.end||a.kind.localeCompare(b.kind));if(candidates.length>MAX_EVIDENCE)truncated=true;const chosen=candidates.slice(0,MAX_EVIDENCE);
  const evidence:SponsorshipEvidence[]=chosen.map((candidate,index)=>({id:`evidence-${index+1}`,kind:candidate.kind,quote:text.slice(candidate.start,candidate.end),start:candidate.start,end:candidate.end,...location(starts,candidate.start),negated:candidate.negated})), byKey=new Map(chosen.map((candidate,index)=>[candidate.key,evidence[index]]));
  const brands:SponsorshipEntity[]=[],coupons:SponsorshipEntity[]=[],links:SponsorshipLink[]=[],indicators:SponsorshipReport['indicators']=[],sponsorMentions:SponsorshipMention[]=[];
  const brandMap=new Map<string,SponsorshipEntity>();
  const attach=(entity:SponsorshipEntity,ids:string[])=>{for(const id of ids)if(!entity.evidenceIds.includes(id))entity.evidenceIds.push(id);};
  for(const mention of rawMentions){const marker=byKey.get(mention.markerKey);if(!marker)continue;const name=mention.brandKey?byKey.get(mention.brandKey):undefined;let brand:SponsorshipEntity|undefined;
    if(name&&mention.brandValue&&!mention.negated){const key=normalized(mention.brandValue);brand=brandMap.get(key);if(!brand){brand={id:`brand-${brands.length+1}`,value:mention.brandValue,evidenceIds:[]};brandMap.set(key,brand);brands.push(brand);}attach(brand,[marker.id,name.id]);}
    sponsorMentions.push({evidenceId:marker.id,brandId:brand?.id??null,brandState:mention.negated?'negated':brand?'literal-name':'unknown'});
  }
  const couponMap=new Map<string,SponsorshipEntity>(),indicatorMap=new Map<string,SponsorshipReport['indicators'][number]>(),linkMap=new Map<string,SponsorshipLink>();
  for(const [index,candidate]of chosen.entries()){const proof=evidence[index];if(proof.kind==='coupon-code'&&!proof.negated){let entity=couponMap.get(proof.quote);if(!entity){entity={id:`coupon-${coupons.length+1}`,value:proof.quote,evidenceIds:[]};couponMap.set(proof.quote,entity);coupons.push(entity);}attach(entity,[proof.id]);}
    if(proof.kind==='affiliate'||proof.kind==='disclosure'){const key=`${proof.kind}:${proof.negated}:${normalized(proof.quote)}`;let entity=indicatorMap.get(key);if(!entity){entity={id:`indicator-${indicators.length+1}`,value:proof.quote,kind:proof.kind,negated:proof.negated,evidenceIds:[]};indicatorMap.set(key,entity);indicators.push(entity);}attach(entity,[proof.id]);}
    if(proof.kind==='url'){const url=urls.get(candidate.key)!;let entity=linkMap.get(url);if(!entity){entity={id:`link-${links.length+1}`,value:url,url,evidenceIds:[],contextBrandIds:[],contextEvidenceIds:[],contextBasis:'unattributed'};linkMap.set(url,entity);links.push(entity);}attach(entity,[proof.id]);
      for(const mention of sponsorMentions){const marker=evidence.find(item=>item.id===mention.evidenceId)!;if(mention.brandId&&marker.line===proof.line&&Math.abs(marker.end-proof.start)<=180){entity.contextBasis='same-line-text';if(!entity.contextBrandIds.includes(mention.brandId))entity.contextBrandIds.push(mention.brandId);if(!entity.contextEvidenceIds.includes(marker.id))entity.contextEvidenceIds.push(marker.id);}}
    }
  }
  const mentionMap=new Map<string,SponsorshipReport['mentions'][number]>();for(const proof of evidence)if(!['brand','url'].includes(proof.kind)){let span=sentence(text,proof.start);if(unsafeSpans.some(unsafe=>unsafe.start<span.end&&unsafe.end>span.start))span={start:proof.start,end:proof.end};const key=`${span.start}:${span.end}`;let mention=mentionMap.get(key);if(!mention){mention={excerpt:text.slice(span.start,span.end),...span,line:location(starts,span.start).line,evidenceIds:[]};mentionMap.set(key,mention);}if(!mention.evidenceIds.includes(proof.id))mention.evidenceIds.push(proof.id);}
  const warnings:string[]=[];if(truncated)warnings.push('Limite de 200 evidências atingido; resultados posteriores podem ter sido omitidos.');if(ignoredUnsafeLinks)warnings.push(`${ignoredUnsafeLinks} links com formato inseguro, credenciais ou parâmetros sensíveis foram omitidos.`);
  return {version:1,source:'literal-text-evidence',inputSource:['youtube-dom','public-page','user-provided'].includes(String(input.source))?String(input.source):'unspecified',inputCharacters:text.length,evidence,brands,coupons,links,indicators,sponsorMentions,mentions:[...mentionMap.values()].slice(0,MAX_EVIDENCE),estimatedRevenue:null,truncated,ignoredUnsafeLinks,limitations:['Somente marcadores e nomes literais no texto fornecido; não comprova patrocínio, contrato, afiliação ou receita.','Marca desconhecida permanece desconhecida. Domínios não são usados para adivinhar marcas.','Contexto de link na mesma linha é uma referência textual para revisão, não prova de propriedade ou relação comercial.','Links não são abertos e nenhum serviço remoto é consultado. Não estima valores de contratos.','Índices start/end usam [início,fim) em unidades UTF-16 do texto original; linhas e colunas começam em 1.'],warnings};
}

export function sponsorshipRows(report:SponsorshipReport):Record<string,unknown>[] {return report.evidence.map(proof=>({id:proof.id,kind:proof.kind,line:proof.line,column:proof.column,start:proof.start,end:proof.end,quote:proof.quote,negated:proof.negated,brands:report.brands.filter(entity=>entity.evidenceIds.includes(proof.id)).map(entity=>entity.value).join('; '),coupons:report.coupons.filter(entity=>entity.evidenceIds.includes(proof.id)).map(entity=>entity.value).join('; '),links:report.links.filter(entity=>entity.evidenceIds.includes(proof.id)).map(entity=>entity.url).join('; ')}));}
export function sponsorshipMarkdown(report:SponsorshipReport):string {
  const lines=['# Evidências textuais de divulgação','',`Origem declarada: ${JSON.stringify(report.inputSource)}`,`Texto: ${report.inputCharacters} unidades UTF-16. Receita estimada: desconhecida.`,...report.limitations.map(value=>`- ${value}`),''];
  for(const proof of report.evidence){const fence='`'.repeat(Math.max(3,...[...proof.quote.matchAll(/`+/g)].map(match=>match[0].length+1)));lines.push(`## ${proof.id} · ${proof.kind}`,`Linha ${proof.line}, coluna ${proof.column}; intervalo [${proof.start}, ${proof.end}). Negação literal: ${proof.negated?'sim':'não'}.`,'',`${fence}text`,proof.quote,fence,'');}
  return lines.join('\n');
}
