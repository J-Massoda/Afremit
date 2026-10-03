import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { handleApi } from '../src/api.mjs';
import { localStore } from '../src/memory.mjs';

const store = await localStore();
const root = resolve('public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT || 8788);
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
    const result = await handleApi(request, {}, { demo: true, store });
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
  }
  const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try { const file = await stat(path); if (!file.isFile()) throw new Error('Not a file'); res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Afremit local demo: http://localhost:${port}`));
