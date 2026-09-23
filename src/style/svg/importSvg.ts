import { IDENTITY, multiply, type Matrix } from './pathData';
import { newDoc, pathShape, shapeId, transformShape, type Paint, type SvgDoc, type SvgShape } from './svgModel';

/**
 * An SVG file read into the editor's model. The caller parses the XML
 * (DOMParser in the UI) into plain nodes; this walks them with inherited
 * paint and transforms. Basic shapes, paths, text and groups are kept;
 * gradients, images, clip paths and the like are listed as skipped.
 * Plain black (the default fill) becomes the symbol's colour, so an icon
 * drawn in black recolours like ink.
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text content (text elements). */
  text?: string;
}

interface Inherited {
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  opacity: number;
  m: Matrix;
  group?: string;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  lime: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  orange: '#FFA500',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
  navy: '#000080',
  maroon: '#800000',
  purple: '#800080',
  teal: '#008080',
  olive: '#808000',
};

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0').toUpperCase();

/** A paint value as the model's paint; undefined when it cannot be read (then inherited). */
export function readPaint(v: string | undefined): Paint | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (!s || s === 'inherit') return undefined;
  if (s === 'none' || s === 'transparent') return 'none';
  if (s === 'currentcolor' || s.startsWith('param(fill')) return 'fill';
  if (s.startsWith('param(stroke')) return 'stroke';
  if (s.startsWith('url(')) return undefined;
  let hex: string | undefined;
  if (/^#[0-9a-f]{3}$/.test(s)) hex = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  else if (/^#[0-9a-f]{6}$/.test(s) || /^#[0-9a-f]{8}$/.test(s)) hex = s;
  else if (NAMED[s]) hex = NAMED[s];
  else {
    const m = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
    if (m) {
      const c = (t: string) => (t.endsWith('%') ? (Number(t.slice(0, -1)) * 255) / 100 : Number(t));
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
      hex = `#${hex2(c(m[1]))}${hex2(c(m[2]))}${hex2(c(m[3]))}${a < 1 ? hex2(a * 255) : ''}`;
    }
  }
  if (!hex) return undefined;
  hex = hex.toUpperCase();
  return hex === '#000000' || hex === '#000000FF' ? 'fill' : hex;
}

/** The transform attribute as a matrix (functions applied left to right, as SVG does). */
export function readTransform(v: string | undefined): Matrix {
  if (!v) return IDENTITY;
  let m: Matrix = IDENTITY;
  for (const f of v.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = f[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix = IDENTITY;
    switch (f[1]) {
      case 'matrix':
        if (a.length === 6) t = a as unknown as Matrix;
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        const cx = a[1] ?? 0;
        const cy = a[2] ?? 0;
        t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Attributes with `style="…"` declarations merged in (style wins, as in CSS). */
function styled(attrs: Record<string, string>): Record<string, string> {
  const out = { ...attrs };
  for (const decl of (attrs.style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const num = (v: string | undefined, fallback = 0) => {
  const x = parseFloat(v ?? '');
  return Number.isFinite(x) ? x : fallback;
};

const points = (v: string | undefined) => {
  const a = (v ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const out: string[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push(`${a[i]} ${a[i + 1]}`);
  return out;
};

let groupSeq = 0;

export function docFromSvgTree(root: XmlNode): { doc: SvgDoc; skipped: string[] } {
  const skipped = new Set<string>();
  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const width = vb.length === 4 ? vb[2] : num(root.attrs.width, 100);
  const height = vb.length === 4 ? vb[3] : num(root.attrs.height, 100);
  const doc = newDoc(width || 100, height || 100);
  const origin: Matrix = vb.length === 4 ? [1, 0, 0, 1, -vb[0], -vb[1]] : IDENTITY;

  const walk = (node: XmlNode, inh: Inherited, depth: number) => {
    const a = styled(node.attrs);
    if (a.display === 'none' || a.visibility === 'hidden') return;
    const m = multiply(inh.m, readTransform(a.transform));
    const opacity = inh.opacity * num(a.opacity, 1) * num(a['fill-opacity'], 1);
    const style: Inherited = {
      fill: readPaint(a.fill) ?? inh.fill,
      stroke: readPaint(a.stroke) ?? inh.stroke,
      strokeWidth: a['stroke-width'] !== undefined ? num(a['stroke-width'], 1) : inh.strokeWidth,
      opacity,
      m,
      group: inh.group,
    };
    const base = { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])), opacity: opacity < 1 ? opacity : undefined, group: style.group };
    const put = (s: SvgShape) => doc.shapes.push(transformShape(s, m));
    switch (node.tag) {
      case 'svg':
      case 'g': {
        // A group below the root keeps its shapes together in the editor.
        const inner = node.tag === 'g' && depth > 0 ? { ...style, group: style.group ?? `g${Date.now().toString(36)}${(groupSeq++).toString(36)}` } : style;
        for (const c of node.children) walk(c, inner, depth + 1);
        return;
      }
      case 'rect': {
        const w = num(a.width);
        const h = num(a.height);
        if (w > 0 && h > 0) put({ ...base, id: shapeId(), kind: 'rect', x: num(a.x), y: num(a.y), w, h, r: num(a.rx, num(a.ry)) || undefined });
        return;
      }
      case 'circle':
      case 'ellipse': {
        const rx = node.tag === 'circle' ? num(a.r) : num(a.rx);
        const ry = node.tag === 'circle' ? num(a.r) : num(a.ry, rx);
        if (rx > 0 && ry > 0) put({ ...base, id: shapeId(), kind: 'ellipse', cx: num(a.cx), cy: num(a.cy), rx, ry });
        return;
      }
      case 'line':
        put(pathShape(`M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`, { ...base, fill: 'none' }));
        return;
      case 'polyline':
      case 'polygon': {
        const p = points(a.points);
        if (p.length > 1) put(pathShape(`M${p.join('L')}${node.tag === 'polygon' ? 'Z' : ''}`, node.tag === 'polyline' ? { ...base, fill: base.fill } : base));
        return;
      }
      case 'path':
        if (a.d) put(pathShape(a.d, base));
        return;
      case 'text': {
        const text = (node.text ?? '').trim();
        if (!text) return;
        const weight = /bold|[6-9]00/.test(a['font-weight'] ?? '') ? (/900|black/.test(a['font-weight'] ?? '') ? 900 : 700) : 400;
        const family = (a['font-family'] ?? '').toLowerCase();
        put({
          ...base,
          id: shapeId(),
          kind: 'text',
          x: num(a.x),
          y: num(a.y),
          text,
          size: num(a['font-size'], 16),
          weight,
          font: family.includes('serif') && !family.includes('sans') ? 'serif' : 'sans',
          anchor: a['text-anchor'] === 'middle' ? 'middle' : a['text-anchor'] === 'end' ? 'end' : 'start',
        });
        return;
      }
      case 'title':
      case 'desc':
      case 'metadata':
      case 'defs':
      case 'style':
        return;
      default:
        skipped.add(node.tag);
    }
  };
  walk(root, { fill: 'fill', stroke: 'none', strokeWidth: 1, opacity: 1, m: origin }, 0);
  return { doc, skipped: [...skipped] };
}
