// Enrich a real, main-branch GitHub Actions push with a bounded authoritative
// compare diff. Actions event payloads may omit commit added/modified/removed
// arrays. Never infer changed paths from the workflow filename or fake a trigger.
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const SHA=/^[a-f0-9]{40}$/i;
const REPO='newsdayads/tigeriq-ai-lab';

export function compareChangedPaths(value) {
  if(!Array.isArray(value?.files))throw Error('GITHUB_PUSH_COMPARE_FILES_MISSING');
  // GitHub compare returns at most 300 file records. Do not certify a
  // potentially truncated source-scope list as complete.
  if(value.files.length>=300)throw Error('GITHUB_PUSH_COMPARE_TOO_MANY_FILES');
  const out=new Set();
  for(const entry of value.files){
    for(const path of [entry?.filename,entry?.previous_filename]){
      if(path==null)continue;
      if(typeof path!=='string'||!path.trim()||path.includes('\0'))throw Error('GITHUB_PUSH_COMPARE_PATH_INVALID');
      out.add(path);
    }
  }
  return [...out];
}

export async function enrichGithubPushPayload(payload, {
  fetchImpl=fetch,token='',apiUrl='https://api.github.com',repository=REPO,
}={}) {
  if(repository!==REPO||payload?.repository?.full_name!==REPO||
    payload?.ref!=='refs/heads/main')throw Error('GITHUB_PUSH_REPOSITORY_OR_REF_DENIED');
  const before=String(payload.before||''),after=String(payload.after||'');
  if(!SHA.test(before)||!SHA.test(after)||before===after)throw Error('GITHUB_PUSH_SHA_INVALID');
  if(!token||typeof fetchImpl!=='function')throw Error('GITHUB_PUSH_TOKEN_REQUIRED');
  const base=String(apiUrl||'').replace(/\/$/,'');
  if(!/^https:\/\/api\.github\.com$/i.test(base)&&!/^https:\/\/[a-z0-9.-]+\/api\/v3$/i.test(base))
    throw Error('GITHUB_PUSH_API_ORIGIN_DENIED');
  const response=await fetchImpl(`${base}/repos/${REPO}/compare/${before}...${after}`,{
    headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'},
    redirect:'error',signal:AbortSignal.timeout(10000),
  });
  if(!response?.ok)throw Error('GITHUB_PUSH_COMPARE_UNAVAILABLE');
  const changedPaths=compareChangedPaths(await response.json());
  // A valid compare can legitimately contain zero files when a PR's commits
  // cancel each other out (for example a deterministic fail->repair canary).
  // Preserve the verified push identity and let Core classify the empty scope
  // as a no-op instead of failing the signed event-dispatch workflow.
  return {...payload,changedPaths};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [inputPath,outputPath]=process.argv.slice(2);
  if(!inputPath||!outputPath)throw Error('GITHUB_PUSH_PATH_ARGUMENTS_REQUIRED');
  const payload=JSON.parse(await readFile(inputPath,'utf8'));
  const enriched=await enrichGithubPushPayload(payload,{
    token:process.env.GH_TOKEN,apiUrl:process.env.API_URL,repository:process.env.REPOSITORY,
  });
  await writeFile(outputPath,JSON.stringify(enriched)+'\n',{flag:'wx'});
}
