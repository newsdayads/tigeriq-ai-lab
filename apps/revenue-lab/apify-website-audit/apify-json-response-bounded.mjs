// GH-2293 R04: cap authenticated Apify JSON responses as bytes arrive.
// Native fetch exposes a ReadableStream; never buffer unbounded data in .text().
const MAX_APIFY_JSON_BYTES = 131072;

export async function readBoundedApifyJsonText(response, fail) {
  const length = response.headers?.get?.('content-length');
  if (typeof length === 'string' && /^\d+$/.test(length) &&
      BigInt(length) > BigInt(MAX_APIFY_JSON_BYTES)) {
    try { void response.body?.cancel?.().catch(() => {}); } catch { /* already closed */ }
    fail('RESPONSE_TOO_LARGE');
  }
  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') {
    // Compatibility with explicitly mocked fetch objects used by test suites.
    const raw = await response.text();
    if (new TextEncoder().encode(raw).length > MAX_APIFY_JSON_BYTES) fail('RESPONSE_TOO_LARGE');
    return raw;
  }
  const reader = stream.getReader();
  const parts = [];
  let lengthSoFar = 0;
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { ended = true; break; }
      if (!(value instanceof Uint8Array)) fail('APIFY_JSON_INVALID');
      lengthSoFar += value.byteLength;
      if (lengthSoFar > MAX_APIFY_JSON_BYTES) fail('RESPONSE_TOO_LARGE');
      parts.push(value);
    }
    const all = new Uint8Array(lengthSoFar);
    let offset = 0;
    for (const part of parts) { all.set(part, offset); offset += part.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(all);
  } finally {
    if (!ended) {
      try { void reader.cancel().catch(() => {}); } catch { /* already closed */ }
    }
    reader.releaseLock();
  }
}
