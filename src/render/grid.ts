import type { CanvasPalette } from './color';
import type { SceneLayer, ViewState } from './types';

/** Picks a 1-2-5 spacing so minor lines stay ≥ `minPx` apart on screen. */
export function gridSpacing(scale: number, minPx = 14): { minor: number; major: number } {
  const target = minPx / scale;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const m = [1, 2, 5, 10].find((k) => k * p >= target) ?? 10;
  const minor = m * p;
  // 1 → 5, 2 → 10, 5 → 20: majors always land on round values.
  return { minor, major: minor * (m === 5 ? 4 : 5) };
}

/**
 * Adaptive grid for the visible area. World-aligned in absolute coordinates
 * (so grid lines fall on round TM values), emitted relative to the origin.
 */
export function buildGrid(view: ViewState, origin: { x: number; y: number }, palette: CanvasPalette): SceneLayer {
  const { minor, major } = gridSpacing(view.scale);
  const halfW = view.width / 2 / view.scale;
  const halfH = view.height / 2 / view.scale;
  const cx = view.center.x + origin.x;
  const cy = view.center.y + origin.y;
  const x0 = Math.floor((cx - halfW) / minor) * minor;
  const x1 = cx + halfW;
  const y0 = Math.floor((cy - halfH) / minor) * minor;
  const y1 = cy + halfH;
  const minorPos: number[] = [];
  const majorPos: number[] = [];
  const isMajor = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
  const ly0 = cy - halfH - origin.y;
  const ly1 = cy + halfH - origin.y;
  const lx0 = cx - halfW - origin.x;
  const lx1 = cx + halfW - origin.x;
  for (let i = 0, x = x0; x <= x1; x = x0 + ++i * minor) (isMajor(x) ? majorPos : minorPos).push(x - origin.x, ly0, x - origin.x, ly1);
  for (let i = 0, y = y0; y <= y1; y = y0 + ++i * minor) (isMajor(y) ? majorPos : minorPos).push(lx0, y - origin.y, lx1, y - origin.y);
  const batch = (pos: number[], color: typeof palette.gridMinor) => ({
    positions: new Float32Array(pos),
    distances: new Float32Array(pos.length / 2),
    color,
    dash: null,
  });
  return { id: '__grid', lines: [batch(minorPos, palette.gridMinor), batch(majorPos, palette.gridMajor)], fills: [], points: [] };
}
