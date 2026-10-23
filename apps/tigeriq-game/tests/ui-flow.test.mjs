import test from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../dist/engine/levels.js';
import {enumerateSolutions} from '../dist/engine/robot.js';

// DOM contract harness: exercises actual compiled event bindings, NOT a real browser.
class StubNode {
  constructor(id = '') { this.id=id; this.hidden=false; this.disabled=false; this.textContent=''; this.className=''; this.children=[]; this.listeners={}; this.type=''; }
  addEventListener(name, callback) { (this.listeners[name]??=[]).push(callback); }
  click() { if(this.disabled) return; for(const cb of (this.listeners.click??[])) cb(); }
  replaceChildren(...children) { this.children=[...children]; }
  appendChild(n) { this.children.push(n); return n; }
}
const ids=['select-screen','play-screen','result-screen','status','level-buttons','back','home','reset','retry','next','run','play-title','goal-description','board','commands','edit-menu','choices','result-title','result-description','result-board'];
function makeHarness(){
  const nodes = Object.fromEntries(ids.map(id=>[id,new StubNode(id)]));
  const graphics = new Proxy({}, {get:(obj,key)=>['beginPath','arc','fill','fillRect','clearRect','save','translate','rotate','moveTo','lineTo','closePath','restore'].includes(key) ? ()=>{} : obj[key],set:(obj,key,value)=>{obj[key]=value;return true;}});
  nodes.board.width=480; nodes.board.height=480; nodes['result-board'].width=480; nodes['result-board'].height=480;
  nodes.board.getContext=()=>graphics; nodes['result-board'].getContext=()=>graphics;
  globalThis.document={getElementById:(id)=>nodes[id]??null,createElement:(tag)=>{assert.equal(tag,'button');return new StubNode();}};
  return nodes;
}
test('DOM-bound clicks follow all five levels and reach final victory',async()=>{
  const e=makeHarness();
  await import('../dist/main.js?ui-harness=1');
  assert.equal(e['select-screen'].hidden,false);
  assert.equal(e['level-buttons'].children.length,5);
  e['level-buttons'].children[0].click();
  for(let i=0;i<5;i++){
    assert.equal(e['play-screen'].hidden,false, `play level ${i+1}`);
    assert.match(e['play-title'].textContent,RegExp(`Màn ${i+1}/5`));
    assert.equal(e.run.disabled,true);
    const editable=e.commands.children[LEVELS[i].editableSlot];
    editable.click();
    assert.equal(e['edit-menu'].hidden,false);
    const replacement=enumerateSolutions(LEVELS[i])[0].replacement;
    const choice=e.choices.children.find(node=>node.textContent.endsWith(`(${replacement})`));
    assert.ok(choice,`replacement available for level ${i+1}`);
    choice.click();
    assert.equal(e.run.disabled,false);
    e.run.click();
    assert.equal(e['result-screen'].hidden,false);
    assert.equal(e['result-title'].textContent,'ĐÃ GIÚP ROBOT!');
    assert.equal(e.next.hidden,false);
    if(i===4) assert.match(e['result-description'].textContent,/vượt qua cả 5 màn/);
    e.next.click();
  }
  assert.equal(e['select-screen'].hidden,false);
  assert.equal(e['level-buttons'].children.length,5);
});

test('DOM click-through of only stage 5 never claims completion of all five',async()=>{
  const e=makeHarness();
  await import('../dist/main.js?ui-harness=jump-to-last');
  e['level-buttons'].children[4].click();
  assert.match(e['play-title'].textContent,/Màn 5\/5/);
  const level=LEVELS[4];
  e.commands.children[level.editableSlot].click();
  const replacement=enumerateSolutions(level)[0].replacement;
  const choice=e.choices.children.find(node=>node.textContent.endsWith(`(${replacement})`));
  assert.ok(choice);
  choice.click();
  e.run.click();
  assert.equal(e['result-title'].textContent,'ĐÃ GIÚP ROBOT!');
  assert.doesNotMatch(e['result-description'].textContent,/vượt qua cả 5 màn/);
  assert.match(e['result-description'].textContent,/thắng màn 5/);
});
