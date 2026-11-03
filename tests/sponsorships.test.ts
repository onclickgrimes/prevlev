import {afterEach,describe,expect,it,vi} from 'vitest';
import {extractSponsorships,sponsorshipRows,sponsorshipMarkdown} from '../src/core/sponsorships';
import {analyzeSponsorships} from '../server/sponsorships.mjs';
import {analyzeDataset} from '../server/analysis.mjs';
import {toCsv} from '../src/core/export';

afterEach(()=>vi.unstubAllGlobals());
const source='🪐 Introdução.\r\nEste vídeo é patrocinado pela Acme Studio. Use o cupom ACME20 em https://acme.example/oferta?ref=creator\nSponsored by The North Face. Use code SAVE20. Affiliate link https://shop.example/?ref=abc\nOferecimento: Banco do Brasil. Parceria com Acme Studio.\nNão é patrocinado por Marca Falsa.\nPatrocinado por https://unknown.example';

describe('evidências literais com posições verificáveis',()=>{
 it('extrai marcas PT/EN, cupons e divulgação com intervalos exatos em UTF16/CRLF',()=>{
   const report=extractSponsorships({text:source,source:'user-provided'});
   expect(report.brands.map(item=>item.value)).toEqual(['Acme Studio','The North Face','Banco do Brasil']);expect(report.coupons.map(item=>item.value)).toEqual(['ACME20','SAVE20']);
   expect(report.indicators.some(item=>item.kind==='affiliate'&&item.value==='Affiliate link')).toBe(true);
   for(const proof of report.evidence){expect(source.slice(proof.start,proof.end)).toBe(proof.quote);expect(proof.start).toBeGreaterThanOrEqual(0);expect(proof.end).toBeLessThanOrEqual(source.length);}
   const brand=report.evidence.find(item=>item.quote==='Acme Studio')!;expect(brand.start).toBe(source.indexOf('Acme Studio'));expect(brand.line).toBe(2);expect(brand.column).toBe(brand.start-source.lastIndexOf('\n',brand.start));
   expect(report.estimatedRevenue).toBeNull();expect(JSON.stringify(report)).not.toMatch(/"confidence"|"classification"|estimatedRpm|contractValue/);
 });
 it('deduplica nomes e links mantendo todas as evidências e sem adivinhar marca por domínio',()=>{
   const report=extractSponsorships({text:'Patrocinado por Acme Studio. https://same.example\nSponsored by Acme Studio. https://same.example\nhttps://unknown-merchant.example\nPatrocinado por merchant.example'});
   expect(report.brands).toHaveLength(1);expect(report.brands[0].evidenceIds).toHaveLength(4);expect(report.links).toHaveLength(2);expect(report.links[0].evidenceIds).toHaveLength(2);expect(report.links[0].contextBasis).toBe('same-line-text');
   expect(report.links[1]).toMatchObject({contextBasis:'unattributed',contextBrandIds:[]});expect(report.sponsorMentions.at(-1)).toMatchObject({brandId:null,brandState:'unknown'});
 });
 it('mantém negação e referências ambíguas explícitas em vez de declarar patrocinador',()=>{
   const report=extractSponsorships({text:'Não é patrocinado por Acme.\nThis video is not sponsored by Brand.\nPatrocinado por você.\nOferecimento especial de hoje.\nCódigo fonte e cupom para desconto não identificam marcas.'});
   expect(report.brands).toEqual([]);expect(report.coupons).toEqual([]);expect(report.sponsorMentions.slice(0,2).every(item=>item.brandState==='negated')).toBe(true);expect(report.sponsorMentions.slice(2).every(item=>item.brandState==='unknown')).toBe(true);
 });
 it('reconhece nomes/códigos entre aspas sem classificar palavras genéricas como cupom',()=>{
   const report=extractSponsorships({text:'Parceria com "Nuvem & Cia". Cupom de desconto: "acme". Código: DEV_10. Use code SAVE20.\nCódigo fonte, cupom para amigos, affiliate marketing.'});
   expect(report.brands.map(item=>item.value)).toEqual(['Nuvem & Cia']);expect(report.coupons.map(item=>item.value)).toEqual(['acme','DEV_10','SAVE20']);expect(report.indicators.filter(item=>item.kind==='affiliate')).toEqual([]);
 });
 it('não usa a simples palavra sponsor ou publicidade como evidência de contrato',()=>{
   const report=extractSponsorships({text:'Discutimos publicidade, o significado de sponsor e marketing de afiliados. Nenhuma relação é descrita.'});expect(report.brands).toEqual([]);expect(report.coupons).toEqual([]);expect(report.sponsorMentions).toEqual([]);expect(report.estimatedRevenue).toBeNull();
 });
});

