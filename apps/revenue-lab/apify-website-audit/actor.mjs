import { Actor } from 'apify';
import { auditWebsite } from './audit-engine.mjs';
import { requireActorAuditUrl, auditStartLogMessage, auditFailureCode, auditFailureLogMessage } from './actor-input.mjs';

async function main() {
  await Actor.init();
  const input = await Actor.getInput() || {};
  const url = typeof input.url === 'string' ? input.url : null;

  // Never print a user-supplied URL: even public sites can carry credential
  // query parameters or Basic Auth information.
  console.log(auditStartLogMessage());

  try {
    const auditResult = await auditWebsite(requireActorAuditUrl(input), input);
    await Actor.setValue('OUTPUT', auditResult);
    console.log('Audit completed successfully.');
  } catch (error) {
    const code = auditFailureCode(error);
    console.error(auditFailureLogMessage(error));
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
