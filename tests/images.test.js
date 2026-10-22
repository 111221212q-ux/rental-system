const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const { Store } = require('../backend/storage');
const { createApp, bootstrap } = require('../backend/server');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-images-'));
  let store = new Store(path.join(root, 'rental.sqlite')), server, base;
  async function listen() {
    const app = createApp({ store, jwtSecret: 'image-tests-secret-longer-than-24-chars', rateLimits: false });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = 'http://127.0.0.1:' + server.address().port;
  }
  await bootstrap(store, { INITIAL_ADMIN_PASSWORD: 'image-admin-test' });
  await listen();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function json(method, url, body, token) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  }
  const admin = (await json('POST', '/api/auth/login', { username: 'sa_882f4ca6', password: 'image-admin-test' })).data.token;
  async function upload(buffer, type = 'image/png', token = admin, extra) {
    const form = new FormData(); form.append('image', new Blob([buffer], { type }), '../../evil.html');
    if (extra) form.append(...extra);
    const res = await fetch(base + '/api/uploads/images', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: form });
    return { status: res.status, data: await res.json() };
  }
  const photo = await sharp({ create: { width: 2200, height: 1200, channels: 3, background: '#4968eb' } }).jpeg().withMetadata({ exif: { IFD0: { Artist: 'private-camera-owner' } } }).toBuffer();
  return { root, photo, admin, upload, json, get store() { return store; }, get base() { return base; },
    restart: async () => { await new Promise(resolve => server.close(resolve)); store.close(); store = new Store(path.join(root, 'rental.sqlite')); await listen(); } };
}

test('admin uploads, creates, replaces and removes image; static bytes and login survive restart', async t => {
  const h = await fixture(t);
  const uploaded = await h.upload(h.photo, 'image/jpeg');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.match(uploaded.data.url, /^\/uploads\/[a-f0-9]{64}\.webp$/);
  assert.equal(uploaded.data.width, 1600); assert.ok(uploaded.data.height < 1600);
  const response = await fetch(h.base + uploaded.data.url);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/webp/);
  assert.match(response.headers.get('cache-control'), /immutable/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /img-src[^;]*blob:/, 'local previews must be allowed by CSP');
  const bytes = Buffer.from(await response.arrayBuffer()), metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined); assert.ok(bytes.length < h.photo.length);
  const created = await h.json('POST', '/api/items', { name: '图片测试相机', code: 'IMAGE-CAM', totalStock: 1, image: uploaded.data.url }, h.admin);
  assert.equal(created.status, 201); assert.equal(created.data.item.image, uploaded.data.url);
  await h.restart();
  assert.equal((await h.json('GET', '/api/items')).data[0].image, uploaded.data.url);
  assert.deepEqual(Buffer.from(await (await fetch(h.base + uploaded.data.url)).arrayBuffer()), bytes);
  const replacement = await h.upload(await sharp({ create: { width: 500, height: 300, channels: 4, background: '#23ad7b' } }).png().toBuffer());
  assert.equal(replacement.status, 201);
  const edited = await h.json('PUT', '/api/items/' + created.data.item.id, { image: replacement.data.url }, h.admin);
  assert.equal(edited.data.item.image, replacement.data.url);
  const removed = await h.json('PUT', '/api/items/' + created.data.item.id, { image: '' }, h.admin);
  assert.equal(removed.status, 200); assert.equal(removed.data.item.image, '');
  // Source bytes are immutable and retained; removing an association cannot break old backups.
  assert.equal((await fetch(h.base + uploaded.data.url)).status, 200);
});

test('upload auth precedes parsing; users cannot upload and parser rejects forged, truncated, oversized and extra parts', async t => {
  const h = await fixture(t);
  assert.equal((await h.upload(h.photo, 'image/jpeg', '')).status, 401);
  const student = h.store.insert('users', { username: '2026000000099', email: 'image-student@example.com', password: bcrypt.hashSync('student-test', 4) });
  const token = (await h.json('POST', '/api/auth/login', { username: student.username, password: 'student-test' })).data.token;
  assert.equal((await h.upload(h.photo, 'image/jpeg', token)).status, 403);
  assert.equal((await h.upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/png')).status, 400);
  assert.equal((await h.upload(h.photo.subarray(0, 30), 'image/jpeg')).status, 400);
  assert.equal((await h.upload(h.photo, 'image/svg+xml')).status, 400);
  assert.equal((await h.upload(Buffer.alloc(8 * 1024 * 1024 + 1), 'image/png')).status, 413);
  assert.equal((await h.upload(h.photo, 'image/jpeg', h.admin, ['other', 'unexpected'])).status, 400);
  const huge = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await h.upload(huge)).status, 400);
  assert.deepEqual(fs.readdirSync(path.join(h.root, 'uploads')), []);
  assert.equal((await h.upload(h.photo, 'image/jpeg')).status, 201, 'invalid requests must release processing slot');
});

test('canonical paths hide data, reject traversal and missing images while preserving external URLs', async t => {
  const h = await fixture(t);
  for (const url of ['/uploads/rental.sqlite', '/uploads/initial-admin.txt', '/uploads/%2e%2e%2frental.sqlite', '/uploads/' + 'a'.repeat(64) + '.webp']) {
    const response = await fetch(h.base + url); assert.equal(response.status, 404);
    assert.equal((await response.text()).includes(h.root), false);
  }
  for (const image of ['/uploads/' + 'a'.repeat(64) + '.webp', '//example.com/a.jpg', '/uploads/../x.webp', 'javascript:alert(1)', 'https://host/x"onload="alert(1)']) {
    assert.equal((await h.json('POST', '/api/items', { name: 'invalid', code: 'INVALID', totalStock: 1, image }, h.admin)).status, 400);
  }
  assert.equal((await h.json('POST', '/api/items', { name: 'external', code: 'EXT', totalStock: 1, image: 'https://example.com/a.jpg' }, h.admin)).status, 201);
});

