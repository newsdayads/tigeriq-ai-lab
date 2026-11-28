import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('./owner-overrides/owner-quota-rotation.css',import.meta.url),'utf8');
const marker='/* Owner 2026-11-29: portrait-only adaptive layout';
const patch=css.slice(css.indexOf(marker));
function rule(selector){
  const match=patch.match(new RegExp(selector.replace(/[.*+?^\${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]+)\\}'));
  assert.ok(match,'missing '+selector);
  return match[1];
}
test('portrait layout patch is confined to portrait media query',()=>{
  assert.ok(css.includes(marker));
  assert.match(patch,/@media screen and \(max-width:700px\) and \(min-height:541px\) and \(orientation:portrait\)/);
  let depth=0;
  const clean=patch.replace(/\/\*[\s\S]*?\*\//g,'');
  const start=clean.indexOf('{');assert.ok(start>0);
  for(let i=start;i<clean.length;i++){if(clean[i]==='{')depth++;if(clean[i]==='}')depth--;if(depth===0){assert.equal(clean.slice(i+1).trim(),'');break;}}
  assert.equal(depth,0);
});
test('two-column system cards and independent non-home layout',()=>{
  assert.match(rule('.page:not([data-id="home"]) .grid'),/grid-template-columns:repeat\(2,minmax\(0,1fr\)\) !important/);
  assert.match(rule('.page[data-id="system"] .grid > .w-meters'),/grid-area:auto \/ auto \/ auto \/ span 1 !important/);
  assert.match(rule('.page:not([data-id="home"]) .grid > .w:only-child'),/grid-area:auto \/ 1 \/ auto \/ -1 !important/);
});
test('process and media content can expand and navigation reserves safe space',()=>{
  assert.match(rule('.page:not([data-id="home"]) .grid > .w-processes'),/height:auto !important/);
  assert.match(rule('.page .w-processes .p-title'),/white-space:normal/);
  assert.match(rule('.page .w-processes .p-grid'),/grid-template-columns:1fr !important/);
  assert.match(rule('.page:not([data-id="home"]) .w-media .m-text'),/flex:1 1 0/);
  assert.match(rule('body:not(.pagebar-docked):not(.controls-top) #pager > .page'),/100dvh - 52px - env\(safe-area-inset-bottom,0px\)/);
});
