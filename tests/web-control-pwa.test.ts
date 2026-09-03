import { mkdtemp,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { startWebControlServer } from '../apps/web-control/src/server.js';
import { writeWebControlSnapshot } from '../apps/web-control/src/file-source.js';
import type { WebControlSnapshot } from '../apps/web-control/src/core.js';

const empty:WebControlSnapshot={version:1,generatedAt:new Date().toISOString(),goals:{queued:0,running:0,waitingAuthorization:0,blocked:0,done:0,failed:0},goalRows:[],tasks:{queued:0,running:0,review:0,authorization:0,blocked:0,done:0,failed:0},taskRows:[],workers:{total:0,busy:0,online:0,waiting:0,offline:0,failed:0},workerRows:[],providers:[],employees:[],authorization:{goalIds:[],taskIds:[]},evidence:{subjects:0,judgePass:0,judgePending:0}};

async function server(){const root=await mkdtemp(path.join(os.tmpdir(),'tigeriq-pwa-'));const snapshot=path.join(root,'snapshot.json'),control=path.join(root,'control.json'),goals=path.join(root,'goals.json');await writeWebControlSnapshot(empty,snapshot);await writeFile(control,JSON.stringify({version:1,paused:false}));await writeFile(goals,JSON.stringify({version:1,goals:[]}));return startWebControlServer({port:0,secureCookies:false,snapshotPath:snapshot,continuousControlPath:control,continuousGoalsPath:goals});}

describe('Web Control Mobile PWA',()=>{
  it('serves install metadata and safe same-origin PWA resources',async()=>{const app=await server();try{
    const root=await fetch(`${app.url}/`);const html=await root.text();expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');expect(html).toContain('apple-mobile-web-app-capable');expect(html).toContain('src="/pwa-register.js"');
    const csp=root.headers.get('content-security-policy')??'';expect(csp).toContain("script-src 'self'");expect(csp).toContain("worker-src 'self'");expect(csp).toContain("manifest-src 'self'");
    const manifest=await fetch(`${app.url}/manifest.webmanifest`);expect(manifest.headers.get('content-type')).toContain('application/manifest+json');expect((await manifest.json() as {display:string}).display).toBe('standalone');
    expect((await fetch(`${app.url}/pwa-icon.svg`)).headers.get('content-type')).toContain('image/svg+xml');
    const worker=await fetch(`${app.url}/sw.js`);const source=await worker.text();expect(worker.headers.get('service-worker-allowed')).toBe('/');expect(source).toContain('Operational HTML, sessions, CSRF tokens, API state, goals and controls are always network-only');expect(source).not.toContain("ALLOWED.add('/')");
  }finally{await app.close();}});
});
