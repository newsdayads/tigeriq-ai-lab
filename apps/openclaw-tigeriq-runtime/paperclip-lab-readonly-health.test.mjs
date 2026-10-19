import { describe, expect, it } from 'vitest';
import { paperclipUnverifiedDockerHealth } from './paperclip-lab.mjs';

describe('GH-2054 Paperclip R02 broker-only read-only diagnostics', () => {
  const docker = {
    kind: null,
    version: null,
    error: 'BROKER_PROBE_SKIPPED_READ_ONLY_PREFLIGHT',
    broker: { ready: true },
  };

  it('reports healthy HTTP without falsely accepting Docker, container or database', () => {
    const result = paperclipUnverifiedDockerHealth({
      docker,
      port: { host: '127.0.0.1', port: 3210, reachable: true },
      http: { reachable: true, status: 200, appOk: true },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('DOCKER_UNAVAILABLE');
    expect(result.url).toBe('http://127.0.0.1:3210');
    expect(result.docker).toBe(docker);
    expect(result.result).toMatchObject({
      portReachable: true, httpReachable: true, httpStatus: 200, httpAppOk: true,
      dockerVerified: false, containerVerified: false, databaseVerified: false,
    });
    expect(result.http.appOk).toBe(true);
  });

  it('does not invent HTTP success or Docker readiness when the API is unreachable', () => {
    const result = paperclipUnverifiedDockerHealth({
      docker,
      port: { reachable: false },
      http: { reachable: false, status: null, appOk: false },
    });
    expect(result.ok).toBe(false);
    expect(result.result).toMatchObject({
      portReachable: false, httpReachable: false, httpStatus: null, httpAppOk: false,
      dockerVerified: false, containerVerified: false, databaseVerified: false,
    });
  });

  it('fails closed with missing optional probe evidence', () => {
    const result = paperclipUnverifiedDockerHealth({ docker });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('DOCKER_UNAVAILABLE');
    expect(result.result).toMatchObject({
      portReachable: false, httpReachable: false, httpStatus: null, httpAppOk: false,
      dockerVerified: false, containerVerified: false, databaseVerified: false,
    });
  });
});
