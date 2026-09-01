import { getVercelOidcToken } from '@vercel/oidc';

if (process.env.VERCEL !== '1') process.exit(0);

function safe(value, max = 500) {
  return String(value || '').replace(/[A-Za-z0-9_-]{120,}/g, '[redacted]').slice(0, max);
}

async function request(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  console.log(`[P0_GATEWAY_DIAG] ${url} status=${response.status} body=${safe(text)}`);
  return { response, text };
}

try {
  const token = String((await getVercelOidcToken()) || '').trim();
  console.log(`[P0_GATEWAY_DIAG] oidc_present=${Boolean(token)} oidc_length=${token.length}`);
  if (!token) process.exit(0);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  await request('https://ai-gateway.vercel.sh/v1/credits', { headers: { authorization: `Bearer ${token}` } });
  await request('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'google/gemini-3-flash',
      messages: [{ role: 'user', content: 'Return exactly: 4' }],
      max_tokens: 8,
      temperature: 0,
      stream: false
    })
  });
} catch (error) {
  console.log(`[P0_GATEWAY_DIAG] exception=${safe(error?.message || error)}`);
}
