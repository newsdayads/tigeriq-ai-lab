import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthWatchdog } from '../packages/health-watchdog/src/watchdog.js';
import type { ServiceName, AuditEvent } from '../packages/health-watchdog/src/types.js';

describe('HealthWatchdog', () => {
  let checkMock: vi.MockedFunction<(svc: ServiceName) => Promise<boolean>>;
  let restartMock: vi.MockedFunction<(svc: ServiceName) => Promise<void>>;
  let logMock: vi.MockedFunction<(e: AuditEvent) => void>;

  beforeEach(() => {
    checkMock = vi.fn();
    restartMock = vi.fn().mockResolvedValue(undefined);
    logMock = vi.fn();
  });

  it('restarts failed service with bounded retries and exponential backoff', async () => {
    // core fails first two checks, succeeds after restart
    const sequence = [false, false, true];
    checkMock
      .mockImplementationOnce(() => Promise.resolve(sequence[0]))
      .mockImplementationOnce(() => Promise.resolve(sequence[1]))
      .mockImplementationOnce(() => Promise.resolve(sequence[2]))
      .mockResolvedValue(true); // subsequent checks healthy

    const watchdog = new HealthWatchdog(
      checkMock,
      restartMock,
      logMock,
      { intervalMs: 10_000, maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 },
    );

    // run single check manually via private method
    await (watchdog as any).checkService('core');

    expect(restartMock).toHaveBeenCalledTimes(2);
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'core', attempt: 1, status: 'retry' }),
    );
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'core', attempt: 2, status: 'retry' }),
    );
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'core', status: 'success' }),
    );
  });

  it('does not restart healthy services', async () => {
    checkMock.mockResolvedValue(true);
    const watchdog = new HealthWatchdog(
      checkMock,
      restartMock,
      logMock,
      { intervalMs: 10_000 },
    );

    await (watchdog as any).checkService('webControl');

    expect(restartMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('stops after max retries and logs failure', async () => {
    checkMock.mockResolvedValue(false);
    const watchdog = new HealthWatchdog(
      checkMock,
      restartMock,
      logMock,
      { intervalMs: 10_000, maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    );

    await (watchdog as any).checkService('codingLane');

    expect(restartMock).toHaveBeenCalledTimes(2);
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'codingLane', status: 'failure' }),
    );
  });
});
