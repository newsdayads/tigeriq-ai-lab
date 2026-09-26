import { startUiAutopilotSnapshotServer } from './ui-autopilot-snapshot.mjs';

const service=startUiAutopilotSnapshotServer();
const stop=async()=>{try{await service.stop?.();}catch{}};
process.once('SIGINT',()=>void stop());
process.once('SIGTERM',()=>void stop());
