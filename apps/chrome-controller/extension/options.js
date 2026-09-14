const worker = document.getElementById('worker');
const status = document.getElementById('status');
const { workerId } = await chrome.storage.local.get('workerId');
if (workerId) worker.value = workerId;

document.getElementById('save').addEventListener('click', async () => {
  if (!worker.value) {
    status.textContent = 'Chưa chọn nhân viên.';
    return;
  }
  await chrome.storage.local.set({ workerId: worker.value });
  status.textContent = `Đã gắn profile này với ${worker.value}.`;
  await chrome.runtime.sendMessage({ type: 'TIGERIQ_CONFIG_UPDATED' });
});
