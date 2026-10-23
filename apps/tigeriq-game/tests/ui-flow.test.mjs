import test from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../dist/engine/levels.js';
import {enumerateSolutions} from '../dist/engine/robot.js';

// DOM contract harness: exercises actual compiled event bindings, NOT a real browser.
class StubNode {
  constructor(id = '') { this.id=id; this.hidden=false; this.disabled=false; this.textContent=''; this.className=''; this.children=[]; this.listeners={}; this.type=''; this.focused=false; }
  addEventListener(name, callback) { (this.listeners[name]??=[]).push(callback); }
  focus() { this.focused=true; }
  click() { if(this.disabled) return; for(const cb of (this.listeners.click??[])) cb(); }
  replaceChildren(...children) { this.children=[...children]; }
  appendChild(n) { this.children.push(n); return n; }
}
const ids=['select-screen','play-screen','result-screen','status','level-buttons','back','home','reset','retry','next','run','play-title','goal-description','board','commands','edit-menu','choices','result-title','result-description','result-board','onboarding','onboarding-step','onboarding-description','intro-next','intro-skip','intro-replay'];
function makeHarness(){
  const nodes = Object.fromEntries(ids.map(id=>[id,new StubNode(id)]));
  const graphics = new Proxy({}, {get:(obj,key)=>['beginPath','arc','fill','fillRect','clearRect','save','translate','rotate','moveTo','lineTo','closePath','restore'].includes(key) ? ()=>{} : obj[key],set:(obj,key,value)=>{obj[key]=value;return true;}});
  nodes.board.width=480; nodes.board.height=480; nodes['result-board'].width=480; nodes['result-board'].height=480;
  nodes.board.getContext=()=>graphics; nodes['result-board'].getContext=()=>graphics;
  globalThis.document={listeners:{},getElementById:(id)=>nodes[id]??null,createElement:(tag)=>{assert.equal(tag,'button');return new StubNode();},addEventListener(name,callback){(this.listeners[name]??=[]).push(callback);}};
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

test('real DOM selection cards retain session progress when returning home',async()=>{
  const e=makeHarness();
  await import('../dist/main.js?ui-harness=progress-home');
  assert.match(e['level-buttons'].children[0].textContent,/Chưa chơi/);
  e['level-buttons'].children[0].click();
  e.commands.children[LEVELS[0].editableSlot].click();
  const answer0=enumerateSolutions(LEVELS[0])[0].replacement;
  e.choices.children.find(n=>n.textContent.endsWith(`(${answer0})`)).click();
  e.run.click();
  assert.equal(e['result-title'].textContent,'ĐÃ GIÚP ROBOT!');
  e.home.click();
  assert.match(e['level-buttons'].children[0].textContent,/Đã qua/);
  assert.match(e['level-buttons'].children[4].textContent,/Chưa chơi/);
  e['level-buttons'].children[4].click();
  e.back.click();
  assert.match(e['level-buttons'].children[0].textContent,/Đã qua/);
  e['level-buttons'].children[4].click();
  e.commands.children[LEVELS[4].editableSlot].click();
  const answer4=enumerateSolutions(LEVELS[4])[0].replacement;
  e.choices.children.find(n=>n.textContent.endsWith(`(${answer4})`)).click();
  e.run.click();
  assert.doesNotMatch(e['result-description'].textContent,/vượt qua cả 5 màn/);
  e.next.click();
  assert.match(e['level-buttons'].children[0].textContent,/Đã qua/);
  assert.match(e['level-buttons'].children[4].textContent,/Đã qua/);
  assert.match(e['level-buttons'].children[1].textContent,/Chưa chơi/);
});

test('keyboard Escape and explicit Close cancel the editing menu and restore focus safely',async()=>{
  const e=makeHarness();
  await import('../dist/main.js?ui-harness=close-edit');
  const level=LEVELS[0],slot=level.editableSlot;
  e['level-buttons'].children[0].click();
  e.commands.children[slot].click();
  assert.equal(e['edit-menu'].hidden,false);
  assert.equal(e.choices.children[0].focused,true);
  assert.equal(e.choices.children.length,7); // six legal replacements plus Close
  const answer=enumerateSolutions(level)[0].replacement;
  e.choices.children.find(n=>n.textContent.endsWith(`(${answer})`)).click();
  assert.equal(e.run.disabled,false);
  assert.equal(e.run.focused,true);
  const cancelEscape=globalThis.document.listeners.keydown[0];
  let prevented=false;
  cancelEscape({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
  assert.equal(e['edit-menu'].hidden,false);
  cancelEscape({key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(e['edit-menu'].hidden,true);
  assert.equal(e.run.disabled,true);
  assert.equal(e.commands.children[slot].focused,true);
  e.commands.children[slot].click();
  const close=e.choices.children.find(n=>n.textContent==='Đóng danh sách lệnh');
  assert.ok(close);
  close.click();
  assert.equal(e['edit-menu'].hidden,true);
  assert.equal(e.run.disabled,true);
  e.commands.children[slot].click();
  e.choices.children.find(n=>n.textContent.endsWith(`(${answer})`)).click();
  e.run.click();
  assert.equal(e['result-title'].textContent,'ĐÃ GIÚP ROBOT!');
});

test('three-step onboarding advances, completes, skips and replays without blocking gameplay',async()=>{
  const e=makeHarness();
  await import('../dist/main.js?ui-harness=three-step-onboarding');
  assert.equal(e.onboarding.hidden,false);
  assert.equal(e['intro-replay'].hidden,true);
  assert.match(e['onboarding-step'].textContent,/Bước 1\/3/);
  assert.match(e['onboarding-description'].textContent,/mục tiêu/);
  e['intro-next'].click();
  assert.match(e['onboarding-step'].textContent,/Bước 2\/3/);
  e['intro-next'].click();
  assert.match(e['onboarding-step'].textContent,/Bước 3\/3/);
  assert.equal(e['intro-next'].textContent,'Bắt đầu chơi');
  e['intro-next'].click();
  assert.equal(e.onboarding.hidden,true);
  assert.equal(e['intro-replay'].hidden,false);
  e['intro-replay'].click();
  assert.equal(e['intro-next'].focused,true);
  assert.match(e['onboarding-step'].textContent,/Bước 1\/3/);
  e['intro-skip'].click();
  assert.equal(e.onboarding.hidden,true);
  e['level-buttons'].children[0].click();
  assert.equal(e['play-screen'].hidden,false);
  e.back.click();
  assert.equal(e['intro-replay'].hidden,false);
  assert.equal(e.onboarding.hidden,true);
});
test('onboarding skip from first step and replay starts at the first step',async()=>{
  const e=makeHarness();
  await import('../dist/main.js?ui-harness=skip-first');
  e['intro-skip'].click();
  assert.equal(e.onboarding.hidden,true);
  e['intro-replay'].click();
  assert.match(e['onboarding-step'].textContent,/Bước 1\/3/);
  e['intro-next'].click();
  assert.match(e['onboarding-step'].textContent,/Bước 2\/3/);
  e['intro-skip'].click();
  assert.equal(e.onboarding.hidden,true);
});
