import { projectWorkItem } from '../src/unifiedWorkItem.js';
import * as dbHelpers from '../src/dbHelpers';

jest.mock('../src/dbHelpers');

describe('projectWorkItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps objective, jobs, and events to UnifiedWorkItem', () => {
    const mockObj = {
      id: 'obj1',
      sourceRef: 'gh#123',
      kind: 'coding',
      assignedExecutor: 'usr-456',
      stage: 'running',
      priority: 1,
      lease: null,
      nextAction: 'Submit PR',
    };
    const mockJobs = [
      { id: 'j1', objectiveId: 'obj1', evidenceRef: 'ev1' },
    ];
    const mockEvents = [
      { id: 'e1', objectiveId: 'obj1', status: 'blocker', message: 'Missing env var' },
    ];
    (dbHelpers.getObjective as jest.Mock).mockReturnValue(mockObj);
    (dbHelpers.getJobs as jest.Mock).mockReturnValue(mockJobs);
    (dbHelpers.getEvents as jest.Mock).mockReturnValue(mockEvents);

    const res = projectWorkItem('obj1');

    expect(res.workItemId).toBe('obj1');
    expect(res.sourceRef).toBe('gh#123');
    expect(res.kind).toBe('coding');
    expect(res.assignedExecutor).toBe('usr-456');
    expect(res.stage).toBe('running');
    expect(res.priority).toBe(1);
    expect(res.blockers).toEqual(['Missing env var']);
    expect(res.evidenceRefs).toEqual(['ev1']);
    expect(res.nextAction).toBe('Submit PR');
  });

  it('handles missing executor', () => {
    const mockObj = { id: 'o2', sourceRef: 'p12', kind: 'review', stage: 'running', priority: 0 };
    (dbHelpers.getObjective as jest.Mock).mockReturnValue(mockObj);
    (dbHelpers.getJobs as jest.Mock).mockReturnValue([]);
    (dbHelpers.getEvents as jest.Mock).mockReturnValue([]);

    const res = projectWorkItem('o2');
    expect(res.assignedExecutor).toBeNull();
    expect(res.priority).toBe(0);
    expect(res.blockers).toHaveLength(0);
  });
});
