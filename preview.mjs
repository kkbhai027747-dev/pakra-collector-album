import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';
import { createCollectionServer } from './server.mjs';

const theme = fileURLToPath(new URL('./theme', import.meta.url));
const port = Number(process.env.PREVIEW_PORT ?? 8791);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port.');
const secret = randomBytes(32);
const shop = 'album-preview.myshopify.com';
const catalog = JSON.parse(readFileSync(theme + '/assets/p10-collector-catalog.json', 'utf8'));
const backend = createCollectionServer({ secret, shop, dbPath: ':memory:' });
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
const backendRoot = 'http://127.0.0.1:' + backend.address().port;

function proxyPath(identity) {
  const values = {
    shop, logged_in_customer_id: identity, timestamp: String(Math.floor(Date.now() / 1000)),
    path_prefix: '/apps/pakra-collection'
  };
  const message = Object.entries(values).map(pair => pair.join('=')).sort().join('');
  return '/proxy/v1/collection?' + new URLSearchParams({
    ...values, signature: createHmac('sha256', secret).update(message).digest('hex')
  });
}

async function proxy(identity, method = 'GET', body) {
  return fetch(backendRoot + proxyPath(identity), {
    method, headers: { 'Content-Type': 'application/json' }, body
  });
}

const start = await (await proxy('101')).json();
if (!start.csrfToken) throw new Error('Preview backend not configured');
const owned = catalog.cards.slice(0, 5).map((card, index) => ({
  cardId: card.id, status: 'owned', quantity: index === 1 ? 3 : 1, wishlist: false
}));
const missing = catalog.cards.slice(6, 9).map(card => ({
  cardId: card.id, status: 'missing', quantity: 0, wishlist: true
}));
const seeded = await proxy('101', 'POST', JSON.stringify({
  revision: start.revision, csrfToken: start.csrfToken, changes: [...owned, ...missing]
}));
if (!seeded.ok) throw new Error('Preview seed failed');

// Preview identities are fixed fixtures; never connect this adapter to real accounts.
function demoAccount(url) {
  const account = url.searchParams.get('demo');
  return ['one', 'two', 'guest'].includes(account) ? account : 'one';
}

function escape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function render(locale) {
  const source = readFileSync(theme + '/sections/p10-collector-album.liquid', 'utf8')
    .replace(/{% schema %}[\s\S]*?{% endschema %}/g, '');
  const strings = JSON.parse(readFileSync(theme + '/locales/' +
    (locale === 'zh-CN' ? 'zh-CN.json' : 'en.default.json'), 'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/, ''));
  return source.replace(/{{\s*([\s\S]*?)\s*}}/g, (_, expression) => {
    const parts = expression.trim().split('|').map(part => part.trim());
    const variable = parts.shift();
    const literal = /^'([^']*)'$/.exec(variable);
    let value = literal ? literal[1] : ({
      'section.id': 'preview-album',
      'section.settings.api_endpoint': '/apps/pakra-collection/v1/collection',
      'routes.root_url': '/',
      'routes.storefront_login_url': '/?demo=one&lang=' + locale,
      'request.locale.iso_code': locale
    })[variable];
    if (value === undefined) throw new Error('Unsupported Liquid expression');
    for (const filter of parts) {
      if (filter === 't') value = value.split('.').reduce((item, key) => item[key], strings);
      else if (filter === 'json') value = JSON.stringify(value);
      else if (filter === 'escape') value = escape(value);
      else if (filter === 'asset_url') value = '/assets/' + value;
      else if (filter === 'stylesheet_tag') value = '<link rel="stylesheet" href="' + value + '">';
      else throw new Error('Unsupported filter');
    }
    return value;
  });
}

const allowedAssets = new Set(['p10-collector-album.js','p10-collector-album.css','p10-collector-catalog.json']);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/apps/pakra-collection/v1/collection') {
      const source = new URL(req.headers.referer || 'http://127.0.0.1/');
      const demo = demoAccount(source);
      const identity = demo === 'guest' ? '' : demo === 'two' ? '202' : '101';
      const chunks = [];
      let bodyBytes = 0;
      for await (const chunk of req) {
        bodyBytes += chunk.length;
        if (bodyBytes > 64 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'body_too_large' } }));
          return;
        }
        chunks.push(chunk);
      }
      const response = await proxy(identity, req.method, req.method === 'POST' ? Buffer.concat(chunks).toString() : undefined);
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(await response.text());
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice('/assets/'.length);
      if (!allowedAssets.has(name)) { res.writeHead(404); res.end(); return; }
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'application/json';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(readFileSync(theme + '/assets/' + name));
      return;
    }
    if (url.pathname !== '/') { res.writeHead(404); res.end('Preview route only'); return; }
    const locale = url.searchParams.get('lang') === 'zh-CN' ? 'zh-CN' : 'en';
    const demo = demoAccount(url);
    const dark = url.searchParams.get('theme') === 'dark';
    const banner = locale === 'zh-CN' ? '本地预览 · 使用虚拟测试账号，未连接店铺顾客' : 'LOCAL PREVIEW · Synthetic test accounts, not store customers';
    const controls = [
      ['one', locale === 'zh-CN' ? '测试账号 A' : 'Test account A'],
      ['two', locale === 'zh-CN' ? '测试账号 B' : 'Test account B'],
      ['guest', locale === 'zh-CN' ? '游客' : 'Guest']
    ].map(([key, label]) => '<a href="/?demo=' + key + '&lang=' + locale + '">' + (demo === key ? '● ' : '') + label + '</a>').join(' ');
    const alternateLocale = locale === 'zh-CN' ? 'en' : 'zh-CN';
    const html = `<!doctype html>
<html lang="${locale}"${dark ? ' data-p10-color-mode="dark"' : ''}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>PAKRA · Collection album preview</title>
    <style>
      body { margin: 0; font-family: Arial, sans-serif; color: #17151a; }
      .preview-bar { padding: 12px 24px; background: #eee8f3; font-size: 12px;
        display: flex; gap: 16px; justify-content: space-between; flex-wrap: wrap; }
      .preview-bar a { color: #4d3267; margin-right: 12px; }
      .preview-brand { padding: 24px max(24px, calc((100vw - 1216px) / 2));
        font-family: Georgia, serif; font-weight: bold; font-size: 26px; border-bottom: 1px solid #eee; }
    </style>
  </head>
  <body>
    <div class="preview-bar">
      <span>${banner}</span>
      <nav>${controls}<a href="/?demo=${demo}&lang=${alternateLocale}">EN / 中文</a></nav>
    </div>
    <div class="preview-brand">PAKRACARDS</div>
    ${render(locale)}
  </body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin' });
    res.end(html);
  } catch {
    res.writeHead(500, {'Content-Type':'text/plain'});
    res.end('Preview unavailable');
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Local collection preview: http://127.0.0.1:${server.address().port}\n`));
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal, () => server.close(() => backend.close(() => process.exit(0))));
}
