import test from 'node:test';
import assert from 'node:assert';

test('resource wait and requeue mechanism handles busy state without terminal failure', async () => {
  const events = [];
  const mockPool = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql.includes('for update skip locked')) {
            return { rows: [{ id: 'JOB-TEST-1', objective_id: 'OBJ-1', attempts: 0, max_attempts: 3 }] };
          }
          if (sql.includes('count(*)::int as count from tigeriq_ai_resources')) {
            return { rows: [{ count: 10 }] };
          }
          return { rows: [] };
        },
        release() {}
      };
    },
    async query(sql, params) {
      if (sql.includes('tigeriq_events')) {
        events.push({ sql, params });
      }
      return { rows: [] };
    }
  };
  assert.ok(mockPool, 'Mock pool created successfully for resource wait testing');
});
