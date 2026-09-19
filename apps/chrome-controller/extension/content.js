function visible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

const WORKER_BADGE_ID = 'tigeriq-worker-badge';
const WORKER_BADGE_LABELS = {
  NV03: 'NV03 · CHATGPT GO',
  NV02: 'NV02 · CHATGPT PLUS',
  NV04: 'NV04 · GEMINI PRO',
};
const WORKER_BADGE_COLORS = {
  NV03: '#2563eb',
  NV02: '#16a34a',
  NV04: '#7c3aed',
};
let activeWorkerBadge = null;
let badgeRepairQueued = false;

function stripWorkerTitlePrefix() {
  const clean = document.title.replace(/^(?:\[NV0[2345]\]\s*)+/, '');
  if (clean !== document.title) document.title = clean;
}

function removeWorkerBadge() {
  activeWorkerBadge = null;
  document.getElementById(WORKER_BADGE_ID)?.remove();
  stripWorkerTitlePrefix();
}

function ensureWorkerBadge() {
  const workerId = activeWorkerBadge?.workerId;
  if (!workerId || !WORKER_BADGE_LABELS[workerId] || !document.documentElement) return;
  let badge = document.getElementById(WORKER_BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = WORKER_BADGE_ID;
    Object.assign(badge.style, {
      position: 'fixed',
      top: '10px',
      right: '12px',
      zIndex: '2147483647',
      padding: '6px 10px',
      borderRadius: '8px',
      color: '#fff',
      font: '800 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      letterSpacing: '0.03em',
      border: '1px solid rgba(255,255,255,0.85)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: '0.94',
      display: 'block',
    });
    document.documentElement.appendChild(badge);
  }
  const wantedBackground = WORKER_BADGE_COLORS[workerId];
  const wantedText = `● ${WORKER_BADGE_LABELS[workerId]}`;
  const wantedBadgeTitle = activeWorkerBadge?.label || WORKER_BADGE_LABELS[workerId];
  if (badge.style.background !== wantedBackground) badge.style.background = wantedBackground;
  if (badge.textContent !== wantedText) badge.textContent = wantedText;
  if (badge.title !== wantedBadgeTitle) badge.title = wantedBadgeTitle;
  const cleanTitle = document.title.replace(/^(?:\[NV0[2345]\]\s*)+/, '');
  const wantedTitle = `[${workerId}] ${cleanTitle}`;
  if (document.title !== wantedTitle) document.title = wantedTitle;
}

function queueBadgeRepair() {
  if (badgeRepairQueued || !activeWorkerBadge) return;
  badgeRepairQueued = true;
  queueMicrotask(() => {
    badgeRepairQueued = false;
    ensureWorkerBadge();
  });
}

function showWorkerBadge(workerId, label) {
  if (!WORKER_BADGE_LABELS[workerId]) {
    removeWorkerBadge();
    return;
  }
  activeWorkerBadge = { workerId, label };
  ensureWorkerBadge();
}

const badgeObserver = new MutationObserver(() => queueBadgeRepair());
badgeObserver.observe(document.documentElement, { childList: true, subtree: true });

function notifyRouteChanged() {
  queueBadgeRepair();
  try { chrome.runtime.sendMessage({ type: 'TIGERIQ_ROUTE_CHANGED', url: location.href }, () => void chrome.runtime.lastError); } catch { /* extension navigation teardown */ }
}
for (const method of ['pushState', 'replaceState']) {
  const original = history[method].bind(history);
  history[method] = (...args) => {
    const result = original(...args);
    notifyRouteChanged();
    return result;
  };
}
addEventListener('popstate', notifyRouteChanged);
addEventListener('hashchange', notifyRouteChanged);

