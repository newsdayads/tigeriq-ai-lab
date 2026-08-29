import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const directory = new URL('../schemas/', import.meta.url);
const files = (await readdir(directory)).filter((file) => file.endsWith('.schema.json'));
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
for (const file of files) {
  const schema = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
  ajv.compile(schema);
}
console.log(`Validated ${files.length} schemas.`);
