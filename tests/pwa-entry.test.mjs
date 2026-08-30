import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('Web Control PWA entry', () => {
  it('moves legacy PWA entry to the executive Command Center without caching HTML', () => {
    expect(sw).toContain("client.navigate('/command-center.html')");
    expect(sw).toContain("Response.redirect(new URL('/command-center.html',event.request.url),302)");
    expect(sw).toContain("cameFromCommandCenter(event.request.referrer)");
    expect(sw).toContain('event.respondWith(fetch(event.request))');
    expect(sw).not.toContain('caches.open');
  });
});
