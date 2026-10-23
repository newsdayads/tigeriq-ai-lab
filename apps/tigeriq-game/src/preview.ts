/** A tiny boundary-safe rendering preview. Puzzle logic belongs to G05. */
export const GRID_SIZE = 6;
export type Heading = 0 | 1 | 2 | 3;
export type PreviewCommand = 'left' | 'right' | 'forward';
export interface PreviewState {
  x: number;
  y: number;
  heading: Heading;
  commands: number;
}
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0]
];
export function initialState(): PreviewState {
  return { x: 1, y: 4, heading: 0, commands: 0 };
}
export function advancePreview(state: Readonly<PreviewState>, command: PreviewCommand): PreviewState {
  if (command === 'left') {
    return { ...state, heading: ((state.heading + 3) % 4) as Heading, commands: state.commands + 1 };
  }
  if (command === 'right') {
    return { ...state, heading: ((state.heading + 1) % 4) as Heading, commands: state.commands + 1 };
  }
  if (command !== 'forward') throw new Error('Unsupported preview command');
  const direction = DIRECTIONS[state.heading];
  if (!direction) throw new Error('Invalid preview heading');
  const x = state.x + direction[0];
  const y = state.y + direction[1];
  return {
    ...state,
    x: x >= 0 && x < GRID_SIZE ? x : state.x,
    y: y >= 0 && y < GRID_SIZE ? y : state.y,
    commands: state.commands + 1
  };
}
