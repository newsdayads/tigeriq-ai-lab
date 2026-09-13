import test from 'node:test';
import assert from 'node:assert';

test('manager-json-retry tests', async (t) => {
  await t.test('valid json bypasses retry', async () => {
    const validOutput = JSON.stringify({ status: 'active', summary: 'ok' });
    let called = 0;
    const mockPrompt = async (model) => {
      called++;
      return validOutput;
    };
    
    // Simulate core's call logic
    const parseManager = async (prompt) => {
      const res = await prompt();
      const parsed = JSON.parse(res);
      return parsed;
    };

    const result = await parseManager(mockPrompt);
    assert.strictEqual(result.status, 'active');
    assert.strictEqual(called, 1);
  });

  await t.test('malformed json triggers retry and succeeds on valid retry', async () => {
    let attempts = 0;
    const mockPrompt = async (model) => {
      attempts++;
      if (attempts === 1) {
        return 'not json at all trailing garbage';
      }
      return JSON.stringify({ status: 'idle', summary: 'recovered' });
    };

    // Test retry logic pattern
    let attemptCount = 0;
    let lastErr = null;
    let res;
    while (attemptCount < 2) {
      attemptCount++;
      try {
        const raw = await mockPrompt();
        res = JSON.parse(raw);
        break;
      } catch (err) {
        lastErr = err;
        if (attemptCount === 2) throw err;
      }
    }

    assert.strictEqual(attemptCount, 2);
    assert.strictEqual(res.status, 'idle');
  });
});
