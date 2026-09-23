// End-to-end smoke test: boots the app on its own Vite server, drives it in
// headless Chrome with real mouse/keyboard events and checks the document
// through the dev-only `window.kentos` handle.
//
//   pnpm e2e            (CHROME_BIN overrides the browser binary)
import { createServer } from 'vite';
import { launch, sleep, WEBGPU_ARGS } from './cdp.mjs';

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const b = await launch(url, { args: WEBGPU_ARGS });
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
  // Text: click, type straight into the field that opens there, Enter.
  await b.key('t');
  await b.click(...(await at(0, -60)));
  const fieldOpen = await b.eval(`!document.querySelector('.inline-text').hidden && document.activeElement === document.querySelector('.inline-text__input')`);
  await b.type('Deneme');
  await b.key('Enter');
  check('text tool opens a focused field where you click', fieldOpen);
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
  const edited = await b.eval(`window.kentos.doc.get(${tid}).text`);
  check('inline edit commits the new text', edited === 'Düzenlendi', edited);

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
  // Two neighbouring edges, then a typed distance.
  await key('p', { shift: true });
  await b.click(...(await toScreen(X + 95, N - 60)));
  await b.click(...(await toScreen(X + 120, N - 40)));
  await cmd('5');
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

  // Toolbox: every tool visible without scrolling; a group title folds its tools.
  const box = await b.eval(`(() => { const body = document.querySelector('.toolbox__body'); return { scroll: body.scrollHeight > body.clientHeight, tools: document.querySelectorAll('.toolbox__tool').length }; })()`);
  check('toolbox shows every tool without scrolling', !box.scroll && box.tools === (await b.eval('window.kentos.tools.list().length')), JSON.stringify(box));
  const titleAt = await b.eval(`(() => { const r = document.querySelector('.toolbox__title').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  await b.click(...titleAt);
  const folded = await b.eval(`document.querySelector('.toolbox__grid').hidden`);
  await b.click(...titleAt);
  check('a toolbox group folds and opens from its title', folded && !(await b.eval(`document.querySelector('.toolbox__grid').hidden`)));

  // Mouse only: the command bar's "Yay" button, then a corner rounded by pulling the mouse.
  const chip = async (label) => {
    const at = await b.eval(`(() => { const el = [...document.querySelectorAll('.cmdbar__opt')].find((x) => x.textContent.startsWith(${JSON.stringify(label)})); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    if (at) await b.click(...at);
    return !!at;
  };
  // Kept below the command bar, which floats over the top of the drawing.
  await key('p');
  await b.click(...(await toScreen(X, N + 40)));
  await b.click(...(await toScreen(X + 30, N + 40)));
  const yay = await chip('Yay');
  await b.move(...(await toScreen(X + 30, N + 25)));
  await b.click(...(await toScreen(X + 30, N + 25)));
  await key('Enter');
  const bulged = await newest();
  check('command bar option buttons work with the mouse', yay && bulged.kind === 'polyline' && (bulged.bulges ?? []).some((x) => Math.abs(x) > 0.5), JSON.stringify(bulged.bulges));
  await key('Escape');
  await key('r');
  await cmd(`${X + 70},${N + 20}`);
  await cmd(`${X + 120},${N + 60}`);
  await key('Escape');
  const box2 = await newest();
  await key('f', { shift: true });
  await b.move(...(await toScreen(X + 120, N + 20)));
  await b.click(...(await toScreen(X + 120, N + 20)));
  await b.move(...(await toScreen(X + 120, N + 28)));
  await b.click(...(await toScreen(X + 120, N + 28)));
  await key('Escape');
  const rounded = await b.eval(`window.kentos.doc.get(${box2.id})`);
  check('fillet: click a corner, pull the mouse, click', rounded.pts.length === 5 && (rounded.bulges ?? []).some((x) => Math.abs(x) > 0.1), `${rounded.pts.length} köşe`);

  // Right button held during a command: menu → one-shot midpoint snap, used by the next click.
  const pressRight = async (x, y, ms) => {
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await sleep(ms);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
    await sleep(60);
  };
  const menuRow = (text) => b.eval(`(() => { const row = [...document.querySelectorAll('.menu .menu__item')].find((r) => r.textContent.includes(${JSON.stringify(text)})); if (!row) return null; const r = row.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  await key('l');
  await cmd(`${X + 130},${N - 70}`);
  await cmd(`${X + 130},${N - 30}`);
  await key('Escape');
  await key('l');
  await pressRight(...(await toScreen(X + 60, N + 60)), 450);
  const snapSub = await menuRow('Tek seferlik kenet');
  if (snapSub) {
    await b.move(...snapSub);
    await sleep(250);
    const mid = await menuRow('Orta nokta');
    if (mid) await b.click(...mid);
  }
  await b.move(...(await toScreen(X + 131, N - 49)));
  await b.click(...(await toScreen(X + 131, N - 49)));
  await b.click(...(await toScreen(X + 100, N - 49)));
  const snapped = await newest();
  check('held right button → one-shot midpoint snap', !!snapSub && Math.abs(snapped.a.x - X - 130) < 1e-9 && Math.abs(snapped.a.y - N + 50) < 1e-9, `a=(${(snapped.a.x - X).toFixed(3)}, ${(snapped.a.y - N).toFixed(3)})`);
  await key('Escape');

  // Typing a distance while the mouse is on the drawing opens the field beside the cursor.
  await key('l');
  await b.click(...(await toScreen(X, N - 75)));
  await b.move(...(await toScreen(X + 20, N - 75)));
  await key('1');
  await b.key('2');
  await b.key('.');
  await b.key('5');
  const field = await b.eval(`(() => { const el = document.querySelector('.cursor-input'); return el.hidden ? null : el.querySelector('input').value; })()`);
  await b.key('Enter');
  const typedLine = await newest();
  check('cursor input: typed 12.5 draws 12.5 m towards the mouse', field === '12.5' && Math.abs(Math.hypot(typedLine.b.x - typedLine.a.x, typedLine.b.y - typedLine.a.y) - 12.5) < 1e-9, `alan=${field}`);
  await key('Escape');
  await key('Escape');

  // Grip menu: right click a vertex grip of a selected rectangle deletes that vertex.
  await b.eval(`window.kentos.selection.set([${box2.id}])`);
  await sleep(60);
  const gripBefore = (await b.eval(`window.kentos.doc.get(${box2.id})`)).pts.length;
  await pressRight(...(await toScreen(X + 70, N + 60)), 30);
  const delRow = await menuRow('Köşeyi sil');
  if (delRow) await b.click(...delRow);
  check('grip menu deletes a vertex', (await b.eval(`window.kentos.doc.get(${box2.id})`)).pts.length === gripBefore - 1);
  await b.eval('window.kentos.selection.clear()');

  // Object tracking: rest on a corner, then the point locks exactly level with it.
  await key('l');
  await b.move(...(await toScreen(X + 130, N - 30)));
  await sleep(480);
  const acquired = await b.eval('window.kentos.view.trackPoints.length');
  await b.move(...(await toScreen(X + 100, N - 29.6)));
  await sleep(40);
  await b.click(...(await toScreen(X + 100, N - 29.6)));
  await b.click(...(await toScreen(X + 100, N + 10)));
  const tracked = await newest();
  check('object tracking: resting acquires a point, the next pick is level with it', acquired === 1 && tracked.a.y === N - 30, `${acquired} nokta, y=${(tracked.a.y - N).toFixed(9)}`);
  await key('Escape');

  // Shapes: rotated rectangle (edge, then width), regular polygon, arc continuing from a line.
  const ringArea = (pts) => Math.abs(pts.reduce((acc, p, i) => { const q = pts[(i + 1) % pts.length]; return acc + p.x * q.y - q.x * p.y; }, 0) / 2);
  await key('r', { alt: true });
  await cmd(`${X + 20},${N - 110}`);
  await cmd('@20<45');
  await b.move(...(await toScreen(X + 10, N - 90)));
  await cmd('5');
  const rot = await newest();
  check('rotated rectangle: 20 m edge at 45°, 5 m wide', rot.kind === 'polygon' && Math.abs(ringArea(rot.pts) - 100) < 1e-6, `alan ${ringArea(rot.pts).toFixed(4)}`);
  await key('Escape');
  await key('g', { shift: true });
  await cmd('8');
  await cmd(`${X + 70},${N - 110}`);
  await cmd(`${X + 78},${N - 110}`);
  const oct = await newest();
  check('regular polygon: 8 corners on the circle', oct.pts.length === 8 && oct.pts.every((q) => Math.abs(Math.hypot(q.x - X - 70, q.y - N + 110) - 8) < 1e-9));
  await key('Escape');
  await key('l');
  await cmd(`${X + 100},${N - 110}`);
  await cmd(`${X + 120},${N - 110}`);
  await key('Escape');
  await key('a');
  await chip('Devam');
  await cmd(`${X + 130},${N - 100}`);
  const cont = await newest();
  check('arc continues tangent to the last line', cont.kind === 'arc' && Math.abs(cont.c.x - X - 120) < 1e-9 && Math.abs(cont.r - 10) < 1e-9, `c=(${(cont.c.x - X).toFixed(6)}, ${(cont.c.y - N).toFixed(6)})`);
  await key('Escape');

  // Ellipse (exact crossing snap) and a construction line trimmed into a ray.
  await b.eval(`window.kentos.view.camera.fit({ minX: ${X - 10}, minY: ${N + 85}, maxX: ${X + 90}, maxY: ${N + 150} }, 20)`);
  await sleep(100);
  await key('l', { shift: true });
  await cmd(`${X + 20},${N + 110}`);
  await cmd(`${X + 60},${N + 110}`);
  await cmd('10');
  const el = await newest();
  check('ellipse from an axis and the other half-axis', el.kind === 'ellipse' && Math.abs(Math.hypot(el.major.x, el.major.y) - 20) < 1e-9 && Math.abs(el.ratio - 0.5) < 1e-12);
  await key('Escape');
  await key('x', { shift: true });
  await chip('Yatay');
  await cmd(`${X},${N + 115}`);
  await key('Escape');
  const xl = await newest();
  const cross = 40 - 20 * Math.sqrt(1 - 0.25);
  await key('l');
  await b.move(...(await toScreen(X + cross + 0.15, N + 115.1)));
  await b.click(...(await toScreen(X + cross + 0.15, N + 115.1)));
  await b.click(...(await toScreen(X + cross, N + 140)));
  const onCross = await newest();
  check('snap to xline × ellipse crossing is exact', Math.abs(onCross.a.x - X - cross) < 1e-9 && onCross.a.y === N + 115, `x=${(onCross.a.x - X).toFixed(12)}`);
  await key('Escape');
  await key('t', { shift: true });
  await b.move(...(await toScreen(X + 5, N + 115)));
  await b.click(...(await toScreen(X + 5, N + 115)));
  await key('Escape');
  const rays = await b.eval(`[...window.kentos.doc.all()].filter((e) => e.kind === 'ray' && e.p.y === ${N + 115}).map((e) => e.dir.x)`);
  check('trimming an xline on one side leaves a ray', !(await b.eval(`!!window.kentos.doc.get(${xl.id})`)) && rays.includes(1), JSON.stringify(rays));

  // Option letters: in a running command a plain letter that is an option triggers it (S: side count).
  await key('g', { shift: true });
  await b.key('s');
  await b.key('7');
  await b.key('Enter');
  await b.click(...(await toScreen(X + 75, N + 95)));
  await b.click(...(await toScreen(X + 82, N + 95)));
  const hept = await newest();
  check('option letter beats the tool shortcut (S → kenar sayısı)', hept.kind === 'polygon' && hept.pts.length === 7, `${hept.pts?.length}`);
  await key('Escape');

  // Point calculator (Netcad's koordinat hesap makinası) inside a running line: yan nokta.
  await key('l');
  await cmd(`${X},${N + 100}`);
  await cmd(`${X},${N + 140}`);
  await key('Escape');
  await key('l');
  await cmd(`${X + 60},${N + 100}`);
  await cmd('YAN');
  await b.move(...(await toScreen(X, N + 100)));
  await b.click(...(await toScreen(X, N + 100)));
  await b.move(...(await toScreen(X, N + 140)));
  await b.click(...(await toScreen(X, N + 140)));
  await cmd('30,5');
  const side = await newest();
  check('point calculator: yan nokta 30/5 feeds the line', Math.abs(side.b.x - X - 5) < 1e-9 && Math.abs(side.b.y - N - 130) < 1e-9, `(${(side.b.x - X).toFixed(9)}, ${(side.b.y - N).toFixed(9)})`);
  await key('Escape');

  await b.eval(`window.kentos.view.camera.fit({ minX: ${X - 20}, minY: ${N - 80}, maxX: ${X + 140}, maxY: ${N + 80} }, 20)`);
  await sleep(100);

  // Dragging a panel splitter must never show an empty (black) viewport frame.
  const frames = [];
  b.on('Page.screencastFrame', (p) => {
    frames.push(p.data);
    b.send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  const vr = await b.eval('(() => { const r = window.kentos.view.clientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()');
  const [spx, spy] = await b.eval(`(() => { const r = document.querySelector('.shell__right .splitter').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  await b.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(200);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spx, y: spy, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 25; i++) {
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spx - i * 4, y: spy, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spx - 100, y: spy, button: 'left', clickCount: 1 });
  await sleep(200);
  await b.send('Page.stopScreencast');
  let blackFrames = 0;
  for (const data of frames) {
    const share = await b.eval(`(async () => {
      const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      const d = g.getImageData(Math.round((${vr.x} + 120) * k), Math.round((${vr.y} + 20) * k), Math.round((${vr.w} - 400) * k), Math.round((${vr.h} - 40) * k)).data;
      let black = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 20) black++;
      return black / (d.length / 4);
    })()`);
    if (share > 0.5) blackFrames++;
  }
  check('resizing a panel never flashes a black viewport', frames.length > 5 && blackFrames === 0, `${blackFrames}/${frames.length} kare siyah`);
  await b.eval('window.kentos.ui.dockWidth.set(312)');

  // Area operations (Alan işlemleri) on fresh squares east of everything else.
  const AX = E + 400;
  await b.eval(`window.kentos.view.camera.fit({ minX: ${AX - 10}, minY: ${N - 60}, maxX: ${AX + 140}, maxY: ${N + 60} }, 20)`);
  await sleep(100);
  const addGeom = (geom) => b.eval(`(() => { const k = window.kentos; let id; k.doc.transact('t', () => { id = k.doc.add({ ...${JSON.stringify(geom)}, layerId: k.doc.layers.active.value, attrs: {} }).id; }); return id; })()`);
  const sq = (x, y, s) => [{ x: AX + x, y: N + y }, { x: AX + x + s, y: N + y }, { x: AX + x + s, y: N + y + s }, { x: AX + x, y: N + y + s }];
  const netOf = (id) => b.eval(`window.kentos.doc.get(${id}) && (() => { const e = window.kentos.doc.get(${id}); const a = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x - p[0].x) * (p[i].y - p[0].y) - (p[i].x - p[0].x) * (p[j].y - p[0].y); return Math.abs(s / 2); }; return a(e.pts) - (e.holes || []).reduce((t, h) => t + a(h.pts), 0); })()`);
  const selected = () => b.eval('[...window.kentos.selection.ids.value]');
  const sqA = await addGeom({ kind: 'polygon', pts: sq(0, 0, 20) });
  const sqB = await addGeom({ kind: 'polygon', pts: sq(10, 10, 20) });
  await b.eval(`window.kentos.selection.set([${sqA}, ${sqB}])`);
  await key('b', { alt: true });
  await sleep(150);
  const united = await selected();
  check('Alt+B unites two squares into one area', united.length === 1 && Math.abs((await netOf(united[0])) - 700) < 1e-6);
  await b.eval(`window.kentos.commands.execute('edit.undo')`);
  const island = await addGeom({ kind: 'polygon', pts: sq(6, 6, 4) });
  await b.eval(`window.kentos.selection.set([${sqA}])`);
  await key('c', { alt: true });
  await b.click(...(await toScreen(AX + 8, N + 8)));
  await key('Enter');
  await sleep(150);
  const [holedId] = await selected();
  const holedE = await b.eval(`window.kentos.doc.get(${holedId})`);
  check('Alt+C with an inner area leaves a hole (adalı alan)', holedE?.holes?.length === 1 && Math.abs((await netOf(holedId)) - 384) < 1e-6 && !!(await b.eval(`window.kentos.doc.get(${island})`)));
  await key('Escape');
  await key('Escape');
  await key('h');
  await b.click(...(await toScreen(AX + 2, N + 2)));
  await sleep(100);
  const hatchE = await b.eval('[...window.kentos.doc.all()].at(-1)');
  check('hatching a holed area leaves its island empty', hatchE.kind === 'hatch' && hatchE.holes?.length === 1);
  await key('Escape');
  for (const [x1, y1, x2, y2] of [[60, -2, 90, -2], [88, -4, 88, 26], [90, 24, 60, 24], [62, 26, 62, -4]]) await addGeom({ kind: 'line', a: { x: AX + x1, y: N + y1 }, b: { x: AX + x2, y: N + y2 } });
  await key('b', { shift: true });
  await b.click(...(await toScreen(AX + 70, N + 10)));
  await sleep(150);
  const [faceId] = await selected();
  check('Shift+B: a click inside crossing lines makes the enclosed area', Math.abs((await netOf(faceId)) - 26 * 26) < 1e-6);
  await key('Escape');
  await b.eval(`window.kentos.doc.remove([${faceId}])`);
  await key('h');
  await key('b');
  await b.click(...(await toScreen(AX + 70, N + 10)));
  await sleep(100);
  const byLines = await b.eval('[...window.kentos.doc.all()].at(-1)');
  const hatchRingArea = (r) => Math.abs(r.reduce((s, p, i) => s + (p.x - r[0].x) * (r[(i + 1) % r.length].y - r[0].y) - (r[(i + 1) % r.length].x - r[0].x) * (p.y - r[0].y), 0)) / 2;
  check('hatch by lines (B) fills the region the crossing lines close', byLines.kind === 'hatch' && Math.abs(hatchRingArea(byLines.ring) - 26 * 26) < 1e-6);
  await key('b');
  await key('Escape');

  // Paralel çizgi (Y): typed distances and axis; Dik çık (O) on its first leg.
  await key('y');
  await key('s');
  await cmd('3');
  await key('a');
  await cmd('4');
  await cmd(`${AX},${N - 40}`);
  await cmd(`${AX + 20},${N - 40}`);
  await cmd(`${AX + 20},${N - 20}`);
  await key('Enter');
  await sleep(100);
  const [pl, pr] = await b.eval('[...window.kentos.doc.all()].slice(-3)');
  const at0 = (p, x, y) => Math.abs(p.x - (AX + x)) < 1e-9 && Math.abs(p.y - (N + y)) < 1e-9;
  check('Paralel çizgi: sides at 3 m and 4 m, mitred at the turn', at0(pl.pts[1], 17, -37) && at0(pr.pts[1], 24, -44), JSON.stringify([pl.pts[1], pr.pts[1]]));
  await key('Escape');
  await key('o');
  await b.click(...(await toScreen(AX + 2, N - 40)));
  await cmd('6');
  await cmd('-5');
  const perp = await newest();
  check('Dik çık: 6 m from the clicked end, 5 m to the left', perp.kind === 'line' && at0(perp.a, 6, -40) && at0(perp.b, 6, -35), JSON.stringify(perp));
  await key('Escape');

  // Drawing engines: WebGL2 by default; WebGPU switched live from the status
  // bar must draw the same scene. Pixels are read straight after a frame.
  check('WebGL2 is the default engine', (await b.eval('window.kentos.view.backendKind.value')) === 'webgl2');
  const inked = () =>
    b.eval(`(() => {
      const v = window.kentos.view; v.glQueued = true; v.frame();
      const c = document.querySelector('.viewport__gl');
      const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
      const g = o.getContext('2d'); g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, o.width, o.height).data;
      const bg = v.palette.background.map((c) => c * 255);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) n++;
      return n;
    })()`);
  await b.eval(`window.kentos.commands.execute('view.zoomExtents')`);
  // The faint full-screen grid is all antialiasing; engines differ there only by sampling.
  const gridWasOn = await b.eval('window.kentos.settings.grid.value');
  await b.eval('window.kentos.settings.grid.set(false)');
  await sleep(100);
  const glInk = await inked();
  const gpuReady = await b.eval('(async () => !!(await navigator.gpu?.requestAdapter()))()');
  if (!gpuReady) console.log('– WebGPU denetimleri atlandı: bu tarayıcıda WebGPU bağdaştırıcısı yok.');
  else {
    await b.click(...(await b.eval(`(() => { const r = document.querySelector('.status__renderer').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`)));
    await sleep(150);
    const gpuItem = await b.eval(`(() => { const t = [...document.querySelectorAll('.menu [role^=menuitem]')].find((e) => e.textContent.includes('WebGPU')); if (!t) return null; const r = t.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })()`);
    if (gpuItem) await b.click(...gpuItem);
    await b.waitFor(`window.kentos.view.backendKind.value === 'webgpu'`, 10000).catch(() => {});
    check('status bar switches to WebGPU live', (await b.eval(`window.kentos.view.backendKind.value + '|' + document.querySelector('.status__renderer').textContent`)) === 'webgpu|WebGPU');
    const gpuInk = await inked();
    check('WebGPU draws the same scene as WebGL2', gpuInk > 0.85 * glInk && gpuInk < 1.15 * glInk, `${gpuInk} / ${glInk} px`);
    await b.eval(`window.kentos.commands.execute('view.renderer.webgl2')`);
    await b.waitFor(`window.kentos.view.backendKind.value === 'webgl2'`, 10000).catch(() => {});
    check('switching back to WebGL2 keeps one canvas', (await b.eval(`window.kentos.view.backendKind.value + '|' + document.querySelectorAll('.viewport__gl').length`)) === 'webgl2|1');
  }
  await b.eval(`window.kentos.settings.grid.set(${gridWasOn})`);

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
