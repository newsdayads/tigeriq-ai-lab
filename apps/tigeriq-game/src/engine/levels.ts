import type {Puzzle} from './robot.js';
/** G02 canonical five-stage data. Source contract: docs/projects/tigeriq-game/ROBOT_OOPS_GAME_DESIGN.md. */
export const LEVELS: readonly Puzzle[] = [
  {id:'L01',name:'Lạc hướng',width:4,height:4,start:{x:0,y:1,heading:1},originalCommands:['MOVE','TURN_LEFT'],editableSlot:1,maxSteps:2,item:null,switch:null,delivery:null,obstacles:[],goal:{kind:'position',x:2,y:1}},
  {id:'L02',name:'Rẽ sai',width:4,height:4,start:{x:0,y:2,heading:1},originalCommands:['MOVE','TURN_RIGHT','MOVE'],editableSlot:1,maxSteps:3,item:null,switch:null,delivery:null,obstacles:[],goal:{kind:'position',x:1,y:1}},
  {id:'L03',name:'Bấm nhầm',width:4,height:4,start:{x:1,y:1,heading:1},originalCommands:['TURN_LEFT','MOVE','PRESS'],editableSlot:0,maxSteps:3,item:null,switch:{x:1,y:2},delivery:null,obstacles:[],goal:{kind:'switch'}},
  {id:'L04',name:'Giao gói hàng',width:4,height:4,start:{x:0,y:1,heading:1},originalCommands:['MOVE','PICK','TURN_LEFT','DROP'],editableSlot:2,maxSteps:4,item:{x:1,y:1},switch:null,delivery:{x:2,y:1},obstacles:[],goal:{kind:'delivery'}},
  {id:'L05',name:'Đường vòng',width:4,height:4,start:{x:0,y:2,heading:1},originalCommands:['MOVE','TURN_RIGHT','MOVE','TURN_RIGHT','MOVE'],editableSlot:1,maxSteps:5,item:null,switch:null,delivery:null,obstacles:[],goal:{kind:'position',x:2,y:1}},
];
