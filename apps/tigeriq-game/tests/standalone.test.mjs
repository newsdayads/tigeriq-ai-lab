import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {LEVELS} from '../dist/engine/levels.js';
import {enumerateSolutions,simulate,replaceExactlyOne} from '../dist/engine/robot.js';
import {flattenG06Module} from '../scripts/build-standalone.mjs';

const target=new URL('../dist/robot-oops-offline.html',import.meta.url);
const receiptUrl=new URL('../dist/robot-oops-offline.receipt.json',import.meta.url);
const load=async()=>{const html=await readFile(target,'utf8');return {
  html,script:/<script data-tigeriq-g06-offline="true">\n([\s\S]+?)<\/script>/.exec(html)?.[1]
};};

class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.hidden=false;this.disabled=false;this.textContent='';this.className='';this._click=null;this.style={};this.width=480;this.height=480;}
  addEventListener(type,cb){if(type==='click')this._click=cb;}
  appendChild(e){this.children.push(e);return e;}
  replaceChildren(...items){this.children=items;}
  focus(){}
  click(){if(!this.disabled&&typeof this._click==='function')this._click();}
  getContext(){return new Proxy({}, {get:(_t,key)=>['fillRect','beginPath','arc','fill','save','translate','rotate','moveTo','lineTo','closePath','restore','clearRect'].includes(key)?()=>{}:null,set:()=>true});}
}
function runGame(js){
  const ids=new Map();
  const doc={
    getElementById(id){if(!ids.has(id))ids.set(id,new Element(id==='board'||id==='result-board'?'canvas':'div'));return ids.get(id);},
    createElement:tag=>new Element(tag),
    addEventListener(){}
  };
  runInNewContext(js,{document:doc,console,Math,Number,Object,String,Array,Error,RangeError});
  const get=id=>doc.getElementById(id);
  return {get,click:id=>get(id).click()};
}

test('packaged offline HTML is self-contained and retains canonical five levels',async()=>{
  const {html,script}=await load();
  assert.ok(script,'generated inline game entrypoint is required');
  assert.match(html,/<style data-tigeriq-g06-offline="true">/);
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=/);
  assert.doesNotMatch(script,/(^|\n)\s*(?:import|export)\s/m);
  assert.doesNotMatch(script,/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
  const receipt=JSON.parse(await readFile(receiptUrl,'utf8'));
  assert.equal(receipt.sha256,createHash('sha256').update(html).digest('hex'));
  assert.equal(receipt.phoneAccepted,false);
  assert.equal(receipt.nativeLeaseVerified,false);
  assert.equal(receipt.production,false);
  for(const l of LEVELS)assert.ok(script.includes(l.id),l.id);
});

test('generated real UI can finish all five canonical levels with one actual edit each',async()=>{
  const {script}=await load();const {get,click}=runGame(script);
  click('intro-skip');
  for(let i=0;i<LEVELS.length;i++){
    const level=LEVELS[i];
    const answers=enumerateSolutions(level);
    assert.ok(answers.length>0,level.id);
    assert.equal(simulate(level,level.originalCommands).win,false,level.id);
    assert.equal(simulate(level,replaceExactlyOne(level,answers[0])).win,true,level.id);
    get('level-buttons').children[i].click();
    assert.equal(get('play-screen').hidden,false);
    get('commands').children[level.editableSlot].click();
    const desired=get('choices').children.find(b=>b.textContent.includes('('+answers[0].replacement+')'));
    assert.ok(desired,level.id+' choice visible');
    desired.click();
    assert.equal(get('run').disabled,false);
    click('run');
    assert.equal(get('result-screen').hidden,false);
    assert.match(get('result-title').textContent,/ĐÃ GIÚP ROBOT/);
    click('next');
  }
  assert.equal(get('select-screen').hidden,false);
  assert.equal(get('level-buttons').children.length,5);
  for(const button of get('level-buttons').children)assert.match(button.textContent,/Đã qua/);
});

test('an incorrect replacement fails visibly and retry restores a clean editable state',async()=>{
  const {script}=await load();const {get,click}=runGame(script);
  click('intro-skip');get('level-buttons').children[0].click();
  get('commands').children[LEVELS[0].editableSlot].click();
  const wrong=get('choices').children.find(b=>b.textContent.includes('(WAIT)'));
  assert.ok(wrong);wrong.click();click('run');
  assert.match(get('result-title').textContent,/CHƯA THÀNH CÔNG/);
  assert.equal(get('next').hidden,true);
  click('retry');
  assert.equal(get('play-screen').hidden,false);
  assert.equal(get('run').disabled,true);
});

test('standalone builder refuses injected imports and unknown modules',()=>{
  assert.throws(()=>flattenG06Module('unknown.js','export const ok=true;'),/UNKNOWN_G06_MODULE/);
  assert.throws(()=>flattenG06Module('main.js','import {x} from "https://attacker.invalid";'),/UNEXPECTED_MODULE_DEPENDENCY/);
  assert.throws(()=>flattenG06Module('engine/robot.js','export * from "./danger.js";'),/UNSUPPORTED_WILDCARD_MODULE/);
  assert.throws(()=>flattenG06Module('engine/robot.js','export function f(){import("./danger.js")}'),/DYNAMIC_IMPORT_FORBIDDEN/);
});
