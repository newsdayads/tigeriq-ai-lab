const IDS = ['NV03','NV02','NV04'];
const HOST = { NV03:'chatgpt.com', NV02:'chatgpt.com', NV04:'gemini.google.com' };
const status = document.getElementById('status');
const saved = await chrome.storage.local.get(['workerIds','workerId']);
const initial = Array.isArray(saved.workerIds) ? saved.workerIds : (saved.workerId ? [saved.workerId] : []);
for (const id of IDS) document.getElementById(id).checked = initial.includes(id);

document.getElementById('save').addEventListener('click', async () => {
  const workerIds = IDS.filter((id) => document.getElementById(id).checked);
  if (!workerIds.length) { status.textContent = 'Phải chọn ít nhất một nhân viên.'; return; }
  const hosts = workerIds.map((id) => HOST[id]);
  if (new Set(hosts).size !== hosts.length) {
    status.textContent = 'Không được gắn NV03 và NV02 vào cùng một Profile vì cùng dùng chatgpt.com.';
    return;
  }
  await chrome.storage.local.set({ workerIds });
  await chrome.storage.local.remove('workerId');
  status.textContent = `Đã gắn Profile với: ${workerIds.join(', ')}.`;
  await chrome.runtime.sendMessage({ type: 'TIGERIQ_CONFIG_UPDATED' });
});
