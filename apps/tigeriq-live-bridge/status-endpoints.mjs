// Source-only default URL policy for the PC01 co-resident live status bridge.
// Coding Lane listens on 127.0.0.1:8797 by default. An explicitly configured
// status URL takes precedence (for deployments that deliberately bind another host).
export const DEFAULT_PC01_CODING_STATUS_URL='http://127.0.0.1:8797/api/status';
export function resolveCodingStatusUrl(env=process.env){
  return String(env?.TIGERIQ_CODING_STATUS_URL??'').trim()||DEFAULT_PC01_CODING_STATUS_URL;
}
