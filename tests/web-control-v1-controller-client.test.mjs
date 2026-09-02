import { describe, expect, it } from 'vitest';
import {
  CONTROLLER_ENDPOINTS,
  WEB_SNAPSHOT_SCHEMA,
  MockControllerClient,
  WorkforceControllerClient,
  controllerUrlPolicy,
  validateControllerSnapshot,
} from '../public/web-v1/controller-client.js';
import { MOCK_CONTROLLER_SNAPSHOT } from '../public/web-v1/mock-data.js';

function validSnapshot() {
  return {
    schemaVersion: WEB_SNAPSHOT_SCHEMA,
    generatedAt: '2026-09-02T09:30:00+07:00',
    source: { mode: 'controller', authoritative: true, label: 'PC01 Workforce Controller' },
    controller: { state: 'online' }, company: {},
    jobs: [], employees: [], devices: [], providers: [], prompts: [], results: [], activity: [],
  };
}

describe('Web Control V1 Workforce Controller client', () => {
  it('accepts Tailscale/local URLs and fails closed on public or mixed-content controller URLs', () => {
    expect(controllerUrlPolicy('https://pc01.example-tailnet.ts.net', 'https:').ok).toBe(true);
    expect(controllerUrlPolicy('http://100.100.20.30:8790', 'http:').ok).toBe(true);
    expect(controllerUrlPolicy('http://100.100.20.30:8790', 'https:').code).toBe('CONTROLLER_MIXED_CONTENT');
    expect(controllerUrlPolicy('https://example.com', 'https:').code).toBe('CONTROLLER_NOT_TAILNET_OR_LOCAL');
  });

  it('reads authoritative snapshot from Controller contract and never sends admin secret', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, async json() { return validSnapshot(); } };
    };
    const client = new WorkforceControllerClient({
      baseUrl: 'https://pc01.example-tailnet.ts.net', accessToken: 'short-lived-browser-token', fetchImpl, pageProtocol: 'https:',
    });
    await expect(client.snapshot()).resolves.toEqual(validSnapshot());
    expect(calls[0].url).toBe(`https://pc01.example-tailnet.ts.net${CONTROLLER_ENDPOINTS.snapshot}`);
    expect(calls[0].init.headers.authorization).toBe('Bearer short-lived-browser-token');
    expect(calls[0].init.headers['x-tigeriq-admin-secret']).toBeUndefined();
  });

  it('uses existing workforce status endpoint only as a connection probe', async () => {
    let called = '';
    const client = new WorkforceControllerClient({
      baseUrl: 'http://100.100.20.30:8790', pageProtocol: 'http:',
      fetchImpl: async (url) => { called = url; return { ok:true, async json(){return {ok:true,workforce:{tasks:{total:0}}};} }; },
    });
    await client.health();
    expect(called).toBe(`http://100.100.20.30:8790${CONTROLLER_ENDPOINTS.health}`);
  });

  it('rejects non-authoritative or wrong-schema snapshots rather than fabricating state', () => {
    expect(() => validateControllerSnapshot({ ...validSnapshot(), source:{mode:'mock',authoritative:false} })).toThrow('CONTROLLER_SNAPSHOT_NOT_AUTHORITATIVE');
    expect(() => validateControllerSnapshot({ ...validSnapshot(), schemaVersion:'wrong' })).toThrow('CONTROLLER_SCHEMA_MISMATCH');
  });

  it('submits only a goal intent to Controller; orchestration is not implemented in Web', async () => {
    let body = null;
    const client = new WorkforceControllerClient({
      baseUrl: 'http://100.100.20.30:8790', pageProtocol: 'http:',
      fetchImpl: async (_url, init) => { body=JSON.parse(init.body);return {ok:true,async json(){return {ok:true,accepted:true};}}; },
    });
    await client.submitGoal({ objective:'JOB-001', priority:'P0' });
    expect(body.goal).toEqual({ objective:'JOB-001', priority:'P0' });
    expect(body).not.toHaveProperty('tasks');
    expect(body).not.toHaveProperty('executor');
  });

  it('keeps mock mode explicitly non-authoritative and never dispatches', async () => {
    const mock = new MockControllerClient(MOCK_CONTROLLER_SNAPSHOT);
    const snapshot = await mock.snapshot();
    expect(snapshot.source).toEqual(expect.objectContaining({mode:'mock',authoritative:false}));
    const result = await mock.submitGoal({objective:'demo'});
    expect(result).toEqual(expect.objectContaining({mock:true,dispatched:false}));
  });
});
