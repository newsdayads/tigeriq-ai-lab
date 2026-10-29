// GH-5135: fail closed if original resources or reproducible toolchain are missing.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kinds = ['drawable','raw','layout','xml','string','id'];
export function referencesFromSource(source) {
  const result=new Map(kinds.map(x=>[x,new Set()]));
  for(const [,kind,name] of source.matchAll(/(?<!android\.)\bR\.(drawable|raw|layout|xml|string|id)\.([a-zA-Z]\w*)/g)) result.get(kind).add(name);
  return result;
}
// Track resources referenced from AndroidManifest too; framework @android:* values are external.
export function referencesFromManifest(xml) {
  const found = new Map(kinds.map(kind => [kind, new Set()]));
  for (const [,kind,name] of xml.matchAll(/(?<!@android:)@(drawable|raw|layout|xml|string|id)\/([A-Za-z]\w*)/g)) {
    found.get(kind).add(name);
  }
  return found;
}
export function inspectR01(root) {
  const base='apps/ultracarhcm-v2/';
  const required=['settings.gradle','build.gradle','app/build.gradle','app/src/main/AndroidManifest.xml','gradlew','gradle/wrapper/gradle-wrapper.properties','gradle/wrapper/gradle-wrapper.jar'];
  const missingFiles=required.filter(p=>!existsSync(join(root,base,p))).map(p=>base+p);
  const res=join(root,base,'app/src/main/res'),java=join(root,base,'app/src/main/java');
  if (!existsSync(res)) missingFiles.push(base+'app/src/main/res');
  if (!existsSync(java)) missingFiles.push(base+'app/src/main/java');
  const names=new Map(kinds.map(x=>[x,new Set()]));
  if(existsSync(res)) for(const folder of readdirSync(res,{withFileTypes:true})) {
    if(!folder.isDirectory()) continue;
    const kind=folder.name.split('-')[0];
    if(!names.has(kind) && kind!=='values') continue;
    for(const ent of readdirSync(join(res,folder.name),{withFileTypes:true})) {
      if(!ent.isFile()) continue;
      if(kind==='values' && ent.name.endsWith('.xml')) {
        const xml=readFileSync(join(res,folder.name,ent.name),'utf8');
        for(const [,tag,attrs] of xml.matchAll(/<(string|item)\b([^>]*)>/g)) {
          const name=attrs.match(/\bname=['"]([^'"]+)['"]/),type=tag==='string'?'string':attrs.match(/\btype=['"](string|id)['"]/)?.[1];
          if(name&&names.has(type)) names.get(type).add(name[1]);
        }
      } else if(names.has(kind)) names.get(kind).add(ent.name.replace(/\.[^.]+$/,'').replace(/\.9$/,''));
    }
  }
  const refs=new Map(kinds.map(x=>[x,new Set()]));
  const scan=dir=>{
    if(!existsSync(dir))return;
    for(const ent of readdirSync(dir,{withFileTypes:true})) {
      const p=join(dir,ent.name);
      if(ent.isDirectory()) scan(p);
      else if(/\.(kt|java)$/.test(ent.name))for(const [kind,values] of referencesFromSource(readFileSync(p,'utf8')))for(const val of values)refs.get(kind).add(val);
    }
  };
  scan(java);
  const manifest=join(root,base,'app/src/main/AndroidManifest.xml');
  if (existsSync(manifest)) {
    for (const [kind,names] of referencesFromManifest(readFileSync(manifest,'utf8'))) {
      for (const name of names) refs.get(kind).add(name);
    }
  }
  const missingResources=[];
  for(const [kind,values] of refs) for(const name of values) if(!names.get(kind).has(name)) missingResources.push(kind+'/'+name);
  return {ok:missingFiles.length===0&&missingResources.length===0,missingFiles,missingResources:missingResources.sort()};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=inspectR01(resolve(process.argv[2]||'.'));
  console.log(JSON.stringify({workOrder:'GH-5135',step:'R01',...result},null,2));
  if(!result.ok)process.exitCode=2;
}
