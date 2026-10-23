import test from 'node:test';import assert from 'node:assert/strict';
import {LEVELS} from '../dist/engine/levels.js';
import {newSession,openLevel,selectSlot,selectReplacement,executeLevel,retryLevel,nextLevel} from '../dist/levels/game.js';
import {enumerateSolutions} from '../dist/engine/robot.js';
test('five stages are winnable end-to-end through one edit and Next',()=>{
  let s=newSession();assert.equal(s.screen,'select');
  for(let i=0;i<5;i++){
    s=i===0?openLevel(0):s;assert.equal(s.levelIndex,i);
    const l=LEVELS[i];const solution=enumerateSolutions(l)[0];
    s=selectSlot(s,l.editableSlot);s=selectReplacement(s,solution.replacement);s=executeLevel(s);
    assert.equal(s.screen,'result');assert.equal(s.outcome.win,true,l.id);
    s=nextLevel(s);
  }
  assert.equal(s.screen,'select');
});
test('wrong edits or running without selection are rejected',()=>{
  const s=openLevel(0);assert.throws(()=>executeLevel(s),/ONE_REPLACEMENT/);
  assert.throws(()=>selectSlot(s,0),/FIXED_OR_INVALID_SLOT/);
  assert.throws(()=>selectReplacement(s,'MOVE'),/NO_EDIT_SLOT/);
  const chosen=selectSlot(s,1);assert.throws(()=>selectReplacement(chosen,'TURN_LEFT'),/EXACTLY_ONE/);
});
test('failed level retries from original state',()=>{
  let s=openLevel(2);s=selectSlot(s,0);s=selectReplacement(s,'WAIT');s=executeLevel(s);
  assert.equal(s.outcome.win,false);assert.throws(()=>nextLevel(s),/NEXT_REQUIRES_WIN/);
  const next=retryLevel(s);assert.equal(next.screen,'play');assert.equal(next.replacement,null);assert.equal(next.editSlot,null);
});
test('level bounds are checked',()=>{assert.throws(()=>openLevel(-1),RangeError);assert.throws(()=>openLevel(5),RangeError);});
