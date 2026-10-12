import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { must, atomic, hash } from './core.mjs';

const modules=fileURLToPath(new URL('../node_modules/',import.meta.url));
export const FONT_CATALOG={
  'dm-sans':{family:'DM Sans',weights:'100 1000',fallback:'Arial, sans-serif'},
  lora:{family:'Lora',weights:'400 700',fallback:'Georgia, serif'},
  'space-grotesk':{family:'Space Grotesk',weights:'300 700',fallback:'Arial, sans-serif'},
  fraunces:{family:'Fraunces',weights:'100 900',fallback:'Georgia, serif'},
  manrope:{family:'Manrope',weights:'200 800',fallback:'Arial, sans-serif'},
  'playfair-display':{family:'Playfair Display',weights:'400 900',fallback:'Georgia, serif'},
  outfit:{family:'Outfit',weights:'100 900',fallback:'Arial, sans-serif'},
  bitter:{family:'Bitter',weights:'100 900',fallback:'Georgia, serif'},
  'source-sans-3':{"family":"Source Sans 3","weights":"200 900","fallback":"Arial, sans-serif","category":"humanista","suitability":"texto e interface"},
  'source-serif-4':{"family":"Source Serif 4","weights":"200 900","fallback":"Georgia, serif","category":"serifada editorial","suitability":"texto longo e títulos"},
  'cormorant-garamond':{"family":"Cormorant Garamond","weights":"300 700","fallback":"Georgia, serif","category":"serifada de alto contraste","suitability":"títulos grandes"},
  'inter':{"family":"Inter","weights":"100 900","fallback":"Arial, sans-serif","category":"grotesca","suitability":"texto e interface"},
  'work-sans':{"family":"Work Sans","weights":"100 900","fallback":"Arial, sans-serif","category":"grotesca","suitability":"texto e títulos"},
  'plus-jakarta-sans':{"family":"Plus Jakarta Sans","weights":"200 800","fallback":"Arial, sans-serif","category":"geométrica","suitability":"títulos e interface"},
  'archivo':{"family":"Archivo","weights":"100 900","fallback":"Arial, sans-serif","category":"grotesca","suitability":"texto e títulos"},
  'oswald':{"family":"Oswald","weights":"200 700","fallback":"Arial, sans-serif","category":"display condensada","suitability":"títulos curtos"},
  'syne':{"family":"Syne","weights":"400 800","fallback":"Arial, sans-serif","category":"display expressiva","suitability":"títulos curtos"},
  'eb-garamond':{"family":"EB Garamond","weights":"400 800","fallback":"Georgia, serif","category":"serifada editorial","suitability":"texto e títulos"},
  'nunito-sans':{"family":"Nunito Sans","weights":"200 1000","fallback":"Arial, sans-serif","category":"humanista","suitability":"texto e interface"},
  'roboto-condensed':{"family":"Roboto Condensed","weights":"100 900","fallback":"Arial, sans-serif","category":"sans condensada","suitability":"títulos e conteúdo denso"},
};
for(const [name,font] of Object.entries(FONT_CATALOG)){const m=JSON.parse(readFileSync(path.join(modules,"@fontsource-variable",name,"metadata.json")));font.styles=m.styles; font.portuguese=true; font.category ||= font.fallback.includes("Georgia")?"serifada editorial":"sans"; font.suitability ||= "títulos e texto";}
export const LIBRARY_CATALOG={native:{description:'APIs nativas; padrão, sem dependência'},animejs:{version:'3.2.2',description:'Timeline coordenada complexa, apenas se justificada; respeitar reduced motion'}};

