import http from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);

  const extname = path.extname(filePath);
  let contentType = 'text/html';

  switch(extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpg';
      break;
  }

  readFile(filePath, { encoding: 'utf8' }).then(content => {
    if (err) {
      if(err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('页面不存在');
      } else {
        res.writeHead(500);
        res.end('服务器错误: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  }).catch(err => {
    if(err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('页面不存在');
    } else {
      res.writeHead(500);
      res.end('服务器错误: ' + err.code);
    }
  });
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`简单服务器运行在 http://localhost:${PORT}`);
  console.log(`网络地址: http://10.106.80.147:${PORT}`);
  console.log(`或 http://198.18.0.1:${PORT}`);
});