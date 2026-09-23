import { describe, expect, it } from 'vitest';
import { CadDocument } from '../model/document';
import { LayerStore } from '../model/layers';
import { toSnapshot } from '../model/snapshot';
import { snapshotSampleDocument } from '../model/snapshotSample';
import type { AppContext } from './context';
import { DocumentFiles, type DrawingFileHandle, type DrawingFilePicker } from './fileIO';

/** An in-memory file; `fail` makes its writer throw on close, `during` runs while it is being written. */
function memoryFile(name: string, opts: { text?: string; fail?: boolean; during?: () => void } = {}) {
  const file = {
    name,
    text: opts.text ?? '',
    getFile: async () => new Blob([file.text]),
    createWritable: async () => {
      let buffer = '';
      return {
        write: async (data: string) => {
          buffer += data;
          opts.during?.();
        },
        close: async () => {
          if (opts.fail) throw new Error('disk dolu');
          file.text = buffer;
        },
      };
    },
  };
  return file satisfies DrawingFileHandle;
}

function setup(doc = new CadDocument({ name: 'Proje', layers: new LayerStore([{ id: 'x', name: 'X' }], 'x'), origin: { x: 0, y: 0 } })) {
  const messages: string[] = [];
  const say = (kind: string) => (text: string) => messages.push(`${kind}: ${text}`);
  const ctx = {
    doc,
    log: { success: say('ok'), warn: say('uyarı'), error: say('hata'), info: say('bilgi') },
    tools: { activate: () => {} },
    selection: { clear: () => {} },
    view: { camera: { fit: () => {} }, zoomExtents: () => {} },
  } as unknown as AppContext;
  const files = new DocumentFiles(ctx);
  return { doc, files, messages };
}

const pick = (save: DrawingFileHandle | null, open: DrawingFileHandle | null = null): DrawingFilePicker => ({ save: async () => save, open: async () => open });

describe('local drawing files', () => {
  it('clears dirty only once the file is written, and saves there again without asking', async () => {
    const { doc, files, messages } = setup();
    doc.add({ kind: 'point', layerId: 'x', p: { x: 1, y: 2 }, attrs: {} });
    const file = memoryFile('Pafta 12.kcad');
    files.picker = pick(file);
    expect(await files.save()).toBe(true);
    expect(doc.dirty.value).toBe(false);
    expect(JSON.parse(file.text)).toEqual(JSON.parse(JSON.stringify(toSnapshot(doc))));
    // The project takes the file's name, without the extension.
    expect(doc.name.value).toBe('Pafta 12');
    expect(messages.at(-1)).toBe('ok: “Pafta 12.kcad” kaydedildi.');
    // The next save goes to the same file; the picker is not asked.
    files.picker = pick(null);
    doc.add({ kind: 'point', layerId: 'x', p: { x: 3, y: 4 }, attrs: {} });
    expect(await files.save()).toBe(true);
    expect(JSON.parse(file.text).entities).toHaveLength(2);
    expect(doc.dirty.value).toBe(false);
  });

  it('keeps the drawing unsaved when the write fails or the user cancels', async () => {
    const { doc, files, messages } = setup();
    doc.add({ kind: 'point', layerId: 'x', p: { x: 1, y: 2 }, attrs: {} });
    files.picker = pick(memoryFile('a.kcad', { fail: true }));
    expect(await files.saveAs()).toBe(false);
    expect(doc.dirty.value).toBe(true);
    expect(messages.at(-1)).toMatch(/^hata: “a\.kcad” yazılamadı: disk dolu\. Değişiklikler kaydedilmemiş sayılıyor/);
    files.picker = pick(null);
    expect(await files.saveAs()).toBe(false);
    expect(doc.dirty.value).toBe(true);
  });

  it('an edit made while the file is being written stays unsaved', async () => {
    const { doc, files, messages } = setup();
    doc.add({ kind: 'point', layerId: 'x', p: { x: 1, y: 2 }, attrs: {} });
    files.picker = pick(memoryFile('a.kcad', { during: () => doc.add({ kind: 'point', layerId: 'x', p: { x: 5, y: 5 }, attrs: {} }) }));
    expect(await files.save()).toBe(true);
    expect(doc.dirty.value).toBe(true);
    expect(messages.at(-1)).toMatch(/^uyarı: .*kayıt sürerken yapılan değişiklikler henüz kaydedilmedi/);
  });

  it('opens a drawing, and refuses a broken one without touching the open drawing', async () => {
    const { doc, files, messages } = setup();
    const src = snapshotSampleDocument();
    const good = memoryFile('Örnek.kcad', { text: JSON.stringify(toSnapshot(src)) });
    files.picker = pick(null, good);
    expect(await files.open()).toBe(true);
    expect([...doc.all()]).toEqual([...src.all()]);
    expect(doc.dirty.value).toBe(false);
    expect(files.handle).toBe(good);
    const size = doc.size;
    files.picker = pick(null, memoryFile('bozuk.kcad', { text: '{"format":"kentos.document","version":9}' }));
    expect(await files.open()).toBe(false);
    expect(messages.at(-1)).toMatch(/^hata: “bozuk\.kcad” açılamadı: /);
    expect(doc.size).toBe(size);
    expect(files.handle).toBe(good);
  });

  it('a file read without write access is not where Save writes', () => {
    const { files } = setup();
    const text = JSON.stringify(toSnapshot(snapshotSampleDocument()));
    expect(files.load(text, memoryFile('salt.kcad', { text }), true)).toBe(true);
    expect(files.handle).toBeNull();
  });

  it('one file command at a time', async () => {
    const { doc, files } = setup();
    doc.add({ kind: 'point', layerId: 'x', p: { x: 1, y: 2 }, attrs: {} });
    files.picker = pick(memoryFile('a.kcad'));
    const first = files.save();
    expect(files.busy.value).toBe(true);
    expect(await files.save()).toBe(false);
    expect(await first).toBe(true);
    expect(files.busy.value).toBe(false);
  });
});
