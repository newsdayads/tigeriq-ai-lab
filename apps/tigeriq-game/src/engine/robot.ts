/** Deterministic robot puzzle executor. No I/O, random state, network or timers. */
export type Command = 'MOVE' | 'TURN_LEFT' | 'TURN_RIGHT' | 'PICK' | 'DROP' | 'PRESS' | 'WAIT';
export type Heading = 0 | 1 | 2 | 3;
export interface Point { x: number; y: number; }
export interface RobotState extends Point { heading: Heading; holding: boolean; pressed: boolean; delivered: boolean; remainingItem: Point | null; }
export type Goal = ({kind:'position'} & Point) | {kind:'switch'} | {kind:'delivery'};
export interface Puzzle {
  id: string; name: string; width: number; height: number;
  start: Point & {heading: Heading}; originalCommands: readonly Command[];
  editableSlot: number; maxSteps: number; item: Point | null; switch: Point | null;
  delivery: Point | null; obstacles: readonly Point[]; goal: Goal;
}
export type FailureReason = 'OUT_OF_BOUNDS' | 'BLOCKED' | 'INVALID_PICK' | 'INVALID_DROP' | 'INVALID_PRESS' | 'STEP_LIMIT' | 'GOAL_NOT_MET' | 'SOLVED';
export interface TraceEntry { step: number; command: Command; state: RobotState; }
export interface SimulationResult { win: boolean; reason: FailureReason; steps: number; state: RobotState; trace: readonly TraceEntry[]; }
export interface Replacement { slot: number; replacement: Command; }
const COMMANDS: readonly Command[] = ['MOVE', 'TURN_LEFT', 'TURN_RIGHT', 'PICK', 'DROP', 'PRESS', 'WAIT'];
const DELTAS: readonly (readonly [number,number])[] = [[0,-1],[1,0],[0,1],[-1,0]];
function same(a:Point,b:Point):boolean{return a.x===b.x&&a.y===b.y;}
function validPoint(point:Point,level:Puzzle):boolean{return Number.isInteger(point.x)&&Number.isInteger(point.y)&&point.x>=0&&point.y>=0&&point.x<level.width&&point.y<level.height;}
function cloneState(s:RobotState):RobotState{return {...s,remainingItem:s.remainingItem?{...s.remainingItem}:null};}
export function validatePuzzle(level:Puzzle):void {
  if(!level.id || !Number.isInteger(level.width)||!Number.isInteger(level.height)||level.width<2||level.height<2)throw new Error('INVALID_BOARD');
  if(!validPoint(level.start,level) || !Number.isInteger(level.start.heading)||level.start.heading<0||level.start.heading>3)throw new Error('INVALID_START');
  if(!Array.isArray(level.originalCommands)||level.originalCommands.length===0||level.originalCommands.some(c=>!COMMANDS.includes(c)))throw new Error('INVALID_COMMANDS');
  if(!Number.isInteger(level.editableSlot)||level.editableSlot<0||level.editableSlot>=level.originalCommands.length)throw new Error('INVALID_SLOT');
  if(!Number.isInteger(level.maxSteps)||level.maxSteps<=0||level.maxSteps>1000)throw new Error('INVALID_STEP_LIMIT');
  for(const p of [...level.obstacles,...(level.item?[level.item]:[]),...(level.switch?[level.switch]:[]),...(level.delivery?[level.delivery]:[])])if(!validPoint(p,level))throw new Error('INVALID_POINT');
  if(level.obstacles.some(p=>same(p,level.start)))throw new Error('BLOCKED_START');
  if(!['position','switch','delivery'].includes(level.goal.kind))throw new Error('INVALID_GOAL');
  if(level.goal.kind==='position'&&!validPoint(level.goal,level))throw new Error('INVALID_GOAL_POSITION');
  if(level.goal.kind==='switch'&&!level.switch)throw new Error('MISSING_SWITCH');
  if(level.goal.kind==='delivery'&&(!level.delivery||!level.item))throw new Error('MISSING_DELIVERY');
}
export function replaceExactlyOne(level:Puzzle,edit:Replacement):Command[] {
  validatePuzzle(level);
  if(!edit || edit.slot!==level.editableSlot || !COMMANDS.includes(edit.replacement) || level.originalCommands[edit.slot]===edit.replacement)throw new Error('EXACTLY_ONE_VALID_EDIT_REQUIRED');
  const commands=[...level.originalCommands];commands[edit.slot]=edit.replacement;
  return commands;
}
export function simulate(level:Puzzle,commands:readonly Command[]):SimulationResult {
  validatePuzzle(level);
  if(!Array.isArray(commands)||commands.some(x=>!COMMANDS.includes(x)))throw new Error('INVALID_COMMANDS');
  let state:RobotState={x:level.start.x,y:level.start.y,heading:level.start.heading,holding:false,pressed:false,delivered:false,remainingItem:level.item?{...level.item}:null};
  const trace:TraceEntry[]=[];
  const result=(win:boolean,reason:FailureReason):SimulationResult=>({win,reason,steps:trace.length,state:cloneState(state),trace});
  for(let i=0;i<commands.length;i++){
    if(i>=level.maxSteps)return result(false,'STEP_LIMIT');
    const cmd=commands[i];
    let failure:FailureReason|null=null;
    if(cmd==='TURN_LEFT')state.heading=((state.heading+3)%4) as Heading;
    else if(cmd==='TURN_RIGHT')state.heading=((state.heading+1)%4) as Heading;
    else if(cmd==='MOVE'){
      const [dx,dy]=DELTAS[state.heading]!;const next={x:state.x+dx,y:state.y+dy};
      if(!validPoint(next,level))failure='OUT_OF_BOUNDS';
      else if(level.obstacles.some(p=>same(p,next)))failure='BLOCKED';
      else {state.x=next.x;state.y=next.y;}
    }else if(cmd==='PICK'){
      if(state.holding||!state.remainingItem||!same(state,state.remainingItem))failure='INVALID_PICK';
      else {state.holding=true;state.remainingItem=null;}
    }else if(cmd==='DROP'){
      if(!state.holding)failure='INVALID_DROP';
      else {state.holding=false;state.delivered=!!level.delivery&&same(state,level.delivery);}
    }else if(cmd==='PRESS'){
      if(!level.switch||!same(state,level.switch))failure='INVALID_PRESS';
      else state.pressed=true;
    }
    trace.push({step:i+1,command:cmd,state:cloneState(state)});
    if(failure)return result(false,failure);
  }
  const g=level.goal;
  const won=g.kind==='position'?same(state,g):g.kind==='switch'?state.pressed:state.delivered&&!state.holding;
  return result(won,won?'SOLVED':'GOAL_NOT_MET');
}
export function enumerateSolutions(level:Puzzle):readonly Replacement[] {
  validatePuzzle(level);
  return COMMANDS.filter(cmd=>cmd!==level.originalCommands[level.editableSlot]).filter(cmd=>{
    const commands=replaceExactlyOne(level,{slot:level.editableSlot,replacement:cmd});
    return simulate(level,commands).win;
  }).map(replacement=>({slot:level.editableSlot,replacement}));
}
