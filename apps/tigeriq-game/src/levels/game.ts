import {LEVELS} from '../engine/levels.js';
import {replaceExactlyOne, simulate, type Command, type SimulationResult} from '../engine/robot.js';
export type Screen = 'select' | 'play' | 'result';
export interface GameSession {
  screen: Screen;
  levelIndex: number;
  editSlot: number | null;
  replacement: Command | null;
  outcome: SimulationResult | null;
  /** Won level IDs for this playthrough, never inferred from the selected level. */
  completedLevels: readonly number[];
}
export function newSession():GameSession{return {screen:'select',levelIndex:0,editSlot:null,replacement:null,outcome:null,completedLevels:[]};}
export function openLevel(index:number,completedLevels:readonly number[]=[]):GameSession{
  if(!Number.isInteger(index)||index<0||index>=LEVELS.length)throw new RangeError('INVALID_LEVEL');
  return {screen:'play',levelIndex:index,editSlot:null,replacement:null,outcome:null,completedLevels:[...completedLevels]};
}
export function selectSlot(state:Readonly<GameSession>,slot:number):GameSession{
  const level=LEVELS[state.levelIndex];
  if(state.screen!=='play'||slot!==level.editableSlot)throw new Error('FIXED_OR_INVALID_SLOT');
  return {...state,editSlot:slot,replacement:null};
}
export function selectReplacement(state:Readonly<GameSession>,cmd:Command):GameSession{
  if(state.screen!=='play'||state.editSlot===null)throw new Error('NO_EDIT_SLOT');
  replaceExactlyOne(LEVELS[state.levelIndex],{slot:state.editSlot,replacement:cmd});
  return {...state,replacement:cmd};
}
export function executeLevel(state:Readonly<GameSession>):GameSession{
  if(state.screen!=='play'||state.editSlot===null||state.replacement===null)throw new Error('ONE_REPLACEMENT_REQUIRED');
  const level=LEVELS[state.levelIndex];
  const program=replaceExactlyOne(level,{slot:state.editSlot,replacement:state.replacement});
  const outcome=simulate(level,program);
  const completedLevels=outcome.win && !state.completedLevels.includes(state.levelIndex)
    ? [...state.completedLevels,state.levelIndex] : state.completedLevels;
  return {...state,screen:'result',outcome,completedLevels};
}
export function retryLevel(state:Readonly<GameSession>):GameSession{return openLevel(state.levelIndex,state.completedLevels);}
export function nextLevel(state:Readonly<GameSession>):GameSession{
  if(state.screen!=='result'||!state.outcome?.win)throw new Error('NEXT_REQUIRES_WIN');
  return state.levelIndex===LEVELS.length-1?{...newSession(),completedLevels:[...state.completedLevels]}:openLevel(state.levelIndex+1,state.completedLevels);
}
