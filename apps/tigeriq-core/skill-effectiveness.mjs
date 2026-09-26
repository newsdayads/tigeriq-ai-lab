const eventsMap = new Map();

export function useSkill(id, input) {
  if (!id) throw new Error("Skill ID is required");
  const success = input && typeof input === 'object' && 'success' in input ? Boolean(input.success) : true;
  const records = eventsMap.get(id) || [];
  records.push({ success, timestamp: Date.now(), input });
  eventsMap.set(id, records);
  return { id, success };
}

export function measureEffectiveness(id) {
  if (!id) throw new Error("Skill ID is required");
  const records = eventsMap.get(id);
  if (!records || records.length === 0) {
    return { id, total: 0, successRate: 0 };
  }
  const successes = records.filter(r => r.success).length;
  return {
    id,
    total: records.length,
    successRate: successes / records.length
  };
}

export function retireSkill(id) {
  if (!id) throw new Error("Skill ID is required");
  return eventsMap.delete(id);
}
