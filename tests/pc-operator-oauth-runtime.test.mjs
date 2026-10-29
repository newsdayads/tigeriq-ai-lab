import { describe, it, expect } from 'vitest';
import {
  createOAuthResourceServer,
  oauthRuntimeConfig,
  oauthRuntimeReadiness,
} from '../apps/tigeriq-core/pc-operator-oauth-runtime.mjs';

const complete = Object.freeze({
  issuerUrl: 'https://auth.example.test/',
  resourceUrl: 'https://pc01.example.test/mcp',
  jwksUrl: 'https://auth.example.test/.well-known/jwks.json',
  authorizationEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token',
  registrationEndpoint: '',
});

describe('PC Operator OAuth runtime readiness', () => {
  it('does not activate OAuth until authorization and token endpoints are present', () => {
    const config = {
      ...complete,
      authorizationEndpoint: '',
      tokenEndpoint: '',
    };
    const readiness = oauthRuntimeReadiness(config);
    expect(readiness.configured).toBe(false);
    expect(readiness.missing).toEqual(['authorizationEndpoint', 'tokenEndpoint']);
    expect(readiness.invalid).toEqual([]);
    expect(createOAuthResourceServer({ config }).configured()).toBe(false);
  });

  it('rejects invalid required and optional HTTPS endpoints without exposing values', () => {
    const config = {
      ...complete,
      authorizationEndpoint: 'http://auth.example.test/authorize',
      registrationEndpoint: 'https://u:p@auth.example.test/register',
    };
    const readiness = oauthRuntimeReadiness(config);
    expect(readiness.configured).toBe(false);
    expect(readiness.missing).toEqual([]);
    expect(readiness.invalid).toEqual(['authorizationEndpoint', 'registrationEndpoint']);
    expect(JSON.stringify(readiness)).not.toContain('u:p');
  });

  it('reports fully valid metadata as configured', () => {
    const runtime = createOAuthResourceServer({ config: complete });
    expect(runtime.readiness()).toEqual({
      configured: true,
      missing: [],
      invalid: [],
    });
    expect(runtime.configured()).toBe(true);
    expect(runtime.authorizationMetadata()).toMatchObject({
      issuer: complete.issuerUrl,
      authorization_endpoint: complete.authorizationEndpoint,
      token_endpoint: complete.tokenEndpoint,
      jwks_uri: complete.jwksUrl,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('maps environment variables without inventing defaults', () => {
    const config = oauthRuntimeConfig({
      TIGERIQ_OAUTH_ISSUER: complete.issuerUrl,
      TIGERIQ_OAUTH_RESOURCE: complete.resourceUrl,
      TIGERIQ_OAUTH_JWKS_URL: complete.jwksUrl,
      TIGERIQ_OAUTH_AUTHORIZATION_ENDPOINT: complete.authorizationEndpoint,
      TIGERIQ_OAUTH_TOKEN_ENDPOINT: complete.tokenEndpoint,
    });
    expect(config.registrationEndpoint).toBe('');
    expect(oauthRuntimeReadiness(config).configured).toBe(true);
  });
});
