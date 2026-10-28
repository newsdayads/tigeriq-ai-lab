import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('Running UltraCarHCM V2 baseline structure checks...');
const buildGradle = fs.readFileSync(path.resolve('apps/ultracarhcm-v2/build.gradle'), 'utf8');
assert(buildGradle.includes('com.dexcam.ultracar'), 'Namespace must be configured');
const manifest = fs.readFileSync(path.resolve('apps/ultracarhcm-v2/src/main/AndroidManifest.xml'), 'utf8');
assert(manifest.includes('MainActivity'), 'Manifest must declare MainActivity');
console.log('All baseline assertions passed successfully.');
