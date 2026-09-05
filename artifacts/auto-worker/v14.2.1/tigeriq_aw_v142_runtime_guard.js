'use strict';
/* TIQ142_RUNTIME_GUARD — does not fake heartbeat/state */
(() => {
  const VERSION = '14.2.1';
  try { document.documentElement.dataset.tigeriqAwCandidate = VERSION; } catch (_) {}
  try { chrome.runtime.sendMessage({ type:'TIQ142_RUNTIME_SEEN', version:VERSION, href:location.href }).catch(() => {}); } catch (_) {}
})();
