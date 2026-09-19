import { describe, it, expect, vi } from 'vitest';
import { DurableDispatchLeaseStore, hasCoreUiAssignment } from '../apps/chrome-controller/src/dispatch-lease';

describe('Chrome Controller UI Assignment', () => {
  it('exports hasCoreUiAssignment helper correctly', () => {
    expect(hasCoreUiAssignment({ uiAssignment: { id: 'test' } })).toBe(true);
    expect(hasCoreUiAssignment({})).toBe(false);
    expect(hasCoreUiAssignment(null)).toBe(false);
  });

  it('moks a workItem with uiAssignment set by Core and verifies dispatch-lease skips UI selector path', () => {
    const store = new DurableDispatchLeaseStore('/tmp/fake-lease-path.json', 'owner-1', 60000);
    const workItem = { id: 'work-1', uiAssignment: { target: 'core-assigned-ui' } };
    
    const selectSpy = vi.spyOn(store, 'selectWork');
    const result = store.selectWork(workItem);

    expect(selectSpy).toHaveBeenCalledWith(workItem);
    expect(result).toEqual({ target: 'core-assigned-ui' });
  });

  it('mocks a workItem without uiAssignment and ensures existing UI selector path is reachable', () => {
    const store = new DurableDispatchLeaseStore('/tmp/fake-lease-path-2.json', 'owner-1', 60000);
    const workItem = { id: 'work-2' };
    
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = store.selectWork(workItem);

    expect(warnSpy).toHaveBeenCalledWith('Chrome attempting to select UI work without Core assignment');
    expect(result).toBe('DEFAULT_UI_SELECTOR_PATH');
    warnSpy.mockRestore();
  });
});
