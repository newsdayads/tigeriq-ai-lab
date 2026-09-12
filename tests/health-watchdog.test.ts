import { describe, it, expect, vi } from 'vitest';
import { HealthWatchdog } from '../packages/health-watchdog/src/watchdog.js';
import { ServiceConfig } from '../packages/health-watchdog/src/types.js';

describe('HealthWatchdog', () => {
  it('should detect healthy services and keep them untouched', async () => {
    const checkCore = vi.fn().mockResolvedValue(true);
    const restartCore = vi.fn().mockResolvedValue(undefined);

    const services: ServiceConfig[] = [
      {
        name: 'core',
        port: 8795,
        endpoint: 'http://localhost:8795/truth',
        checkTruth: checkCore,
        restart: restartCore,
      },
    ];

    const auditEvents: any[] = [];
    const watchdog = new HealthWatchdog(services, {
      baseBackoffMs: 10,
      auditLogger: (e) => auditEvents.push(e),
    });

    await watchdog.checkAllServices();

    expect(checkCore).toHaveBeenCalled();
    expect(restartCore).not.toHaveBeenCalled();
    const status = watchdog.getStatus('core');
    expect(status?.healthy).toBe(true);
    expect(auditEvents.length).toBe(0); // No failures, no audit events for failure
  });

  it('should trigger bounded retries, exponential back-off, and restart on simulated failure', async () => {
    let coreTruth = false;
    const restartCore = vi.fn().mockImplementation(async () => {
      coreTruth = true; // recover on restart
    });

    const services: ServiceConfig[] = [
      {
        name: 'core',
        port: 8795,
        endpoint: 'http://localhost:8795/truth',
        checkTruth: async () => coreTruth,
        restart: restartCore,
      },
      {
        name: 'web-control',
        port: 8796,
        endpoint: 'http://localhost:8796/truth',
        checkTruth: async () => true,
        restart: vi.fn(),
      },
    ];

    const auditEvents: any[] = [];
    const watchdog = new HealthWatchdog(services, {
      maxRetries: 2,
      baseBackoffMs: 5,
      auditLogger: (e) => auditEvents.push(e),
    });

    // Run check which fails core
    await watchdog.checkAllServices();

    // Wait slightly for async recovery loop to finish
    await new Promise((r) => setTimeout(r, 50));

    expect(restartCore).toHaveBeenCalled();
    expect(auditEvents.some((e) => e.service === 'core' && e.status === 'attempt')).toBe(true);
    expect(auditEvents.some((e) => e.service === 'core' && e.status === 'success')).toBe(true);

    // Verify web-control (healthy service) was untouched
    const webStatus = watchdog.getStatus('web-control');
    expect(webStatus?.healthy).toBe(true);
  });

  it('should trigger blocker event after max retries exceeded for stalled coding-lane', async () => {
    const checkCodingLane = vi.fn().mockResolvedValue(false);
    const restartCodingLane = vi.fn().mockRejectedValue(new Error('Restart failed'));

    const services: ServiceConfig[] = [
      {
        name: 'coding-lane',
        port: 8797,
        endpoint: 'http://localhost:8797/truth',
        checkTruth: checkCodingLane,
        restart: restartCodingLane,
      },
    ];

    const auditEvents: any[] = [];
    const watchdog = new HealthWatchdog(services, {
      maxRetries: 2,
      baseBackoffMs: 2,
      auditLogger: (e) => auditEvents.push(e),
    });

    await watchdog.checkAllServices();
    await new Promise((r) => setTimeout(r, 50));

    expect(restartCodingLane).toHaveBeenCalledTimes(2);
    const blockerEvent = auditEvents.find((e) => e.service === 'coding-lane' && e.status === 'blocker');
    expect(blockerEvent).toBeDefined();
    expect(blockerEvent?.message).toContain('CRITICAL');

    const status = watchdog.getStatus('coding-lane');
    expect(status?.healthy).toBe(false);
  });
});
