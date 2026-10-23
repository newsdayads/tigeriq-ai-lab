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

test('jumping to the last stage cannot falsely mark all five levels complete',()=>{
  const level=LEVELS[4],answer=enumerateSolutions(level)[0];
  let s=openLevel(4);
  s=selectSlot(s,answer.slot);
  s=selectReplacement(s,answer.replacement);
  s=executeLevel(s);
  assert.equal(s.outcome.win,true);
  assert.deepEqual(s.completedLevels,[4]);
  assert.notEqual(s.completedLevels.length,LEVELS.length);
  const after=nextLevel(s);
  assert.equal(after.screen,'select');
  assert.deepEqual(after.completedLevels,[]);
});

test('sequential wins only increment completion on successful runs and survive retry',()=>{
  let s=openLevel(0);
  assert.deepEqual(s.completedLevels,[]);
  for(let i=0;i<LEVELS.length;i++){
    const l=LEVELS[i];
    if(i>0)assert.deepEqual(s.completedLevels,Array.from({length:i},(_,j)=>j));
    s=selectSlot(s,l.editableSlot);
    s=selectReplacement(s,enumerateSolutions(l)[0].replacement);
    s=executeLevel(s);
    assert.equal(s.outcome.win,true);
    assert.deepEqual(s.completedLevels,Array.from({length:i+1},(_,j)=>j));
    if(i<LEVELS.length-1){
      const replay=retryLevel(s);
      assert.deepEqual(replay.completedLevels,s.completedLevels);
      assert.equal(replay.outcome,null);
      s=nextLevel(s);
    }
  }
  assert.equal(s.completedLevels.length,5);
});

test('losing a level never increments the actual completion count',()=>{
  let s=openLevel(2);
  s=selectSlot(s,LEVELS[2].editableSlot);
  s=selectReplacement(s,'WAIT');
  s=executeLevel(s);
  assert.equal(s.outcome.win,false);
  assert.deepEqual(s.completedLevels,[]);
});
