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

const numericParts = value => {
  if (typeof value !== 'string' ||
      !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value))
    return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
};
// Narrow, fail-closed subset of npm semver syntax found in pinned REA 6.4.0:
// exact (including prerelease), ^M.m.p, ~M.m.p and major-only "1".
// This is not a complete npm resolver, nor does it authenticate an SBOM.
const supportedDependencySpec = spec =>
  versionOk(spec) || (/^(0|[1-9][0-9]*)$/.test(spec) &&
    Number.isSafeInteger(Number(spec))) ||
  ((spec.startsWith('^') || spec.startsWith('~')) &&
    numericParts(spec.slice(1)) !== null);
const dependencySpecMatches = (spec, resolved) => {
  if (versionOk(spec)) return spec === resolved;
  const actual = numericParts(resolved);
  if (!actual) return false; // ranged specs do not silently allow prereleases
  if (/^(0|[1-9][0-9]*)$/.test(spec)) return actual[0] === Number(spec);
  const min = numericParts(spec.slice(1));
  if (!min || (spec[0] !== '^' && spec[0] !== '~')) return false;
  const cmp = actual[0] - min[0] || actual[1] - min[1] || actual[2] - min[2];
  if (cmp < 0) return false;
  if (spec[0] === '~') return actual[0] === min[0] && actual[1] === min[1];
  if (min[0] > 0) return actual[0] === min[0];
  if (min[1] > 0) return actual[0] === 0 && actual[1] === min[1];
  return actual[0] === 0 && actual[1] === 0 && actual[2] === min[2];
};

// Immutable REA 6.4.0 upstream production-lock peers: exactly three optional
// declarations in two packages. These are metadata admission bounds, not
// authentication of a consumer SBOM or permission to run npm.
const OPTIONAL_SOURCE_PEERS=Object.freeze({
  'node_modules/ajv-formats': Object.freeze({ajv:'^8.0.0'}),
  'node_modules/ws': Object.freeze({bufferutil:'^4.0.1','utf-8-validate':'>=5.0.2'})
});

