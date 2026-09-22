import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Chrome Controller Background F5 Refresh Timer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should set up alarm and trigger refresh between 5 and 10 minutes', async () => {
    const createAlarm = vi.fn();
    const reloadTab = vi.fn();
    
    global.chrome = {
      alarms: {
        create: createAlarm,
        onAlarm: { addListener: vi.fn() }
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() }
      },
      windows: {
        onRemoved: { addListener: vi.fn() }
      },
      tabs: {
        reload: reloadTab
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as any;

    const bg = await import('../apps/chrome-controller/extension/background.js');
    expect(createAlarm).toHaveBeenCalledWith('tigeriqTick', { periodInMinutes: 0.5 });
    await bg.scheduleF5Refresh();
    expect(bg.nextF5RefreshAt).toBeGreaterThan(0);
    
    // Verify nextF5RefreshAt is set within configured refresh bounds
    const diff = bg.nextF5RefreshAt - Date.now();
    expect(diff).toBeGreaterThanOrEqual(bg.F5_REFRESH_MIN_MS - 100);
    expect(diff).toBeLessThanOrEqual(bg.F5_REFRESH_MAX_MS + 100);

    // Test checkF5Refresh triggers reload when time is reached
    vi.spyOn(bg, 'getWorkerIds').mockResolvedValue(['NV02']);
    vi.spyOn(bg, 'findContext').mockResolvedValue({ tabId: 123 } as any);
    bg.setNextF5RefreshAt(Date.now() - 1000);
    await bg.checkF5Refresh();
    expect(reloadTab).toHaveBeenCalledWith(123);
  });
});
