import test from 'node:test';
import fs from 'node:fs';
import { Script } from 'node:vm';
import os from 'node:os';
import { safeFilename, safePackage, validBatch, fileInDrop } from './farm-ops.mjs';
import { validMacro, executeMacro, MacroRuns } from './macro-engine.mjs';
import { LocalScheduler } from './schedule-engine.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert/strict';
import { parseDevices, safeSerial, validInput, privateWifiAddress, parsePrivateWifiIpv4, parseExistingAdbTcpPort, wifiCandidateFromOutputs, wifiEndpointReachable, normalizeKnownWifiEndpoints, reconnectKnownWifiEndpoints, adbConnectFailure, mirrorOptions, server } from './app.mjs';

test('ADB inventory parses connected, offline, unauthorized devices', () => {
  const devices=parseDevices('List of devices attached\nR3CM400AKRX device product:beyondxks model:SM_G977N transport_id:1\n192.168.0.9:5555 offline\nABCD unauthorized\n');
  assert.equal(devices.length,3);
  assert.deepEqual(devices[0],{serial:'R3CM400AKRX',state:'device',model:'SM_G977N',product:'beyondxks'});
  assert.equal(devices[1].state,'offline');
  assert.equal(devices[2].state,'unauthorized');
});
test('serial cannot inject shell flags, path or operators', () => {
  for(const s of ['R3CM400AKRX','192.168.1.8:5555','emulator-5554']) assert.equal(safeSerial(s),true);
  for(const s of ['--help','../../a','x;del','a b','']) assert.equal(safeSerial(s),false);
});
test('bounded group inputs and supported actions', () => {
  assert.equal(validInput({serials:['ABC'],action:'tap',x:12,y:99}),true);
  assert.equal(validInput({serials:['ABC','DEF'],action:'key',key:'HOME'}),true);
  assert.equal(validInput({serials:['ABC'],action:'swipe',x:10,y:10,toX:20,toY:40,ms:300}),true);
  assert.equal(validInput({serials:['ABC'],action:'text',text:'hello world'}),true);
  assert.equal(validInput({serials:['ABC'],action:'text',text:'a\u0000b'}),false);
  assert.equal(validInput({serials:['ABC'],action:'shell',cmd:'rm -rf /'}),false);
  assert.equal(validInput({serials:['ABC','ABC'],action:'key',key:'HOME'}),false);
  assert.equal(validInput({serials:['ABC'],action:'tap',x:-1,y:3}),false);
  assert.equal(validInput({serials:['ABC'],action:'swipe',x:1,y:3,toX:4,toY:4,ms:1}),false);
  assert.equal(validInput({serials:['ABC'],action:'key',key:'FACTORY_RESET'}),false);
});
test('server module imports without listening or side effects', () => {
  assert.equal(server.listening,false);
});

test('browser controller parses under strict CSP external-script policy', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.match(html,/<script src="\/ui\.js" type="module"><\/script>/);
  assert.doesNotMatch(html,/<script type="module">/);
  const ui=fs.readFileSync(path.join(dir,'ui.js'),'utf8');
  assert.doesNotThrow(()=>new Script(ui));
  assert.match(html,/id="pasteClipboard"/);
  assert.match(html,/id="openScrcpy"/);
  assert.match(html,/id="mirrorFps"/);
  assert.match(ui,/navigator\.clipboard\.readText\(\)/);
});

test('control screen uses CSS-pixel click threshold and prioritizes real device interaction', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const ui=fs.readFileSync(path.join(dir,'ui.js'),'utf8');
  assert.match(ui,/Math\.hypot\(e\.clientX-startX,e\.clientY-startY\)>8/);
  assert.doesNotMatch(ui,/Math\.hypot\(\(a\[0\]-b\[0\]\)\*size\.width/);
  assert.match(ui,/function settleScreen\(img,ok\)/);
  assert.match(ui,/img\.dataset\.forceAfterBusy='1'/);
  assert.match(ui,/refreshOne\(img,true\)/);
  assert.match(ui,/make\('▣','Điều khiển video thời gian thực \(scrcpy\)',\(\)=>openMirror\(d\.serial\)\)/);
  assert.match(ui,/\$\('mirrorSelected'\)\.onclick=.*openMirror\(ss\[0\]\)/);
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.match(html,/id="openScrcpy"/);
});

