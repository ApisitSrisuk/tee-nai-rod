// Local dev server: serves public/ and runs api/*.js like Vercel does.
// Run: npm run dev   → http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const file = path.join(root, 'api', name + '.js');
      if (!name || name.startsWith('_') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
      const mod = await import(pathToFileURL(file).href + '?t=' + fs.statSync(file).mtimeMs);
      req.headers['x-forwarded-for'] ||= req.socket.remoteAddress;
      return await mod.default(req, res);
    }
    let p = path.join(root, 'public', decodeURIComponent(url.pathname));
    if (!p.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end('server error');
  }
}).listen(PORT, () => console.log(`dev server → http://localhost:${PORT}`));
