import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('catalog rebuild check works outside the project working directory', () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../build-catalog.mjs', import.meta.url)), '--check',
  ], { cwd: tmpdir(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Catalog verified: 25 cards/);
});

test('portable preview serves both locales and isolates synthetic accounts', async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../preview.mjs', import.meta.url))], {
    cwd: tmpdir(),
    windowsHide: true,
    env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), PREVIEW_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopped = new Promise((resolve) => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
  });
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic preview startup timed out.')), 5000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic preview exited before startup.')); });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = /Local collection preview: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  for (const locale of ['en', 'zh-CN']) {
    const response = await fetch(`${origin}/?lang=${locale}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(`<html lang="${locale}"`));
    assert.doesNotMatch(html, /{{|{%|undefined/);
    assert.match(html, /p10-collector-album/);
  }
  const request = async (demo) => {
    const response = await fetch(`${origin}/apps/pakra-collection/v1/collection`, {
      headers: { Referer: `${origin}/?demo=${demo}` },
    });
    return { status: response.status, body: await response.json() };
  };
  const first = await request('one');
  assert.equal(first.status, 200);
  assert.equal(Object.keys(first.body.entries).length, 8);
  assert.deepEqual((await request('two')).body.entries, {});
  assert.equal((await request('guest')).status, 401);
  const catalog = await fetch(`${origin}/assets/p10-collector-catalog.json`).then((response) => response.json());
  assert.equal(catalog.cards.length, 25);
  assert.equal((await fetch(`${origin}/assets/not-allowed.json`)).status, 404);
});
