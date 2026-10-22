const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BSON } = require('mongodb');
const { migrate, readBackup, safeError } = require('../migrate-db');

const clone = value => BSON.deserialize(BSON.serialize(value), { promoteValues: false });
const idIndex = { v: 2, name: '_id_', key: { _id: 1 } };
const fixture = () => [
  { name: 'comments', docs: [], indexes: [idIndex] },
  { name: 'users', docs: [
    { _id: new BSON.ObjectId('000000000000000000000001'), username: '学生甲',
      count: new BSON.Long('9007199254740993'), score: new BSON.Decimal128('12.30'),
      createdAt: new Date('2026-10-16T00:00:00Z'), bytes: new BSON.Binary(Buffer.from([0, 1, 255])) },
    { _id: new BSON.ObjectId('000000000000000000000002'), username: '学生乙', active: true },
    { _id: new BSON.ObjectId('000000000000000000000003'), username: '学生丙', active: false },
  ], indexes: [idIndex, { v: 2, name: 'username_1', key: { username: 1 }, unique: true }] },
];

async function harness(t, flags = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rental-migration-test-'));
  // root is always the directory returned by mkdtemp above, never a caller-supplied path.
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = { clients: [], writes: 0, batches: [], logs: [], reads: {}, cursorCloses: 0 };
  function database(entries, isSource) {
    const map = new Map(entries.map(c => [c.name, {
      ...c, docs: c.docs.map(clone), indexes: c.indexes.map(clone), options: c.options || {}, type: c.type || 'collection',
    }]));
    const db = {
      map,
      listCollections() {
        return { toArray: async () => [...map].map(([name, c]) => ({ name, type: c.type, options: c.options })) };
      },
      async createCollection(name, options) {
        assert.equal(isSource, false, 'never write to source');
        state.writes++;
        if (map.has(name)) throw new Error('NamespaceExists');
        map.set(name, { docs: [], indexes: [clone(idIndex)], options, type: 'collection' });
      },
      collection(name) {
        const c = map.get(name);
        return {
          listIndexes: () => ({ toArray: async () => c.indexes.map(clone) }),
          find() {
            if (isSource) {
              const n = state.reads[name] = (state.reads[name] || 0) + 1;
              flags.onSourceRead?.(name, n, c, state);
            }
            const docs = c.docs.map(clone);
            return {
              sort() { docs.sort((a, b) => String(a._id).localeCompare(String(b._id))); return this; },
              async *[Symbol.asyncIterator]() { yield* docs; },
              async close() { state.cursorCloses++; },
            };
          },
          async insertMany(docs) {
            assert.equal(isSource, false, 'never write to source');
            state.writes++;
            state.batches.push(docs.length);
            if (flags.failInsert) throw new Error('simulated write failure');
            c.docs.push(...docs.map(clone));
            if (flags.corruptTarget) c.docs[0].username = '损坏数据';
          },
          async createIndex(key, options) {
            assert.equal(isSource, false, 'never write to source');
            state.writes++;
            c.indexes.push(clone({ v: 2, key, ...options }));
          },
          async deleteMany() { assert.fail('deletion must never be used'); },
        };
      },
    };
    return db;
  }
  const source = database(flags.source || fixture(), true);
  const target = database(flags.target || [], false);
  class Client {
    constructor(uri) { this.source = uri.includes('source'); this.closed = false; state.clients.push(this); }
    async connect() { if (!this.source && flags.failConnect) throw new Error('simulated connect failure'); }
    db() { return this.source ? source : target; }
    async close() { this.closed = true; }
  }
  return {
    root, state, source, target,
    run: (extra = {}) => migrate({ src: 'mongodb://source', dst: 'mongodb://target', backupDir: root,
      batchSize: 2, ...extra }, { MongoClient: Client, log: line => state.logs.push(line) }),
  };
}

test('default preflight reads source without target writes or backup files', async t => {
  const h = await harness(t);
  const result = await h.run();
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.collections.find(c => c.name === 'users').count, 3);
  assert.equal(h.state.writes, 0);
  assert.deepEqual(await fs.readdir(h.root), []);
  assert.ok(h.state.clients.every(c => c.closed));
});

test('apply backs up BSON, copies empty collections and indexes, preserves large numbers', async t => {
  const h = await harness(t);
  const before = BSON.EJSON.stringify(h.source.map.get('users').docs, { relaxed: false });
  const result = await h.run({ apply: true });
  assert.equal(result.mode, 'apply');
  assert.deepEqual(h.state.batches, [2, 1]);
  assert.equal(BSON.EJSON.stringify(h.target.map.get('users').docs, { relaxed: false }), before);
  assert.equal(BSON.EJSON.stringify(h.source.map.get('users').docs, { relaxed: false }), before);
  assert.equal(h.target.map.get('users').indexes.find(i => i.name === 'username_1').unique, true);
  assert.equal(h.target.map.get('comments').docs.length, 0);
  const saved = [];
  for await (const doc of readBackup(path.join(result.backupPath, 'users.bson'))) saved.push(doc);
  assert.equal(BSON.EJSON.stringify(saved, { relaxed: false }), before);
  const manifest = await fs.readFile(path.join(path.dirname(result.backupPath), 'manifest.json'), 'utf8');
  assert.ok(manifest.includes('sha256'));
  assert.ok(!manifest.includes('mongodb://'));
  assert.ok(h.state.clients.every(c => c.closed));
});

test('same source and target is rejected before connecting, even with different credentials', async t => {
  const h = await harness(t);
  await assert.rejects(h.run({ src: 'mongodb://a:secret@SAME:27017', dst: 'mongodb://b:other@same' }), /同一个数据库/);
  assert.equal(h.state.clients.length, 0);
});