test('Windows package fails closed on pinned runtime provenance and records license hashes', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'windows','package-windows.ps1'),'utf8');
  assert.ok(source.includes("nodeSha256='3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237'"));
  assert.ok(source.includes("webView2LoaderSha256='3426DCC55FDFB8B5E7AC623CF33B4CCF283FBF68A0C5A65BDDFDB4D749A8ABEE'"));
  assert.ok(source.includes("$dotnetSdkPattern='^8\\.0\\.\\d+$'"));
  assert.ok(source.includes("dotnet --list-sdks"));
  assert.ok(source.includes("rollForward='disable'"));
  assert.ok(source.includes("Assert-Sha256 $node $nodeSha256 'Node.js'"));
  assert.ok(source.includes("Assert-AuthenticodePublisher $node $nodePublisherPattern 'Node.js'"));
  assert.ok(source.includes("Assert-Sha256 $webView2Loader $webView2LoaderSha256 'WebView2Loader.dll'"));
  assert.ok(source.includes("Assert-AuthenticodePublisher $webView2Loader $webView2PublisherPattern 'WebView2Loader.dll'"));
  for(const field of ['nodeSignerSubject','dotnetLicenseSha256','dotnetThirdPartySha256','webView2SignerSubject','webView2LicenseSha256','webView2NoticeSha256'])
    assert.ok(source.includes(field+'='));
});

test('Windows host monitors and recovers a dead local backend', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'windows','Program.cs'),'utf8');
  assert.match(source,/healthTimer\.Tick \+= async \(_, _\) => await RecoverBackendAsync\(\)/);
  assert.match(source,/if \(await HealthyAsync\(client\)\) return;/);
  assert.match(source,/ShutdownOwnedHost\(\);\s*StartBackend\(\);/);
  assert.match(source,/if \(viewer\.CoreWebView2 is not null\) viewer\.CoreWebView2\.Reload\(\)/);
  assert.match(source,/healthTimer\.Stop\(\);\s*ShutdownOwnedHost\(\);/);
  assert.match(source,/if \(!ready\)[\s\S]*?healthTimer\.Start\(\);[\s\S]*?CoreWebView2Environment\.CreateAsync/);
});


test('Windows GUI refuses Session 0 and installer maintains per-user interactive autostart', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const program=fs.readFileSync(path.join(dir,'windows','Program.cs'),'utf8');
  const installSource=path.join(dir,'windows','install-user.ps1');
  const uninstallSource=path.join(dir,'windows','uninstall-user.ps1');
  const install=fs.readFileSync(fs.existsSync(installSource)?installSource:path.join(dir,'install-user.ps1'),'utf8');
  const uninstall=fs.readFileSync(fs.existsSync(uninstallSource)?uninstallSource:path.join(dir,'uninstall-user.ps1'),'utf8');
  assert.match(program,/Process\.GetCurrentProcess\(\)\.SessionId == 0 \|\| !Environment\.UserInteractive/);
  assert.match(program,/Environment\.ExitCode = 12;/);
  assert.match(install,/SpecialFolders\('Startup'\)/);
  assert.match(install,/TigerIQ Phone Farm\.lnk/);
  assert.match(install,/interactive user-session launcher/);
  assert.match(install,/\[switch\]\$NoAutoStart/);
  assert.match(uninstall,/SpecialFolders\('Startup'\)/);
  assert.match(uninstall,/if\(\$auto\.TargetPath -eq \$exe\)\{Remove-Item \$autoStartPath -Force\}/);
});

test('batch controls validate package, files, duplicate serial and actions', () => {
  assert.equal(safePackage('com.example.demo'), true);
  assert.equal(safePackage('com.example;cmd'), false);
  assert.equal(safePackage('settings'), false);
  assert.equal(safeFilename('my-app.apk'), true);
  assert.equal(safeFilename('sample.csv'), true);
  for (const s of ['../sample.apk', 'CON.txt', 'one..two.apk', '.hidden.apk', 'a.exe']) assert.equal(safeFilename(s), false);
  assert.equal(validBatch({action:'install',serials:['A1','B2'],file:'my-app.apk'}),true);
  assert.equal(validBatch({action:'install',serials:['A1'],file:'sample.csv'}),false);
  assert.equal(validBatch({action:'upload',serials:['A1'],file:'sample.csv'}),true);
  assert.equal(validBatch({action:'launch',serials:['A1'],package:'com.example.demo'}),true);
  assert.equal(validBatch({action:'uninstall',serials:['A1'],package:'com.example.demo'}),true);
  assert.equal(validBatch({action:'shell',serials:['A1'],cmd:'unsafe'}),false);
  assert.equal(validBatch({action:'forceStop',serials:['A1','A1'],package:'com.example.demo'}),false);
});

