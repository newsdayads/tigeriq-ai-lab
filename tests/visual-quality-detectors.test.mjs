import {readFileSync} from 'node:fs';
import {it as test,expect} from 'vitest';

const detectors=JSON.parse(readFileSync(new URL('../docs/skills/visual-quality-gate/detectors.json',import.meta.url),'utf8'));

function styleRule(id,style){
  const rule=detectors.rules.find(r=>r.id===id);
  if(!rule)throw new Error('missing rule '+id);
  const pairs=Object.entries(style||{});
  const matchClause=clause=>pairs.some(([k,v])=>k===clause.property&&new RegExp(clause.matches,'i').test(String(v)));
  if(rule.trigger.all)return rule.trigger.all.every(matchClause);
  if(rule.trigger.any)return rule.trigger.any.some(matchClause);
  return false;
}

function sideTabFinding({width,hostHeight,height,leftGap=99,rightGap=99,chromatic=true,empty=true,context='card'}){
  const rule=detectors.rules.find(r=>r.id==='side-tab');
  const g=rule.trigger.geometry;
  if(['nav','progress','slider','scrollbar','separator','tablist','status'].includes(context))return false;
  return empty&&chromatic&&width>=g.widthMinPx&&width<=g.widthMaxPx&&height>=hostHeight*g.minHostHeightRatio&&(Math.abs(leftGap)<=g.edgeTolerancePx||Math.abs(rightGap)<=g.edgeTolerancePx);
}

test('visual detector delta is pinned, machine-readable and non-duplicative',()=>{
  expect(detectors.source.project).toBe('pbakaus/impeccable');
  expect(detectors.source.commit).toBe('ece38d9904b8a619b3f77cab476eacad09c4fb11');
  expect(detectors.rules.map(r=>r.id).sort()).toEqual(['glow-shadow','gradient-text','side-tab']);
  for(const rule of detectors.rules){
    expect(rule.finding).toBeTruthy();
    expect(rule.rationale).toBeTruthy();
    expect(rule.falsePositiveGuards.length).toBeGreaterThan(0);
    expect(['hard','advisory']).toContain(rule.severity);
  }
});

test('gradient-text fires only on gradient plus text clipping',()=>{
  expect(styleRule('gradient-text',{'background-image':'linear-gradient(red,blue)','background-clip':'text'})).toBe(true);
  expect(styleRule('gradient-text',{'background-image':'linear-gradient(red,blue)','background-clip':'border-box'})).toBe(false);
  expect(styleRule('gradient-text',{'color':'#fff'})).toBe(false);
});

test('glow-shadow stays advisory and ignores small normal shadows',()=>{
  const rule=detectors.rules.find(r=>r.id==='glow-shadow');
  expect(rule.severity).toBe('advisory');
  expect(styleRule('glow-shadow',{'box-shadow':'0 0 48px rgba(99,102,241,.6)'})).toBe(true);
  expect(styleRule('glow-shadow',{'box-shadow':'0 0 4px rgba(99,102,241,.6)'})).toBe(false);
});

test('side-tab catches only bounded decorative stripe geometry and preserves semantic guards',()=>{
  expect(sideTabFinding({width:4,hostHeight:100,height:100,leftGap:0})).toBe(true);
  expect(sideTabFinding({width:4,hostHeight:100,height:100,leftGap:0,context:'progress'})).toBe(false);
  expect(sideTabFinding({width:4,hostHeight:100,height:100,leftGap:0,chromatic:false})).toBe(false);
  expect(sideTabFinding({width:4,hostHeight:100,height:100,leftGap:0,empty:false})).toBe(false);
  expect(sideTabFinding({width:20,hostHeight:100,height:100,leftGap:0})).toBe(false);
});

test('new delta cannot add false hard-fails for advisory detector fixtures',()=>{
  const hard=detectors.rules.filter(r=>r.severity==='hard').map(r=>r.id);
  expect(hard).toEqual(['gradient-text']);
  expect(sideTabFinding({width:4,hostHeight:100,height:100,leftGap:0,context:'status'})).toBe(false);
  expect(styleRule('glow-shadow',{'box-shadow':'0 0 4px currentColor'})).toBe(false);
});
