import { cssColor, drawShape } from './canvasShapes';
import type { AtlasImage, AtlasSource, TileMark } from './types';
import { TEXT_BOX } from './types';

/**
 * One texture page shared by the WebGL2 and WebGPU backends for
 * everything that is an image on the GPU: SVG and raster markers, text
 * markers and pattern tiles (MapLibre's sprite, in spirit). Images are
 * drawn once into a Canvas2D page, keyed by content; SVG and raster
 * decoding is asynchronous, so a lookup may answer "not yet" and the atlas
 * calls `onChange` when the image arrives. The page is premultiplied on
 * upload by the backends; when it is full it starts over (the scene asks
 * again for what it still uses).
 */

const PAGE = 2048;
const PAD = 3;
/** Rasterisation sizes: markers are small on screen, tiles repeat. */
const TEXT_PX = 48;
const SVG_PX = 128;
const RASTER_PX = 256;
const TILE_PX = 128;

type Entry = { state: 'ready'; x: number; y: number; w: number; h: number; aspect: number } | { state: 'loading' } | { state: 'failed' };

const withXmlns = (svg: string) => (/\sxmlns\s*=/.test(svg) ? svg : svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'));

async function decodeSvg(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([withXmlns(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export class Atlas implements AtlasSource {
  version = 1;
  readonly canvas: HTMLCanvasElement;
  /** Called when an image finished loading (the view redraws). */
  onChange: (() => void) | null = null;
  private readonly g: CanvasRenderingContext2D;
  private entries = new Map<string, Entry>();
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private mips: { version: number; levels: HTMLCanvasElement[] } | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PAGE;
    this.canvas.height = PAGE;
    this.g = this.canvas.getContext('2d', { willReadFrequently: false })!;
    // Text drawn before the UI font arrived used a fallback: draw it again.
    document.fonts?.ready.then(() => {
      let changed = false;
      for (const [k, e] of this.entries)
        if (k.startsWith('t|') && e.state === 'ready') {
          this.entries.delete(k);
          changed = true;
        }
      if (changed) this.bump();
    });
  }

  lookup(image: AtlasImage): { uv: readonly [number, number, number, number]; aspect: number } | null {
    let e = this.entries.get(image.key);
    if (!e) {
      this.load(image);
      e = this.entries.get(image.key);
    }
    if (!e || e.state !== 'ready') return null;
    return { uv: [e.x / PAGE, e.y / PAGE, e.w / PAGE, e.h / PAGE], aspect: e.h / e.w };
  }

  mipLevels(): readonly HTMLCanvasElement[] {
    if (this.mips?.version === this.version) return this.mips.levels;
    const levels: HTMLCanvasElement[] = [];
    let prev: HTMLCanvasElement = this.canvas;
    for (let size = PAGE / 2; size >= 1; size /= 2) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(prev, 0, 0, size, size);
      levels.push(c);
      prev = c;
    }
    this.mips = { version: this.version, levels };
    return levels;
  }

  private bump(): void {
    this.version++;
    this.onChange?.();
  }

  /** Makes sure every image of a draw list is placed (or loading) before the texture is uploaded. */
  prefetch(images: Iterable<AtlasImage>): void {
    for (const i of images) this.lookup(i);
  }

  /** A free spot for w×h px (shelf packing); null when the page is full. */
  private alloc(w: number, h: number): [number, number] | null {
    const W = Math.ceil(w) + PAD * 2;
    const H = Math.ceil(h) + PAD * 2;
    if (W > PAGE || H > PAGE) return null;
    if (this.shelfX + W > PAGE) {
      this.shelfY += this.shelfH;
      this.shelfX = 0;
      this.shelfH = 0;
    }
    if (this.shelfY + H > PAGE) return null;
    const at: [number, number] = [this.shelfX + PAD, this.shelfY + PAD];
    this.shelfX += W;
    this.shelfH = Math.max(this.shelfH, H);
    return at;
  }

  /** Starts the page over (it filled up): every image is drawn again on its next lookup. */
  private reset(): void {
    this.g.clearRect(0, 0, PAGE, PAGE);
    this.entries = new Map([...this.entries].filter(([, e]) => e.state === 'loading'));
    this.shelfX = this.shelfY = this.shelfH = 0;
  }

  /** Reserves space and draws into it; retries once on a fresh page. */
  private place(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, x: number, y: number) => void): void {
    let at = this.alloc(w, h);
    if (!at) {
      this.reset();
      at = this.alloc(w, h);
    }
    if (!at) {
      this.entries.set(key, { state: 'failed' });
      return;
    }
    const [x, y] = at;
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    draw(g, x, y);
    g.restore();
    this.entries.set(key, { state: 'ready', x, y, w, h, aspect: h / w });
    // The GPU copy is stale now; the backends upload again before their next draw.
    this.version++;
  }

  private load(image: AtlasImage): void {
    switch (image.kind) {
      case 'text':
        return this.loadText(image);
      case 'svg':
      case 'raster': {
        this.entries.set(image.key, { state: 'loading' });
        const max = image.kind === 'svg' ? SVG_PX : RASTER_PX;
        const scale = max / Math.max(image.width, image.height, 1e-9);
        const w = Math.max(1, Math.round(image.width * scale));
        const h = Math.max(1, Math.round(image.height * scale));
        (image.kind === 'svg' ? decodeSvg(image.svg) : decodeUrl(image.url))
          .then((img) => {
            this.place(image.key, w, h, (g, x, y) => g.drawImage(img, x, y, w, h));
            this.bump();
          })
          .catch(() => this.entries.set(image.key, { state: 'failed' }));
        return;
      }
      case 'tile':
        return this.loadTile(image);
    }
  }

  private loadText(image: Extract<AtlasImage, { kind: 'text' }>): void {
    const g = this.g;
    const font = `${image.italic ? 'italic ' : ''}${image.weight} ${TEXT_PX}px ${image.font}`;
    g.font = font;
    const halo = image.halo ? image.halo.width * TEXT_PX : 0;
    const w = Math.max(1, Math.ceil(g.measureText(image.text).width + 2 * halo));
    const h = Math.ceil(TEXT_PX * TEXT_BOX);
    this.place(image.key, w, h, (c, x, y) => {
      c.font = font;
      c.textBaseline = 'alphabetic';
      c.textAlign = 'left';
      const baseline = y + h * 0.78;
      if (image.halo) {
        c.lineJoin = 'round';
        c.lineWidth = halo * 2;
        c.strokeStyle = image.halo.color;
        c.strokeText(image.text, x + halo, baseline);
      }
      c.fillStyle = image.color;
      c.fillText(image.text, x + halo, baseline);
    });
  }

  /** Pattern tile: each mark drawn at the cell centre (and half-shifted for staggered rows), wrapped at the edges so tiles join seamlessly. */
  private loadTile(image: Extract<AtlasImage, { kind: 'tile' }>): void {
    const W = TILE_PX;
    const H = Math.max(2, Math.round(TILE_PX * image.aspect));
    const images = image.draw.flatMap((m) => (m.look.kind === 'image' ? [m.look.image] : []));
    const draw = (decoded: Map<string, HTMLImageElement>) =>
      this.place(image.key, W, H, (g, x, y) => {
        const centres: [number, number][] = image.stagger
          ? [
              [0.5, 0.25],
              [0, 0.75],
            ]
          : [[0.5, 0.5]];
        for (const m of image.draw)
          for (const [cx, cy] of centres)
            for (const dx of [-W, 0, W])
              for (const dy of [-H, 0, H]) this.drawMark(g, m, x + cx * W + dx + m.offset[0] * W, y + cy * H + dy - m.offset[1] * W, W, decoded);
      });
    if (!images.length) return draw(new Map());
    this.entries.set(image.key, { state: 'loading' });
    Promise.all(images.map((i) => (i.kind === 'svg' ? decodeSvg(i.svg) : i.kind === 'raster' ? decodeUrl(i.url) : Promise.resolve(null)).then((img) => [i.key, img] as const)))
      .then((list) => {
        const decoded = new Map<string, HTMLImageElement>();
        for (const [k, img] of list) if (img) decoded.set(k, img);
        draw(decoded);
        this.bump();
      })
      .catch(() => this.entries.set(image.key, { state: 'failed' }));
  }

  private drawMark(g: CanvasRenderingContext2D, m: TileMark, cx: number, cy: number, W: number, decoded: Map<string, HTMLImageElement>): void {
    const w = m.w * W;
    const h = (m.h || m.w) * W;
    g.save();
    g.translate(cx, cy);
    g.rotate(-m.rotation);
    g.scale(1, -1);
    if (m.look.kind === 'shape') drawShape(g, m.look, w, h, m.look.strokeWidth * W);
    else {
      const img = decoded.get(m.look.image.key);
      if (m.look.image.kind === 'text') {
        g.scale(1, -1);
        g.font = `${m.look.image.italic ? 'italic ' : ''}${m.look.image.weight} ${h}px ${m.look.image.font}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = m.look.image.color;
        g.fillText(m.look.image.text, 0, 0);
      } else if (img) {
        const iw = w;
        const ih = w * (img.naturalHeight / Math.max(img.naturalWidth, 1));
        g.scale(1, -1);
        g.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      }
    }
    g.restore();
  }
}

export { cssColor };
