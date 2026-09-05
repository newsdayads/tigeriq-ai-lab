import { FileJournal } from '../../../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry } from '../../../packages/workforce/src/index.js';
import { DurableAutonomyStore } from '../../../packages/workforce/src/autonomy-store.js';
import { FileJournalWorkforceStateStore } from '../../../packages/workforce/src/journal-store.js';
import { DurableNodeCredentialStore } from '../../../packages/workforce/src/node-credentials.js';
import { NodePairingService, verifyAndroidP256PairingProof } from '../../../packages/workforce/src/pairing.js';
import { RemoteTaskBroker } from '../../../packages/workforce/src/remote-task-broker.js';
import { DurableWorkforceRuntime } from '../../../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../../../packages/workforce/src/task-mailbox.js';
import { startWorkforceController } from './server.js';

const journalPath = process.env.TIGERIQ_WORKFORCE_JOURNAL ?? 'F:\\TigerIQ\\State\\workforce.jsonl';
const host = process.env.TIGERIQ_WORKFORCE_HOST ?? '127.0.0.1';
const port = Number(process.env.TIGERIQ_WORKFORCE_PORT ?? '8790');
const adminSecret = process.env.TIGERIQ_WORKFORCE_ADMIN_SECRET ?? '';
const allowTailnetSelfPair = process.env.TIGERIQ_WORKFORCE_ALLOW_TAILNET_SELF_PAIR === '1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('TIGERIQ_WORKFORCE_PORT must be an integer between 1 and 65535');
}

const journal = new FileJournal(journalPath);
const stateStore = new FileJournalWorkforceStateStore(journal);
const credentialStore = new DurableNodeCredentialStore(journal);
const registry = new WorkforceRegistry();
const queue = new TaskQueue();
const runtime = await DurableWorkforceRuntime.restore(
  registry,
  queue,
  new CapabilityScheduler(registry),
  stateStore,
);
const pairing = new NodePairingService(verifyAndroidP256PairingProof);
const mailbox = new DurableTaskMailbox(journal);
const autonomy = new DurableAutonomyStore(journal);
const remoteTasks = new RemoteTaskBroker(runtime, mailbox, () => new Date(), autonomy);
const server = await startWorkforceController({
  runtime,
  pairing,
  credentials: credentialStore,
  remoteTasks,
  adminSecret,
  allowTailnetSelfPair,
  host,
  port,
});

console.log(`TigerIQ Workforce Controller online: ${server.url}`);
console.log(`Workforce journal: ${journalPath}`);
console.log(adminSecret ? 'Pairing/admin writes enabled.' : 'Admin writes disabled: TIGERIQ_WORKFORCE_ADMIN_SECRET is not configured.');
console.log(allowTailnetSelfPair ? 'Tailnet self-pair enabled for 100.64.0.0/10 peers.' : 'Tailnet self-pair disabled.');

const shutdown = async () => {
  await runtime.checkpoint();
  await server.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
