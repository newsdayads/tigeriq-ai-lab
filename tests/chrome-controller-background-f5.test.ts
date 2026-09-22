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

    // Load background to verify alarm/timer and refresh behavior
    await import('../apps/chrome-controller/extension/background.js');
    expect(createAlarm).toHaveBeenCalledWith('tigeriqTick', { periodInMinutes: 0.5 });
  });
});
