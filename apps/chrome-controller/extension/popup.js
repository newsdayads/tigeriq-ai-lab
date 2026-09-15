const CONTROLLER = 'http://127.0.0.1:8798';
const WORKER_IDS = ['NV03', 'NV02', 'NV04'];

const controllerStatus = document.getElementById('controllerStatus');
const controllerDetail = document.getElementById('controllerDetail');
const profileWorkers = document.getElementById('profileWorkers');
const workerStates = document.getElementById('workerStates');
const errorBox = document.getElementById('error');

document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

function setControllerStatus(online, detail) {
  controllerStatus.textContent = online ? 'ONLINE' : 'OFFLINE';
  controllerStatus.className = `status ${online ? 'status-online' : 'status-offline'}`;
  controllerDetail.textContent = detail;
}

function renderBoundWorkers(ids) {
  profileWorkers.replaceChildren();
  if (!ids.length) {
    const empty = document.createElement('span');
    empty.className = 'state-value';
    empty.textContent = 'Chưa gắn worker';
    profileWorkers.append(empty);
    return;
  }
  for (const id of ids) {
    const item = document.createElement('div');
    item.className = 'worker';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = id;
    item.append(dot, label);
    profileWorkers.append(item);
  }
}

function renderStates(workers, boundIds) {
  workerStates.replaceChildren();
  const states = new Map((workers || []).map((worker) => [worker.id, worker]));
  const ids = boundIds.length ? boundIds : WORKER_IDS;
  for (const id of ids) {
    const worker = states.get(id);
    const row = document.createElement('div');
    row.className = 'state-row';
    const workerId = document.createElement('span');
    workerId.className = 'state-id';
    workerId.textContent = id;
    const state = document.createElement('span');
    state.className = 'state-value';
    state.textContent = worker?.status || 'Chưa có trạng thái';
    row.append(workerId, state);
    workerStates.append(row);
  }
}

async function load() {
  errorBox.hidden = true;
  try {
    const saved = await chrome.storage.local.get(['workerIds']);
    const boundIds = Array.isArray(saved.workerIds) ? saved.workerIds.filter((id) => WORKER_IDS.includes(id)) : [];
    renderBoundWorkers(boundIds);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`${CONTROLLER}/api/state`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const state = await response.json();
      clearTimeout(timer);
      setControllerStatus(true, 'Kết nối Controller bình thường');
      renderStates(state.workers, boundIds);
    } catch (error) {
      clearTimeout(timer);
      setControllerStatus(false, 'Không kết nối được Controller');
      renderStates([], boundIds);
      errorBox.textContent = error?.name === 'AbortError' ? 'Controller không phản hồi trong thời gian chờ.' : 'Không thể đọc trạng thái Controller.';
      errorBox.hidden = false;
    }
  } catch {
    renderBoundWorkers([]);
    renderStates([], []);
    setControllerStatus(false, 'Không đọc được cấu hình Profile');
    errorBox.textContent = 'Không thể đọc cấu hình worker của Profile.';
    errorBox.hidden = false;
  }
}

void load();
