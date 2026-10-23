import type {Puzzle, RobotState} from '../engine/robot.js';
export function drawGame(canvas:HTMLCanvasElement,level:Puzzle,final?:Readonly<RobotState>):void {
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('CANVAS_UNAVAILABLE');
  const cell=canvas.width/level.width;
  ctx.fillStyle='#0c1730';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<level.height;y++)for(let x=0;x<level.width;x++){
    ctx.fillStyle=(x+y)%2?'#1c3757':'#16304c';
    ctx.fillRect(x*cell+4,y*cell+4,cell-8,cell-8);
  }
  for(const p of level.obstacles){ctx.fillStyle='#b9c3d5';ctx.fillRect((p.x+.17)*cell,(p.y+.17)*cell,cell*.66,cell*.66);}
  const circle=(x:number,y:number,color:string,r=.23)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc((x+.5)*cell,(y+.5)*cell,cell*r,0,Math.PI*2);ctx.fill();};
  const goal=level.goal;
  if(goal.kind==='position')circle(goal.x,goal.y,'#ffce54',.30);
  if(level.switch)circle(level.switch.x,level.switch.y,'#eaa5fa',.25);
  if(level.delivery)circle(level.delivery.x,level.delivery.y,'#ffce54',.27);
  const parcel=final?final.remainingItem:level.item;
  if(parcel){ctx.fillStyle='#f89967';ctx.fillRect((parcel.x+.35)*cell,(parcel.y+.35)*cell,.3*cell,.3*cell);}
  const x=final?.x??level.start.x, y=final?.y??level.start.y, direction=final?.heading??level.start.heading;
  ctx.save();ctx.translate((x+.5)*cell,(y+.5)*cell);ctx.rotate(direction*Math.PI/2);
  ctx.fillStyle='#69e6dc';ctx.beginPath();ctx.moveTo(0,-.32*cell);ctx.lineTo(.27*cell,.22*cell);ctx.lineTo(0,.11*cell);ctx.lineTo(-.27*cell,.22*cell);ctx.closePath();ctx.fill();ctx.restore();
}
