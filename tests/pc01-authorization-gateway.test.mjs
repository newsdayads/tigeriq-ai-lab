import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { createMcpFunnelGateway } from '../apps/tigeriq-core/mcp-funnel-gateway.mjs';
import { ownerCodeDigest } from '../apps/tigeriq-core/pc01-authorization-server.mjs';

describe('self-hosted authority gateway integration',()=>{
  it('serves discovery while requiring OAuth on MCP, without anonymous execution',async()=>{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048}), salt='b'.repeat(32);
    const config={issuerUrl:'https://pc01.example.test/',resourceUrl:'https://pc01.example.test/mcp',
      ownerSubject:'windows:S-1-5-21-1000',ownerCodeSalt:salt,
      ownerCodeHash:ownerCodeDigest('fixture-owner-code-only-12345678901234567890',salt),
      privateKeyPem:keys.privateKey.export({format:'pem',type:'pkcs8'})};
    const server=createMcpFunnelGateway({selfHostedAuthConfig:config});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    try {
      const resource=await fetch(base+'/.well-known/oauth-protected-resource/mcp');
      expect(resource.status).toBe(200);
      expect(await resource.json()).toMatchObject({resource:config.resourceUrl,authorization_servers:[config.issuerUrl]});
      const metadata=await fetch(base+'/.well-known/oauth-authorization-server');
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({issuer:config.issuerUrl,client_id_metadata_document_supported:true});
      const denied=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=');
      const jwks=await fetch(base+'/oauth/jwks');
      expect((await jwks.json()).keys[0]).not.toHaveProperty('d');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    }
  });
});
