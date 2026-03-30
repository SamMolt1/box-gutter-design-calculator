const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT = 3000;
const DIR  = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Default to index.html
  let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  // Get local network IP
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const n of iface) {
      if (n.family === 'IPv4' && !n.internal) { localIP = n.address; break; }
    }
  }

  console.log('\n  Box Gutter Design Calculator\n');
  console.log('  Local:    http://localhost:' + PORT);
  console.log('  Network:  http://' + localIP + ':' + PORT);
  console.log('\n  Opening browser...');
  console.log('  Press Ctrl+C to stop.\n');

  // Open browser automatically
  const { exec } = require('child_process');
  exec('start http://localhost:' + PORT);
});
