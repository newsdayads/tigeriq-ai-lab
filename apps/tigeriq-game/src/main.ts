import {LEVELS} from './engine/levels.js';
import type {Command, Puzzle} from './engine/robot.js';
import {newSession,openLevel,selectSlot,selectReplacement,executeLevel,retryLevel,nextLevel,type GameSession} from './levels/game.js';
import {drawGame} from './levels/draw.js';
const commandNames:Record<Command,string>={MOVE:'Đi tới',TURN_LEFT:'Quay trái',TURN_RIGHT:'Quay phải',PICK:'Nhặt',DROP:'Đặt',PRESS:'Nhấn',WAIT:'Đợi'};
const allCommands=Object.keys(commandNames) as Command[];
const $=<T extends HTMLElement>(id:string):T=>{const e=document.getElementById(id);if(!e)throw new Error('Missing UI '+id);return e as T;};
const sections={select:$('select-screen'),play:$('play-screen'),result:$('result-screen')};
let current:GameSession=newSession();let status='Chọn màn để bắt đầu.';
function text(id:string,value:string):void{$(id).textContent=value;}
function button(label:string,click:()=>void):HTMLButtonElement {const e=document.createElement('button');e.type='button';e.textContent=label;e.addEventListener('click',click);return e;}
function goalDescription(l:Puzzle):string {return l.goal.kind==='position'?`Đưa robot tới ô (${l.goal.x}, ${l.goal.y}).`:l.goal.kind==='switch'?'Cho robot nhấn công tắc màu tím.':'Đưa gói hàng tới ô nhận màu vàng.';}
function failMessage(code:string):string {return ({BLOCKED:'Robot bị vật cản chắn đường.',OUT_OF_BOUNDS:'Robot đi ra ngoài lưới.',INVALID_PICK:'Robot chưa đứng tại gói hàng.',INVALID_DROP:'Robot chưa cầm gói hàng.',INVALID_PRESS:'Robot chưa đứng tại công tắc.',STEP_LIMIT:'Robot đã hết số bước cho phép.',GOAL_NOT_MET:'Robot chưa hoàn thành mục tiêu.'} as Record<string,string>)[code]??'Chưa thành công.';}
function render():void {
  for(const [key,node] of Object.entries(sections))node.hidden=key!==current.screen;
  text('status',status);
  if(current.screen==='select'){
    const list=$('level-buttons');list.replaceChildren();
    for(let i=0;i<LEVELS.length;i++)list.appendChild(button(`${i+1}. ${LEVELS[i].name} · Chơi`,()=>{current=openLevel(i);status='Chọn lệnh có thể sửa.';render();}));return;
  }
  const level=LEVELS[current.levelIndex];
  if(current.screen==='play'){
    text('play-title',`Màn ${current.levelIndex+1}/5 · ${level.name}`);text('goal-description',goalDescription(level));
    drawGame($<HTMLCanvasElement>('board'),level);
    const list=$('commands');list.replaceChildren();
    for(let i=0;i<level.originalCommands.length;i++){
      const editable=i===level.editableSlot;
      const e=button(`Lệnh ${i+1}: ${i===current.editSlot&&current.replacement?current.replacement:level.originalCommands[i]} · ${editable?'Có thể sửa':'Cố định'}`,()=>{
        if(!editable){status='Lệnh cố định, không thể thay.';render();return;}
        current=selectSlot(current,i);status='Chọn một lệnh khác trong danh sách.';render();
      });e.className=editable?'editable':'';if(i===current.editSlot)e.className+=' selected';list.appendChild(e);
    }
    const editing=current.editSlot!==null;$('edit-menu').hidden=!editing;
    if(editing){const choices=$('choices');choices.replaceChildren();for(const cmd of allCommands.filter(c=>c!==level.originalCommands[level.editableSlot])){
      const e=button(`${commandNames[cmd]} (${cmd})`,()=>{current=selectReplacement(current,cmd);status=`Đã chọn ${commandNames[cmd]}. Nhấn CHẠY.`;render();});
      if(cmd===current.replacement)e.className='selected';choices.appendChild(e);
    }}
    ($<HTMLButtonElement>('run')).disabled=current.replacement===null;
    return;
  }
  if(current.screen==='result'){
    const outcome=current.outcome!;const won=outcome.win;
    text('result-title',won?'ĐÃ GIÚP ROBOT!':'CHƯA THÀNH CÔNG');
    text('result-description',won?`Màn ${current.levelIndex+1} thành công sau ${outcome.steps} bước. ${current.levelIndex===LEVELS.length-1?'Bạn đã vượt qua cả 5 màn!':'Chọn màn tiếp theo.'}`:failMessage(outcome.reason));
    drawGame($<HTMLCanvasElement>('result-board'),level,outcome.state);
    const next=$<HTMLButtonElement>('next');next.hidden=!won;next.textContent=current.levelIndex===LEVELS.length-1?'Chọn màn':'Màn tiếp';
  }
}
$('back').addEventListener('click',()=>{current=newSession();status='Đã về chọn màn.';render();});
$('home').addEventListener('click',()=>{current=newSession();status='Đã về chọn màn.';render();});
$('reset').addEventListener('click',()=>{current=retryLevel(current);status='Đã đặt lại màn chơi.';render();});
$('retry').addEventListener('click',()=>{current=retryLevel(current);status='Chọn lệnh khác và thử lại.';render();});
$('next').addEventListener('click',()=>{current=nextLevel(current);status='Đã mở màn kế tiếp.';render();});
$('run').addEventListener('click',()=>{if(current.screen!=='play'||current.replacement===null)return;current=executeLevel(current);status=current.outcome?.win?'Đã thắng màn này.':'Hãy sửa lệnh và thử lại.';render();});
render();
