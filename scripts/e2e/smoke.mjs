// End-to-end smoke test: boots the app on its own Vite server, drives it in
// headless Chrome with real mouse/keyboard events and checks the document
// through the dev-only `window.kentos` handle.
//
//   pnpm e2e            (CHROME_BIN overrides the browser binary)
import { createServer } from 'vite';
import { launch, sleep } from './cdp.mjs';

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const b = await launch(url);
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

try {
  const ready = 'window.kentos && window.kentos.view.backendKind.value';
  await b.waitFor(ready, 20000);
  await sleep(1200); // first-load dependency optimisation can reload once
  await b.waitFor(ready, 20000);
  check('app boots with a GPU backend', true, await b.eval('window.kentos.view.backendKind.value'));

  const base = await b.eval('window.kentos.doc.size');
  const toScreen = (x, y) =>
    b.eval(`(() => { const k = window.kentos; const s = k.view.camera.worldToScreen({x:${x}, y:${y}}); const r = k.view.clientRect(); return [Math.round(s.x + r.left), Math.round(s.y + r.top)]; })()`);
  // Work east of the sample sheet frame, where the drawing is empty.
  const E = 487060;
  const N = 4420100;
  await b.eval(`window.kentos.view.camera.fit({ minX: ${E - 20}, minY: ${N - 80}, maxX: ${E + 140}, maxY: ${N + 80} }, 20)`);
  await sleep(200);
  const at = async (dx, dy) => toScreen(E + dx, N + dy);
  const added = async () => (await b.eval('window.kentos.doc.size')) - base;
  await b.click(...(await at(120, -70)));

  // Lines + quick trim
  await b.key('l');
  await b.click(...(await at(0, 0)));
  await b.click(...(await at(100, 0)));
  await b.key('Enter');
  await b.click(...(await at(30, -20)));
  await b.click(...(await at(30, 20)));
  await b.key('Enter');
  await b.click(...(await at(70, -20)));
  await b.click(...(await at(70, 20)));
  await b.key('Escape');
  check('line tool draws three lines (no stale snap)', (await added()) === 3, `+${await added()}`);
  await b.key('t', { shift: true });
  await b.move(...(await at(50, 0)));
  await b.click(...(await at(50, 0)));
  await b.key('Escape');
  check('trim splits the crossed line in two', (await added()) === 4, `+${await added()}`);

  // Spline, dimension, text
  await b.key('s');
  for (const [dx, dy] of [[0, 40], [30, 60], [60, 35], [90, 55]]) await b.click(...(await at(dx, dy)));
  await b.key('Enter');
  await b.key('d');
  await b.click(...(await at(0, -40)));
  await b.click(...(await at(90, -40)));
  await b.click(...(await at(45, -32)));
  await b.key('Escape');
  await b.key('t');
  await b.click(...(await at(0, -60)));
  await b.key('Enter');
  await b.key(' ');
  await b.type('Deneme');
  await b.key('Enter');
  await b.key('Escape');
  const kinds = await b.eval(`[...window.kentos.doc.all()].slice(-3).map(e => e.kind).join(',')`);
  check('spline, dimension and text are created', kinds === 'spline,dimension,text', kinds);

  // Rectangle + hatch inside it
  await b.key('r');
  await b.click(...(await at(110, -60)));
  await b.click(...(await at(135, -20)));
  await b.key('Escape');
  await b.key('h');
  await b.move(...(await at(120, -40)));
  await b.click(...(await at(120, -40)));
  await b.key('Escape');
  check('hatch fills the rectangle', (await b.eval(`[...window.kentos.doc.all()].at(-1).kind`)) === 'hatch');

  // Double-click text → inline editor
  const tid = await b.eval(`[...window.kentos.doc.all()].find(e => e.kind === 'text' && e.text === 'Deneme').id`);
  const tp = await b.eval(`(() => { const t = window.kentos.doc.get(${tid}); return [t.p.x + t.height, t.p.y + t.height * 0.4]; })()`);
  const [tx, ty] = await toScreen(tp[0], tp[1]);
  await b.click(tx, ty);
  await b.click(tx, ty, { clickCount: 2 });
  check('double click opens the inline text editor', await b.eval(`!document.querySelector('.inline-text').hidden`));
  await b.type('Düzenlendi');
  await b.key('Enter');
  check('inline edit commits the new text', (await b.eval(`window.kentos.doc.get(${tid}).text`)) === 'Düzenlendi');

  // Editing tools on exact, typed geometry (a second work area further east).
  const X = E + 200;
  const focusCanvas = () => b.eval('window.kentos.view.focus()');
  const key = async (k, o) => (await focusCanvas(), await b.key(k, o));
  const cmd = async (text) => (await key(' '), await b.type(text), await b.key('Enter'));
  const newest = () => b.eval('[...window.kentos.doc.all()].at(-1)');
  await b.eval(`window.kentos.view.camera.fit({ minX: ${X - 20}, minY: ${N - 80}, maxX: ${X + 140}, maxY: ${N + 80} }, 20)`);
  await key('Escape');

  // Polyline with a tangent arc segment: Y switches to arcs, D back to lines.
  await key('p');
  await cmd(`${X},${N}`);
  await cmd(`${X + 40},${N}`);
  await cmd('Y');
  await cmd(`${X + 40},${N + 30}`);
  await cmd('D');
  await cmd(`${X},${N + 30}`);
  await key('Enter');
  const arcPath = await newest();
  check('polyline arc mode draws a tangent half circle', arcPath.kind === 'polyline' && Math.abs(arcPath.bulges[1] - 1) < 1e-9, JSON.stringify(arcPath.bulges));
  await key('Escape');

  // Explode it, then join the pieces back.
  await b.eval(`window.kentos.selection.set([${arcPath.id}])`);
  await key('x');
  await sleep(50);
  const pieces = await b.eval(`[...window.kentos.selection.ids.value].map((id) => window.kentos.doc.get(id).kind).join(',')`);
  await key('j');
  await sleep(50);
  const rejoined = await b.eval(`window.kentos.doc.get([...window.kentos.selection.ids.value][0])`);
  check('explode and join round-trip a polyline with an arc', pieces === 'line,arc,line' && rejoined.pts.length === 4 && Math.abs(rejoined.bulges[1] - 1) < 1e-9, pieces);
  await b.eval('window.kentos.selection.clear()');

  // Chamfer a rectangle corner (imar köşe kesmesi), then break a line and divide the rest.
  await key('r');
  await cmd(`${X + 70},${N - 60}`);
  await cmd(`${X + 120},${N - 20}`);
  await key('Escape');
  const rect = await newest();
  await key('p', { shift: true });
  await cmd('5');
  await b.click(...(await toScreen(X + 95, N - 60)));
  await b.click(...(await toScreen(X + 120, N - 40)));
  await key('Escape');
  const cut = await b.eval(`window.kentos.doc.get(${rect.id}).pts.length`);
  check('chamfer cuts a polygon corner', cut === 5, `${cut} köşe`);
  await key('l');
  await cmd(`${X},${N - 60}`);
  await cmd(`${X + 60},${N - 60}`);
  await key('Escape');
  const brokenLine = await newest();
  await key('b');
  await b.click(...(await toScreen(X + 30, N - 60)));
  await key('Enter');
  await key('Escape');
  const halves = await b.eval(`[...window.kentos.doc.all()].slice(-2).map((e) => e.kind).join(',')`);
  check('break at one point splits a line in two', halves === 'line,line' && !(await b.eval(`!!window.kentos.doc.get(${brokenLine.id})`)), halves);

  // Copy / paste back at the original coordinates.
  await b.eval(`window.kentos.selection.set([${rect.id}])`);
  await key('c', { ctrl: true });
  const beforePaste = await b.eval('window.kentos.doc.size');
  await key('v', { ctrl: true, shift: true });
  check('copy and paste-in-place duplicate the selection', (await b.eval('window.kentos.doc.size')) === beforePaste + 1);
  await b.eval('window.kentos.selection.clear()');

  // Undo / redo round trip
  const before = await b.eval('window.kentos.doc.size');
  await b.eval(`window.kentos.commands.execute('edit.undo'); window.kentos.commands.execute('edit.redo')`);
  check('undo/redo keeps the document intact', (await b.eval('window.kentos.doc.size')) === before);

  await b.shot('smoke-final');
  const errors = b.consoleLog.filter((l) => /^(error|EXCEPTION)/.test(l));
  check('no console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  b.close();
  await server.close();
}
console.log(failures.length ? `\n${failures.length} kontrol başarısız.` : '\nTüm kontroller geçti.');
process.exit(failures.length ? 1 : 0);