test('quota rejection does not publish partial files, deduplication and concurrent requests stay bounded', async t => {
  const h = await fixture(t);
  const results = await Promise.all([h.upload(h.photo, 'image/jpeg'), h.upload(h.photo, 'image/jpeg')]);
  assert.ok(results.some(r => r.status === 201)); assert.ok(results.every(r => [201, 429].includes(r.status)));
  const first = results.find(r => r.status === 201);
  const again = await h.upload(h.photo, 'image/jpeg'); assert.equal(again.data.url, first.data.url);
  assert.equal(fs.readdirSync(path.join(h.root, 'uploads')).length, 1);
  const quotaFile = path.join(h.root, 'uploads', 'b'.repeat(64) + '.webp');
  fs.writeFileSync(quotaFile, ''); fs.truncateSync(quotaFile, 100 * 1024 * 1024);
  const other = await sharp({ create: { width: 50, height: 50, channels: 3, background: 'red' } }).png().toBuffer();
  const full = await h.upload(other); assert.equal(full.status, 507); assert.match(full.data.error, /空间已满/);
  assert.equal(fs.readdirSync(path.join(h.root, 'uploads')).length, 2);
  assert.equal((await h.upload(h.photo, 'image/jpeg')).status, 201, 'deduplicated uploads remain usable when quota reached');
});

test('backup copies referenced images independently; restore serves exact bytes; retention prunes image pairs', async t => {
  const h = await fixture(t), image = await h.upload(h.photo, 'image/jpeg');
  const name = image.data.url.split('/').pop(), source = path.join(h.root, 'uploads', name);
  const original = fs.readFileSync(source), directory = path.join(h.root, 'backups');
  await h.json('POST', '/api/items', { name: 'with image', code: 'BACKUP', totalStock: 1, image: image.data.url }, h.admin);
  const first = await h.store.backup(directory);
  assert.deepEqual(fs.readFileSync(path.join(first + '.images', name)), original);
  const restoreRoot = path.join(h.root, 'restored'); fs.mkdirSync(restoreRoot);
  fs.copyFileSync(first, path.join(restoreRoot, 'rental.sqlite')); fs.cpSync(first + '.images', path.join(restoreRoot, 'uploads'), { recursive: true });
  fs.unlinkSync(source);
  const restored = new Store(path.join(restoreRoot, 'rental.sqlite'));
  let server;
  try {
    const app = createApp({ store: restored, jwtSecret: 'image-restore-secret-longer-than-24-chars' });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const res = await fetch('http://127.0.0.1:' + server.address().port + image.data.url);
    assert.equal(res.status, 200); assert.deepEqual(Buffer.from(await res.arrayBuffer()), original);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); restored.close(); }
  await assert.rejects(h.store.backup(directory), /图片不存在/);
  assert.deepEqual(fs.readdirSync(directory).sort(), [path.basename(first), path.basename(first) + '.images'].sort(), 'failed copy must preserve previous backup and leave no partial');
  fs.writeFileSync(source, original);
  for (let n = 0; n < 8; n++) await h.store.backup(directory);
  assert.equal(fs.readdirSync(directory).filter(n => n.endsWith('.sqlite')).length, 7);
  assert.equal(fs.readdirSync(directory).filter(n => n.endsWith('.sqlite.images')).length, 7);
  for (const entry of fs.readdirSync(directory).filter(n => n.endsWith('.images'))) assert.deepEqual(fs.readFileSync(path.join(directory, entry, name)), original);
});

test('frontend uploads cannot replace a reopened or cancelled form; local image URL is accepted safely', async () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../frontend/public/app.html'), 'utf8');
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const source = html.slice(html.indexOf('const itemImageStates='), html.indexOf('function showAddItemModal()'));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '', disabled: false, classList: { add() {}, remove() {}, toggle() {} }, removeAttribute() {} });
    return nodes.get(id);
  };
  let release, request, nextBlob = 0; const revoked = [];
  const context = vm.createContext({ document: { getElementById: node, querySelector: node }, URL: { createObjectURL: () => 'blob:' + (++nextBlob), revokeObjectURL: url => revoked.push(url) }, AbortController, FormData: class { append() {} }, API_URL: '/api', gt: () => 'token', toast() {}, enableBtn: btn => { btn.disabled = false; }, escUrl: url => /^https?:\/\//.test(url) ? url : '', fetch: () => request = new Promise(resolve => { release = resolve; }) });
  vm.runInContext(source, context);
  vm.runInContext("resetItemImage('new')", context);
  const old = vm.runInContext("uploadItemImage('new',{type:'image/png',size:100})", context);
  assert.equal(node('new-item-image-file').disabled, true);
  vm.runInContext("cancelItemImage('new');resetItemImage('new','https://example.com/current.jpg')", context);
  release({ ok: true, json: async () => ({ url: '/uploads/' + 'c'.repeat(64) + '.webp', bytes: 100 }) });
  await old;
  assert.equal(node('new-item-image').value, 'https://example.com/current.jpg');
  assert.ok(revoked.includes('blob:1'));
  const urlFn = html.split(/\r?\n/).find(line => line.startsWith('function escUrl('));
  const urls = vm.createContext({ esc: s => s }); vm.runInContext(urlFn, urls);
  assert.equal(vm.runInContext("escUrl('/uploads/'+ 'a'.repeat(64)+'.webp')", urls), '/uploads/' + 'a'.repeat(64) + '.webp');
  assert.equal(vm.runInContext("escUrl('//evil.example/x')", urls), '');
  assert.equal(vm.runInContext("escUrl('https://host/x\" onerror=alert(1)')", urls), '');
});