function detectSecurityBlock() {
  if (document.querySelector('iframe[src*="captcha" i], iframe[src*="challenge" i], [class*="captcha" i], [id*="captcha" i]')) {
    return 'BLOCKED_CAPTCHA';
  }
  const text = Array.from(document.querySelectorAll('[role="alert"], [role="dialog"], [data-testid*="toast" i]'))
    .slice(0, 30)
    .map((el) => (el.textContent || '').toLowerCase())
    .join(' ');
  const checks = [
    ['rate limit', 'BLOCKED_RATE_LIMIT'], ['too many requests', 'BLOCKED_RATE_LIMIT'],
    ['suspicious activity', 'BLOCKED_SUSPICIOUS_ACTIVITY'], ['unusual activity', 'BLOCKED_SUSPICIOUS_ACTIVITY'],
    ['verify your identity', 'BLOCKED_REAUTH'], ['verify it’s you', 'BLOCKED_REAUTH'], ['verify it is you', 'BLOCKED_REAUTH'],
    ['security warning', 'BLOCKED_SECURITY_WARNING'], ['đã đạt giới hạn', 'BLOCKED_RATE_LIMIT'],
    ['xác minh danh tính', 'BLOCKED_REAUTH'], ['hoạt động đáng ngờ', 'BLOCKED_SUSPICIOUS_ACTIVITY'],
  ];
  for (const [needle, status] of checks) if (text.includes(needle)) return status;
  return null;
}

function detectUiBusy() {
  const selectors = location.hostname === 'chatgpt.com'
    ? ['button[data-testid="stop-button"]','button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]']
    : ['button[aria-label*="Stop" i]','button[aria-label*="Dừng" i]','button[data-test-id*="stop" i]'];
  return selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some((el) => visible(el)));
}

function findComposer() {
  const selectors = location.hostname === 'chatgpt.com'
    ? ['#prompt-textarea', 'div[contenteditable="true"][data-lexical-editor="true"]', '[contenteditable="true"][role="textbox"]', 'textarea']
    : ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea'];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    const match = elements.find((el) => visible(el));
    if (match) return match;
  }
  return null;
}

function fillComposer(element, text) {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

function findSendButton(composer) {
  const scopedRoots = [composer?.closest?.('form'), composer?.parentElement].filter(Boolean);
  const scopedSelectors = [
    'button[data-testid="send-button"]',
    'button[type="submit"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[aria-label*="submit" i]'
  ];
  const globalSelectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[aria-label*="submit" i]'
  ];
  for (const root of scopedRoots) {
    for (const selector of scopedSelectors) {
      const matches = Array.from(root.querySelectorAll(selector)).filter((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
      if (matches.length === 1) return matches[0];
    }
  }
  for (const selector of globalSelectors) {
    const matches = Array.from(document.querySelectorAll(selector)).filter((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (matches.length === 1) return matches[0];
  }
  return null;
}
function composerText(element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return String(element.value || '').trim();
  return String(element?.innerText || element?.textContent || '').trim();
}
function submittedPromptVisible(expectedText) {
  if (location.hostname !== 'chatgpt.com') return false;
  return Array.from(document.querySelectorAll('[data-message-author-role="user"]'))
    .some((el) => visible(el) && String(el.textContent || '').trim() === expectedText.trim());
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForSubmissionEvidence(expectedText, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(100);
    const blocked = detectSecurityBlock();
    if (blocked) return { ok: false, status: blocked };
    if (detectUiBusy()) return { ok: true, evidence: 'UI_BUSY' };
    if (submittedPromptVisible(expectedText)) return { ok: true, evidence: 'USER_MESSAGE_VISIBLE' };
    const currentComposer = findComposer();
    if (currentComposer && composerText(currentComposer) === '') return { ok: true, evidence: 'COMPOSER_CLEARED' };
  }
  return { ok: false, status: 'SUBMIT_EVIDENCE_MISSING' };
}

async function dispatch(text) {
  const blocked = detectSecurityBlock();
  if (blocked) return { ok: false, status: blocked };
  const expectedText = text.trim();
  if (!expectedText) return { ok: false, status: 'EMPTY_WORK_ORDER' };
  const composer = findComposer();
  if (!composer) return { ok: false, status: 'COMPOSER_NOT_FOUND' };
  if (composerText(composer) !== expectedText) fillComposer(composer, text);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    await sleep(200);
    const blockedAfterFill = detectSecurityBlock();
    if (blockedAfterFill) return { ok: false, status: blockedAfterFill };
    const send = findSendButton(composer);
    if (!send) continue;
    send.click();
    const submitted = await waitForSubmissionEvidence(expectedText);
    if (!submitted.ok) return submitted;
    return { ok: true, status: 'SUBMITTED', evidence: submitted.evidence };
  }
  return { ok: false, status: 'SEND_BUTTON_NOT_FOUND' };
}

function normalizedText(element) {
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function dismissMenu() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

function profileBlocked(reason) {
  dismissMenu();
  return { ok: false, status: `MODEL_PROFILE_BLOCKED:${reason}` };
}

function modelProfileTrigger() {
  const selectors = [
    'button[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"][aria-haspopup="menu"]',
    'button[aria-label="Chọn mô hình ChatGPT"][aria-haspopup="menu"]',
    'button[aria-label="Select ChatGPT model"][aria-haspopup="menu"]'
  ];
  const matches = [...new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))))].filter(visible);
  return matches.length === 1 ? matches[0] : null;
}

