export function wrapFileChange(path, content, metadata = {}) {
  const text = String(content ?? '');
  const meta = typeof metadata === 'object' && metadata !== null ? metadata : {};
  return [
    '-----BEGIN TIGERIQ_FILE_CHANGE_V1-----',
    `Path: ${String(path || '').trim()}`,
    ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`),
    'Content-Length: ' + Buffer.byteLength(text, 'utf8'),
    '',
    text,
    '-----END TIGERIQ_FILE_CHANGE_V1-----'
  ].join('\n');
}

export function unwrapFileChange(rawBlock) {
  const text = String(rawBlock || '');
  const startIdx = text.indexOf('-----BEGIN TIGERIQ_FILE_CHANGE_V1-----');
  const endIdx = text.indexOf('-----END TIGERIQ_FILE_CHANGE_V1-----');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('ENVELOPE_MALFORMED: missing TIGERIQ_FILE_CHANGE_V1 delimiters');
  }
  const headerAndBody = text.slice(startIdx + '-----BEGIN TIGERIQ_FILE_CHANGE_V1-----'.length, endIdx).trimStart();
  const parts = headerAndBody.split(/\r?\n\r?\n/);
  if (parts.length < 2) {
    throw new Error('ENVELOPE_MALFORMED: missing separator between headers and content');
  }
  const headerLines = parts[0].split(/\r?\n/);
  const content = parts.slice(1).join('\n');
  let path = '';
  const metadata = {};
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key.toLowerCase() === 'path') {
      path = val;
    } else if (key.toLowerCase() !== 'content-length') {
      metadata[key] = val;
    }
  }
  if (!path) {
    throw new Error('ENVELOPE_MALFORMED: missing Path header in envelope');
  }
  return { path, content, metadata };
}

export function parseEnvelopeOrLegacy(input) {
  if (typeof input === 'string' && input.includes('-----BEGIN TIGERIQ_FILE_CHANGE_V1-----')) {
    return unwrapFileChange(input);
  }
  if (input && typeof input === 'object' && typeof input.path === 'string') {
    return {
      path: String(input.path || '').trim(),
      content: String(input.content ?? input.source ?? ''),
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    };
  }
  throw new Error('INVALID_CHANGE_ENVELOPE');
}