const peerVersionMatches=(spec,resolved)=>{
  if(spec.startsWith('>=')){
    const minimum=numericParts(spec.slice(2)),actual=numericParts(resolved);
    if(!minimum||!actual)return false;
    for(let i=0;i<3;i++){
      if(actual[i]>minimum[i])return true;
      if(actual[i]<minimum[i])return false;
    }
    return true;
  }
  return supportedDependencySpec(spec)&&dependencySpecMatches(spec,resolved);
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
function inspectR06ConsumerLockUnchecked(lock){
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
  // This check is deliberately for a dedicated, single-package REA consumer.
  // Extra root requests or lifecycle/workspace hints can change what npm installs
  // without changing the 35 pinned REA edges. Keep this a shape check, not approval.
  const rootMapEmptyOrAbsent=key=>!own(root,key)||
    (rec(root[key])&&Object.keys(root[key]).length===0);
  const rootListEmptyOrAbsent=key=>!own(root,key)||
    (Array.isArray(root[key])&&root[key].length===0);
  if(Object.keys(root.dependencies).length!==1||
      ['devDependencies','optionalDependencies','peerDependencies','scripts']
        .some(key=>!rootMapEmptyOrAbsent(key))||
      ['workspaces','bundleDependencies','bundledDependencies']
        .some(key=>!rootListEmptyOrAbsent(key))||
      (own(root,'hasInstallScript')&&root.hasInstallScript!==false)||
      (own(root,'gypfile')&&root.gypfile!==false))
    return report('REJECTED','CONSUMER_ROOT_SCOPE_DRIFT');
  if(!rec(rea.dependencies)||pairs(rea.dependencies).length!==35||
      pairs(DIRECT).some(([name,v])=>rea.dependencies[name]!==v))
    return report('REJECTED','REA_DIRECT_DEPENDENCIES_MISMATCH');
  if(pairs(DIRECT).some(([name,v])=>{
    const path=locate(pkgs,'node_modules/rea-agents',name);
    return !path||pkgs[path]?.version!==v;
  }))return report('REJECTED','REA_LOCK_RESOLUTION_MISMATCH');
  let missingOptionalDependencies=0,missingOptionalPeers=0,peerDeclarations=0;
  for(const [path,p] of rows){
    if(!path)continue;
    if(p.link===true||!versionOk(p.version)||!sriOk(p.integrity)||
        !resolvedOk(p.resolved,path.slice(path.lastIndexOf('node_modules/')+13),p.version))
      return report('REJECTED','UNVERIFIED_PACKAGE_SOURCE');
    // Only the three audited upstream optional peer edges are admitted.
    // Unknown required peers may cause npm to resolve additional packages.
    const declaredPeers=p.peerDependencies===undefined?{}:p.peerDependencies;
    const peerMeta=p.peerDependenciesMeta===undefined?{}:p.peerDependenciesMeta;
    if(!rec(declaredPeers)||!rec(peerMeta))
      return report('REJECTED','PEER_DEPENDENCY_SCOPE_DRIFT');
    const allowed=OPTIONAL_SOURCE_PEERS[path]||{};
    if(pairs(declaredPeers).some(([name,spec])=>!own(allowed,name)||allowed[name]!==spec||
       !rec(peerMeta[name])||peerMeta[name].optional!==true||
       Object.keys(peerMeta[name]).length!==1)||
       pairs(peerMeta).some(([name])=>!own(declaredPeers,name)))
      return report('REJECTED','PEER_DEPENDENCY_SCOPE_DRIFT');
    for(const [name,spec] of pairs(declaredPeers)){
      peerDeclarations++;
      const located=locate(pkgs,path,name);
      if(!located){missingOptionalPeers++;continue;}
      if(!peerVersionMatches(spec,pkgs[located].version))
        return report('REJECTED','PEER_DEPENDENCY_VERSION_MISMATCH');
    }
    // npm optionalDependencies may be absent (e.g. non-target OS binaries).
    // Strictly reject missing required edges. Never treat shape as host acceptance.
    for(const [kind,deps] of [['required',p.dependencies],['optional',p.optionalDependencies]]){
      if(deps===undefined)continue;
      if(!rec(deps))return report('REJECTED','INVALID_DEPENDENCY_MAP');
      for(const [name,spec] of pairs(deps)){
        if(!nameOk(name)||typeof spec!=='string'||!spec.trim()||spec.length>256)
          return report('REJECTED','INVALID_DEPENDENCY_REFERENCE');
        if(!supportedDependencySpec(spec))
          return report('REJECTED','UNSUPPORTED_DEPENDENCY_SPEC');
        const located=locate(pkgs,path,name);
        if(!located){
          if(kind==='optional') { missingOptionalDependencies++; continue; }
          return report('REJECTED','UNRESOLVED_DEPENDENCY_REFERENCE');
        }
        if(!dependencySpecMatches(spec, pkgs[located].version))
          return report('REJECTED',versionOk(spec)
            ? 'DEPENDENCY_EXACT_VERSION_MISMATCH'
            : 'DEPENDENCY_RANGE_MISMATCH');
      }
    }
  }
  // Never equate caller-controlled lock data with actual npm-installed artifacts.
  return report('STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED',
    'R05_AND_HOST_AND_CONSUMER_PROVENANCE_STILL_REQUIRED',{
      packageRows:rows.length-1,directDependencies:35,missingOptionalDependencies,
      peerDeclarations,missingOptionalPeers,
      packagesWithInstallScriptFlag:rows.filter(([path,p])=>path&&p.hasInstallScript===true).length
    });
}

// Boundary for caller-controlled objects. JSON.parse produces ordinary data, but
// plugin/test callers can supply getters and Proxies that throw on inspection.
// A malicious accessor must never leak an exception or turn into install approval.
export function inspectR06ConsumerLock(lock){
  try{return inspectR06ConsumerLockUnchecked(lock);}
  catch{return report('REJECTED','INVALID_UNTRUSTED_LOCK_OBJECT');}
}
