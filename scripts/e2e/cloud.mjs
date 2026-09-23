// Cloud end-to-end test (Faz B): the real kentosd against the development
// database, the app in headless Chrome signed in as `ayse`, and `mehmet` as a
// second editor over plain HTTP. Checks sign-in, upload, autosave, reload
// persistence, another editor's change arriving live, a conflict resolved
// from the dialog, and a server restart while an edit waits.
//
//   pnpm e2e:cloud     (needs `pnpm db:setup` once; builds kentosd first)
//
// Projects it creates stay in the development database, named "E2E …".
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { launch, sleep } from './cdp.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (!env.KENTOS_DEV_PASSWORD) throw new Error('.env.local içinde KENTOS_DEV_PASSWORD yok: önce `pnpm db:setup` çalıştırın.');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const apiPort = await freePort();
process.env.KENTOS_API_PORT = String(apiPort);
const vite = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await vite.listen();
const url = vite.resolvedUrls.local[0];
const publicUrl = url.replace(/\/$/, '');

let api = null;
async function startApi() {
  api = spawn('./target/debug/kentosd', ['serve'], { env: { ...process.env, KENTOS_API_PORT: String(apiPort), KENTOS_PUBLIC_URL: publicUrl, KENTOS_LOG: 'warn' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${apiPort}/v1/health`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('kentosd başlamadı');
}
async function stopApi() {
  if (!api) return;
  const p = api;
  api = null;
  p.kill('SIGINT');
  await new Promise((r) => p.once('exit', r));
}

/** mehmet: a second editor with his own session, straight against the API. */
const mehmet = {
  cookie: '',
  async call(method, path, body) {
    const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-kentos-client': 'web', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.()[0];
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  },
  commit(tenantId, projectId, features, expected) {
    return this.call('POST', `/v1/tenants/${tenantId}/projects/${projectId}/commands`, {
      commandName: 'project.changes', version: 1, tenantId, projectId, requestId: `mehmet-${crypto.randomUUID()}`,
      idempotencyKey: crypto.randomUUID(), expectedVersions: expected, input: { features },
    });
  },
};

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

await startApi();
const b = await launch(url);
try {
  const ready = 'window.kentos && window.kentos.view.backendKind.value';
  await b.waitFor(ready, 20000);
  await sleep(1200);
  await b.waitFor(ready, 20000);
  await b.waitFor(`window.kentos.server.state.value === 'online'`, 8000);
  await b.waitFor(`window.kentos.cloud.auth.value === 'signedOut'`, 5000);
  const center = (sel, text = '') =>
    b.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const press = async (sel, text) => {
    const p = await center(sel, text);
    if (!p) throw new Error(`bulunamadı: ${sel} ${text ?? ''}`);
    await b.click(...p);
    await sleep(150);
  };

  // Sign in through the dialog, with the keyboard.
  await b.eval(`window.kentos.commands.execute('cloud.upload')`);
  await b.waitFor(`document.querySelector('.dialog--cloud input[name=login]')`, 3000);
  await b.type('ayse');
  await b.key('Tab');
  await b.type(env.KENTOS_DEV_PASSWORD);
  await b.shot('cloud-login');
  await b.key('Enter');
  await b.waitFor(`window.kentos.cloud.auth.value === 'signedIn'`, 5000);
  check('signs in with a local account', true, await b.eval('window.kentos.cloud.me.value.user.displayName'));

  // The upload dialog follows by itself; the drawing becomes a cloud project.
  await b.waitFor(`document.querySelector('.dialog--cloud')?.textContent.includes('Proje adı')`, 3000);
  const name = `E2E ${new Date().toISOString().slice(0, 19)}`;
  await b.eval(`(() => { const i = document.querySelector('.dialog--cloud input[aria-label="Proje adı"]'); i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event('input')); })()`);
  const size = await b.eval('window.kentos.doc.size');
  await press('.dialog__foot .btn', 'Buluta yükle');
  await b.waitFor(`window.kentos.cloud.project.value && window.kentos.cloud.sync.value.state.value === 'saved'`, 60000);
  const project = await b.eval('window.kentos.cloud.project.value');
  check('uploads the drawing as a cloud project', project.name === name && !(await b.eval('window.kentos.doc.dirty.value')), `${size} nesne`);
  await b.waitFor(`window.kentos.cloud.link.value === 'online'`, 8000);
  check('the live channel is open', true);

  await mehmet.call('POST', '/v1/auth/login', { login: 'mehmet', password: env.KENTOS_DEV_PASSWORD });
  const listed = await mehmet.call('GET', `/v1/tenants/${project.tenantId}/projects/${project.projectId}`);
  check('another member sees it with every object', listed.status === 200 && Number(listed.body.featureCount) === size, listed.body.featureCount);

  // Draw a line with typed coordinates; autosave sends it without Ctrl+S.
  const X = 486900, N = 4420600;
  await b.eval(`window.kentos.view.camera.fit({ minX: ${X - 50}, minY: ${N - 50}, maxX: ${X + 150}, maxY: ${N + 50} }, 20)`);
  // As in the smoke test: keys go to the drawing; Space opens the command line for a typed point.
  const focusCanvas = () => b.eval('window.kentos.view.focus()');
  const cmd = async (t) => {
    await focusCanvas();
    await b.key(' ');
    await b.type(t);
    await b.key('Enter');
    await sleep(80);
  };
  await focusCanvas();
  await b.key('l');
  await cmd(`${X},${N}`);
  await cmd(`${X + 100},${N}`);
  await b.key('Escape');
  await b.waitFor(`window.kentos.cloud.sync.value.state.value === 'pending' || window.kentos.cloud.sync.value.state.value === 'saving' || window.kentos.cloud.sync.value.state.value === 'saved'`, 2000);
  await b.waitFor(`window.kentos.cloud.sync.value.state.value === 'saved' && !window.kentos.doc.dirty.value`, 8000);
  const lineId = await b.eval(`(() => { const k = window.kentos; const e = [...k.doc.all()].at(-1); return k.cloud.sync.value.featureOf(e.id); })()`);
  let got = await mehmet.call('GET', `/v1/tenants/${project.tenantId}/projects/${project.projectId}/features?ids=${lineId}`);
  const line = got.body.features[0];
  check('autosave stores the line exactly', line?.entity.kind === 'line' && line.entity.a.x === X && line.entity.b.x === X + 100 && line.version === '1', JSON.stringify(line?.entity.b));
  await b.shot('cloud-saved');

  // Reload: the session cookie survives; the project opens from the list with the line.
  await b.send('Page.reload');
  await sleep(1500);
  await b.waitFor(ready, 20000);
  await b.waitFor(`window.kentos.cloud.auth.value === 'signedIn'`, 8000);
  await b.eval(`window.kentos.commands.execute('cloud.open')`);
  await b.waitFor(`document.querySelector('.cloud-row')`, 5000);
  await press('.cloud-row', name);
  await press('.dialog__foot .btn', 'Aç');
  await b.waitFor(`window.kentos.cloud.project.value?.name === ${JSON.stringify(name)} && window.kentos.cloud.link.value === 'online'`, 30000);
  const reopened = await b.eval(`(() => { const k = window.kentos; return { size: k.doc.size, line: [...k.doc.all()].find((e) => k.cloud.sync.value.featureOf(e.id) === ${JSON.stringify(lineId)}) }; })()`);
  check('after a reload the cloud project opens with the line', reopened.size === size + 1 && reopened.line?.b.x === X + 100, `${reopened.size} nesne`);

  // Mehmet moves the line's end: the change arrives live, with no unsaved mark.
  const moved = { ...line.entity, b: { x: X + 120, y: N } };
  const r1 = await mehmet.commit(project.tenantId, project.projectId, [{ op: 'update', id: lineId, entity: moved }], { [lineId]: '1' });
  check('the other editor commits', r1.status === 200, r1.body.versions?.[lineId]);
  await b.waitFor(`[...window.kentos.doc.all()].some((e) => e.kind === 'line' && e.b.x === ${X + 120})`, 8000);
  check('another editor’s change arrives live', !(await b.eval('window.kentos.doc.dirty.value')));

  // Both change it at once: the browser gets a conflict, then takes the server's copy.
  const localId = await b.eval(`[...window.kentos.doc.all()].find((e) => e.kind === 'line' && e.b.x === ${X + 120}).id`);
  const r2 = await mehmet.commit(project.tenantId, project.projectId, [{ op: 'update', id: lineId, entity: { ...line.entity, b: { x: X + 140, y: N } } }], { [lineId]: '2' });
  await b.eval(`window.kentos.doc.update(${localId}, { b: { x: ${X + 160}, y: ${N} } })`);
  await b.eval(`window.kentos.commands.execute('file.save')`);
  await b.waitFor(`window.kentos.cloud.sync.value.state.value === 'conflict'`, 8000);
  check('a simultaneous edit is a conflict, not an overwrite', r2.status === 200, await b.eval(`document.querySelector('.status__save')?.textContent`));
  await b.eval(`window.kentos.commands.execute('cloud.conflicts')`);
  await b.waitFor(`document.querySelector('.cloud-conflicts')`, 3000);
  await b.shot('cloud-conflict');
  await press('.dialog__foot .btn', 'Sunucudakini al');
  await b.waitFor(`window.kentos.cloud.sync.value.state.value === 'saved'`, 8000);
  check('taking the server copy shows the other editor’s line', (await b.eval(`window.kentos.doc.get(${localId}).b.x`)) === X + 140);

  // The server goes away while an edit waits; nothing is lost and it is saved once when it is back.
  await stopApi();
  await b.eval(`window.kentos.doc.update(${localId}, { a: { x: ${X - 10}, y: ${N} } })`);
  await b.eval(`window.kentos.commands.execute('file.save')`);
  await b.waitFor(`window.kentos.cloud.sync.value.state.value === 'offline_pending'`, 8000);
  check('with the server down the edit waits on the device', (await b.eval(`document.querySelector('.status__save')?.textContent`)).startsWith('Çevrimdışı'));
  await startApi();
  await b.waitFor(`window.kentos.cloud.sync.value.state.value === 'saved'`, 40000);
  got = await mehmet.call('GET', `/v1/tenants/${project.tenantId}/projects/${project.projectId}/features?ids=${lineId}`);
  if (got.status === 401) {
    await mehmet.call('POST', '/v1/auth/login', { login: 'mehmet', password: env.KENTOS_DEV_PASSWORD });
    got = await mehmet.call('GET', `/v1/tenants/${project.tenantId}/projects/${project.projectId}/features?ids=${lineId}`);
  }
  check('the waiting edit is saved once when the server is back', got.body.features[0].entity.a.x === X - 10 && got.body.features[0].version === '4', got.body.features[0].version);
  await b.waitFor(`window.kentos.cloud.link.value === 'online'`, 40000);
  check('the live channel reconnects', true);

  // Themes and the large type size, with the save cell showing.
  for (const theme of ['dark', 'light']) {
    await b.eval(`window.kentos.commands.execute('view.theme.${theme}')`);
    await sleep(200);
    await b.shot(`cloud-status-${theme}`);
  }
  // The "Büyük" type size with a cloud dialog open.
  await b.eval(`document.documentElement.style.setProperty('--ui-scale', '1.08')`);
  await b.eval(`window.kentos.commands.execute('cloud.open')`);
  await b.waitFor(`document.querySelector('.cloud-row')`, 5000);
  await sleep(200);
  await b.shot('cloud-projects-large');
  await b.key('Escape');
  await b.eval(`document.documentElement.style.setProperty('--ui-scale', '1')`);
  const errors = b.consoleLog.filter((l) => /^(error|EXCEPTION)/.test(l));
  check('no console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  b.close();
  await vite.close();
  await stopApi();
}
console.log(failures.length ? `\n${failures.length} kontrol başarısız.` : '\nTüm kontroller geçti.');
process.exit(failures.length ? 1 : 0);
