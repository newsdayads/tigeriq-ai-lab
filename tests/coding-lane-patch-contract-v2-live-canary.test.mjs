import {describe,expect,it} from 'vitest';
import {isRetryableAiError} from '../apps/tigeriq-coding-lane/policy.mjs';

describe('Patch Contract V2 live canary',()=>{
  it('keeps generic HTTP 400 retry classification fail-closed',()=>{
    const error=Object.assign(new Error('HTTP_400:provider rejected request shape'),{status:400});
    // Intentionally wrong for the live same-PR repair canary. Coding Lane must repair this to false.
    expect(isRetryableAiError(error)).toBe(true);
  });
});
