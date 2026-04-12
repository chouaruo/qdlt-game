'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const { generateGameTurn } = require('./lib/chat');

const root = path.join(__dirname, 'public');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = mime[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath)
    .on('error', () => {
      res.writeHead(404);
      res.end('Not found');
    })
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/chat') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const result = await generateGameTurn(body);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, error.statusCode || 500, {
          error: error.exposeMessage || '服务端调用失败'
        });
      }
    });
    return;
  }

  const relPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(root, relPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    serveFile(res, filePath);
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`问道链途本地服务已启动: http://localhost:${port}`);
});
