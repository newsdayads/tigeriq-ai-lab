/** GH-5284: reproducible offline single-file game built from the canonical G06 dist.
 * No PC01 shell, device access, browser auth, external scripts, or production publish.
 */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'..');
const dist=join(root,'dist');
const sources=Object.freeze([
  'engine/robot.js','engine/levels.js','levels/game.js','levels/draw.js','main.js'
]);
const allowedImports=Object.freeze({
  'engine/robot.js':[],
  'engine/levels.js':[],
  'levels/game.js':['../engine/levels.js','../engine/robot.js'],
  'levels/draw.js':[],
  'main.js':['./engine/levels.js','./levels/game.js','./levels/draw.js'],
});
const fail=(condition,code)=>{if(!condition)throw Error(code);};
const safeInline=(content,tag)=>{fail(!new RegExp('</'+tag,'i').test(content),'INLINE_TAG_BREAKOUT');return content;};
const hex=bytes=>createHash('sha256').update(bytes).digest('hex');

/** This is deliberately NOT a general-purpose bundler: reject unseen module syntax. */
export function flattenG06Module(name,input){
  fail(sources.includes(name),'UNKNOWN_G06_MODULE');
  fail(typeof input==='string','INVALID_G06_SOURCE');
  const actual=[];
  const withoutImports=input.replace(/^\s*import\s+\{[^}]+\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,(_line,spec)=>{
    actual.push(spec);return '';
  });
  fail(JSON.stringify(actual)===JSON.stringify(allowedImports[name]),'UNEXPECTED_MODULE_DEPENDENCY '+name);
  fail(!/^\s*(?:import|export)\s+\*/m.test(withoutImports),'UNSUPPORTED_WILDCARD_MODULE '+name);
  const body=withoutImports.replace(/^\s*export\s+(?=(?:const|let|var|function|class)\b)/gm,'');
  fail(!/^\s*(?:import|export)\s/m.test(body),'UNRESOLVED_ES_MODULE '+name);
  fail(!body.includes('import('),'DYNAMIC_IMPORT_FORBIDDEN');
  safeInline(body,'script');
  return body;
}
export async function buildG06Offline(){
  const chunks=[];
  for(const name of sources){
    const content=await readFile(join(dist,name),'utf8');
    chunks.push('// '+name+'\n'+flattenG06Module(name,content));
  }
  const js='(()=>{\n\'use strict\';\n'+chunks.join('\n')+'\n})();\n';
  safeInline(js,'script');
  const [rawHtml,rawCss]=await Promise.all([
    readFile(join(dist,'index.html'),'utf8'),readFile(join(dist,'styles.css'),'utf8')
  ]);
  const stylesheet='<link rel="stylesheet" href="./styles.css" />';
  const entry='<script type="module" src="./main.js"></script>';
  fail(rawHtml.split(stylesheet).length===2&&rawHtml.split(entry).length===2,
    'G06_HTML_ENTRYPOINT_MISMATCH');
  safeInline(rawCss,'style');
  const inlineStyles='<style data-tigeriq-g06-offline="true">\n'+rawCss+'\n</style>';
  const inlineScript='<script data-tigeriq-g06-offline="true">\n'+js+'</script>';
  const html=rawHtml.replace(stylesheet,inlineStyles).replace(entry,'')
    .replace('</body>',inlineScript+'\n</body>');
  fail(html.includes(inlineStyles)&&html.includes(inlineScript),'OFFLINE_PACK_NOT_EMBEDDED');
  fail(!/<(?:link|script)[^>]+(?:href|src)\s*=\s*["'](?:https?:|\/\/|\.\/)/i.test(html),
    'OFFLINE_DEPENDENCY_NOT_ALLOWED');
  const target=join(dist,'robot-oops-offline.html');
  await writeFile(target,html,'utf8');
  const receipt={schema:'TIGERIQ_G06_OFFLINE_BUILD_V1',workOrder:'GH-5284',
    artifact:'dist/robot-oops-offline.html',sha256:hex(Buffer.from(html)),
    bytes:Buffer.byteLength(html),sources:sources.slice(),
    phoneAccepted:false,nativeLeaseVerified:false,production:false};
  await writeFile(join(dist,'robot-oops-offline.receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  process.stdout.write('GH5284_OFFLINE_GAME_BUILT='+receipt.sha256+'\n');
  return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  buildG06Offline().catch(e=>{console.error('GH5284_OFFLINE_BUILD_FAILED',e.message);process.exitCode=1;});
}
