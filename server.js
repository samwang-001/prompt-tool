const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aishmynicfrueempsbun.supabase.co';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.prompt-tool.dedyn.io';
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB limit for proxy body
const PROXY_TIMEOUT = 30000; // 30s timeout for proxy requests

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/**
 * 安全的静态文件路径验证
 * 防止路径遍历攻击（如 ../../../etc/passwd）
 */
function safeResolvePath(requestPath) {
  // 解码 URL 编码的路径（如 %2e%2e%2f）
  let decoded = decodeURIComponent(requestPath);
  // 移除 null 字节
  decoded = decoded.replace(/\0/g, '');
  // 标准化路径
  const resolved = path.resolve(path.join(__dirname, decoded));
  // 确保解析后的路径在项目目录内
  if (!resolved.startsWith(__dirname + path.sep) && resolved !== __dirname) {
    return null;
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // 代理：/api/manage-users -> Supabase Edge Function
  if (parsed.pathname === '/api/manage-users') {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    let body = '';
    let bodySize = 0;

    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        // 超过大小限制，立即终止
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请求体过大' }));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      // 验证 Authorization 头格式
      const authHeader = req.headers['authorization'] || '';
      if (authHeader && !authHeader.startsWith('Bearer ')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无效的 Authorization 格式' }));
        return;
      }

      const proxyReq = https.request(
        `${SUPABASE_URL}/functions/v1/manage-users`,
        {
          method: 'POST',
          timeout: PROXY_TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          });
          proxyRes.pipe(res);
        }
      );

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '代理请求超时' }));
      });

      proxyReq.on('error', (err) => {
        // 不暴露内部错误细节
        console.error('[Proxy] 代理请求失败:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '服务暂时不可用' }));
        }
      });

      proxyReq.write(body);
      proxyReq.end();
    });

    req.on('error', (err) => {
      console.error('[Server] 客户端请求错误:', err.message);
    });

    // 客户端请求超时
    req.setTimeout(60000, () => {
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请求超时' }));
      req.destroy();
    });

    return;
  }

  // 代理：/api/pollinations -> Pollinations API (绕过浏览器 Origin 头 403)
  if (parsed.pathname === '/api/pollinations') {
    const q = parsed.query;
    const prompt = q.prompt || '';
    const width = q.width || '1024';
    const height = q.height || '1024';
    const seed = q.seed || '42';
    const model = q.model || 'flux';

    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 prompt 参数' }));
      return;
    }

    const upstreamUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=${model}`;
    console.log(`[Pollinations] 代理请求: ${model} ${width}×${height}`);

    const proxyReq = https.get(upstreamUrl, { timeout: PROXY_TIMEOUT * 2 }, (proxyRes) => {
      if (proxyRes.statusCode >= 400) {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Pollinations 返回 ${proxyRes.statusCode}` }));
        return;
      }
      // 透传图片内容类型
      const ct = proxyRes.headers['content-type'] || 'image/jpeg';
      res.writeHead(200, {
        'Content-Type': ct,
        'Cache-Control': 'no-store',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Pollinations 请求超时' }));
      }
    });

    proxyReq.on('error', (err) => {
      console.error('[Pollinations] 代理错误:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Pollinations 服务不可达' }));
      }
    });

    return;
  }

  // 静态文件服务
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;

  // ★ 路径遍历防护
  const safePath = safeResolvePath(filePath);
  if (!safePath) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<h1>403 Forbidden</h1>');
    return;
  }

  const ext = path.extname(safePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // 安全头
  const securityHeaders = {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
  };

  fs.readFile(safePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>500 Internal Server Error</h1>');
      }
      return;
    }
    res.writeHead(200, securityHeaders);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[Server] 运行在 http://localhost:${PORT}/`);
  console.log(`[Server] 代理: /api/manage-users -> ${SUPABASE_URL}/functions/v1/manage-users`);
  console.log(`[Server] 允许来源: ${ALLOWED_ORIGIN}`);
});