function fontSources(name) {
  must(FONT_CATALOG[name],'FONT','Família fora do catálogo previamente instalado.');
  const source=path.join(modules,'@fontsource-variable',name),all=readdirSync(path.join(source,'files'));
  const entries=FONT_CATALOG[name].styles.flatMap(style=>['latin-ext','latin'].map(subset=>({subset,style,file:all.find(f=>f===`${name}-${subset}-wght-${style}.woff2`)})));
  const metadata=JSON.parse(readFileSync(path.join(source,'metadata.json')));
  must(FONT_CATALOG[name].weights===metadata.variable.wght.min+' '+metadata.variable.wght.max,'FONT_WEIGHTS','Pesos divergentes dos arquivos reais.');
  must(entries.every(e=>e.file),'FONT_FILES','Fonte sem arquivos latinos/acentos preparados.');
  const license=readFileSync(path.join(source,'LICENSE'),'utf8');
  must(/SIL OPEN FONT LICENSE/i.test(license),'FONT_LICENSE','Licença OFL não confirmada.');
  return {source,entries,license};
}
export function verifyResources() {
  for(const name of Object.keys(FONT_CATALOG))fontSources(name);
  const pkg=JSON.parse(readFileSync(path.join(modules,'animejs/package.json')));
  must(pkg.version==='3.2.2'&&pkg.license==='MIT','LIBRARY_VERSION','Biblioteca local diverge da versão/licença aprovada.');
  return {fonts:FONT_CATALOG,libraries:LIBRARY_CATALOG};
}
export function installFonts(dir,selection) {
  // Reading old briefs does not change their assets or consume another generation.
  const legacy={editorial:{heading:'lora',body:'dm-sans'},modern:{heading:'dm-sans',body:'lora'},technical:{heading:'space-grotesk',body:'dm-sans'}};
  const chosen=typeof selection==='string'?legacy[selection]:selection;
  must(chosen,'FONT','Seleção de fontes ausente.');
  const files=[],rules=[],hashes={};
  for(const name of new Set([chosen.heading,chosen.body])) {
    const {source,entries,license}=fontSources(name),meta=FONT_CATALOG[name];
    // Fontsource's own unicode ranges/weight metadata keep accented glyphs intact.
    const original=FONT_CATALOG[name].styles.map(style=>readFileSync(path.join(source,style==='normal'?'wght.css':'wght-italic.css'),'utf8')).join('\n');
    for(const {subset,style,file} of entries) {
      const target='assets/fonts/'+file,bytes=readFileSync(path.join(source,'files',file));
      atomic(path.join(dir,'site',target),bytes);files.push(target);hashes[target]=hash(bytes);
      const block=original.split('@font-face').find(s=>s.includes(`/${file}`));
      const range=/unicode-range:\s*([^;]+);/.exec(block||'')?.[1];must(range,'FONT_RANGE',`Sem unicode-range: ${name}/${subset}`);
      rules.push(`@font-face{font-family:'${meta.family}';font-style:${style};font-weight:${meta.weights};font-display:swap;src:url('./${target}') format('woff2');unicode-range:${range}}`);
    }
    const target=`assets/fonts/LICENSE-${name}.txt`;atomic(path.join(dir,'site',target),license);files.push(target);hashes[target]=hash(license);
  }
  return {...chosen,families:{heading:FONT_CATALOG[chosen.heading],body:FONT_CATALOG[chosen.body]},files,hashes,css:rules.join('\n'),license:'SIL Open Font License 1.1; incluída no pacote'};
}
export function installLibrary(dir,name='native',reason='') {
  must(Object.hasOwn(LIBRARY_CATALOG,name),'LIBRARY','Dependência não preparada.');
  if(name==='native')return {name,files:[],hashes:{},reason:'Recursos nativos suficientes'};
  must(reason.trim().length>=20,'LIBRARY_REASON','Justifique o ganho concreto antes de selecionar a dependência.');
  verifyResources();
  const mapping={'lib/anime.min.js':'animejs/lib/anime.min.js','lib/LICENSE-animejs.txt':'animejs/LICENSE.md'},hashes={};
  for(const [dest,src] of Object.entries(mapping)){const bytes=readFileSync(path.join(modules,src));atomic(path.join(dir,'site',dest),bytes);hashes[dest]=hash(bytes);}
  return {name,version:'3.2.2',reason,files:Object.keys(mapping),hashes};
}
