// End-to-end tests for the Cloudflare Pages Functions API, against the built site in `wrangler pages dev`
// with a throwaway local D1 database (a temp folder). Never touches a remote database.
// Run with `npm test` (builds first). Locally the CF-Connecting-IP header is passed through, so each test can be its own visitor.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const PORT = 8791, BASE = `http://127.0.0.1:${PORT}`, KEY = 'test-admin-key-0123456789';
const wrangler = join('node_modules', 'wrangler', 'bin', 'wrangler.js');
const state = mkdtempSync(join(tmpdir(), 'portfolio-d1-test-'));
const content = JSON.parse(readFileSync(new URL('../../api/portfolio.json', import.meta.url), 'utf8'));
let server;

function run(...args) {
  const r = spawnSync(process.execPath, [wrangler, ...args], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

async function start(adminKey) {
  const args = [wrangler, 'pages', 'dev', '--port', String(PORT), '--persist-to', state];
  if (adminKey) args.push('--binding', `ADMIN_KEY=${adminKey}`);
  server = spawn(process.execPath, args, { stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* still starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('wrangler pages dev did not start');
}

async function stop() {
  if (!server) return;
  // wrangler starts workerd as a child; kill the whole tree so the port and the database file are released.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1500));
  server = undefined;
}

let n = 0;
const newIp = () => `10.0.${Math.floor(++n / 250)}.${n % 250 + 1}`;
const post = (body, ip = newIp(), headers = {}) => fetch(BASE + '/api/contact', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
});
const inbox = async () => {
  const r = await fetch(BASE + '/api/contact', { headers: { 'X-Admin-Key': KEY } });
  assert.equal(r.status, 200);
  return r.json();
};
const valid = (tag = 'x') => ({ name: 'Test Visitor', email: 'visitor@example.com', message: 'Hello from the test suite ' + tag });

before(async () => {
  assert.ok(readFileSync('dist/index.html'), 'run `npm run build` first');
  run('d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state);
});
after(async () => { await stop(); rmSync(state, { recursive: true, force: true }); });

describe('first run, ADMIN_KEY not set', () => {
  before(() => start());
  after(stop);

  test('GET /api/health', async () => {
    const r = await fetch(BASE + '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  test('GET /api/portfolio returns api/portfolio.json with seven stations', async () => {
    const r = await fetch(BASE + '/api/portfolio');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public,max-age=300');
    const body = await r.json();
    assert.deepEqual(body, content);
    assert.equal(body.stations.length, 7);
    assert.deepEqual(body.stations.map(s => s.turn), [1, 2, 3, 4, 5, 6, 7]);
  });

  test('unknown /api paths are 404, not the SPA', async () => {
    assert.equal((await fetch(BASE + '/api/nope')).status, 404);
    assert.equal((await fetch(BASE + '/api/a/b/c')).status, 404);
  });

  test('the site itself is still served', async () => {
    const r = await fetch(BASE + '/');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<div id="root">/);
  });

  test('inbox is closed (404) while ADMIN_KEY is not set, whatever the header', async () => {
    assert.equal((await fetch(BASE + '/api/contact')).status, 404);
    assert.equal((await fetch(BASE + '/api/contact', { headers: { 'X-Admin-Key': '' } })).status, 404);
    assert.equal((await fetch(BASE + '/api/contact', { headers: { 'X-Admin-Key': KEY } })).status, 404);
  });

  test('store a message before the restart', async () => {
    assert.equal((await post(valid('before restart'))).status, 202);
  });
});

describe('second run on the same database, ADMIN_KEY set', () => {
  before(() => start(KEY));
  after(stop);

  test('messages persist across restarts', async () => {
    assert.ok((await inbox()).some(m => m.message === 'Hello from the test suite before restart'));
  });

  test('admin auth: missing, wrong or near-miss keys get 404', async () => {
    for (const key of [undefined, '', 'wrong', KEY + 'x', KEY.slice(0, -1), KEY.toUpperCase()]) {
      const r = await fetch(BASE + '/api/contact', key === undefined ? {} : { headers: { 'X-Admin-Key': key } });
      assert.equal(r.status, 404, `key ${JSON.stringify(key)}`);
      assert.equal(await r.text(), '');
    }
    const r = await fetch(BASE + '/api/contact', { headers: { 'X-Admin-Key': KEY } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('validation: each bad field gets 400 with the .NET-style problem body', async () => {
    const long = c => 'a'.repeat(c);
    const cases = [
      [{ email: 'a@b.c', message: 'long enough message' }, 'Name'],
      [{ name: '   ', email: 'a@b.c', message: 'long enough message' }, 'Name'],
      [{ name: long(81), email: 'a@b.c', message: 'long enough message' }, 'Name'],
      [{ name: 42, email: 'a@b.c', message: 'long enough message' }, 'Name'],
      [{ name: 'A', message: 'long enough message' }, 'Email'],
      [{ name: 'A', email: 'nope', message: 'long enough message' }, 'Email'],
      [{ name: 'A', email: '@b.c', message: 'long enough message' }, 'Email'],
      [{ name: 'A', email: 'a@', message: 'long enough message' }, 'Email'],
      [{ name: 'A', email: 'a@b@c', message: 'long enough message' }, 'Email'],
      [{ name: 'A', email: long(251) + '@b.c', message: 'long enough message' }, 'Email'],
      [{ name: 'A', email: 'a@b.c' }, 'Message'],
      [{ name: 'A', email: 'a@b.c', message: 'too short' }, 'Message'],
      [{ name: 'A', email: 'a@b.c', message: '    short     ' }, 'Message'],
      [{ name: 'A', email: 'a@b.c', message: long(4001) }, 'Message'],
    ];
    for (const [body, key] of cases) {
      const r = await post(body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(r.headers.get('content-type'), 'application/problem+json');
      const p = await r.json();
      assert.equal(p.status, 400);
      assert.deepEqual(Object.keys(p.errors), [key], JSON.stringify(p));
    }
    const all = await (await post({})).json();
    assert.deepEqual(Object.keys(all.errors).sort(), ['Email', 'Message', 'Name']);
  });

  test('limits: 80/254/4000 characters are accepted', async () => {
    const r = await post({ name: 'n'.repeat(80), email: 'e'.repeat(250) + '@b.c', message: 'm'.repeat(4000) });
    assert.equal(r.status, 202);
  });

  test('malformed requests: bad JSON 400, non-object 400, wrong content type 415, too large 413', async () => {
    assert.equal((await post('{nope')).status, 400);
    assert.equal((await post('[1,2]')).status, 400);
    assert.equal((await post('null')).status, 400);
    assert.equal((await post(valid(), newIp(), { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post({ ...valid(), pad: 'x'.repeat(17 * 1024) })).status, 413);
  });

  test('accepted messages are stored trimmed and returned newest first', async () => {
    assert.equal((await post({ name: '  Pat  ', email: '  pat@example.com ', message: '\n  trimmed message here  \n' })).status, 202);
    const [m] = await inbox();
    assert.equal(m.name, 'Pat');
    assert.equal(m.email, 'pat@example.com');
    assert.equal(m.message, 'trimmed message here');
    assert.match(m.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(Object.keys(m).sort(), ['createdAt', 'email', 'id', 'message', 'name']);
  });

  test('honeypot: 202 but not stored', async () => {
    const before = (await inbox())[0].id;
    assert.equal((await post({ ...valid('honeypot'), website: 'http://spam.example' })).status, 202);
    const now = await inbox();
    assert.equal(now[0].id, before);
    assert.ok(!now.some(m => m.message.endsWith('honeypot')));
  });

  test('rate limit: five posts per hour per IP, invalid ones count too, then 429', async () => {
    const ip = newIp();
    assert.equal((await post({}, ip)).status, 400);
    assert.equal((await post({}, ip)).status, 400);
    for (let i = 0; i < 3; i++) assert.equal((await post(valid('rl' + i), ip)).status, 202);
    const r = await post(valid('rl-over'), ip);
    assert.equal(r.status, 429);
    const wait = Number(r.headers.get('retry-after'));
    assert.ok(wait > 0 && wait <= 3600);
    assert.equal((await post(valid('other visitor'))).status, 202, 'other IPs are unaffected');
    assert.ok(!(await inbox()).some(m => m.message.endsWith('rl-over')));
  });

  test('concurrent posts from one IP: exactly five get in', async () => {
    const ip = newIp();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post(valid('burst ' + i), ip)));
    const codes = rs.map(r => r.status);
    assert.equal(codes.filter(c => c === 202).length, 5, codes.join(','));
    assert.equal(codes.filter(c => c === 429).length, 15);
    assert.equal((await inbox()).filter(m => m.message.includes('burst ')).length, 5);
  });

  test('inbox returns at most the latest 200, newest first', async () => {
    const reqs = [];
    for (let v = 0; v < 42; v++) {
      const ip = newIp();
      for (let i = 0; i < 5; i++) reqs.push(post(valid(`bulk ${v}-${i}`), ip));
    }
    assert.ok((await Promise.all(reqs)).every(r => r.status === 202));
    const list = await inbox();
    assert.equal(list.length, 200);
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].id > list[i].id);
  });

  test('API responses carry the security headers', async () => {
    const r = await fetch(BASE + '/api/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(r.headers.get('content-security-policy'));
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
});

test('production bundle: Pages can compile the functions', () => {
  const out = mkdtempSync(join(tmpdir(), 'portfolio-fn-build-'));
  try { run('pages', 'functions', 'build', 'functions', '--outdir', out); }
  finally { rmSync(out, { recursive: true, force: true }); }
});
