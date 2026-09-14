function visible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

const WORKER_BADGE_ID = 'tigeriq-worker-badge';
const WORKER_BADGE_LABELS = {
  NV03: 'NV03 · CHATGPT GO',
  NV05: 'NV05 · CHATGPT PLUS',
  NV04: 'NV04 · GEMINI PRO',
};
const WORKER_BADGE_COLORS = {
  NV03: '#2563eb',
  NV05: '#16a34a',
  NV04: '#7c3aed',
};

function stripWorkerTitlePrefix() {
  document.title = document.title.replace(/^\[NV0[345]\]\s*/, '');
}

function removeWorkerBadge() {
  document.getElementById(WORKER_BADGE_ID)?.remove();
  stripWorkerTitlePrefix();
}

function showWorkerBadge(workerId, label) {
  if (!WORKER_BADGE_LABELS[workerId]) {
    removeWorkerBadge();
    return;
  }
  let badge = document.getElementById(WORKER_BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = WORKER_BADGE_ID;
    Object.assign(badge.style, {
      position: 'fixed',
      top: '56px',
      right: '12px',
      zIndex: '2147483647',
      padding: '9px 14px',
      borderRadius: '10px',
      color: '#fff',
      font: '800 14px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      letterSpacing: '0.03em',
      border: '2px solid rgba(255,255,255,0.92)',
      boxShadow: '0 4px 14px rgba(0,0,0,0.38)',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: '0.97',
    });
    document.documentElement.appendChild(badge);
  }
  badge.style.background = WORKER_BADGE_COLORS[workerId];
  badge.textContent = `● ${WORKER_BADGE_LABELS[workerId]}`;
  badge.title = label || WORKER_BADGE_LABELS[workerId];
  stripWorkerTitlePrefix();
  document.title = `[${workerId}] ${document.title}`;
}

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

function findSendButton() {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[aria-label*="submit" i]'
  ];
  for (const selector of selectors) {
    const match = Array.from(document.querySelectorAll(selector)).find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (match) return match;
  }
  return null;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function dispatch(text) {
  const blocked = detectSecurityBlock();
  if (blocked) return { ok: false, status: blocked };
  if (!text.trim()) return { ok: false, status: 'EMPTY_WORK_ORDER' };
  const composer = findComposer();
  if (!composer) return { ok: false, status: 'COMPOSER_NOT_FOUND' };
  fillComposer(composer, text);
  await sleep(1500);
  const blockedAfterFill = detectSecurityBlock();
  if (blockedAfterFill) return { ok: false, status: blockedAfterFill };
  const send = findSendButton();
  if (!send) return { ok: false, status: 'SEND_BUTTON_NOT_FOUND' };
  send.click();
  return { ok: true, status: 'SUBMITTED' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TIGERIQ_WORKER_BADGE') {
    if (message.workerId) showWorkerBadge(String(message.workerId), String(message.label || ''));
    else removeWorkerBadge();
    sendResponse({ ok: true });
    return;
  }
  if (message?.type !== 'TIGERIQ_DISPATCH') return;
  void dispatch(String(message.text || '')).then(sendResponse).catch((error) => sendResponse({ ok: false, status: String(error) }));
  return true;
});
