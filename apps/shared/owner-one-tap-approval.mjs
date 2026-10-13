// P0 Owner-facing one-tap approval: pure, fail-closed, no authorization side effects.
// ChatGPT native and external providers must bind real user actions themselves.
const GATES = new Set([
  'PRODUCTION','PAID_FINANCIAL','CREDENTIAL_SECRET','SECURITY_PERMISSION',
  'DESTRUCTIVE_IRREVERSIBLE','PHYSICAL_LEGAL','RDC_COMMAND','CODEX',
  'INSTALL_PERMISSION',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;

function checkedText(value, limit = 400) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
      /[\r\n\x00-\x1f]/.test(value)) return null;
  return value.trim();
}

export function validateOwnerApprovalRequest(request, source = {}) {
  const errors = [];
  if (!request || typeof request !== 'object' || Array.isArray(request))
    return {ok:false, errors:['REQUEST_INVALID']};
  if (source.verified !== true || source.fresh !== true)
    errors.push('SOURCE_NOT_VERIFIED_FRESH');
  if (request.status !== 'OWNER_GATE' || request.requiresNewAuthorization !== true ||
      request.alreadyAuthorized === true) errors.push('NOT_A_REAL_NEW_OWNER_GATE');
  if (!ID.test(String(request.requestId || ''))) errors.push('REQUEST_ID_INVALID');
  if (!GATES.has(request.gate)) errors.push('GATE_NOT_SPECIFIC');
  for (const field of ['title','action','scope','impact','risk','cost','reversibility','sourceLabel']) {
    if (!checkedText(request[field], field === 'scope' ? 600 : 400))
      errors.push(field.toUpperCase() + '_REQUIRED');
  }
  // No bulk permission grant and no surprise second requested permission.
  if (Array.isArray(request.gates) || request.grantAll === true)
    errors.push('BULK_PERMISSION_FORBIDDEN');
  return {ok:errors.length === 0,errors};
}

export function buildOwnerApprovalCard(request, source = {}) {
  const result = validateOwnerApprovalRequest(request, source);
  if (!result.ok) return {ok:false,errors:result.errors};
  const id = request.requestId;
  const suffix = ' Quyền chỉ có hiệu lực đối với hành động/phạm vi này; giữ nguyên mọi cổng xác thực và kiểm chứng bên ngoài.';
  const approved = 'DUYỆT YÊU CẦU ' + id + ' — ' + request.action +
    '; PHẠM VI: ' + request.scope + '; LOẠI QUYỀN: ' + request.gate +
    '; CHI PHÍ: ' + request.cost + '; CHỈ MỘT LẦN.' + suffix;
  const rejected = 'TỪ CHỐI YÊU CẦU ' + id + ' — ' + request.action +
    '; PHẠM VI: ' + request.scope + '.';
  return {
    ok:true, errors:[],
    card:{
      requestId:id, title:request.title, action:request.action, scope:request.scope,
      impact:request.impact, risk:request.risk, cost:request.cost,
      reversibility:request.reversibility, sourceLabel:request.sourceLabel,
      gate:request.gate, status:'CHỜ ANH SƠN DUYỆT',
      approveLabel:'DUYỆT', rejectLabel:'TỪ CHỐI',
      approvalText:approved, rejectionText:rejected,
      // The next user message is NOT a signed authorization receipt from external tools.
      submissionIsGrant:false,
    },
  };
}

export function publishOwnerApprovalCard(request, {source, emit, sendMessage} = {}) {
  const prepared = buildOwnerApprovalCard(request, source);
  if (!prepared.ok) return {published:false, errors:prepared.errors};
  if (typeof emit !== 'function' || typeof sendMessage !== 'function')
    return {published:false, errors:['REAL_ACTION_CALLBACKS_REQUIRED']};
  let submitted = false;
  const submit = (text) => {
    if (submitted) return false;
    submitted = true;
    try {
      sendMessage(text); // Must be invoked by a genuine UI click, never during render.
      return true;
    } catch (error) {
      submitted = false; // No false success; surface decides whether retry is appropriate.
      throw error;
    }
  };
  emit({
    ...prepared.card,
    onApprove:() => submit(prepared.card.approvalText),
    onReject:() => submit(prepared.card.rejectionText),
  });
  return {published:true, errors:[]}; // Published UI, NOT Owner approval or target execution.
}
