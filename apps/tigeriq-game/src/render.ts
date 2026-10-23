import { GRID_SIZE, type PreviewState } from './preview.js';
export function gridCellSize(canvasWidth: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) throw new RangeError('Invalid canvas size');
  return canvasWidth / GRID_SIZE;
}
/** Draw all assets procedurally: no third-party art or fonts. */
export function drawPreview(canvas: HTMLCanvasElement, state: Readonly<PreviewState>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const side = canvas.width;
  const cell = gridCellSize(side);
  ctx.clearRect(0, 0, side, side);
  ctx.fillStyle = '#0e1930';
  ctx.fillRect(0, 0, side, side);
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#172947' : '#1a3152';
      ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
    }
  }
  const goalX = 4.5 * cell;
  const goalY = 1.5 * cell;
  ctx.fillStyle = '#f3ce59';
  ctx.beginPath();
  ctx.arc(goalX, goalY, cell * .24, 0, 2 * Math.PI);
  ctx.fill();
  const centerX = (state.x + .5) * cell;
  const centerY = (state.y + .5) * cell;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(state.heading * Math.PI / 2);
  ctx.fillStyle = '#60d7d1';
  ctx.beginPath();
  ctx.moveTo(0, -cell * .32);
  ctx.lineTo(cell * .28, cell * .26);
  ctx.lineTo(0, cell * .13);
  ctx.lineTo(-cell * .28, cell * .26);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
