import test from 'node:test';
import assert from 'node:assert';
import { runContextGateway, estimateTokenCount, filterContextItems, compactContext } from '../apps/tigeriq-core/context-gateway.mjs';

test('estimateTokenCount computes expected rough token length', () => {
  assert.strictEqual(estimateTokenCount(''), 0);
  assert.strictEqual(estimateTokenCount('abcd'), 1);
  assert.strictEqual(estimateTokenCount('abcdefgh'), 2);
});

test('filterContextItems removes low relevance items unless pinned', () => {
  const items = [
    { id: '1', content: 'high relevance', relevance: 0.9 },
    { id: '2', content: 'low relevance', relevance: 0.1 },
    { id: '3', content: 'pinned low', relevance: 0.0, pinned: true }
  ];
  const filtered = filterContextItems(items, { minRelevance: 0.5 });
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0].id, '3'); // pinned first
  assert.strictEqual(filtered[1].id, '1');
});

test('compactContext enforces hard budgets and headroom with metrics', () => {
  const items = [
    { id: 'a', content: 'A'.repeat(400), tokens: 100 },
    { id: 'b', content: 'B'.repeat(400), tokens: 100 },
    { id: 'c', content: 'C'.repeat(1600), tokens: 400 }
  ];
  const result = compactContext(items, 300, 50);
  // effective budget is 300 - 50 = 250
  assert.strictEqual(result.accepted.length, 2);
  assert.strictEqual(result.evicted.length, 1);
  assert.strictEqual(result.metrics.effectiveBudget, 250);
  assert.strictEqual(result.metrics.totalTokens, 200);
  assert.strictEqual(result.metrics.utilizationRatio, 200 / 300);
});

test('runContextGateway integrates filtering and compaction cleanly', () => {
  const items = [
    { id: '1', content: 'important', relevance: 0.9, tokens: 50 },
    { id: '2', content: 'noise', relevance: 0.1, tokens: 50 }
  ];
  const result = runContextGateway(items, { budget: 100, headroom: 20, minRelevance: 0.5 });
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.accepted[0].id, '1');
  assert.strictEqual(result.evicted.length, 1);
  assert.strictEqual(result.metrics.acceptedCount, 1);
});
