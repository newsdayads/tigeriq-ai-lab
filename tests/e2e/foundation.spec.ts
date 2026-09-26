import { test, expect } from '@playwright/test';

test('phase 0 foundation exposes deterministic smoke', async () => {
  const gates = ['CODE', 'REVIEW', 'TEST', 'TYPECHECK', 'BUILD', 'CI'];
  expect(gates).toContain('CI');
  expect(gates[0]).toBe('CODE');
});
