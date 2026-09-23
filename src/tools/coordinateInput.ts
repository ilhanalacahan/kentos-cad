import type { Vec2 } from '../model/geometry';

const NUM = String.raw`[-+]?\d+(?:\.\d+)?`;
const ABS = new RegExp(String.raw`^(${NUM})\s*[,; ]\s*(${NUM})$`);
const REL = new RegExp(String.raw`^@(${NUM})\s*[,; ]\s*(${NUM})$`);
const POLAR = new RegExp(String.raw`^@?(${NUM})\s*<\s*(${NUM})$`);
const DIST = new RegExp(String.raw`^(${NUM})$`);

/**
 * Parses command-line point input (decimal point, "," or ";" as separator):
 *   486512.34,4420118.9   absolute Y,X
 *   @12.5,-3              relative to the last point
 *   @25<45                distance<angle (degrees, CCW from east)
 *   18.4                  distance along the cursor direction
 */
export function parsePointInput(text: string, last: Vec2 | null, cursor: Vec2 | null): Vec2 | null {
  const t = text.trim();
  let m = t.match(REL);
  if (m) return last ? { x: last.x + +m[1], y: last.y + +m[2] } : null;
  m = t.match(POLAR);
  if (m) {
    if (!last) return null;
    const a = (+m[2] * Math.PI) / 180;
    return { x: last.x + Math.cos(a) * +m[1], y: last.y + Math.sin(a) * +m[1] };
  }
  m = t.match(ABS);
  if (m) return { x: +m[1], y: +m[2] };
  m = t.match(DIST);
  if (m && last && cursor) {
    const dx = cursor.x - last.x;
    const dy = cursor.y - last.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) return null;
    return { x: last.x + (dx / l) * +m[1], y: last.y + (dy / l) * +m[1] };
  }
  return null;
}

export function parseNumber(text: string): number | null {
  const m = text.trim().replace(',', '.').match(DIST);
  return m ? +m[1] : null;
}

export const looksLikeCoordinate = (text: string) => /^[@\d.+-]/.test(text.trim());
