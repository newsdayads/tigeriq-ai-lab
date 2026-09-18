export function estimateTokenCount(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

export function filterContextItems(items = [], options = {}) {
  const maxItems = typeof options.maxItems === 'number' ? options.maxItems : 50;
  const minRelevance = typeof options.minRelevance === 'number' ? options.minRelevance : 0.2;
  const filtered = [];

  for (const item of items) {
    if (!item) continue;
    const relevance = typeof item.relevance === 'number' ? item.relevance : 1.0;
    const pinned = Boolean(item.pinned);
    if (pinned || relevance >= minRelevance) {
      filtered.push({
        id: item.id || `ctx-${Math.random().toString(36).slice(2, 8)}`,
        content: String(item.content || ''),
        relevance,
        pinned,
        tokens: estimateTokenCount(item.content)
      });
    }
  }

  // Sort by pinned desc, then relevance desc
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.relevance - a.relevance;
  });

  return filtered.slice(0, maxItems);
}

export function compactContext(items = [], budget = 4000, headroom = 500) {
  const effectiveBudget = Math.max(0, budget - headroom);
  const accepted = [];
  const evicted = [];
  let currentTokens = 0;

  for (const item of items) {
    const itemTokens = item.tokens || estimateTokenCount(item.content);
    if (currentTokens + itemTokens <= effectiveBudget || (accepted.length === 0 && item.pinned)) {
      accepted.push({ ...item, tokens: itemTokens });
      currentTokens += itemTokens;
    } else {
      evicted.push({ id: item.id, reason: 'budget_exceeded', tokens: itemTokens });
    }
  }

  const metrics = {
    originalCount: items.length,
    acceptedCount: accepted.length,
    evictedCount: evicted.length,
    totalTokens: currentTokens,
    budget,
    headroom,
    effectiveBudget,
    utilizationRatio: budget > 0 ? Number((currentTokens / budget).toFixed(3)) : 0,
    compactedAt: new Date().toISOString()
  };

  return {
    accepted,
    evicted,
    metrics
  };
}

export function runContextGateway(items = [], options = {}) {
  const budget = typeof options.budget === 'number' ? options.budget : 4000;
  const headroom = typeof options.headroom === 'number' ? options.headroom : 500;
  const filtered = filterContextItems(items, options);
  return compactContext(filtered, budget, headroom);
}