function openModelMenu() {
  const menus = Array.from(document.querySelectorAll('[role="menu"]'))
    .filter(visible)
    .filter((menu) => menu.querySelector('[data-model-picker-view-toggle="true"],[data-reasoning-slider="true"],[data-model-selected="true"]'));
  return menus.length === 1 ? menus[0] : null;
}

function selectedModelName(menu) {
  const selected = Array.from(menu.querySelectorAll('[role="menuitemradio"][aria-checked="true"][data-model-selected="true"]'));
  if (selected.length !== 1) return null;
  return String(selected[0].textContent || '').replace(/\s+/g, ' ').trim();
}

async function ensureNv02ExactModelProfile() {
  if (location.hostname !== 'chatgpt.com') return profileBlocked('UNVERIFIED_HOST');
  const initialBlock = detectSecurityBlock();
  if (initialBlock) return profileBlocked(initialBlock);

  let trigger = modelProfileTrigger();
  if (!trigger) return profileBlocked('MODEL_TRIGGER_NOT_UNIQUE');
  if (trigger.getAttribute('data-state') !== 'open') {
    trigger.click();
    await sleep(300);
  }
  let blocked = detectSecurityBlock();
  if (blocked) return profileBlocked(blocked);
  let menu = openModelMenu();
  if (!menu) return profileBlocked('MODEL_MENU_NOT_UNIQUE');

  if (selectedModelName(menu) !== 'GPT-5.6 Sol') {
    const toggles = Array.from(menu.querySelectorAll('[data-model-picker-view-toggle="true"][role="menuitem"]')).filter(visible);
    if (toggles.length !== 1) return profileBlocked('MODEL_VIEW_TOGGLE_NOT_UNIQUE');
    toggles[0].click();
    await sleep(250);
    blocked = detectSecurityBlock();
    if (blocked) return profileBlocked(blocked);
    menu = openModelMenu();
    if (!menu) return profileBlocked('MODEL_MENU_LOST_AFTER_TOGGLE');
    const solItems = Array.from(menu.querySelectorAll('[role="menuitemradio"]'))
      .filter(visible)
      .filter((item) => String(item.textContent || '').replace(/\s+/g, ' ').trim() === 'GPT-5.6 Sol')
      .filter((item) => item.getAttribute('aria-disabled') !== 'true');
    if (solItems.length !== 1) return profileBlocked('GPT_5_6_SOL_OPTION_NOT_UNIQUE');
    solItems[0].click();
    await sleep(400);
    blocked = detectSecurityBlock();
    if (blocked) return profileBlocked(blocked);
  }

  trigger = modelProfileTrigger();
  if (!trigger) return profileBlocked('MODEL_TRIGGER_LOST');
  if (trigger.getAttribute('data-selected-reasoning-effort') !== 'high') {
    if (trigger.getAttribute('data-state') !== 'open') {
      trigger.click();
      await sleep(250);
    }
    menu = openModelMenu();
    if (!menu) return profileBlocked('EFFORT_MENU_NOT_UNIQUE');
    const effortControls = Array.from(menu.querySelectorAll('[data-reasoning-slider="true"][role="menuitem"]')).filter(visible);
    if (effortControls.length !== 1) return profileBlocked('EFFORT_CONTROL_NOT_UNIQUE');
    effortControls[0].focus();
    for (let i = 0; i < 3 && trigger.getAttribute('data-selected-reasoning-effort') !== 'high'; i++) {
      effortControls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      effortControls[0].dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      await sleep(150);
    }
    if (trigger.getAttribute('data-selected-reasoning-effort') !== 'high') return profileBlocked('HIGH_EFFORT_SWITCH_FAILED');
  }

  if (trigger.getAttribute('data-state') !== 'open') {
    trigger.click();
    await sleep(250);
  }
  menu = openModelMenu();
  if (!menu) return profileBlocked('FINAL_MODEL_MENU_NOT_UNIQUE');
  const finalModel = selectedModelName(menu);
  const finalEffort = trigger.getAttribute('data-selected-reasoning-effort');
  if (finalModel !== 'GPT-5.6 Sol') return profileBlocked('FINAL_MODEL_MISMATCH');
  if (finalEffort !== 'high') return profileBlocked('FINAL_EFFORT_MISMATCH');
  const verifiedAt = new Date().toISOString();
  dismissMenu();
  return { ok: true, status: 'MODEL_PROFILE_VERIFIED', model: finalModel, thinking: finalEffort, verifiedAt };
}