test('reordered replica-set hosts do not bypass same-database check', async t => {
  const h = await harness(t);
  await assert.rejects(h.run({ src: 'mongodb://a:27017,b:27017', dst: 'mongodb://b,a' }), /同一个数据库/);
});

test('nonempty target is never overwritten', async t => {
  const target = [{ name: 'important', docs: [{ _id: 'keep', message: '真实业务数据' }], indexes: [idIndex] }];
  const h = await harness(t, { target });
  await assert.rejects(h.run({ apply: true }), /目标库已有集合/);
  assert.equal(h.target.map.get('important').docs[0].message, '真实业务数据');
  assert.equal(h.state.writes, 0);
  assert.deepEqual(await fs.readdir(h.root), []);
});

test('existing empty target collection also stops migration', async t => {
  const h = await harness(t, { target: [{ name: 'users', docs: [], indexes: [idIndex] }] });
  await assert.rejects(h.run({ apply: true }), /目标库已有集合/);
  assert.equal(h.state.writes, 0);
});

test('empty source is rejected without target writes', async t => {
  const h = await harness(t, { source: [] });
  await assert.rejects(h.run({ apply: true }), /源库没有业务数据/);
  assert.equal(h.state.writes, 0);
});

test('source change after backup is detected before any target writes', async t => {
  const h = await harness(t, { onSourceRead: (name, n, c) => {
    if (name === 'users' && n === 2) c.docs[0].username = '迁移期间新增写入';
  } });
  await assert.rejects(h.run({ apply: true }), /备份后的源库内容或条数不一致/);
  assert.equal(h.state.writes, 0);
});

test('source change during import prevents success claim', async t => {
  const h = await harness(t, { onSourceRead: (name, n, c) => {
    if (name === 'users' && n === 3) c.docs[0].username = '导入期间新增写入';
  } });
  await assert.rejects(h.run({ apply: true }), /迁移后的源库内容或条数不一致/);
});

test('target content mismatch is detected even when counts match', async t => {
  const h = await harness(t, { corruptTarget: true });
  await assert.rejects(h.run({ apply: true }), /目标库内容或条数不一致/);
});

test('connect failure closes both clients and does not write', async t => {
  const h = await harness(t, { failConnect: true });
  await assert.rejects(h.run({ apply: true }), /connect failure/);
  assert.equal(h.state.writes, 0);
  assert.ok(h.state.clients.every(c => c.closed));
});

test('insert failure preserves backup and partial target; retry is refused', async t => {
  const h = await harness(t, { failInsert: true });
  await assert.rejects(h.run({ apply: true }), /write failure/);
  const runs = await fs.readdir(h.root);
  assert.equal(runs.length, 1);
  assert.ok((await fs.stat(path.join(h.root, runs[0], 'rental-system', 'users.bson'))).size > 0);
  const writes = h.state.writes;
  await assert.rejects(h.run({ apply: true }), /目标库已有集合/);
  assert.equal(h.state.writes, writes);
  assert.ok(h.state.clients.every(c => c.closed));
});

test('verify compares existing databases without writes and detects missing indexes', async t => {
  const h = await harness(t, { target: fixture() });
  assert.equal((await h.run({ verify: true })).mode, 'verify');
  h.target.map.get('users').indexes.pop();
  await assert.rejects(h.run({ verify: true }), /目标库索引不一致/);
  assert.equal(h.state.writes, 0);
});

test('verify detects extra target collections', async t => {
  const target = [...fixture(), { name: 'extra', docs: [], indexes: [idIndex] }];
  const h = await harness(t, { target });
  await assert.rejects(h.run({ verify: true }), /目标库集合数量不一致/);
  assert.equal(h.state.writes, 0);
});

test('unsupported collections and unsafe backup filenames fail without target writes', async t => {
  for (const entry of [
    { name: 'view', type: 'view' }, { name: '../outside' }, { name: 'capped', options: { capped: true } },
  ]) {
    const h = await harness(t, { source: [{ docs: [{ _id: 'a' }], indexes: [idIndex], ...entry }] });
    await assert.rejects(h.run({ apply: true }), /不支持迁移|不适合用于备份/);
    assert.equal(h.state.writes, 0);
  }
});

test('corrupt or truncated BSON backup is rejected', async t => {
  const h = await harness(t);
  for (const bytes of [Buffer.from([1, 2]), Buffer.from([100, 0, 0, 0, 0]), Buffer.from([0, 0, 0, 0])]) {
    const file = path.join(h.root, 'broken.bson');
    await fs.writeFile(file, bytes);
    await assert.rejects(async () => { for await (const doc of readBackup(file)) void doc; }, /截断|长度无效/);
  }
});

test('error output hides complete URIs and percent-decoded credentials', () => {
  const uri = 'mongodb://private-user:private%40password@host';
  const message = safeError(new Error(uri + ' private-user private@password private%40password'), [uri]);
  assert.ok(!message.includes('private'));
  assert.ok(!message.includes('mongodb://'));
  assert.doesNotThrow(() => safeError(new Error('failure'), ['mongodb://user:%bad@host']));
});

test('missing configuration, conflicting mode and invalid batch size fail before connecting', async t => {
  const h = await harness(t);
  await assert.rejects(h.run({ src: '' }), /SRC 和 DST/);
  await assert.rejects(h.run({ apply: true, verify: true }), /不能同时使用/);
  await assert.rejects(h.run({ batchSize: 0 }), /批量大小/);
  assert.equal(h.state.clients.length, 0);
});

test('CLI refuses missing configuration and unknown flags', () => {
  const env = { ...process.env }; delete env.SRC; delete env.DST;
  const script = path.resolve(__dirname, '../migrate-db.js');
  for (const args of [[], ['--apply', '--dry-run'], ['--force']]) {
    const result = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SRC 和 DST|用法/);
  }
});
