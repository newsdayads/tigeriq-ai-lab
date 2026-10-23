import { advancePreview, initialState, type PreviewCommand } from './preview.js';
import { drawPreview } from './render.js';
const board = document.querySelector<HTMLCanvasElement>('#board');
const status = document.querySelector<HTMLElement>('#status');
if (!board || !status) throw new Error('Game preview DOM is incomplete');
let state = initialState();
function refresh(): void {
  drawPreview(board!, state);
  status!.textContent = 'Ô (' + (state.x + 1) + ', ' + (state.y + 1) + ') · ' + state.commands + ' thao tác. Đích vàng chỉ là minh họa.';
}
for (const command of ['left', 'forward', 'right'] as const) {
  const control = document.getElementById(command);
  if (!control) throw new Error('Missing control: ' + command);
  control.addEventListener('click', () => {
    state = advancePreview(state, command as PreviewCommand);
    refresh();
  });
}
const reset = document.getElementById('reset');
if (!reset) throw new Error('Missing reset control');
reset.addEventListener('click', () => { state = initialState(); refresh(); });
refresh();