test('scrcpy mirror options are bounded and have safe defaults', () => {
  assert.deepEqual(mirrorOptions({}),{maxFps:25,maxSize:1080,videoBitRateMbps:4});
  assert.deepEqual(mirrorOptions({maxFps:60,maxSize:2160,videoBitRateMbps:12}),{maxFps:60,maxSize:2160,videoBitRateMbps:12});
  assert.equal(mirrorOptions({maxFps:240,maxSize:1080,videoBitRateMbps:4}),null);
  assert.equal(mirrorOptions({maxFps:25,maxSize:9999,videoBitRateMbps:4}),null);
  assert.equal(mirrorOptions({maxFps:25,maxSize:1080,videoBitRateMbps:99}),null);
});

test('batch file lookup is confined to approved drop directory', () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-batch-'));
  try {
    const file=path.join(folder,'sample.txt');
    fs.writeFileSync(file,'safe');
    assert.equal(fileInDrop(folder,'sample.txt'),file);
    assert.throws(()=>fileInDrop(folder,'../secrets.csv'));
    assert.throws(()=>fileInDrop(folder,'not-present.apk'));
  } finally { fs.rmSync(folder,{recursive:true,force:true}) }
});

test('macros reject arbitrary shell, unbounded waits and destructive keys', () => {
  assert.equal(validMacro([{action:'key',key:'HOME'},{action:'wait',ms:200},{action:'tap',x:15,y:40}]),true);
  assert.equal(validMacro([{action:'shell',command:'rm -rf /'}]),false);
  assert.equal(validMacro([{action:'key',key:'FACTORY_RESET'}]),false);
  assert.equal(validMacro([{action:'wait',ms:60000}]),false);
  assert.equal(validMacro([{action:'text',text:'A\u0000'}]),false);
  assert.equal(validMacro(Array.from({length:51},()=>({action:'key',key:'HOME'}))),false);
});

test('macros execute bounded group steps and report progress', async () => {
  const actions=[], progresses=[];
  const steps=[{action:'key',key:'HOME'},{action:'wait',ms:50},{action:'key',key:'BACK'}];
  const result=await executeMacro(steps,['PHONE_A','PHONE_B'],async (s,b)=>actions.push(s+':'+b.key),undefined,n=>progresses.push(n));
  assert.deepEqual(actions,['PHONE_A:HOME','PHONE_B:HOME','PHONE_A:BACK','PHONE_B:BACK']);
  assert.deepEqual(progresses,[1,2,3]);
  assert.deepEqual(result,{completed:3,total:3});
});

test('macro run ids, device locking and stop guard', async () => {
  const runs=new MacroRuns();
  const id=runs.start([{action:'wait',ms:1000}],['PHONE_A'],async()=>{});
  assert.ok(runs.status(id));
  assert.throws(()=>runs.start([{action:'key',key:'HOME'}],['PHONE_A'],async()=>{}));
  assert.equal(runs.stop(id),true);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(runs.status(id).state,'cancelled');
});

