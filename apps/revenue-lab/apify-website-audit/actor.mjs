import { Actor } from 'apify';
import { auditWebsite } from './audit-engine.mjs';

async function main() {
  await Actor.init();
  const input = await Actor.getInput() || {};
  const url = input.url || 'https://example.com';
  
  console.log(`Starting website audit for: ${url}`);
  
  try {
    const auditResult = await auditWebsite(url, input);
    await Actor.setValue('OUTPUT', auditResult);
    console.log('Audit completed successfully.');
  } catch (error) {
    console.error(`Audit failed: ${error.message}`);
    await Actor.setValue('OUTPUT', { error: error.message, url, status: 'failed' });
    process.exitCode = 1;
  } finally {
    await Actor.exit();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
