function visible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
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
  if (message?.type !== 'TIGERIQ_DISPATCH') return;
  void dispatch(String(message.text || '')).then(sendResponse).catch((error) => sendResponse({ ok: false, status: String(error) }));
  return true;
});
