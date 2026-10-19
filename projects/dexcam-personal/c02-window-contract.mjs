/**
 * C02 architecture contract (source-only): never calls Android, USB, or shell.
 * A request is NOT evidence that Android applied any window bounds.
 */
const CONTRACT = 'dexcam-c02-window-contract-v1';
const finite = x => typeof x === 'number' && Number.isFinite(x);
const pixel = x => Number.isSafeInteger(x) && x >= 0;
const validRect = r => r && ['x','y','width','height'].every(k => pixel(r[k])) && r.width > 0 && r.height > 0;

export function planWindowRequest({ display, preset, capability } = {}) {
  const fallback = (reason, requested_bounds = null) => ({
    contract: CONTRACT, action:'MANUAL_FALLBACK', reason, requested_bounds,
    applied_bounds:null, verification:'NOT_MEASURED', third_party_task_resize:'NOT_AUTHORIZED'
  });
  // Android Display.INVALID_DISPLAY is -1; ID must be a finite integer.
  // Reject missing/nonprimitive fingerprints rather than trusting truthiness.
  if (!display || !pixel(display.id) ||
      typeof display.fingerprint !== 'string' || !display.fingerprint.trim() ||
      !pixel(display.width_px) || !pixel(display.height_px) ||
      display.width_px === 0 || display.height_px === 0 ||
      !display.insets || !['left','right','top','bottom'].every(k => pixel(display.insets[k])))
    return fallback('DISPLAY_UNVERIFIED');
  if (!preset || preset.display_fingerprint !== display.fingerprint || preset.display_id !== display.id)
    return fallback('DISPLAY_PROFILE_MISMATCH');
  const i = display.insets;
  const usable = { x:i.left, y:i.top, width:display.width_px-i.left-i.right, height:display.height_px-i.top-i.bottom };
  if (!validRect(usable)) return fallback('NO_SAFE_DISPLAY_AREA');
  const r = preset.bounds_normalized;
  if (!r || !['x','y','width','height'].every(k => finite(r[k]) && r[k] >= 0 && r[k] <= 1) ||
      r.width === 0 || r.height === 0 || r.x+r.width > 1 || r.y+r.height > 1)
    return fallback('INVALID_NORMALIZED_BOUNDS');
  const bounds = {x:usable.x+Math.round(r.x*usable.width), y:usable.y+Math.round(r.y*usable.height),
    width:Math.round(r.width*usable.width), height:Math.round(r.height*usable.height)};
  if (!validRect(bounds) || bounds.x+bounds.width > display.width_px-i.right ||
      bounds.y+bounds.height > display.height_px-i.bottom)
    return fallback('INVALID_PIXEL_BOUNDS');
  if (capability?.freeform !== 'SUPPORTED' || capability?.multi_window !== 'SUPPORTED')
    return fallback('FREEFORM_NOT_VERIFIED',bounds);
  if (capability?.activity_state !== 'FOREGROUND')
    return fallback('BACKGROUND_ACTIVITY_LAUNCH_NOT_VERIFIED',bounds);
  return {contract:CONTRACT, action:'REQUEST_L0_LAUNCH_BOUNDS',reason:'PUBLIC_ANDROID_API_REQUEST_ONLY',
    requested_bounds:bounds,applied_bounds:null,verification:'NOT_MEASURED',
    third_party_task_resize:'NOT_AUTHORIZED'};
}

export function checkAppliedBounds({ requested_bounds, observed_bounds, evidence_ref } = {}) {
  if (!validRect(requested_bounds) || !validRect(observed_bounds) ||
      typeof evidence_ref !== 'string' || !evidence_ref.trim())
    return {status:'NOT_MEASURED',delta:null};
  // Adapter must independently authenticate evidence provenance; comparison alone cannot.
  const delta=Object.fromEntries(['x','y','width','height'].map(k=>[k,observed_bounds[k]-requested_bounds[k]]));
  return {status:Object.values(delta).every(x=>x===0)?'BOUNDS_MATCH_OBSERVED':'BOUNDS_DIFFER_OBSERVED',delta};
}

export function planLayoutRestore({snapshot_id,reverse_state='UNKNOWN',reverse_off_evidence,
    manual_close=false,stationary_confirmed=false,live_frame=false}={}) {
  const hold=live_frame?'HOLD_PRE_CAMERA_LAYOUT':'HOLD_AND_SHOW_CAMERA_UNAVAILABLE';
  if (typeof snapshot_id !== 'string' || !snapshot_id.trim())
    return {action:'NO_SNAPSHOT',restore_permitted:false};
  if (manual_close===true && stationary_confirmed===true)
    return {action:'RESTORE_SNAPSHOT_REQUEST',restore_permitted:true,basis:'MANUAL_CLOSE_WHILE_STATIONARY'};
  const off=reverse_state==='OFF' && reverse_off_evidence?.kind==='INDEPENDENT_R_OFF' &&
    typeof reverse_off_evidence?.reference==='string' && !!reverse_off_evidence.reference.trim();
  if(off) return {action:'RESTORE_SNAPSHOT_REQUEST',restore_permitted:true,basis:'VERIFIED_R_OFF'};
  return {action:hold,restore_permitted:false,basis:'NO_VERIFIED_R_OFF'};
}
