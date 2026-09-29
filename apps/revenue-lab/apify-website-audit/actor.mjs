import { Actor } from 'apify';
import { auditWebsite, AuditError } from './audit-engine.mjs';

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
    const code = error instanceof AuditError ? error.code : 'AUDIT_FAILURE';
    console.error(`Audit failed [${code}]: ${error.message}`);
    await Actor.setValue('OUTPUT', {
      schemaVersion: '1.0',
      status: 'failed',
      requestedUrl: url,
      error: {
        code,
        message: error.message,
        detail: error instanceof AuditError ? error.detail ?? null : null,
      },
      metrics: {
        externalApiCostUSD: 0,
        platformCostUSD: null,
        platformCostStatus: 'pending_private_apify_run',
      },
    });
    process.exitCode = 1;
  } finally {
    await Actor.exit();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
