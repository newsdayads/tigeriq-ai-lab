import { describe, expect, it } from 'vitest';
import {
  OWNER_BACKLOG_ISSUE,
  parseWebControlOwnerOrder,
  sortWebControlWorkOrders,
  webControlOwnerEligible,
} from '../apps/tigeriq-core/web-control-owner-order.mjs';

function row(number, priority, extra = {}) {
  return {
    number,
    priority,
    effectivePriority: priority,
    workKind: 'WORK',
    executable: true,
    closed: false,
    status: 'OPEN',
    state: 'MỞ',
    updated_at: '2026-10-26T08:00:00Z',
    ...extra,
  };
}

describe('PC01 Web Control canonical Owner order', () => {
  it('parses only the authoritative Issue #280 V2 block', () => {
    const body=[
      '# queue',
      '<!-- TIGERIQ_OWNER_PRIORITY_V2_BEGIN -->',
      'OWNER_QUEUE_VERSION=20261026',
      'OWNER_PRIORITY_ORDER=#6300 > #5144 > #5235',
      '<!-- TIGERIQ_OWNER_PRIORITY_V2_END -->',
      '',
      'CORE_ORDER=#9999',
    ].join('\n');
    expect(OWNER_BACKLOG_ISSUE).toBe(280);
    expect(parseWebControlOwnerOrder(body)).toEqual([6300,5144,5235]);
  });

  it('orders eligible P1-P5 across priority levels before fallback priority', () => {
    const rows=[
      row(5144,'P1'),
      row(6300,'P2'),
      row(6400,'P1'),
    ];
    expect(sortWebControlWorkOrders(rows,[6300,5144]).map(x=>x.number))
      .toEqual([6300,5144,6400]);
  });

  it('never lets Owner order bypass P0, wait, blocked or executable gates', () => {
    const readyP1=row(5144,'P1');
    const readyP2=row(6300,'P2');
    const waiting=row(5189,'P1',{state:'CHỜ'});
    const blocked=row(5284,'P1',{status:'BLOCKED',state:'BLOCKED'});
    const p0=row(504,'P0');
    const nonExecutable=row(7000,'P1',{executable:false});
    const sorted=sortWebControlWorkOrders(
      [waiting,p0,blocked,readyP1,nonExecutable,readyP2],
      [5189,504,5284,6300,5144,7000],
    );
    expect(sorted.slice(0,2).map(x=>x.number)).toEqual([6300,5144]);
    for(const candidate of [waiting,blocked,p0,nonExecutable]) {
      expect(webControlOwnerEligible(candidate)).toBe(false);
    }
  });

  it('fails closed to deterministic priority ordering when Owner block is malformed', () => {
    const malformed=[
      '<!-- TIGERIQ_OWNER_PRIORITY_V2_BEGIN -->',
      'OWNER_PRIORITY_ORDER=#6300 > #6300',
      '<!-- TIGERIQ_OWNER_PRIORITY_V2_END -->',
    ].join('\n');
    const ownerOrder=parseWebControlOwnerOrder(malformed);
    expect(ownerOrder).toEqual([]);
    expect(sortWebControlWorkOrders([row(6300,'P2'),row(5144,'P1')],ownerOrder).map(x=>x.number))
      .toEqual([5144,6300]);
  });
});
