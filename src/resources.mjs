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
};
export const LIBRARY_CATALOG={native:{description:'APIs nativas; padrão, sem dependência'},animejs:{version:'3.2.2',description:'Timeline coordenada complexa, apenas se justificada; respeitar reduced motion'}};

function fontSources(name) {
  must(FONT_CATALOG[name],'FONT','Família fora do catálogo previamente instalado.');
  const source=path.join(modules,'@fontsource-variable',name),all=readdirSync(path.join(source,'files'));
  const entries=['latin-ext','latin'].map(subset=>({subset,file:all.find(f=>f===`${name}-${subset}-wght-normal.woff2`)}));
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
    const original=readFileSync(path.join(source,'wght.css'),'utf8');
    for(const {subset,file} of entries) {
      const target='assets/fonts/'+file,bytes=readFileSync(path.join(source,'files',file));
      atomic(path.join(dir,'site',target),bytes);files.push(target);hashes[target]=hash(bytes);
      const block=original.split('@font-face').find(s=>s.includes(`/${file}`));
      const range=/unicode-range:\s*([^;]+);/.exec(block||'')?.[1];must(range,'FONT_RANGE',`Sem unicode-range: ${name}/${subset}`);
      rules.push(`@font-face{font-family:'${meta.family}';font-style:normal;font-weight:${meta.weights};font-display:swap;src:url('./${target}') format('woff2');unicode-range:${range}}`);
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
