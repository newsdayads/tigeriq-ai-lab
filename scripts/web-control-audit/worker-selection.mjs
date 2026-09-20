export async function selectIdleWorkers() {
  const statusUrl = 'http://100.97.23.87:8795/api/status';
  const res = await fetch(statusUrl);
  if (!res.ok) {
    throw new Error('Failed to fetch core runtime truth');
  }
  const data = await res.json();
  const workers = data.workers?.filter(w =>
    w.status === 'online' &&
    w.state === 'idle' &&
    w.cost === 0
  ) || [];
  if (workers.length === 0) {
    throw new Error('No idle workers available; fail closed');
  }
  return workers;
}
