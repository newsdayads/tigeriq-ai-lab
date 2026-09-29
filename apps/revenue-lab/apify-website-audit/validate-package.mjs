import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(root, rel), 'utf8'));

const actor = await readJson('.actor/actor.json');
const input = await readJson('.actor/input_schema.json');
const output = await readJson('.actor/output_schema.json');
const pkg = await readJson('package.json');

const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(actor.actorSpecification === 1, 'actorSpecification');
check(actor.dockerfile === '../Dockerfile', 'dockerfile_path');
check(actor.dockerContextDir === '..', 'docker_context');
check(actor.input === './input_schema.json', 'input_schema_path');
check(actor.output === './output_schema.json', 'output_schema_path');
check(actor.usesStandbyMode === false, 'standby_mode');

check(input.schemaVersion === 1 && input.type === 'object', 'input_schema_header');
check(Array.isArray(input.required) && input.required.includes('url'), 'url_required');
check(input.additionalProperties === false, 'additional_properties');
check(input.properties?.maxPages?.minimum === 1 && input.properties?.maxPages?.maximum === 10, 'maxPages_bounds');
check(input.properties?.timeoutMs?.minimum === 250 && input.properties?.timeoutMs?.maximum === 30000, 'timeout_bounds');
check(input.properties?.maxBytes?.minimum === 1024 && input.properties?.maxBytes?.maximum === 5242880, 'maxBytes_bounds');
check(input.properties?.maxRedirects?.minimum === 0 && input.properties?.maxRedirects?.maximum === 5, 'redirect_bounds');
check(input.properties?.requestDelayMs?.minimum === 0 && input.properties?.requestDelayMs?.maximum === 2000, 'delay_bounds');

check(output.actorOutputSchemaVersion === 1, 'output_schema_version');
check(output.properties?.result?.template === '{{links.apiDefaultKeyValueStoreUrl}}/records/OUTPUT', 'output_record');
check(pkg.scripts?.start === 'node actor.mjs', 'start_script');

if (failures.length) {
  console.error('APIFY_PACKAGE_INVALID=' + failures.join(','));
  process.exit(1);
}
console.log('APIFY_PACKAGE_VALID');
