import {describe,it,expect} from 'vitest';
import { validateJobScope, validateSourceScope, selectNextAvailableResource, handleResourceExhaustion } from '../apps/tigeriq-coding-lane/coding-lane.mjs';

describe('Coding Lane Policy and Scope Constraints', () => {
  it('validates job scope successfully', () => {
    expect(validateJobScope(['apps/a.mjs'], [{ path: 'apps/a.mjs' }])).toBe(true);
  });

  it('routes output contract exhaustion directly to repair', () => {
    const res = handleResourceExhaustion({}, new Error('output_contract failed'));
    expect(res.route).toBe('bootstrap_repair');
  });

  it('selects next available resource skipping cooldown', () => {
    const resources = [
      { id: 'NV11', provider: 'groq', ready: () => true },
      { id: 'NV12', provider: 'gemini', ready: () => true }
    ];
    const selected = selectNextAvailableResource(resources, ['NV11']);
    expect(selected.id).toBe('NV12');
  });
});
