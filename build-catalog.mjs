import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(resolve(directory, 'catalog-sources.json'), 'utf8'));
const sourceDirectory = resolve(directory, sources.directory);
const outputPath = resolve(directory, 'theme/assets/p10-collector-catalog.json');
const digest = (value) => createHash('sha256').update(value).digest('hex');
assert.ok(process.argv.slice(2).every((argument) => argument === '--check'), 'Usage: node build-catalog.mjs [--check]');

function readSource(filename) {
  const path = resolve(sourceDirectory, filename);
  const bytes = readFileSync(path);
  const sha256 = digest(bytes);
  assert.equal(sha256, sources.files[filename], `Catalog source changed; review ${filename} before updating catalog-sources.json`);
  return { data: JSON.parse(bytes), reference: { path: relative(directory, path).replaceAll('\\', '/'), sha256 } };
}

function productPath(value, variantId) {
  assert.equal(typeof value, 'string', 'Product link must be a string');
  assert.match(value, /^\/products\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\?variant=\d+)?$/, 'Unsafe product link');
  const url = new URL(value, 'https://pakracards.com');
  assert.equal(url.origin, 'https://pakracards.com');
  assert.equal(url.searchParams.get('variant'), variantId ?? null, 'Variant link mismatch');
  return value;
}

const catalog = readSource('p10-single-card-catalog-20260715-v6.json');
const boxes = readSource('p10-single-card-boxes.json');
assert.ok(Array.isArray(catalog.data.spotlightCards), 'Missing card source');
assert.ok(Array.isArray(boxes.data.boxes), 'Missing box source');

const selected = catalog.data.spotlightCards.filter((card) => (
  card.seriesKey === 'fun-moments' && card.waveKey === 't2w8'
));
assert.equal(selected.length, 25, 'Pilot must contain exactly 25 source cards');

const expectedCodes = new Set([
  ...Array.from({ length: 13 }, (_, index) => `QY08-CR-${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 12 }, (_, index) => `QY08-◇CR-${String(index + 1).padStart(3, '0')}`),
]);
const identities = new Set();
const variants = new Set();
const cards = selected.map((card) => {
  assert.ok(expectedCodes.delete(card.code), `Unexpected or duplicate card code: ${card.code}`);
  const hidden = card.code.includes('◇');
  assert.equal(card.rarityKey, hidden ? 'hidden-cr' : 'cr', 'Rarity does not match card identity');
  assert.match(card.productHandle, /^kayou-mlp-fun-moments-edition-chinese-series-8-t2w8-qy08-(?:hidden-diamond-)?cr-single-cards$/);
  assert.equal(card.productHandle.includes('hidden-diamond'), hidden, 'Product does not match card identity');
  assert.equal(card.status, 'ACTIVE', 'Source card must be a public listing');
  assert.equal(card.publishedOnOnlineStore, true, 'Source card must be published');
  assert.equal(card.previewOnly, false, 'Preview-only cards cannot enter the catalog');
  assert.equal(typeof card.variantId, 'string');
  assert.match(card.variantId, /^\d+$/, 'Invalid variant ID');
  assert.equal(card.variantGid, `gid://shopify/ProductVariant/${card.variantId}`);
  const productLink = productPath(card.link, card.variantId);
  assert.equal(new URL(productLink, 'https://pakracards.com').pathname, `/products/${card.productHandle}`);
  const image = new URL(card.image);
  assert.equal(image.protocol, 'https:', 'Images must use HTTPS');
  assert.equal(image.hostname, 'cdn.shopify.com', 'Images must use Shopify CDN');
  assert.ok(image.pathname.startsWith('/s/files/1/0746/1014/7516/'), 'Image must belong to this store');
  assert.equal(image.username + image.password + image.port, '', 'Unsafe image URL');
  assert.equal(typeof card.imageAlt, 'string');
  assert.ok(card.imageAlt.trim(), 'Image description is required');

  const id = `mlp:zh-CN:fun-moments:t2w8:${card.code}`;
  assert.ok(!identities.has(id), 'Duplicate card identity');
  assert.ok(!variants.has(card.variantId), 'Duplicate variant ID');
  identities.add(id);
  variants.add(card.variantId);
  return {
    id,
    code: card.code,
    rarity: hidden ? 'Hidden CR' : 'CR',
    rarityKey: card.rarityKey,
    image: card.image,
    imageAlt: card.imageAlt,
    productHandle: card.productHandle,
    variantId: card.variantId,
    productLink,
  };
}).sort((a, b) => (
  Number(a.rarityKey === 'hidden-cr') - Number(b.rarityKey === 'hidden-cr')
  || a.code.localeCompare(b.code, 'en')
));
assert.equal(expectedCodes.size, 0, 'Pilot is missing expected card identities');

const boxMatches = boxes.data.boxes.filter((box) => (
  box.seriesKey === 'fun-moments' && box.waveKey === 't2w8'
));
assert.equal(boxMatches.length, 1, 'Expected one matching box');
assert.equal(boxMatches[0].productHandle, 'kayou-mlp-fun-moments-edition-t2-8-card-box');
const boxLink = productPath(`/products/${boxMatches[0].productHandle}`);
const set = {
  id: 'mlp-zh-cn-fun-moments-8-cr',
  ip: 'My Little Pony',
  language: 'zh-CN',
  edition: 'fun-moments',
  wave: 't2w8',
  title: { en: 'Fun Moments: Edition 8 · CR & Hidden CR', zh: '趣影8 · CR 与隐藏 CR' },
  coverage: 'partial',
  count: cards.length,
  boxLink,
};
const payload = {
  schemaVersion: 1,
  id: set.id,
  catalogVersion: `1-${digest(JSON.stringify({ set, cards })).slice(0, 12)}`,
  set,
  cards,
  source: {
    catalog: { ...catalog.reference, generatedAt: catalog.data.generatedAt },
    boxes: boxes.reference,
    scope: 'My Little Pony, Chinese Fun Moments Edition 8: 13 CR and 12 Hidden CR card kinds only. Partial catalog; not a complete edition checklist. Product links and images use the saved storefront catalog. No prices or stock claims.',
  },
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(outputPath, 'utf8'), serialized, 'Catalog is stale. Review sources and run npm run build:catalog.');
  console.log(`Catalog verified: ${cards.length} cards, ${payload.catalogVersion}`);
  process.exit(0);
}
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
mkdirSync(dirname(outputPath), { recursive: true });
try {
  writeFileSync(temporaryPath, serialized, { flag: 'wx' });
  assert.deepEqual(JSON.parse(readFileSync(temporaryPath, 'utf8')), payload);
  renameSync(temporaryPath, outputPath);
} finally {
  rmSync(temporaryPath, { force: true });
}
console.log(JSON.stringify({ outputPath, cards: cards.length, uniqueIdentities: identities.size, uniqueVariants: variants.size, coverage: set.coverage, catalogVersion: payload.catalogVersion }));
