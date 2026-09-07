import assert from 'node:assert/strict';
import { isExactWebControlCommand } from '../api/web-control.mjs';

assert.equal(isExactWebControlCommand('1'), true);
assert.equal(isExactWebControlCommand(' 1 '), true);
assert.equal(isExactWebControlCommand('L'), true);
assert.equal(isExactWebControlCommand('l'), true);
assert.equal(isExactWebControlCommand('  L '), true);
assert.equal(isExactWebControlCommand('11'), false);
assert.equal(isExactWebControlCommand(' 01 '), false);
assert.equal(isExactWebControlCommand(''), false);
assert.equal(isExactWebControlCommand(null), false);

console.log('WEB_CONTROL_COMMAND_ROUTING_PASS');
