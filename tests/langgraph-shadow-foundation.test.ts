import { describe, expect, it, vi } from 'vitest';
import { createDeepAgent } from 'deepagents';
import { StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import {
  LANGGRAPH_SHADOW_FLAG,
  createLangGraphShadowFoundation,
  isLangGraphShadowEnabled,
  langGraphShadowSurface,
} from '../apps/tigeriq-core/langgraph-shadow-foundation.mjs';

describe('LangGraph shadow foundation', () => {
  it('defaults OFF with zero constructor or runtime side effect', () => {
    const pool = new Proxy({}, {
      get() {
        throw new Error('pool must not be touched while shadow flag is OFF');
      },
    });

    expect(isLangGraphShadowEnabled({})).toBe(false);

    const result = createLangGraphShadowFoundation({ env: {}, pool });

    expect(result).toEqual({
      enabled: false,
      createDeepAgent: null,
      StateGraph: null,
      checkpointer: null,
    });
  });

  it('exposes the expected Deep Agents, LangGraph, and PostgresSaver import surface', () => {
    const surface = langGraphShadowSurface();

    expect(surface.createDeepAgent).toBe(createDeepAgent);
    expect(surface.StateGraph).toBe(StateGraph);
    expect(surface.PostgresSaver).toBe(PostgresSaver);
  });

  it('constructs PostgresSaver only when explicitly enabled and never calls setup/connect', () => {
    const pool = {
      connect: vi.fn(() => {
        throw new Error('database connection must not happen in shadow foundation');
      }),
    };

    const result = createLangGraphShadowFoundation({
      env: { [LANGGRAPH_SHADOW_FLAG]: 'true' },
      pool,
    });

    expect(result.enabled).toBe(true);
    expect(result.createDeepAgent).toBe(createDeepAgent);
    expect(result.StateGraph).toBe(StateGraph);
    expect(result.checkpointer).toBeInstanceOf(PostgresSaver);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

[executed on device: PC01 (7a1fa39b-88eb-4906-927e-caaf4bc5b5e3)]