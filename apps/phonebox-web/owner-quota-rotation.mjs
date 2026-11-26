// TigerIQ owner-only overlay. Never modify vendor files on disk.
export function applyOwnerQuotaRotation(source) {
  const start = source.indexOf('W.quotaring = {');
  const end = source.indexOf('\nW.volume = {', start);
  if (start < 0 || end < 0) return null;
  let w = source.slice(start, end);
  const changes = [
    ["create(box, { o }) {", "create(box, { o, page }) {"],
    ["let last = 0;", "let last = 0, rotationStarted = null, lastPhase = -1;\n    const rotate = page?.id === 'home' && ['codex', 'antigravity'].includes(prov);\n    if (rotate) box.classList.add('tiq-rotating-quota');\n    const phase = () => rotationStarted === null ? -1 : Math.max(0, Math.floor((Date.now() - rotationStarted) / 5000));"],
    ["const l = p?.limits?.[idx];", "const available = Array.isArray(p?.limits) ? p.limits.filter(x => x && Number.isFinite(x.percent) && /(?:5.hour|weekly)/i.test(String(x.label))) : [];\n      if (rotate && available.length && rotationStarted === null) rotationStarted = Date.now();\n      const l = rotate && available.length ? available[phase() % available.length] : p?.limits?.[idx];"],
    ["if (kind === 'tick' && Date.now() - last < 30_000) return; last = Date.now(); render();", "if (kind === 'tick' && (rotate ? rotationStarted !== null && phase() === lastPhase : Date.now() - last < 30_000)) return; last = Date.now(); render(); lastPhase = phase();"]
  ];
  for (const [a,b] of changes) {
    if (w.split(a).length !== 2) return null;
    w = w.replace(a, () => b);
  }
  const labelLine = w.split('\n').filter(x => x.includes('label.textContent') && x.includes('quotaText(l.label)'));
  const resetLine = w.split('\n').filter(x => x.includes('sub.textContent = l.resetsAt ?'));
  if (labelLine.length !== 1 || resetLine.length !== 1) return null;
  w = w.replace(labelLine[0], () => "      if (rotate) label.textContent = (prov === 'codex' ? 'Codex' : 'Antigravity') + '\\n' + quotaText(l.label); else " + labelLine[0].trim());
  w = w.replace(resetLine[0], () => "      if (rotate) sub.textContent = l.resetsAt ? 'Reset ' + fmtDur(Math.max(0, l.resetsAt - Date.now())) : ''; else " + resetLine[0].trim());
  return source.slice(0,start) + '/* TigerIQ owner rotation: 5000ms */\n' + w + source.slice(end);
}
