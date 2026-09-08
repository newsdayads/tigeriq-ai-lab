import { describe, expect, it } from 'vitest';
import { LiveEventBufferV5, LiveEventProjectionV5 } from '../apps/dashboard/src/live-events-v5.js';
import type { ExecutiveDashboardV4 } from '../apps/dashboard/src/executive-data-v4.js';

function snapshot(overrides: Partial<ExecutiveDashboardV4> = {}): ExecutiveDashboardV4 {
  return {
    generatedAt: '2026-09-08T06:40:00.000Z',
    works: [{ number: 508, title: 'Live foundation', ownerCode: 'NV01', owner: 'Minh (NV01)', progressPercent: null, progressLabel: '—', status: 'Chờ xử lý', tone: 'waiting', next: 'Audit nguồn', updated: '08/09/2026 13:40:00' }],
    people: [],
    systems: [{ key: 'control', name: 'Bộ điều phối', status: 'Hoạt động', tone: 'active', note: 'Cổng 8790 phản hồi' }],
    activeCount: 0, waitingCount: 1, blockedCount: 0, doneCount: 0, pausedCount: 0,
    progressAverage: null, ownerActionRequired: false, ownerActionText: 'Không có việc cần anh Sơn',
    ...overrides,
  };
}

describe('Web Control V5 live event projection', () => {
  it('creates stable typed events and deduplicates an unchanged snapshot', () => {
    const projection = new LiveEventProjectionV5();
    const first = projection.ingest(snapshot());
    const second = projection.ingest(snapshot({ generatedAt: '2026-09-08T06:40:02.000Z' }));
    expect(first.map((event) => event.event_type)).toEqual(['work.queued', 'system.health']);
    expect(first.every((event) => event.event_id.startsWith('evt-'))).toBe(true);
    expect(second).toEqual([]);
  });
  it('projects state transitions as heartbeat/block/recovery events', () => {
    const projection = new LiveEventProjectionV5();
    projection.ingest(snapshot());
    const active = snapshot({
      generatedAt: '2026-09-08T06:41:00.000Z',
      works: [{ ...snapshot().works[0], status: 'Đang làm', tone: 'active', next: 'SSE', updated: '08/09/2026 13:41:00' }],
      systems: [{ key: 'control', name: 'Bộ điều phối', status: 'Lỗi', tone: 'blocked', note: 'Không phản hồi' }],
    });
    const transitions = projection.ingest(active);
    expect(transitions.map((event) => event.event_type)).toEqual(['work.started', 'system.error']);

    const heartbeat = projection.ingest({ ...active, generatedAt: '2026-09-08T06:41:02.000Z', works: [{ ...active.works[0], updated: '08/09/2026 13:41:02' }] });
    expect(heartbeat.map((event) => event.event_type)).toEqual(['work.heartbeat']);

    const recovered = projection.ingest({ ...active, generatedAt: '2026-09-08T06:41:04.000Z', systems: [{ key: 'control', name: 'Bộ điều phối', status: 'Hoạt động', tone: 'active', note: 'Đã phục hồi' }] });
    expect(recovered.some((event) => event.event_type === 'system.recovered')).toBe(true);
  });

  it('replays only events after lastEventId and rejects duplicate ids', () => {
    const projection = new LiveEventProjectionV5();
    const buffer = new LiveEventBufferV5(10);
    const first = buffer.append(projection.ingest(snapshot()));
    expect(buffer.append(first)).toEqual([]);
    expect(buffer.since(first[0].event_id).map((event) => event.event_id)).toEqual([first[1].event_id]);
  });
});