test('local scheduler survives restart and executes a bounded due macro once', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-schedule-'));
  const filename=path.join(dir,'schedules.json');
  let now=Date.parse('2026-10-24T00:00:00.000Z');
  const invoked=[];
  try {
    const scheduler=new LocalScheduler(filename,async(steps,serials)=>{
      invoked.push({steps,serials});return 'local-run-id';
    },()=>now);
    const saved=scheduler.add({name:'Safe Home',serials:['PHONE_A'],
      steps:[{action:'key',key:'HOME'}],runAt:new Date(now+120000).toISOString(),repeatMinutes:1});
    assert.ok(saved.id);
    assert.equal(scheduler.list().length,1);
    await scheduler.tick();assert.equal(invoked.length,0);
    now+=120001;
    await scheduler.tick();
    assert.equal(invoked.length,1);
    assert.equal(scheduler.list()[0].lastRunId,'local-run-id');
    assert.ok(scheduler.list()[0].nextAt>now);
    const restarted=new LocalScheduler(filename,async()=>{},()=>now);
    assert.equal(restarted.list().length,1);
    assert.equal(restarted.list()[0].lastRunId,'local-run-id');
    assert.equal(restarted.remove(saved.id),true);
    assert.equal(restarted.list().length,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
});

test('local scheduler skips stale jobs instead of replaying uncontrolled backlog', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-schedule-missed-'));
  let now=Date.parse('2026-10-24T00:00:00.000Z'),invocations=0;
  try{
    const scheduler=new LocalScheduler(path.join(dir,'schedules.json'),async()=>{invocations++;},()=>now);
    scheduler.add({name:'One time',serials:['PHONE_A'],steps:[{action:'key',key:'HOME'}],
      runAt:new Date(now+5000).toISOString(),repeatMinutes:0});
    now+=7200000;
    await scheduler.tick();
    assert.equal(invocations,0);
    assert.equal(scheduler.list()[0].enabled,false);
    assert.match(scheduler.list()[0].lastError,/Missed window/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('wireless ADB address limited to valid private LAN IP and nonprivileged port', () => {
  for(const value of ['192.168.100.24:5555','10.2.3.5:45555','172.16.0.9:5555','172.31.255.2:5555'])
    assert.equal(privateWifiAddress(value),true);
  for(const value of ['8.8.8.8:5555','127.0.0.1:5555','192.169.1.2:5555','172.32.0.1:5555','192.168.1.999:5555','192.168.1.2:0','10.1.2.3:80','10.1.2.3:5555 & whoami','localhost:5555'])
    assert.equal(privateWifiAddress(value),false);
});


test('read-only WiFi ADB discovery accepts only an already-enabled private LAN endpoint', () => {
  assert.equal(parsePrivateWifiIpv4('7: wlan0: <UP>\n    inet 192.168.50.23/24 brd 192.168.50.255 scope global wlan0\n'), '192.168.50.23');
  assert.equal(parsePrivateWifiIpv4('inet 10.20.30.40/8 scope global wlan0'), '10.20.30.40');
  assert.equal(parsePrivateWifiIpv4('inet 8.8.8.8/24 scope global wlan0'), null);
  assert.equal(parsePrivateWifiIpv4('inet 192.168.1.999/24 scope global wlan0'), null);
  assert.equal(parseExistingAdbTcpPort('5555\n'), 5555);
  assert.equal(parseExistingAdbTcpPort('45555'), 45555);
  for (const value of ['', '-1', '0', '80', '65536', '5555 & whoami']) assert.equal(parseExistingAdbTcpPort(value), null);
  assert.equal(wifiCandidateFromOutputs('inet 192.168.50.23/24 scope global wlan0', '5555'), '192.168.50.23:5555');
  assert.equal(wifiCandidateFromOutputs('inet 8.8.8.8/24 scope global wlan0', '5555'), null);
  assert.equal(wifiCandidateFromOutputs('inet 192.168.50.23/24 scope global wlan0', '-1'), null);
});

test('WiFi ADB reachability preflight rejects stale configured endpoints without changing ADB', async () => {
  const fakeSocket=event=>()=>{
    const handlers={};
    let timeoutHandler=null;
    return {
      once(name,fn){handlers[name]=fn; if(name===event)queueMicrotask(()=>fn(event==='error'?new Error('refused'):undefined)); return this;},
      setTimeout(_ms,fn){timeoutHandler=fn; if(event==='timeout')queueMicrotask(()=>timeoutHandler()); return this;},
      destroy(){}
    };
  };
  assert.equal(await wifiEndpointReachable('192.168.50.23:5555',100,fakeSocket('connect')),true);
  assert.equal(await wifiEndpointReachable('192.168.50.23:5555',100,fakeSocket('error')),false);
  assert.equal(await wifiEndpointReachable('192.168.50.23:5555',100,fakeSocket('timeout')),false);
  let invoked=false;
  assert.equal(await wifiEndpointReachable('8.8.8.8:5555',100,()=>{invoked=true;throw new Error('must not run')}),false);
  assert.equal(invoked,false);
});

test('WiFi ADB connect failures expose bounded structured diagnostics', () => {
  const refused=adbConnectFailure({
    code:1,
    stderr:'cannot connect to 172.16.199.197:5555: No connection could be made because the target machine actively refused it. (10061)\n'
  });
  assert.equal(refused.reason,'ADB_CONNECT_REFUSED');
  assert.equal(refused.exitCode,1);
  assert.equal(refused.signal,null);
  assert.match(refused.detail,/actively refused/i);
  assert.equal(adbConnectFailure({code:1,stderr:'failed to connect: connection timed out (10060)'}).reason,'ADB_CONNECT_TIMEOUT');
  assert.equal(adbConnectFailure({code:1,stderr:'No route to host'}).reason,'ADB_CONNECT_UNREACHABLE');
  assert.equal(adbConnectFailure({code:1,stderr:'device unauthorized'}).reason,'ADB_CONNECT_UNAUTHORIZED');
  assert.equal(adbConnectFailure({stderr:'x'.repeat(400)}).detail.length,250);
});

test('remembered WiFi ADB endpoints are private, unique and bounded', () => {
  const many=Array.from({length:80},(_,i)=>`192.168.50.${(i%250)+1}:5555`);
  const values=normalizeKnownWifiEndpoints([
    '192.168.50.23:5555',
    '192.168.50.23:5555',
    '8.8.8.8:5555',
    '10.2.3.4:45555',
    ...many
  ]);
  assert.equal(values[0],'192.168.50.23:5555');
  assert.equal(values[1],'10.2.3.4:45555');
  assert.equal(values.includes('8.8.8.8:5555'),false);
  assert.ok(values.length<=64);
  assert.equal(new Set(values).size,values.length);
});

test('WiFi ADB reconnect only retries remembered private endpoints that are not already online', async () => {
  const reachableCalls=[],connectCalls=[];
  const results=await reconnectKnownWifiEndpoints(
    ['192.168.50.23:5555','192.168.50.24:5555','10.0.0.8:45555','8.8.8.8:5555'],
    ['192.168.50.23:5555'],
    async address=>{
      reachableCalls.push(address);
      return address!=='192.168.50.24:5555';
    },
    async address=>{
      connectCalls.push(address);
      return address==='10.0.0.8:45555'?'connected to 10.0.0.8:45555':'unexpected';
    }
  );
  assert.deepEqual(reachableCalls,['192.168.50.24:5555','10.0.0.8:45555']);
  assert.deepEqual(connectCalls,['10.0.0.8:45555']);
  assert.deepEqual(results.map(x=>[x.address,x.state]),[
    ['192.168.50.23:5555','already_connected'],
    ['192.168.50.24:5555','unreachable'],
    ['10.0.0.8:45555','connected']
  ]);
});

test('WiFi ADB reconnect source persists only successful user-approved endpoints and never enables TCP mode', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'app.mjs'),'utf8');
  const ui=fs.readFileSync(path.join(dir,'ui.js'),'utf8');
  assert.match(source,/wifi-endpoints\.json/);
  assert.match(source,/rememberWifiEndpoint\(b\.address\)/);
  assert.match(source,/remembered:true/);
  assert.match(source,/autoReconnectKnownWifi/);
  assert.match(source,/setInterval\(\(\)=>void autoReconnectKnownWifi\(\)/);
  assert.match(source,/rememberedWifi: knownWifiEndpoints\(\)\.length/);
  assert.match(ui,/WiFi nhớ/);
  assert.doesNotMatch(source,/['"]tcpip['"]/);
  assert.doesNotMatch(source,/setprop\s+service\.adb\.tcp\.port/i);
});

test('WiFi candidate endpoint remains discovery-only and never enables ADB TCP mode', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'app.mjs'),'utf8');
  assert.match(source,/\/api\/wifi\/candidate/);
  assert.match(source,/wifiEndpointReachable\(address,1500\)/);
  assert.match(source,/ADB_ENDPOINT_UNREACHABLE/);
  assert.match(source,/reason:'ADB_CONNECT_FAILED',address:b\.address/);
  assert.match(source,/error:failure\.detail,address:b\.address,\.\.\.failure/);
  assert.match(source,/getprop','service\.adb\.tcp\.port/);
  assert.match(source,/ip','-f','inet','addr','show','wlan0/);
  assert.doesNotMatch(source,/['"]tcpip['"]/);
  assert.doesNotMatch(source,/service\.adb\.tcp\.port.*setprop/);
});


test('WiFi ADB UI discovers an existing endpoint from selected USB before connecting', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const ui=fs.readFileSync(path.join(dir,'ui.js'),'utf8');
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.match(html,/id="scanWifi">Dò WiFi ADB<\/button>/);
  assert.match(ui,/active\(\)\.find\(serial=>!serial\.includes\(':'\)\)/);
  assert.match(ui,/\/api\/wifi\/candidate\?serial=/);
  assert.match(ui,/candidate\.address/);
  assert.match(ui,/confirm\('Đã tìm thấy WiFi ADB /);
  assert.match(ui,/\/api\/wifi\/connect/);
  assert.match(ui,/wifiFailureText/);
  assert.match(ui,/ADB_ENDPOINT_UNREACHABLE:'Endpoint LAN không phản hồi'/);
  assert.match(ui,/error\.status=response\.status/);
  assert.match(ui,/\['reason','address','detail'\]/);
  assert.match(ui,/requestedAddress/);
  assert.match(ui,/toast\(wifiFailureText\('Dò WiFi ADB',e\),true\)/);
  assert.match(ui,/toast\(wifiFailureText\('WiFi ADB',e,requestedAddress\),true\)/);
  assert.doesNotMatch(ui,/adb\s+tcpip/i);
  assert.doesNotMatch(ui,/setprop\s+service\.adb\.tcp\.port/i);
});


test('non-shell RC6 bootstrapper pins base package and applies verified embedded overlay', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'windows','bootstrapper','Program.cs'),'utf8');
  const project=fs.readFileSync(path.join(dir,'windows','bootstrapper','TigerIQPhoneFarmBootstrapper.csproj'),'utf8');
  assert.match(project,/<PublishSingleFile>true<\/PublishSingleFile>/);
  assert.match(project,/<SelfContained>true<\/SelfContained>/);
  assert.match(project,/EmbeddedResource Include="\.\.\\\.\.\\app\.mjs"/);
  assert.match(project,/EmbeddedResource Include="\.\.\\\.\.\\ui\.js"/);
  assert.match(project,/<Version>1\.3\.0<\/Version>/);
  assert.match(source,/https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/releases\/download\/tigeriq-phone-farm-windows-v0\.5\.0-rc6\/TigerIQ-PhoneFarm-Windows-v0\.5\.0-RC6-d64b2a04\.zip/);
  assert.match(source,/bd8375a8712ee8bc18d725bd45e3652414946b9eb834de6879c2c42ff8a30709/);
  assert.match(source,/d64b2a04558533d0a8690fc9a2ef11fe74d47596/);
  assert.match(source,/a0fd41ceb655a4e2f702c366b988b92832950f57/);
  assert.match(source,/TIGERIQ_PHONE_FARM_OVERLAY_V1/);
  assert.match(source,/TIGERIQ_PHONE_FARM_CURRENT_RELEASE_V2/);
  assert.match(source,/WriteEmbeddedResourceAtomic/);
  assert.match(source,/HashEmbeddedResource/);
  assert.match(source,/File\.Move\(temp, destination, overwrite: true\)/);
  assert.match(source,/Process\.GetProcessesByName\("TigerIQPhoneFarm"\)/);
  assert.match(source,/CloseMainWindow\(\)/);
  assert.match(source,/Kill\(entireProcessTree: true\)/);
  assert.match(source,/uri\.Scheme != Uri\.UriSchemeHttps/);
  assert.match(source,/uri\.Host, "github\.com"/);
  assert.match(source,/SHA-256 gói RC6 không khớp/);
  assert.match(source,/sourceHead trong BUILD_MANIFEST không khớp/);
  assert.match(source,/SHA-256 TigerIQPhoneFarm\.exe không khớp manifest/);
  assert.match(source,/SHA-256 overlay app\.mjs không khớp/);
  assert.match(source,/SHA-256 overlay ui\.js không khớp/);
  assert.match(source,/UiOverlayResource/);
  assert.match(source,/Path\.Combine\(directory, "ui\.js"\)/);
  assert.match(source,/uiSha256/);
  assert.match(source,/Phát hiện đường dẫn ZIP vượt thư mục đích/);
  assert.match(source,/symbolic link/);
  assert.match(source,/UseShellExecute = false/);
  assert.doesNotMatch(source,/ProcessStartInfo\(\s*"(?:powershell|cmd\\.exe|explorer)"/i);
  assert.doesNotMatch(source,/UseShellExecute\s*=\s*true/);
  assert.doesNotMatch(source,/ProcessStartInfo\([\s\S]{0,240}?(?:powershell|cmd\\.exe|netsh|adb\s+tcpip|setprop\s+service\.adb\.tcp\.port)/i);
});
