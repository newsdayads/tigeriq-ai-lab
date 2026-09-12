// Web Control truth guards. Runs after the base dashboard script but before its first fetch normally resolves.
renderPipeline = function renderPipelineTruth(d) {
  const c = counts(d);
  const review = (d.jobs || []).filter(j => j.capability === 'review' && j.status === 'running').length;
  const running = Math.max(0, c.running - review);
  const rows = [
    ['Queued', c.queued, 'Trong hàng đợi', ''],
    ['Running', running, 'Đang chạy', 'run'],
    ['Review', review, 'Đang kiểm tra', 'review'],
    ['Done', c.done, 'Hoàn thành', 'done'],
    ['Failed', c.failed, 'Thất bại', 'fail']
  ];
  document.getElementById('pipeline').innerHTML = rows.map(x => `<div class="pipe ${x[3]}"><strong>${x[1]}</strong><b>${x[0]}</b><small>${x[2]}</small></div>`).join('');
};

objectiveRow = function objectiveRowTruth(o) {
  const completed = o.status === 'completed';
  const truthNote = completed ? 'Hoàn tất' : 'Core chưa cung cấp % tiến độ';
  return `<div class="objective"><div class="objective-head"><div><strong>${esc(o.objective)}</strong><small>${esc(o.id)} · ${esc(o.priority)} · ${esc(o.status)}</small></div><small>${ago(o.updated_at)}</small></div>${o.summary ? `<small>${esc(o.summary)}</small>` : ''}<small>${truthNote}</small>${completed ? '<div class="progress"><i style="width:100%"></i></div>' : ''}</div>`;
};

const renderBase = render;
render = function renderTruth(d) {
  const h = document.getElementById('topHealth');
  h.style.color = '';
  h.style.borderColor = '';
  h.style.background = '';
  renderBase(d);
};