describe('links seguros somente como evidência textual',()=>{
 it('preserva URL original sem pontuação da frase e aceita parênteses balanceados',()=>{
   const text='Veja (https://example.test/path_(a)). E http://example.test/next?ref=public;';const report=extractSponsorships({text});
   expect(report.links.map(item=>item.url)).toEqual(['https://example.test/path_(a)','http://example.test/next?ref=public']);expect(report.evidence.filter(item=>item.kind==='url').map(item=>item.quote)).toEqual(['https://example.test/path_(a)','http://example.test/next?ref=public']);
 });
 it('omite credenciais, tokens, esquemas compostos e parâmetros sensíveis sem devolvê-los em contexto',()=>{
   const text='Patrocinado por Acme. https://user:PRIVATE_SECRET@example.test/path\nLink de afiliado https://example.test/?access_token=PRIVATE_SECRET\njavascript:https://evil.test\ndata:text/html,https://evil.test\nhttps://example.test/?X-Amz-Signature=PRIVATE_SECRET\nhttps://example.test/#token=PRIVATE_SECRET';
   const report=extractSponsorships({text});expect(report.links).toEqual([]);expect(report.ignoredUnsafeLinks).toBe(6);expect(JSON.stringify(report)).not.toContain('PRIVATE_SECRET');expect(report.warnings).toEqual([expect.stringContaining('omitidos')]);
 });
 it('não consulta URLs, servidores, contas ou provedores durante extração/exportação',()=>{
   const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const report=extractSponsorships({text:'Sponsored by Acme. Use code SAVE20. Affiliate link https://example.test/?ref=creator'});sponsorshipRows(report);sponsorshipMarkdown(report);expect(fetcher).not.toHaveBeenCalled();
 });
});

describe('origem, limites e compatibilidade do servidor',()=>{
 it('rejeita texto identificado como API oficial também por metadados aninhados',async()=>{
   for(const input of [{text:'Patrocinado por Acme',source:'youtube-data-api'},{text:'Patrocinado por Acme',metadata:{origin:{source:'youtube-data-api'}}},{text:'Patrocinado por Acme',provenance:['youtube-data-api']}]){
     expect(()=>extractSponsorships(input)).toThrow('youtube-data-api');expect(()=>analyzeSponsorships(input)).toThrow('youtube-data-api');await expect(analyzeDataset('sponsorships',input)).rejects.toThrow('youtube-data-api');
   }
 });
 it('não adivinha procedência pelo conteúdo textual quando não há marcação de origem',()=>{
   const report=extractSponsorships({text:'Este texto explica a expressão youtube-data-api. Patrocinado por Acme.'});expect(report.brands[0].value).toBe('Acme');expect(report.inputSource).toBe('unspecified');
 });
 it('rejeita acima de100mil caracteres sem truncar o texto e limita saída a200 evidências válidas',()=>{
   expect(()=>extractSponsorships({text:'x'.repeat(100001)})).toThrow('não foi truncado');const text='Patrocinado por Acme.\n'.repeat(400),report=extractSponsorships({text});expect(report.evidence).toHaveLength(200);expect(report.truncated).toBe(true);
   const ids=new Set(report.evidence.map(item=>item.id));for(const entity of [...report.brands,...report.coupons,...report.links,...report.indicators])expect(entity.evidenceIds.every(id=>ids.has(id))).toBe(true);for(const proof of report.evidence)expect(text.slice(proof.start,proof.end)).toBe(proof.quote);
 });
 it('compartilha o mesmo extrator no backend e mantém trechos legados sem receita fictícia',async()=>{
   const text='Tutorial de hoje. Este vídeo é patrocinado pela Exemplo. Obrigado!';const response=await analyzeDataset('sponsorships',{text});expect(response).toMatchObject({status:'ok',source:'prevlev:sponsorship-evidence',data:{mentions:[{excerpt:'Este vídeo é patrocinado pela Exemplo.'}],estimatedRevenue:null,brands:[{value:'Exemplo'}]}});expect(response.data).toEqual(extractSponsorships({text}));
 });
});

describe('exportações preservam evidências e neutralizam interpretação',()=>{
 it('exporta quote/posição original e neutraliza fórmulas CSV em nomes literais',()=>{
   const report=extractSponsorships({text:'Sponsored by "=SUM(A1:A2)". Use code SAVE20.'}),rows=sponsorshipRows(report),csv=toCsv(rows);expect(rows).toContainEqual(expect.objectContaining({quote:'=SUM(A1:A2)',kind:'brand'}));expect(csv).toContain("'=SUM(A1:A2)");expect(csv).toContain('"start"');expect(csv).toContain('SAVE20');
 });
 it('usa cercas maiores que os backticks da evidência no Markdown sem perder o original',()=>{
   const report=extractSponsorships({text:'Sponsored by "Acme ``` Studio".'}),markdown=sponsorshipMarkdown(report);expect(markdown).toContain('````text\nAcme ``` Studio\n````');expect(markdown).toContain('intervalo [');expect(markdown).toContain('não comprova');
 });
});
