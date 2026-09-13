import {disabledLegacyStatus} from '../tigeriq-core/execution-policy.mjs';

// Do not load providers, database, transport, scheduler or the legacy worker.
console.log(JSON.stringify({event: 'CODING_LANE_DISABLED', ...disabledLegacyStatus()}));
