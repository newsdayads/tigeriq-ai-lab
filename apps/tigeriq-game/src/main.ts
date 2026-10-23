import {LEVELS} from './engine/levels.js';
import type {Command, Puzzle} from './engine/robot.js';
import {newSession,openLevel,selectSlot,selectReplacement,executeLevel,retryLevel,nextLevel,type GameSession} from './levels/game.js';
import {drawGame} from './levels/draw.js';
const commandNames:Record<Command,string>={MOVE:'Đi tới',TURN_LEFT:'Quay trái',TURN_RIGHT:'Quay phải',PICK:'Nhặt',DROP:'Đặt',PRESS:'Nhấn',WAIT:'Đợi'};
const allCommands=Object.keys(commandNames) as Command[];
const $=<T extends HTMLElement>(id:string):T=>{const e=document.getElementById(id);if(!e)throw new Error('Missing UI '+id);return e as T;};
const sections={select:$('select-screen'),play:$('play-screen'),result:$('result-screen')};
let current:GameSession=newSession();let status='Chọn màn để bắt đầu.';
const introSteps=[
  {title:'Bước 1/3 · Xem mục tiêu',description:'Nhìn ô đích màu vàng, công tắc tím hoặc vị trí giao hàng trên lưới và đọc mục tiêu ở đầu màn.'},
  {title:'Bước 2/3 · Sửa một lệnh',description:'Chạm lệnh có chữ Có thể sửa, rồi chọn một lệnh mới khác lệnh cũ. Các lệnh Cố định không thay được.'},
  {title:'Bước 3/3 · Chạy và xem kết quả',description:'Chạm CHẠY để giúp robot. Nếu sai, chọn Sửa lại và thử tiếp. Nếu đúng, chọn Màn tiếp.'}
] as const;
let introIndex=0;let introVisible=true;
function text(id:string,value:string):void{$(id).textContent=value;}
function button(label:string,click:()=>void):HTMLButtonElement {const e=document.createElement('button');e.type='button';e.textContent=label;e.addEventListener('click',click);return e;}
function goalDescription(l:Puzzle):string {return l.goal.kind==='position'?`Đưa robot tới ô (${l.goal.x}, ${l.goal.y}).`:l.goal.kind==='switch'?'Cho robot nhấn công tắc màu tím.':'Đưa gói hàng tới ô nhận màu vàng.';}
function failMessage(code:string):string {return ({BLOCKED:'Robot bị vật cản chắn đường.',OUT_OF_BOUNDS:'Robot đi ra ngoài lưới.',INVALID_PICK:'Robot chưa đứng tại gói hàng.',INVALID_DROP:'Robot chưa cầm gói hàng.',INVALID_PRESS:'Robot chưa đứng tại công tắc.',STEP_LIMIT:'Robot đã hết số bước cho phép.',GOAL_NOT_MET:'Robot chưa hoàn thành mục tiêu.'} as Record<string,string>)[code]??'Chưa thành công.';}
function cancelEdit():void {
  if(current.screen!=='play'||current.editSlot===null)return;
  const slot=current.editSlot;
  current={...current,editSlot:null,replacement:null};
  status='Đã đóng danh sách lệnh.';
  render();
  ($('commands').children[slot] as HTMLButtonElement|undefined)?.focus?.();
}
function renderOnboarding():void {
  $('onboarding').hidden=!introVisible;
  $('intro-replay').hidden=introVisible;
  if(!introVisible)return;
  text('onboarding-step',introSteps[introIndex].title);
  text('onboarding-description',introSteps[introIndex].description);
  text('intro-next',introIndex===introSteps.length-1?'Bắt đầu chơi':'Tiếp');
}
function render():void {
  for(const [key,node] of Object.entries(sections))node.hidden=key!==current.screen;
  text('status',status);
  if(current.screen==='select'){
    renderOnboarding();
    const list=$('level-buttons');list.replaceChildren();
    for(let i=0;i<LEVELS.length;i++)list.appendChild(button(`${i+1}. ${LEVELS[i].name} · ${current.completedLevels.includes(i)?'Đã qua · Chơi lại':'Chưa chơi · Chơi'}`,()=>{current=openLevel(i,current.completedLevels);status='Chọn lệnh có thể sửa.';render();}));return;
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
        current=selectSlot(current,i);status='Chọn một lệnh khác trong danh sách.';render();($('choices').children[0] as HTMLButtonElement|undefined)?.focus?.();
      });e.className=editable?'editable':'';if(i===current.editSlot)e.className+=' selected';list.appendChild(e);
    }
    const editing=current.editSlot!==null;$('edit-menu').hidden=!editing;
    if(editing){const choices=$('choices');choices.replaceChildren();for(const cmd of allCommands.filter(c=>c!==level.originalCommands[level.editableSlot])){
      const e=button(`${commandNames[cmd]} (${cmd})`,()=>{current=selectReplacement(current,cmd);status=`Đã chọn ${commandNames[cmd]}. Nhấn CHẠY.`;render();$<HTMLButtonElement>('run').focus?.();});
      if(cmd===current.replacement)e.className='selected';choices.appendChild(e);
    }choices.appendChild(button('Đóng danh sách lệnh',()=>cancelEdit()));}
    ($<HTMLButtonElement>('run')).disabled=current.replacement===null;
    return;
  }
  if(current.screen==='result'){
    const outcome=current.outcome!;const won=outcome.win;
    text('result-title',won?'ĐÃ GIÚP ROBOT!':'CHƯA THÀNH CÔNG');
    text('result-description',won?`Màn ${current.levelIndex+1} thành công sau ${outcome.steps} bước. ${current.levelIndex===LEVELS.length-1?(current.completedLevels.length===LEVELS.length?'Bạn đã vượt qua cả 5 màn!':'Bạn đã thắng màn 5. Hãy hoàn thành các màn còn lại.'):'Chọn màn tiếp theo.'}`:failMessage(outcome.reason));
    drawGame($<HTMLCanvasElement>('result-board'),level,outcome.state);
    const next=$<HTMLButtonElement>('next');next.hidden=!won;next.textContent=current.levelIndex===LEVELS.length-1?'Chọn màn':'Màn tiếp';
  }
}
$('intro-next').addEventListener('click',()=>{
  if(current.screen!=='select'||!introVisible)return;
  if(introIndex===introSteps.length-1){introVisible=false;status='Đã hoàn tất hướng dẫn. Chọn màn để chơi.';}
  else introIndex++;
  render();
});
$('intro-skip').addEventListener('click',()=>{
  if(current.screen!=='select'||!introVisible)return;
  introVisible=false;status='Đã bỏ qua hướng dẫn. Chọn màn để chơi.';render();
});
$('intro-replay').addEventListener('click',()=>{
  if(current.screen!=='select'||introVisible)return;
  introIndex=0;introVisible=true;status='Đang xem lại hướng dẫn.';render();
  ($<HTMLButtonElement>('intro-next')).focus?.();
});
$('back').addEventListener('click',()=>{current={...newSession(),completedLevels:[...current.completedLevels]};status='Đã về chọn màn.';render();});
$('home').addEventListener('click',()=>{current={...newSession(),completedLevels:[...current.completedLevels]};status='Đã về chọn màn.';render();});
$('reset').addEventListener('click',()=>{current=retryLevel(current);status='Đã đặt lại màn chơi.';render();});
$('retry').addEventListener('click',()=>{current=retryLevel(current);status='Chọn lệnh khác và thử lại.';render();});
$('next').addEventListener('click',()=>{current=nextLevel(current);status='Đã mở màn kế tiếp.';render();});
$('run').addEventListener('click',()=>{if(current.screen!=='play'||current.replacement===null)return;current=executeLevel(current);status=current.outcome?.win?'Đã thắng màn này.':'Hãy sửa lệnh và thử lại.';render();});
document.addEventListener('keydown',(event:KeyboardEvent)=>{if(event.key==='Escape'&&current.screen==='play'&&current.editSlot!==null){event.preventDefault();cancelEdit();}});
render();
