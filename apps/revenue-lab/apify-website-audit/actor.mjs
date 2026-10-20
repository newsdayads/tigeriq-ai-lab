import { Actor } from 'apify';
import { auditWebsite } from './audit-engine.mjs';
import { requireActorAuditUrl, auditStartLogMessage, auditFailureLogMessage, auditFailureOutput } from './actor-input.mjs';

async function main() {
  await Actor.init();
  const input = await Actor.getInput() || {};

  // Never print a user-supplied URL: even public sites can carry credential
  // query parameters or Basic Auth information.
  console.log(auditStartLogMessage());

  try {
    const auditResult = await auditWebsite(requireActorAuditUrl(input), input);
    await Actor.setValue('OUTPUT', auditResult);
    console.log('Audit completed successfully.');
  } catch (error) {
    console.error(auditFailureLogMessage(error));
    await Actor.setValue('OUTPUT', auditFailureOutput(error));
    process.exitCode = 1;
  } finally {
    await Actor.exit();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
