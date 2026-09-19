import { describe, expect, it } from 'vitest';
import {
  CONTINUE_PROMPTS, deriveNv02Phase, hasActiveNv02Work, pickContinuePrompt,
  randomDelay, shouldRotateChat,
} from '../apps/chrome-controller/extension/continuity.js';

describe('NV02 continuity policy', () => {
  it('keeps exactly the approved 25 natural continue prompts', () => {
    expect(CONTINUE_PROMPTS).toHaveLength(25);
    expect(new Set(CONTINUE_PROMPTS).size).toBe(25);
    expect(CONTINUE_PROMPTS).toContain('02');
    expect(CONTINUE_PROMPTS).toContain('Làm tiếp');
  });

  it('classifies DOM-backed UI state fail closed', () => {
    expect(deriveNv02Phase({securityBlock:'BLOCKED_CAPTCHA'})).toBe('BLOCKED');
    expect(deriveNv02Phase({stopVisible:true,composerReady:true})).toBe('WORKING');
    expect(deriveNv02Phase({uiBusy:true,composerReady:true})).toBe('WORKING');
    expect(deriveNv02Phase({composerReady:true,uiBusy:false})).toBe('READY');
    expect(deriveNv02Phase({composerReady:false,uiBusy:false})).toBe('STALLED');
    expect(deriveNv02Phase({composerReady:true},{heartbeatStale:true})).toBe('STALLED');
  });

  it('detects controller work that forbids overlapping continue dispatch', () => {
    expect(hasActiveNv02Work({jobs:[{workerId:'NV02',stage:'WORKING'}],autopilot:{}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[],autopilot:{pendingJobId:'GH-1'}})).toBe(true);
    expect(hasActiveNv02Work({jobs:[],autopilot:{phase:'IDLE'}})).toBe(false);
  });

  it('keeps random timing inside requested windows', () => {
    expect(randomDelay(300000,600000,()=>0)).toBe(300000);
    expect(randomDelay(300000,600000,()=>0.999999)).toBeGreaterThanOrEqual(599999);
  });

  it('avoids immediate prompt repetition when alternatives exist', () => {
    expect(pickContinuePrompt('02',()=>0)).not.toBe('02');
  });

  it('rotates chat by bounded count or age instead of every job', () => {
    const now=1_000_000_000;
    expect(shouldRotateChat({chatStartedAt:now,dispatchesInChat:7},now)).toBe(false);
    expect(shouldRotateChat({chatStartedAt:now,dispatchesInChat:8},now)).toBe(true);
    expect(shouldRotateChat({chatStartedAt:now-46*60*1000,dispatchesInChat:1},now)).toBe(true);
  });
});
