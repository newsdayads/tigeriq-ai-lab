import { createDeepAgent } from 'deepagents';
import { StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export const LANGGRAPH_SHADOW_FLAG = 'TIGERIQ_CORE_VNEXT_LANGGRAPH_SHADOW';

export function isLangGraphShadowEnabled(env = process.env) {
  const value = String(env?.[LANGGRAPH_SHADOW_FLAG] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

export function langGraphShadowSurface() {
  return Object.freeze({
    createDeepAgent,
    StateGraph,
    PostgresSaver,
  });
}

export function createLangGraphShadowFoundation({
  env = process.env,
  pool = null,
} = {}) {
  if (!isLangGraphShadowEnabled(env)) {
    return Object.freeze({
      enabled: false,
      createDeepAgent: null,
      StateGraph: null,
      checkpointer: null,
    });
  }

  if (!pool) {
    throw new TypeError('pool is required when LangGraph shadow foundation is enabled');
  }

  const checkpointer = new PostgresSaver(pool);

  return Object.freeze({
    enabled: true,
    createDeepAgent,
    StateGraph,
    checkpointer,
  });
}
