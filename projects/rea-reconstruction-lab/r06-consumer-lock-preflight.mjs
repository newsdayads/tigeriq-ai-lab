// GH-4780 R06: static untrusted npm consumer-lock analysis, NEVER permission to install.
// Upstream pinned: morluto/rea@a56f7bb668ab23fec8d33f7af353ac7ed2fe1895.
const DIRECT = Object.freeze({
  "@babel/parser": "8.0.4",
  "@babel/types": "8.0.4",
  "@clack/prompts": "1.7.0",
  "@electron/asar": "4.2.0",
  "@jridgewell/trace-mapping": "0.3.31",
  "@lydell/node-pty": "1.1.0",
  "@modelcontextprotocol/client": "2.3.1",
  "@modelcontextprotocol/server": "2.3.1",
  "@xmldom/xmldom": "0.9.12",
  "@xterm/addon-serialize": "0.14.0",
  "@xterm/headless": "6.0.0",
  "@zip.js/zip.js": "2.15.0",
  "ajv": "8.20.0",
  "ajv-formats": "3.0.1",
  "canonicalize": "3.0.0",
  "cross-spawn": "7.0.6",
  "diff": "9.0.0",
  "har-schema": "2.0.0",
  "ignore": "7.0.6",
  "incur": "0.6.1",
  "isomorphic-git": "1.38.7",
  "jsonc-parser": "3.3.1",
  "lossless-json": "4.3.1",
  "parse5": "8.0.1",
  "pino": "10.4.0",
  "playwright-core": "1.58.2",
  "plist": "5.0.0",
  "semver": "7.8.5",
  "smol-toml": "1.9.0",
  "stream-json": "3.7.0",
  "write-file-atomic": "7.0.0",
  "ws": "8.21.0",
  "zod": "4.4.3",
  "evmole": "0.9.3",
  "yaml": "2.9.0"
});
const REA_SRI = 'sha512-Vj1zWfSlna5bphGoaoI/TcVBuYvze9u+OyPC3Shz8YkBqaCTqB4COnnRoX7XDwMpwI24ZlFEel2yEj0k8LTWEQ==';
const rec=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const pairs=x=>rec(x)?Object.entries(x):[];
const nameOk=x=>typeof x==='string' && /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(x);
const versionOk=x=>typeof x==='string' && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(x);
const sriOk=x=>typeof x==='string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(x);
const pathOk=x=>x==='' || (typeof x==='string' && x.length<1024 &&
  /^(?:node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)(?:\/node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)*$/.test(x));
const resolvedOk=(x,name,version)=>{
  if(typeof x!=='string'||x.length>1024||!nameOk(name)||!versionOk(version))return false;
  try{
    const u=new URL(x);
    // A trusted registry hostname alone cannot bind a tarball to its package.
    // Percent-encoded scoped names may be present, but must decode to an exact path.
    const expected='/'+name+'/-/'+name.split('/').at(-1)+'-'+version+'.tgz';
    return u.protocol==='https:' && u.hostname==='registry.npmjs.org' &&
      u.port==='' && !u.username && !u.password && !u.search && !u.hash &&
      decodeURIComponent(u.pathname)===expected;
  }catch{return false;}
};
const locate=(pkgs,path,name)=>{
  let parent=path;
  while(true){
    const key=(parent?parent+'/':'')+'node_modules/'+name;
    if(own(pkgs,key))return key;
    if(!parent)return null;
    const pos=parent.lastIndexOf('/node_modules/');
    parent=pos<0?'':parent.slice(0,pos);
  }
};
const report=(decision,reason,counts={})=>({
  decision,reason,counts,sourceAuthenticated:false,lockByteDigestVerified:false,
  installed:false,actualSbomVerified:false,transitiveScriptsVerified:false,
  deviceAuthorized:false,leaseOwned:false,installAuthorized:false,
  hostIsolationVerified:false,mutated:false,releaseAuthorized:false
});
export const REA_DIRECT_DEPENDENCIES=DIRECT;
export const REA_EXPECTED_SRI=REA_SRI;
export function inspectR06ConsumerLock(lock){
  if(!rec(lock)||lock.lockfileVersion!==3||!rec(lock.packages)||
      !rec(lock.packages[''])||!rec(lock.packages['node_modules/rea-agents']))
    return report('REJECTED','LOCK_V3_SHAPE_MISSING');
  const pkgs=lock.packages,rows=pairs(pkgs);
  if(rows.length<37||rows.length>2000||
      rows.some(([path,p])=>!pathOk(path)||!rec(p)))
    return report('REJECTED','PACKAGE_ENTRIES_INVALID');
  const root=pkgs[''],rea=pkgs['node_modules/rea-agents'];
  if(!rec(root.dependencies)||root.dependencies['rea-agents']!=='6.4.0'||
      rea.version!=='6.4.0'||rea.integrity!==REA_SRI||
      !resolvedOk(rea.resolved,'rea-agents',rea.version))
    return report('REJECTED','REA_ARTIFACT_PIN_MISMATCH');
  if(!rec(rea.dependencies)||pairs(rea.dependencies).length!==35||
      pairs(DIRECT).some(([name,v])=>rea.dependencies[name]!==v))
    return report('REJECTED','REA_DIRECT_DEPENDENCIES_MISMATCH');
  if(pairs(DIRECT).some(([name,v])=>{
    const path=locate(pkgs,'node_modules/rea-agents',name);
    return !path||pkgs[path]?.version!==v;
  }))return report('REJECTED','REA_LOCK_RESOLUTION_MISMATCH');
  let missingOptionalDependencies=0;
  for(const [path,p] of rows){
    if(!path)continue;
    if(p.link===true||!versionOk(p.version)||!sriOk(p.integrity)||
        !resolvedOk(p.resolved,path.slice(path.lastIndexOf('node_modules/')+13),p.version))
      return report('REJECTED','UNVERIFIED_PACKAGE_SOURCE');
    // npm optionalDependencies may be absent (e.g. non-target OS binaries).
    // Strictly reject missing required edges. Never treat shape as host acceptance.
    for(const [kind,deps] of [['required',p.dependencies],['optional',p.optionalDependencies]]){
      if(deps===undefined)continue;
      if(!rec(deps))return report('REJECTED','INVALID_DEPENDENCY_MAP');
      for(const [name,spec] of pairs(deps)){
        if(!nameOk(name)||typeof spec!=='string'||!spec.trim()||spec.length>256)
          return report('REJECTED','INVALID_DEPENDENCY_REFERENCE');
        if(!locate(pkgs,path,name)){
          if(kind==='optional') { missingOptionalDependencies++; continue; }
          return report('REJECTED','UNRESOLVED_DEPENDENCY_REFERENCE');
        }
      }
    }
  }
  // Never equate caller-controlled lock data with actual npm-installed artifacts.
  return report('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED',
    'R05_AND_HOST_AND_CONSUMER_PROVENANCE_STILL_REQUIRED',{
      packageRows:rows.length-1,directDependencies:35,missingOptionalDependencies,
      packagesWithInstallScriptFlag:rows.filter(([path,p])=>path&&p.hasInstallScript===true).length
    });
}
