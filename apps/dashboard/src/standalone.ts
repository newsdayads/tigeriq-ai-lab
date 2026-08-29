import { FileJournal } from '../../../packages/event-store/src/index.js';
import { DurableControlPlane } from '../../../packages/durable-control-plane/src/index.js';
import { startDashboard } from './server.js';

const journalPath = process.env.TIGERIQ_JOURNAL ?? 'F:\\TigerIQ\\State\\control-plane.jsonl';
const host = process.env.TIGERIQ_COMMAND_HOST ?? '127.0.0.1';
const port = Number(process.env.TIGERIQ_COMMAND_PORT ?? '8787');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('TIGERIQ_COMMAND_PORT must be an integer between 1 and 65535');
}

const plane = new DurableControlPlane(new FileJournal(journalPath));
const server = await startDashboard(plane, { host, port });

console.log(`TigerIQ Command Center online: ${server.url}`);
console.log(`Journal: ${journalPath}`);
console.log('Write actions require TIGERIQ_COMMAND_SECRET.');

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
