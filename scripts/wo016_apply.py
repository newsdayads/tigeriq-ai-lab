from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)

control_path = Path('api/control.mjs')
control = control_path.read_text(encoding='utf-8')
control = replace_once(control, "      workOrderLifecycleEvidence: true,\n", "      workOrderLifecycleEvidence: true,\n      explicitDispatch: true,\n", 'explicit capability')
control = replace_once(control, "  const priority = String(payload.priority || 'P1').toUpperCase();\n", "  const priority = String(payload.priority || 'P1').toUpperCase();\n  const source = payload.source === 'vercel-explicit-dispatch' ? 'vercel-explicit-dispatch' : 'vercel-chat-chief-of-staff';\n  const governance = source === 'vercel-explicit-dispatch'\n    ? 'Owner explicitly dispatched this instruction from TigerIQ AI Web Control. Execution still requires normal TigerIQ evidence/review/gate.'\n    : 'Chief of Staff classified this as an explicit execution request. Execution still requires normal TigerIQ evidence/review/gate.';\n", 'dispatch metadata')
control = replace_once(control, "    'vercel-chat-chief-of-staff',\n", "    source,\n", 'source body')
control = replace_once(control, "    'Chief of Staff classified this as an explicit execution request. Execution still requires normal TigerIQ evidence/review/gate.',\n", "    governance,\n", 'governance body')
control = replace_once(control, "    if (operation === 'work-order') return json(res, 201, await createWorkOrder(payload, writeCredential(req).token));\n", "    if (operation === 'work-order') return json(res, 201, await createWorkOrder({ ...payload, source: 'vercel-explicit-dispatch' }, writeCredential(req).token));\n", 'work order handler')
control_path.write_text(control, encoding='utf-8')

index_path = Path('public/index.html')
index = index_path.read_text(encoding='utf-8')
index = replace_once(index, '<div class="subtitle">Trợ lý điều hành · Chief of Staff GPT</div>', '<div class="subtitle">Trợ lý điều hành · Chat + Giao việc</div>', 'subtitle')
index = replace_once(index, '  <button id="quickPc">Kiểm tra PC01</button>\n  <button id="openSettings">Cài đặt</button>', '  <button id="quickPc">Kiểm tra PC01</button>\n  <button id="quickWork">Công việc</button>\n  <button id="openSettings">Cài đặt</button>', 'quick work button')
index = replace_once(index, '      <button id="settingsBtn" class="iconbtn" type="button">⚙ Cài đặt</button>\n      <button id="send" class="sendbtn" type="button">Gửi</button>', '      <button id="settingsBtn" class="iconbtn" type="button">⚙ Cài đặt</button>\n      <div style="display:flex;gap:8px;align-items:center">\n        <button id="dispatch" class="iconbtn" type="button">Giao việc</button>\n        <button id="send" class="sendbtn" type="button">Gửi</button>\n      </div>', 'dispatch button')

anchor = "async function canary(){try{const d=await api({operation:'work-order-status',issueNumber:58});const s=d.issue?.stage||'queued';addBubble(`PC01 canary #58: ${stageText[s]||s}${evidenceLabel(d.issue?.evidence)}. Em không tạo thêm canary trùng.`,'assistant','TigerIQ AI · PC01')}catch(e){addBubble('Chưa lấy được bằng chứng PC01: '+(e.details||e.message),'assistant','TigerIQ AI')}}\n"
extra = anchor + """async function showWork(){const rows=loadTracked();if(!rows.length){addBubble('Phiên này chưa có công việc nào được theo dõi. Hàng đợi hệ thống vẫn xem được ở Xem trạng thái.','assistant','TigerIQ AI · công việc');await refresh(false);return}await pollTracked(true)}\nasync function explicitDispatch(){const text=$('instruction').value.trim();if(!text)return;if(!tokenInput.value.trim()){addBubble('Để giao việc trực tiếp, phiên này cần quyền GitHub. Mở Cài đặt → Kết nối GitHub.','assistant','TigerIQ AI');openSettings();return}addBubble(text,'user','Sếp · giao việc');$('instruction').value='';resizeComposer();$('dispatch').disabled=true;$('send').disabled=true;try{const d=await api({operation:'work-order',instruction:text,priority:$('priority').value});trackIssue(d.issue);const msg=d.deduplicated?`Công việc này đã tồn tại ở #${d.issue.number}; em không tạo bản trùng.`:`Đã giao công việc #${d.issue.number}. Em sẽ theo dõi trạng thái và evidence.`;const b=addBubble(msg,'assistant',d.deduplicated?'TigerIQ AI · dedupe':'TigerIQ AI · giao việc');if(d.issue?.url){const a=document.createElement('a');a.href=d.issue.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Mở công việc #'+d.issue.number;a.style.display='block';a.style.marginTop='8px';b.append(a)}setTimeout(()=>pollTracked(false),1200);await refresh(false)}catch(e){if(e.code==='github_authorization_required'||e.code==='github_401'||e.code==='github_403'){addBubble('Quyền GitHub chưa sẵn sàng hoặc đã hết hạn. Mở Cài đặt để kết nối lại.','assistant','TigerIQ AI');openSettings()}else addBubble('Chưa giao được việc: '+(e.details||e.message),'assistant','TigerIQ AI')}finally{$('dispatch').disabled=false;$('send').disabled=false}}\n"""
index = replace_once(index, anchor, extra, 'dispatch functions')
index = replace_once(index, "$('quickStatus').onclick=()=>refresh(true);$('quickPc').onclick=canary;$('send').onclick=send;", "$('quickStatus').onclick=()=>refresh(true);$('quickPc').onclick=canary;$('quickWork').onclick=showWork;$('dispatch').onclick=explicitDispatch;$('send').onclick=send;", 'event wiring')
index_path.write_text(index, encoding='utf-8')

verify_path = Path('scripts/verify_explicit_dispatch.mjs')
verify_path.write_text("""import fs from 'node:fs';\nimport assert from 'node:assert/strict';\nconst api=fs.readFileSync(new URL('../api/control.mjs', import.meta.url),'utf8');\nconst ui=fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');\nassert.match(api,/explicitDispatch: true/);\nassert.match(api,/vercel-explicit-dispatch/);\nassert.match(api,/Owner explicitly dispatched this instruction/);\nassert.match(api,/operation === 'work-order'/);\nassert.match(ui,/id=\"dispatch\"/);\nassert.match(ui,/operation:'work-order'/);\nassert.match(ui,/id=\"quickWork\"/);\nassert.match(ui,/pollTracked\(true\)/);\nassert.match(ui,/Não AI hiện chưa sẵn sàng nên em không tự biến câu này thành Work Order/);\nconsole.log('WO016_EXPLICIT_DISPATCH_PASS');\n""", encoding='utf-8')
print('WO016_PATCH_APPLIED')
