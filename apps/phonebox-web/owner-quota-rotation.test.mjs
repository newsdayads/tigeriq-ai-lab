import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {applyOwnerQuotaRotation} from './owner-quota-rotation.mjs';
const fixture = [
  'W.quotaring = {',
  "  needs: ['quotas', 'tick'],",
  '  create(box, { o }) {',
  "    const prov = o.provider || 'claude', idx = Number(o.limit) || 0;",
  "    const st = { color: 'white', logo: 'x' };",
  "    const dial = dialEl(), label = h('div', 'g-label'), sub = h('div', 'g-sub');",
  '    box.append(dial, label, sub);',
  '    let last = 0;',
  '    const render = () => {',
  '      const p = quotaProviders().find(x => x.id === prov);',
  '      const l = p?.limits?.[idx];',
  "      if (!l) { dial.set(0, '-'); return; }",
  '      dial.set(l.percent, Math.round(l.percent));',
  '      label.textContent = st.logo + p.name + quotaText(l.label);',
  "      sub.textContent = l.resetsAt ? 'resets in ' + fmtDur(l.resetsAt - Date.now()) : '';",
  '    };',
  "    return { update(kind) { if (kind === 'tick' && Date.now() - last < 30_000) return; last = Date.now(); render(); } };",
  '  },',
  '};',
  'W.volume = {};'
].join('\n');
function run(source,provider,limits,page='home',limit='0') {
  let now=100000, rendered, label, sub, rotated=false;
  const W={};
  const providers=[{id:provider,name:provider,limits}];
  vm.runInNewContext(source,{W,Date:{now:()=>now},quotaProviders:()=>providers,
    dialEl:()=>({set:(_,v)=>{rendered=v;},style:{setProperty(){}}}),h:()=>({}),
    quotaText:x=>x,fmtDur:x=>String(x)});
  const inst=W.quotaring.create({style:{setProperty(){}},classList:{add(){rotated=true;}},append(d,l,s){label=l;sub=s;}},{o:{provider,limit},page:{id:page}});
  return {at(ms,kind='tick'){now=100000+ms;inst.update(kind);return [rendered,label.textContent,sub.textContent];},rotated};
}
test('Codex cycles five-hour and weekly every 5000 ms and preserves reset',()=>{
  const src=applyOwnerQuotaRotation(fixture); assert.ok(src);
  const w=run(src,'codex',[{label:'5-hour',percent:10,resetsAt:200000},{label:'Weekly',percent:98,resetsAt:300000}]);
  assert.equal(w.rotated,true); assert.deepEqual(w.at(0,'quotas'),[10,'Codex\n5-hour','Reset 100000']);
  assert.equal(w.at(4999)[0],10); assert.deepEqual(w.at(5000),[98,'Codex\nWeekly','Reset 195000']); assert.equal(w.at(10000)[0],10);
});
test('Antigravity cycles all four real windows, ignores invalid data and wraps',()=>{
  const w=run(applyOwnerQuotaRotation(fixture),'antigravity',[
    {label:'5-hour (Gemini)',percent:1},{label:'Weekly (Gemini)',percent:2},{label:'5-hour (Claude/GPT)',percent:3},{label:'Weekly (Claude/GPT)',percent:4},{label:'Weekly invalid',percent:null}]);
  assert.equal(w.at(0,'quotas')[0],1); assert.equal(w.at(5000)[0],2); assert.equal(w.at(10000)[0],3); assert.equal(w.at(15000)[0],4); assert.equal(w.at(20000)[0],1);
});
test('non-home widgets stay fixed; changed upstream falls back safely',()=>{
  const w=run(applyOwnerQuotaRotation(fixture),'codex',[{label:'5-hour',percent:10},{label:'Weekly',percent:98}],'status','1');
  assert.equal(w.rotated,false); assert.equal(w.at(0,'quotas')[0],98); assert.equal(w.at(5000)[0],98); assert.equal(w.at(30000)[0],98);
  assert.equal(applyOwnerQuotaRotation(fixture.replace('const l = p?.limits?.[idx];','const l = null;')),null);
});
