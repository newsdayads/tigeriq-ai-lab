import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

const actor = await load('./.actor/actor.json');
const input = await load('./.actor/input_schema.json');
const output = await load('./.actor/output_schema.json');

assert.equal(actor.actorSpecification, 1);
assert.equal(actor.name, 'tigeriq-website-audit');
assert.equal(actor.version, '0.1');
assert.equal(actor.dockerContextDir, '..');
assert.equal(actor.dockerfile, './Dockerfile');
assert.equal(actor.input, './input_schema.json');
assert.equal(actor.output, './output_schema.json');

assert.equal(input.schemaVersion, 1);
assert.equal(input.type, 'object');
assert.deepEqual(input.required, ['url']);
assert.equal(input.additionalProperties, false);
assert.equal(input.properties.maxPages.minimum, 1);
assert.equal(input.properties.maxPages.maximum, 10);
assert.equal(input.properties.timeoutMs.minimum, 250);
assert.equal(input.properties.timeoutMs.maximum, 30000);
assert.equal(input.properties.maxBytes.minimum, 1024);
assert.equal(input.properties.maxBytes.maximum, 5242880);
assert.equal(input.properties.maxRedirects.minimum, 0);
assert.equal(input.properties.maxRedirects.maximum, 5);
assert.equal(input.properties.requestDelayMs.minimum, 0);
assert.equal(input.properties.requestDelayMs.maximum, 2000);

assert.equal(output.actorOutputSchemaVersion, 1);
assert.equal(output.properties.result.template, '{{links.apiDefaultKeyValueStoreUrl}}/records/OUTPUT');

console.log('APIFY_ACTOR_DEFINITION_PASS');
