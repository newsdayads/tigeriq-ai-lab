import { transformCoreSource, transformManagerJsonSource } from './core-throughput-transform.mjs';

function sourceText(value){
  if(typeof value==='string')return value;
  return Buffer.from(value).toString('utf8');
}

export async function load(url,context,nextLoad){
  const result=await nextLoad(url,context);
  if(result?.format!=='module')return result;
  const pathname=new URL(url).pathname.replace(/\\/g,'/');
  if(pathname.endsWith('/apps/tigeriq-core/core.mjs')){
    return {...result,source:transformCoreSource(sourceText(result.source))};
  }
  if(pathname.endsWith('/apps/tigeriq-core/manager-json.mjs')){
    return {...result,source:transformManagerJsonSource(sourceText(result.source))};
  }
  return result;
}
