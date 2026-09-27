import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ApiError, authenticateProxy, issueCsrfToken, verifyCsrfToken } from './auth.mjs';
import { CollectionStore } from './store.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const statuses = new Set(['unrecorded', 'missing', 'owned', 'previously_owned']);
const cardIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{S}._:-]{0,159}$/u;
const bodyLimit = 64 * 1024;
const invalidInput = () => new ApiError(400, 'invalid_input', 'Check the collection changes and try again.');

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) {
    request.resume();
    throw new ApiError(415, 'json_required', 'Send collection changes as JSON.');
  }
  if (Number(request.headers['content-length']) > bodyLimit) {
    request.resume();
    throw new ApiError(413, 'body_too_large', 'Save fewer collection changes at once.');
  }
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > bodyLimit) {
        if (!tooLarge) reject(new ApiError(413, 'body_too_large', 'Save fewer collection changes at once.'));
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(invalidInput());
      }
    });
    request.on('aborted', () => reject(invalidInput()));
    request.on('error', () => reject(invalidInput()));
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validateChanges(body, catalog) {
  if (
    !exactKeys(body, ['revision', 'csrfToken', 'changes']) ||
    !Number.isSafeInteger(body.revision) || body.revision < 0 ||
    !Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 100
  ) throw invalidInput();
  const seen = new Set();
  for (const change of body.changes) {
    if (
      !exactKeys(change, ['cardId', 'status', 'quantity', 'wishlist']) ||
      typeof change.cardId !== 'string' || !catalog.has(change.cardId) || seen.has(change.cardId) ||
      !statuses.has(change.status) || !Number.isInteger(change.quantity) ||
      (change.status === 'owned' ? change.quantity < 1 || change.quantity > 999 : change.quantity !== 0) ||
      typeof change.wishlist !== 'boolean'
    ) throw invalidInput();
    seen.add(change.cardId);
  }
}

function loadCatalog(filename) {
  const source = JSON.parse(readFileSync(filename, 'utf8'));
  if (source.schemaVersion !== 1 || !Array.isArray(source.cards)) throw new Error('Invalid catalog.');
  const ids = source.cards.map((card) => card.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate catalog identifiers.');
  return new Set(ids);
}

function createRateLimiter({ windowMs = 60_000, reads = 120, writes = 60 } = {}) {
  const windows = new Map();
  return (principal, method, now) => {
    const key = JSON.stringify([principal.shop, principal.customerId]);
    let window = windows.get(key);
    if (!window || window.expires <= now) {
      if (windows.size >= 10_000) {
        for (const [entryKey, value] of windows) if (value.expires <= now) windows.delete(entryKey);
      }
      if (!windows.has(key) && windows.size >= 10_000) {
        throw new ApiError(429, 'rate_limited', 'Please wait before trying again.');
      }
      window = { expires: now + windowMs, reads: 0, writes: 0 };
      windows.set(key, window);
    }
    const counter = method === 'POST' ? 'writes' : 'reads';
    window[counter] += 1;
    if (window[counter] > (counter === 'writes' ? writes : reads)) {
      throw new ApiError(429, 'rate_limited', 'Please wait before trying again.');
    }
  };
}

export function createCollectionServer({
  secret,
  shop,
  catalog,
  catalogPath = resolve(directory, 'theme/assets/p10-collector-catalog.json'),
  dbPath = resolve(directory, 'data/collection.sqlite'),
  store,
  now = Date.now,
  rateLimit,
} = {}) {
  let configured = (typeof secret === 'string' || Buffer.isBuffer(secret)) && secret.length >= 32 &&
    typeof shop === 'string' && /^[a-z\d][a-z\d-]*\.myshopify\.com$/.test(shop);
  if (configured) {
    try {
      catalog = catalog ? new Set(catalog) : loadCatalog(catalogPath);
      configured = catalog.size > 0 && [...catalog].every((id) => typeof id === 'string' && cardIdPattern.test(id));
    } catch {
      configured = false;
    }
  }
  const ownsStore = configured && !store;
  if (ownsStore) {
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    store = new CollectionStore(dbPath);
  }
  const rateLimiter = createRateLimiter(rateLimit);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/health' && request.method === 'GET') {
        send(response, configured ? 200 : 503, { status: configured ? 'ready' : 'not_configured' });
        return;
      }
      if (url.pathname !== '/proxy/v1/collection') throw new ApiError(404, 'not_found', 'Not found.');
      if (!configured) throw new ApiError(503, 'not_configured', 'Collection sync is not configured yet.');
      if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'method_not_allowed', 'Use GET or POST.');
      const principal = authenticateProxy(url, { secret, shop, now: now() });
      rateLimiter(principal, request.method, now());
      let snapshot;
      if (request.method === 'POST') {
        const body = await readBody(request);
        verifyCsrfToken(body?.csrfToken, principal, secret, now());
        validateChanges(body, catalog);
        snapshot = store.update(principal, body.revision, body.changes);
      } else {
        snapshot = store.read(principal);
      }
      send(response, 200, { schemaVersion: 1, ...snapshot, csrfToken: issueCsrfToken(principal, secret, now()) });
    } catch (error) {
      request.resume();
      if (response.destroyed || response.headersSent) return;
      const known = error instanceof ApiError;
      send(response, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'storage_unavailable',
          message: known ? error.message : 'Collection changes could not be saved. Please try again.',
        },
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  if (ownsStore) server.once('close', () => store.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createCollectionServer({
    secret: process.env.SHOPIFY_API_SECRET,
    shop: process.env.PAKRA_SHOP,
    catalogPath: process.env.PAKRA_ALBUM_CATALOG_PATH,
    dbPath: process.env.PAKRA_ALBUM_DB,
  });
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port.');
  server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    process.stdout.write('Collection service started. Check /health for configuration readiness.\n');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}
