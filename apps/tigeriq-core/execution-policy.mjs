// Step 1 containment is source-controlled; environment variables cannot re-enable it.
// Rollback requires an independently reviewed release, never a provider fallback.
export const LEGACY_AUTONOMY_DISABLED = true;
export const LEGACY_DISABLED_REASON = 'LEGACY_AUTONOMY_QUARANTINED_STEP1';
export function disabledLegacyStatus() {
  return {ok: true, enabled: false, status: 'disabled', reason: LEGACY_DISABLED_REASON};
}