async function archiveConversation() {
  const blocked = detectSecurityBlock();
  if (blocked) return { ok: false, status: blocked };
  if (location.hostname !== 'chatgpt.com') return { ok: false, status: 'ARCHIVE_SELECTOR_UNVERIFIED_HOST' };
  if (!/\/c\//.test(location.pathname)) return { ok: false, status: 'ARCHIVE_REQUIRES_CONVERSATION_URL' };

  const before = location.href;
  const selectors = [
    'header button[aria-haspopup="menu"]',
    'main button[aria-haspopup="menu"]',
    'button[data-testid*="conversation" i][aria-haspopup="menu"]',
    'button[aria-label*="conversation" i][aria-haspopup="menu"]'
  ];
  const candidates = [...new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))))]
    .filter((element) => visible(element))
    .filter((element) => {
      const label = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`.toLowerCase();
      return /more|menu|options|thêm|tùy chọn/.test(label);
    });
  if (candidates.length !== 1) return { ok: false, status: `ARCHIVE_MENU_BUTTON_NOT_UNIQUE:${candidates.length}` };

  candidates[0].click();
  await sleep(350);
  const blockedAfterMenu = detectSecurityBlock();
  if (blockedAfterMenu) { dismissMenu(); return { ok: false, status: blockedAfterMenu }; }

  const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, [data-radix-menu-content] button'))
    .filter((element) => visible(element));
  const archiveItems = menuItems.filter((element) => ['archive', 'lưu trữ'].includes(normalizedText(element)));
  if (archiveItems.length !== 1) {
    dismissMenu();
    return { ok: false, status: `ARCHIVE_MENU_ITEM_NOT_UNIQUE:${archiveItems.length}` };
  }

  archiveItems[0].click();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(250);
    if (location.href !== before || !/\/c\//.test(location.pathname)) return { ok: true, status: 'ARCHIVED' };
    const blockedAfterClick = detectSecurityBlock();
    if (blockedAfterClick) return { ok: false, status: blockedAfterClick };
  }
  return { ok: false, status: 'ARCHIVE_NOT_CONFIRMED' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TIGERIQ_WORKER_BADGE') {
    if (message.workerId) showWorkerBadge(String(message.workerId), String(message.label || ''));
    else removeWorkerBadge();
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === 'TIGERIQ_UI_STATE') {
    sendResponse({ ok: true, uiBusy: detectUiBusy(), securityBlock: detectSecurityBlock() });
    return;
  }
  if (message?.type === 'TIGERIQ_ARCHIVE_CONVERSATION') {
    void archiveConversation().then(sendResponse).catch((error) => sendResponse({ ok: false, status: String(error) }));
    return true;
  }
  if (message?.type === 'TIGERIQ_MODEL_PREFLIGHT') {
    void ensureNv02ExactModelProfile().then(sendResponse).catch((error) => sendResponse({ ok: false, status: `MODEL_PROFILE_BLOCKED:${String(error)}` }));
    return true;
  }
  if (message?.type !== 'TIGERIQ_DISPATCH') return;
  void dispatch(String(message.text || '')).then(sendResponse).catch((error) => sendResponse({ ok: false, status: String(error) }));
  return true;
});