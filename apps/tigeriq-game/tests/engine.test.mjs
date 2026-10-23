import test from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../dist/engine/levels.js';
import {validatePuzzle,replaceExactlyOne,simulate,enumerateSolutions} from '../dist/engine/robot.js';
const answers=['MOVE','TURN_LEFT','TURN_RIGHT','MOVE','TURN_LEFT'];
test('G02 five levels: old code fails, exactly one verified replacement each',()=>{
  assert.equal(LEVELS.length,5);
  for(let i=0;i<LEVELS.length;i++){
    const l=LEVELS[i];validatePuzzle(l);assert.equal(simulate(l,l.originalCommands).win,false,l.id);
    const solutions=enumerateSolutions(l);assert.deepEqual(solutions,[{slot:l.editableSlot,replacement:answers[i]}]);
    const changed=replaceExactlyOne(l,solutions[0]);assert.equal(simulate(l,changed).win,true,l.id);
  }
});
test('no-op, wrong slot and unknown command are rejected',()=>{
  const l=LEVELS[0];assert.throws(()=>replaceExactlyOne(l,{slot:1,replacement:'TURN_LEFT'}),/EXACTLY_ONE/);
  assert.throws(()=>replaceExactlyOne(l,{slot:0,replacement:'MOVE'}),/EXACTLY_ONE/);
  assert.throws(()=>replaceExactlyOne(l,{slot:1,replacement:'TELEPORT'}),/EXACTLY_ONE/);
});
test('collision, out of bounds and step limit fail clearly',()=>{
  const l=LEVELS[0];assert.equal(simulate({...l,obstacles:[{x:1,y:1}]},['MOVE']).reason,'BLOCKED');
  assert.equal(simulate({...l,start:{x:0,y:0,heading:0}},['MOVE']).reason,'OUT_OF_BOUNDS');
  assert.equal(simulate({...l,maxSteps:1},['TURN_RIGHT','MOVE']).reason,'STEP_LIMIT');
});
test('invalid item and switch actions fail, and valid delivery is precise',()=>{
  assert.equal(simulate(LEVELS[3],['DROP']).reason,'INVALID_DROP');
  assert.equal(simulate(LEVELS[3],['PICK']).reason,'INVALID_PICK');
  assert.equal(simulate(LEVELS[2],['PRESS']).reason,'INVALID_PRESS');
  assert.equal(simulate(LEVELS[3],['MOVE','PICK','MOVE','DROP']).reason,'SOLVED');
});
test('simulation is replayable and never mutates source program or level',()=>{
  const l=LEVELS[4];const before=JSON.stringify(l);
  const program=replaceExactlyOne(l,{slot:1,replacement:'TURN_LEFT'});
  const one=simulate(l,program),two=simulate(l,program);
  assert.deepEqual(one,two);assert.equal(JSON.stringify(l),before);
  assert.equal(one.trace.length,l.originalCommands.length);
});
test('invalid level data and impossible levels are detected',()=>{
  const l=LEVELS[0];assert.throws(()=>validatePuzzle({...l,start:{x:20,y:0,heading:1}}),/INVALID_START/);
  assert.deepEqual(enumerateSolutions({...l,goal:{kind:'position',x:3,y:3}}),[]);
});
