import assert from 'node:assert/strict';

process.env.TIGERIQ_COMMAND_SECRET = 'test-secret';

const { default: handler } = await import('../api/control.mjs');

function request(payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const req = {
    method: 'POST',
    headers,
    async *[Symbol.asyncIterator]() { yield body; },
  };
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value ?? ''); },
  };
  return { req, response };
}

let pair = request({ operation: 'chat', message: '1' });
await handler(pair.req, pair.response);
assert.equal(pair.response.statusCode, 401);
assert.equal(JSON.parse(pair.response.body).error, 'owner_authorization_required');

pair = request({ operation: 'chat', message: 'L' });
await handler(pair.req, pair.response);
assert.equal(pair.response.statusCode, 401);
assert.equal(JSON.parse(pair.response.body).error, 'owner_authorization_required');

pair = request({ operation: 'chat', message: '1' }, { 'x-tigeriq-secret': 'test-secret' });
await handler(pair.req, pair.response);
const authorized = JSON.parse(pair.response.body);
assert.equal(pair.response.statusCode, 202);
assert.equal(authorized.mode, 'web-control');
assert.equal(authorized.lane, 'web-control');
assert.equal(authorized.command, '1');
assert.equal(authorized.state, 'external-wait');
assert.equal(authorized.execution.started, false);
assert.equal(authorized.execution.verified, false);
assert.equal(authorized.execution.reason, 'runtime_executor_unavailable');
assert.equal(authorized.evidence.executionVerified, false);
assert.equal(authorized.plan.accepted, true);

pair = request({ operation: 'chat', message: 'L' }, { 'x-tigeriq-secret': 'test-secret' });
await handler(pair.req, pair.response);
const authorizedAlias = JSON.parse(pair.response.body);
assert.equal(pair.response.statusCode, 202);
assert.equal(authorizedAlias.mode, 'web-control');
assert.equal(authorizedAlias.command, '1');
assert.equal(authorizedAlias.state, 'external-wait');
assert.equal(authorizedAlias.execution.verified, false);

pair = request({ operation: 'chat', message: ' 1 ' }, { 'x-tigeriq-secret': 'test-secret' });
await handler(pair.req, pair.response);
const whitespace = JSON.parse(pair.response.body);
assert.equal(whitespace.mode, 'web-control');
assert.equal(whitespace.state, 'external-wait');

pair = request({ operation: 'chat', message: '11' }, { 'x-tigeriq-secret': 'test-secret' });
await handler(pair.req, pair.response);
assert.notEqual(JSON.parse(pair.response.body).mode, 'web-control');

console.log('WEB_CONTROL_HTTP_ROUTING_PASS');
