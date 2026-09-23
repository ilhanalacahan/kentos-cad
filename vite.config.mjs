// Vite configuration. The only addition to the defaults: requests under /v1/
// go to the local KentOS API (apps/api, `pnpm api`), in both `vite` and
// `vite preview`. When the API is not running the answer is a quiet 503, so
// the app shows "Sunucu: yok" without filling the terminal with proxy errors
// (Vite's own proxy logs every refused connection).
import http from 'node:http';
import { defineConfig } from 'vite';

const API_PORT = Number(process.env.KENTOS_API_PORT ?? 8787);

/** Forwards /v1/* to 127.0.0.1:KENTOS_API_PORT. */
function kentosApi() {
  const forward = (req, res, next) => {
    if (!req.url?.startsWith('/v1/')) return next();
    const upstream = http.request({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    upstream.setTimeout(10000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"error":"api-unreachable"}');
    });
    req.pipe(upstream);
  };
  return {
    name: 'kentos-api',
    configureServer: (server) => void server.middlewares.use(forward),
    configurePreviewServer: (server) => void server.middlewares.use(forward),
  };
}

export default defineConfig({
  plugins: [kentosApi()],
});
