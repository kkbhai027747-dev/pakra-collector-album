import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollectionServer } from '../server.mjs';
import { CollectionStore } from '../store.mjs';

const shop = 'album-tests.myshopify.com';
const catalog = new Set(['mlp-test-001', 'mlp-test-002']);
const owned = (cardId = 'mlp-test-001', quantity = 1) => ({ cardId, status: 'owned', quantity, wishlist: false });

function signedPath(secret, {
  customerId = '101',
  signedShop = shop,
  timestamp = Math.floor(Date.now() / 1000),
  extra = [],
  prefix = '/apps/pakra-collection',
} = {}) {
  const parameters = new URLSearchParams({
    shop: signedShop,
    logged_in_customer_id: customerId,
    path_prefix: prefix,
    timestamp: String(timestamp),
  });
  for (const [key, value] of extra) parameters.append(key, value);
  const keys = [...new Set(parameters.keys())];
  const message = keys.map((key) => `${key}=${parameters.getAll(key).join(',')}`).sort().join('');
  parameters.append('signature', createHmac('sha256', secret).update(message).digest('hex'));
  return `/proxy/v1/collection?${parameters}`;
}

async function fixture(t, overrides = {}) {
  const secret = randomBytes(32);
  const server = createCollectionServer({ secret, shop, catalog, dbPath: ':memory:', ...overrides });
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  };
  t.after(close);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async ({ auth, method = 'GET', body, path, headers } = {}) => {
    const response = await fetch(origin + (path ?? signedPath(secret, auth)), {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const get = async (auth) => request({ auth });
  const post = async (snapshot, changes = [owned()], auth, fields = {}) => request({
    auth,
    method: 'POST',
    body: { revision: snapshot.revision, csrfToken: snapshot.csrfToken, changes, ...fields },
  });
  return { secret, server, origin, request, get, post, close };
}

test('starts closed without a secret and exposes no sensitive readiness details', async (t) => {
  const app = await fixture(t, { secret: undefined });
  assert.equal((await app.get()).status, 503);
  assert.deepEqual(await app.request({ path: '/health' }).then(({ status, body }) => ({ status, body })), {
    status: 503, body: { status: 'not_configured' },
  });
});

test('missing or malformed catalogs fail closed', async (t) => {
  for (const options of [{ catalog: new Set() }, { catalog: new Set(['bad id']) }, { catalog: undefined, catalogPath: join(tmpdir(), 'pakra-absent-catalog.json') }]) {
    const app = await fixture(t, options);
    assert.equal((await app.get()).status, 503);
  }
});

test('loads all 25 real catalog cards and preserves hidden-card Unicode identifiers', async (t) => {
  const actualCatalog = JSON.parse(readFileSync(new URL('../theme/assets/p10-collector-catalog.json', import.meta.url), 'utf8'));
  assert.equal(actualCatalog.cards.length, 25);
  const hiddenCard = actualCatalog.cards.find((card) => card.id.includes('◇'));
  assert.ok(hiddenCard);
  const ordinaryId = hiddenCard.id.replace('◇', '');
  assert.ok(actualCatalog.cards.some((card) => card.id === ordinaryId));
  const app = await fixture(t, { catalog: undefined });
  const initial = await app.get();
  assert.equal(initial.status, 200);
  const changes = actualCatalog.cards.map((card) => owned(card.id, card.id === hiddenCard.id ? 2 : 1));
  assert.equal((await app.post(initial.body, changes)).status, 200);
  const restored = (await app.get()).body;
  assert.equal(Object.keys(restored.entries).length, 25);
  assert.equal(restored.entries[hiddenCard.id].quantity, 2);
  assert.equal(restored.entries[ordinaryId].quantity, 1);
});

test('CLI starts and stops with injected synthetic credentials without printing them', async (t) => {
  const reservation = createServer();
  await new Promise((resolveListening) => reservation.listen(0, '127.0.0.1', resolveListening));
  const port = reservation.address().port;
  await new Promise((resolveClose) => reservation.close(resolveClose));
  const secret = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    windowsHide: true,
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOST: '127.0.0.1',
      PORT: String(port),
      SHOPIFY_API_SECRET: secret,
      PAKRA_SHOP: shop,
      PAKRA_ALBUM_DB: ':memory:',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const stopped = new Promise((resolveStopped) => child.once('close', resolveStopped));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
  };
  t.after(stop);
  await new Promise((resolveStarted, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI startup timed out.')), 5000);
    const finish = (error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveStarted();
    };
    child.once('error', () => finish(new Error('CLI could not start.')));
    child.once('exit', () => finish(new Error('CLI exited before readiness.')));
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Collection service started.')) finish();
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
  await stop();
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(shop), false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`), TypeError);
});

test('requires a signed, recent, logged-in request for the configured shop and proxy', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.request({ path: '/proxy/v1/collection' })).status, 401);
  for (const auth of [
    { customerId: '' },
    { customerId: '101x' },
    { signedShop: 'another-shop.myshopify.com' },
    { timestamp: Math.floor(Date.now() / 1000) - 301 },
    { timestamp: Math.floor(Date.now() / 1000) + 60 },
    { prefix: '/apps/another-proxy' },
    { extra: [['logged_in_customer_id', '202']] },
    { extra: [['shop', shop]] },
    { extra: [['timestamp', '1']] },
    { extra: [['path_prefix', '/apps/pakra-collection']] },
  ]) assert.equal((await app.get(auth)).status, 401);
  const tampered = signedPath(app.secret).replace('logged_in_customer_id=101', 'logged_in_customer_id=202');
  assert.equal((await app.request({ path: tampered })).status, 401);
  assert.equal((await app.request({ path: `${signedPath(app.secret)}&signature=invalid` })).status, 401);
});

test('validates decoded query values and duplicate non-critical values using Shopify canonicalization', async (t) => {
  const app = await fixture(t);
  const result = await app.get({ extra: [['extra', 'one + value'], ['extra', 'two&three'], ['额外', '卡片']] });
  assert.equal(result.status, 200);
  assert.equal(result.body.schemaVersion, 1);
  assert.equal(result.body.revision, 0);
  assert.deepEqual(result.body.entries, {});
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  assert.equal(result.headers.get('set-cookie'), null);
});

test('isolates account data and CSRF tokens; refuses a body-supplied customer identity', async (t) => {
  const app = await fixture(t);
  const first = (await app.get()).body;
  const second = (await app.get({ customerId: '202' })).body;
  assert.equal((await app.post(first, [owned()], undefined, { customerId: '202' })).status, 400);
  assert.equal((await app.post(first, [owned()], { customerId: '202' })).status, 403);
  const saved = await app.post(first, [owned('mlp-test-001', 2)]);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual(saved.body.entries, { 'mlp-test-001': { status: 'owned', quantity: 2, wishlist: false } });
  assert.deepEqual((await app.get({ customerId: '202' })).body.entries, {});
  assert.equal((await app.post(second, [{ ...owned('mlp-test-002'), wishlist: true }], { customerId: '202' })).status, 200);
  assert.deepEqual(Object.keys((await app.get()).body.entries), ['mlp-test-001']);
});

test('requires a valid CSRF token and expires it independently of a fresh proxy signature', async (t) => {
  let currentTime = Date.now();
  const app = await fixture(t, { now: () => currentTime });
  const snapshot = (await app.get()).body;
  assert.equal((await app.post(snapshot, [owned()], undefined, { csrfToken: undefined })).status, 403);
  assert.equal((await app.post(snapshot, [owned()], undefined, { csrfToken: 'invalid' })).status, 403);
  currentTime += 901_000;
  const auth = { timestamp: Math.floor(currentTime / 1000) };
  assert.equal((await app.post(snapshot, [owned()], auth)).status, 403);
  const fresh = (await app.get(auth)).body;
  assert.equal((await app.post(fresh, [owned()], auth)).status, 200);
});

test('validates every batch before any write, including catalog, quantities, and unknown fields', async (t) => {
  const app = await fixture(t, { rateLimit: { writes: 1000 } });
  const snapshot = (await app.get()).body;
  const invalidChanges = [
    [{ ...owned(), cardId: 'not-in-catalog' }],
    [owned(), { ...owned('mlp-test-002'), status: 'verified' }],
    [owned(), owned()],
    [{ ...owned(), quantity: 0 }],
    [{ ...owned(), quantity: 1000 }],
    [{ ...owned(), quantity: 1.5 }],
    [{ ...owned(), status: 'missing', quantity: 1 }],
    [{ ...owned(), wishlist: 'yes' }],
    [{ ...owned(), certificate: true }],
    [],
    Array.from({ length: 101 }, () => owned()),
  ];
  for (const changes of invalidChanges) assert.equal((await app.post(snapshot, changes)).status, 400);
  assert.equal((await app.post(snapshot, [owned()], undefined, { revision: -1 })).status, 400);
  const unchanged = (await app.get()).body;
  assert.equal(unchanged.revision, 0);
  assert.deepEqual(unchanged.entries, {});
});

test('stores all supported states and removes empty unrecorded entries', async (t) => {
  const app = await fixture(t);
  let snapshot = (await app.get()).body;
  for (const status of ['missing', 'previously_owned', 'unrecorded']) {
    const result = await app.post(snapshot, [{ cardId: 'mlp-test-001', status, quantity: 0, wishlist: true }]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.entries['mlp-test-001'], { status, quantity: 0, wishlist: true });
    snapshot = result.body;
  }
  const cleared = await app.post(snapshot, [{ cardId: 'mlp-test-001', status: 'unrecorded', quantity: 0, wishlist: false }]);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.entries, {});
  assert.equal(cleared.body.revision, 4);
});

test('rejects stale cross-device writes and keeps the winning revision intact', async (t) => {
  const app = await fixture(t);
  const deviceOne = (await app.get()).body;
  const deviceTwo = (await app.get()).body;
  const results = await Promise.all([
    app.post(deviceOne, [owned('mlp-test-001')]),
    app.post(deviceTwo, [owned('mlp-test-002')]),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const latest = (await app.get()).body;
  assert.equal(latest.revision, 1);
  assert.equal(Object.keys(latest.entries).length, 1);
  assert.deepEqual(latest.entries, results.find((result) => result.status === 200).body.entries);
});

test('survives a service restart using the same SQLite file', async (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'pakra-collector-test-'));
  t.after(() => {
    const target = resolve(temporaryDirectory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(target.startsWith(join(resolve(tmpdir()), 'pakra-collector-test-')));
    rmSync(target, { recursive: true, force: true });
  });
  const dbPath = join(temporaryDirectory, 'collection.sqlite');
  const first = await fixture(t, { dbPath });
  const snapshot = (await first.get()).body;
  assert.equal((await first.post(snapshot, [owned('mlp-test-001', 3)])).status, 200);
  await first.close();
  const restarted = await fixture(t, { dbPath });
  const restored = await restarted.get();
  assert.equal(restored.status, 200);
  assert.equal(restored.body.revision, 1);
  assert.equal(restored.body.entries['mlp-test-001'].quantity, 3);
  assert.deepEqual((await restarted.get({ customerId: '202' })).body.entries, {});
  await restarted.close();
});

test('SQLite rolls back revision and earlier rows if a later row fails', () => {
  const store = new CollectionStore(':memory:');
  try {
    const principal = { shop, customerId: '101' };
    assert.throws(() => store.update(principal, 0, [owned(), { ...owned('mlp-test-002'), quantity: -1 }]));
    const snapshot = store.read(principal);
    assert.equal(snapshot.revision, 0);
    assert.deepEqual(Object.keys(snapshot.entries), []);
  } finally {
    store.close();
  }
});

test('returns bounded failures without exposing storage details or claiming success', async (t) => {
  const storageFailure = await fixture(t, {
    store: {
      read: () => ({ revision: 0, entries: {} }),
      update: () => { throw new Error('Internal storage details must not reach the response.'); },
    },
  });
  const snapshot = (await storageFailure.get()).body;
  const failed = await storageFailure.post(snapshot);
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: { code: 'storage_unavailable', message: 'Collection changes could not be saved. Please try again.' } });
  assert.equal(Object.hasOwn(failed.body, 'revision'), false);
  await storageFailure.close();
  await assert.rejects(storageFailure.get(), TypeError);
});

test('limits oversized bodies, invalid JSON, content types, methods, and request rates', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.request({ method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await app.request({ method: 'POST', body: ' '.repeat(65 * 1024) })).status, 413);
  assert.equal((await app.request({ method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request({ method: 'OPTIONS' })).status, 405);
  assert.equal((await app.request({ method: 'DELETE' })).status, 405);
  const limited = await fixture(t, { rateLimit: { reads: 1, writes: 1 } });
  const snapshot = (await limited.get()).body;
  const throttled = await limited.get();
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get('retry-after'), '60');
  assert.equal((await limited.post(snapshot)).status, 200);
  assert.equal((await limited.post(snapshot)).status, 429);
  assert.equal((await limited.get({ customerId: '202' })).status, 200);
});
