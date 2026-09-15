const CONTROLLER = 'http://127.0.0.1:8798';
const WORKER_IDS = ['NV03', 'NV02', 'NV04'];

const controllerStatus = document.getElementById('controllerStatus');
const controllerDetail = document.getElementById('controllerDetail');
const profileWorkers = document.getElementById('profileWorkers');
const workerStates = document.getElementById('workerStates');
const archiveWorker = document.getElementById('archiveWorker');
const saveArchive = document.getElementById('saveArchive');
const archiveAfterDone = document.getElementById('archiveAfterDone');
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

function renderArchiveWorkers(boundIds) {
  const supported = boundIds.filter((id) => id === 'NV02' || id === 'NV03');
  const ids = supported.length ? supported : ['NV02','NV03'];
  archiveWorker.replaceChildren();
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id === 'NV02' ? 'NV02 · ChatGPT Plus' : 'NV03 · ChatGPT Go';
    archiveWorker.append(option);
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

function showError(value) {
  errorBox.textContent = String(value || 'Không rõ lỗi.');
  errorBox.hidden = false;
}

saveArchive.addEventListener('click', async () => {
  errorBox.hidden = true;
  saveArchive.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type:'TIGERIQ_SAVE_AND_ARCHIVE', workerId:archiveWorker.value });
    if (!response?.ok) throw new Error(response?.status || 'ARCHIVE_FAILED');
    controllerDetail.textContent = `${response.workerId} đã lưu và lưu trữ · ${response.jobId}`;
  } catch (error) {
    showError(error?.message || error);
  } finally {
    saveArchive.disabled = false;
  }
});

archiveAfterDone.addEventListener('change', async () => {
  await chrome.storage.local.set({ archiveAfterDone:archiveAfterDone.checked === true });
});

async function load() {
  errorBox.hidden = true;
  try {
    const saved = await chrome.storage.local.get(['workerIds','archiveAfterDone']);
    const boundIds = Array.isArray(saved.workerIds) ? saved.workerIds.filter((id) => WORKER_IDS.includes(id)) : [];
    renderBoundWorkers(boundIds);
    renderArchiveWorkers(boundIds);
    archiveAfterDone.checked = saved.archiveAfterDone === true;

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
      showError(error?.name === 'AbortError' ? 'Controller không phản hồi trong thời gian chờ.' : 'Không thể đọc trạng thái Controller.');
    }
  } catch {
    renderBoundWorkers([]);
    renderArchiveWorkers([]);
    renderStates([], []);
    setControllerStatus(false, 'Không đọc được cấu hình Profile');
    showError('Không thể đọc cấu hình worker của Profile.');
  }
}

void load();
