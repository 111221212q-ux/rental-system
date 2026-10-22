/**
 * MongoDB Atlas → Sealos。默认只读预检，源库始终只读。
 *
 * PowerShell：连接串只放环境变量，不写入代码。
 *   $env:SRC='<Atlas URI>'
 *   $env:DST='<Sealos URI>'
 *   node migrate-db.js           # 只读预检
 *   node migrate-db.js --apply   # 先备份，再导入完全空的新目标库
 *   node migrate-db.js --verify  # 只读核对两端数据和索引
 *
 * SRC_DB / DST_DB 默认 rental-system；BACKUP_DIR 默认 ./backups。
 * 迁移前必须暂停网站写入。拒绝覆盖目标，不执行任何删除。
 * 失败时保留备份和已导入数据；不要直接在部分导入的库上重试。
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient, BSON } = require('mongodb');

function sameEndpoint(src, dst) {
  const hosts = uri => {
    const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i);
    if (!match) throw new Error('连接串必须使用 mongodb:// 或 mongodb+srv://');
    return match[1].toLowerCase().split(',').map(h => h.replace(/:27017$/, '')).sort().join(',');
  };
  return hosts(src) === hosts(dst);
}

function safeError(error, uris) {
  let message = error.message || String(error);
  for (const uri of uris.filter(Boolean)) {
    const credentials = uri.match(/^mongodb(?:\+srv)?:\/\/([^@/]+)@/i)?.[1];
    message = message.split(uri).join('[连接串已隐藏]');
    for (const value of credentials?.split(':') || []) {
      let decoded = value;
      try { decoded = decodeURIComponent(value); } catch {}
      for (const secret of [value, decoded]) {
        if (secret) message = message.split(secret).join('[已隐藏]');
      }
    }
  }
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s'"`]+/gi, '[连接串已隐藏]');
}

function normalizedIndexes(indexes) {
  return indexes.map(index => Object.fromEntries(Object.entries(index)
    .filter(([key]) => !['v', 'ns', 'background'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function indexDigest(indexes) {
  return BSON.EJSON.stringify(normalizedIndexes(indexes), { relaxed: false });
}

async function collections(db) {
  const list = (await db.listCollections().toArray()).filter(c => !c.name.startsWith('system.'));
  for (const c of list) {
    if (c.type !== 'collection') throw new Error(`不支持迁移特殊集合：${c.name} (${c.type})`);
    if (c.options?.timeseries || c.options?.capped || c.options?.clusteredIndex || c.options?.encryptedFields) {
      throw new Error(`不支持迁移带特殊存储选项的集合：${c.name}`);
    }
    if (/[\\/\0]/.test(c.name) || c.name === '.' || c.name === '..') {
      throw new Error('集合名称不适合用于备份文件');
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

async function inspect(db, backupPath) {
  const result = [];
  for (const c of await collections(db)) {
    const collection = db.collection(c.name);
    const indexes = await collection.listIndexes().toArray();
    const digest = crypto.createHash('sha256');
    let count = 0;
    const file = backupPath ? await fs.open(path.join(backupPath, c.name + '.bson'), 'wx', 0o600) : null;
    const cursor = collection.find({}).sort({ _id: 1 });
    try {
      for await (const doc of cursor) {
        const bytes = BSON.serialize(doc);
        digest.update(bytes);
        if (file) await file.writeFile(bytes);
        count++;
      }
    } finally {
      await cursor.close();
      if (file) await file.close();
    }
    const entry = { name: c.name, count, sha256: digest.digest('hex'), options: c.options || {}, indexes };
    result.push(entry);
    if (backupPath) await fs.writeFile(path.join(backupPath, c.name + '.metadata.json'),
      BSON.EJSON.stringify({ options: entry.options, indexes }, { relaxed: false }), { flag: 'wx', mode: 0o600 });
  }
  return result;
}

function compare(expected, actual, label) {
  if (expected.length !== actual.length) throw new Error(`${label}集合数量不一致`);
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i], b = actual[i];
    if (a.name !== b.name || a.count !== b.count || a.sha256 !== b.sha256) {
      throw new Error(`${label}内容或条数不一致：${a.name}`);
    }
    if (indexDigest(a.indexes) !== indexDigest(b.indexes)) throw new Error(`${label}索引不一致：${a.name}`);
    if (BSON.EJSON.stringify(a.options) !== BSON.EJSON.stringify(b.options)) {
      throw new Error(`${label}集合选项不一致：${a.name}`);
    }
  }
}

async function* readBackup(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const stat = await file.stat();
    let offset = 0;
    while (offset < stat.size) {
      const header = Buffer.alloc(4);
      const { bytesRead } = await file.read(header, 0, 4, offset);
      if (bytesRead !== 4) throw new Error('BSON 备份文件截断');
      const size = header.readInt32LE(0);
      if (size < 5 || size > 16 * 1024 * 1024 || offset + size > stat.size) {
        throw new Error('BSON 备份文档长度无效');
      }
      const bytes = Buffer.alloc(size);
      let read = 0;
      while (read < size) {
        const part = await file.read(bytes, read, size - read, offset + read);
        if (!part.bytesRead) throw new Error('BSON 备份文件截断');
        read += part.bytesRead;
      }
      offset += size;
      yield BSON.deserialize(bytes, { promoteValues: false });
    }
  } finally {
    await file.close();
  }
}

async function migrate(config, dependencies = {}) {
  const Client = dependencies.MongoClient || MongoClient;
  const log = dependencies.log || console.log;
  const { src, dst, srcDb = 'rental-system', dstDb = 'rental-system', apply = false, verify = false,
    backupDir = path.join(__dirname, 'backups'), batchSize = 250 } = config;
  if (!src || !dst) throw new Error('请先设置 SRC 和 DST 环境变量');
  if (apply && verify) throw new Error('--apply 与 --verify 不能同时使用');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('批量大小必须是正整数');
  if (/[\\/\0]/.test(srcDb) || srcDb === '.' || srcDb === '..') throw new Error('源数据库名称无效');
  if (sameEndpoint(src, dst) && srcDb === dstDb) throw new Error('源和目标不能是同一个数据库');
  const options = { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000, promoteValues: false };
  const clients = [];
  let backupPath;
  try {
    const source = new Client(src, options); clients.push(source);
    const target = new Client(dst, options); clients.push(target);
    await source.connect();
    await target.connect();
    const sourceDb = source.db(srcDb), targetDb = target.db(dstDb);
    if (!verify && (await targetDb.listCollections().toArray()).some(c => !c.name.startsWith('system.'))) {
      throw new Error('目标库已有集合。为避免覆盖，请使用完全空的新数据库；脚本不会清空目标');
    }
    if (apply) {
      await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
      const runDir = await fs.mkdtemp(path.join(backupDir, 'migration-'));
      backupPath = path.join(runDir, srcDb);
      await fs.mkdir(backupPath, { mode: 0o700 });
      log('源库备份目录：' + runDir);
    }
    const snapshot = await inspect(sourceDb, backupPath);
    if (snapshot.reduce((sum, c) => sum + c.count, 0) === 0) throw new Error('源库没有业务数据，停止迁移');
    for (const c of snapshot) log(`${c.name}: ${c.count} 条，${c.indexes.length} 个索引，SHA256 ${c.sha256}`);
    if (verify) {
      compare(snapshot, await inspect(targetDb), '目标库');
      compare(snapshot, await inspect(sourceDb), '源库复核');
      log('验证通过：两端全部集合的内容、条数和索引一致');
      return { mode: 'verify', collections: snapshot };
    }
    if (!apply) {
      log('只读预检通过，尚未写入目标。暂停网站写入后使用 --apply 执行迁移');
      return { mode: 'dry-run', collections: snapshot };
    }
    await fs.writeFile(path.join(path.dirname(backupPath), 'manifest.json'),
      BSON.EJSON.stringify({ createdAt: new Date(), srcDb, dstDb, collections: snapshot }, { relaxed: false }),
      { flag: 'wx', mode: 0o600 });
    compare(snapshot, await inspect(sourceDb), '备份后的源库');
    // 备份和复核可能耗时，写入前再次确认目标没有被网站初始化。
    if ((await targetDb.listCollections().toArray()).some(c => !c.name.startsWith('system.'))) {
      throw new Error('预检后目标库出现了集合，停止写入');
    }
    for (const c of snapshot) {
      await targetDb.createCollection(c.name, c.options);
      const targetCollection = targetDb.collection(c.name);
      let batch = [];
      for await (const doc of readBackup(path.join(backupPath, c.name + '.bson'))) {
        batch.push(doc);
        if (batch.length >= batchSize) { await targetCollection.insertMany(batch, { ordered: true }); batch = []; }
      }
      if (batch.length) await targetCollection.insertMany(batch, { ordered: true });
      for (const index of normalizedIndexes(c.indexes).filter(i => i.name !== '_id_')) {
        const { key, ...indexOptions } = index;
        await targetCollection.createIndex(key, indexOptions);
      }
      log(`已导入 ${c.name}: ${c.count} 条`);
    }
    compare(snapshot, await inspect(targetDb), '目标库');
    compare(snapshot, await inspect(sourceDb), '迁移后的源库');
    log('迁移验证通过。保留原库和备份，再切换网站至目标库的内网地址');
    return { mode: 'apply', collections: snapshot, backupPath };
  } catch (error) {
    if (backupPath) log('备份和部分导入数据已保留；请先排查，不要直接重试 --apply');
    throw error;
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const src = process.env.SRC, dst = process.env.DST;
  if (args.some(a => !['--apply', '--verify', '--dry-run'].includes(a)) ||
      new Set(args).size !== args.length || args.length > 1) {
    console.error('用法：node migrate-db.js [--dry-run | --apply | --verify]');
    process.exitCode = 1;
  } else {
    migrate({ src, dst, srcDb: process.env.SRC_DB, dstDb: process.env.DST_DB,
      backupDir: process.env.BACKUP_DIR, apply: args.includes('--apply'), verify: args.includes('--verify') })
      .catch(error => { console.error('迁移停止：' + safeError(error, [src, dst])); process.exitCode = 1; });
  }
}

module.exports = { migrate, readBackup, safeError };
