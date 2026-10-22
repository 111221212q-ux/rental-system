const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { imageDirectory, referencedImages, requireImage, imageName } = require('./images');

function removeImageBackup(directory) {
  // Only remove flat, generated image backup directories; never follow a directory symlink.
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('图片备份目录无效');
  const files = fs.readdirSync(directory, { withFileTypes: true });
  if (files.some(f => !f.isFile() || !imageName.test(f.name))) throw new Error('图片备份目录内容无效');
  for (const file of files) fs.unlinkSync(path.join(directory, file.name));
  fs.rmdirSync(directory);
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin','superadmin')),
 active INTEGER NOT NULL DEFAULT 1, firstRental INTEGER NOT NULL DEFAULT 1,
 emailVerified INTEGER NOT NULL DEFAULT 0, passwordVersion INTEGER NOT NULL DEFAULT 0,
 nickname TEXT NOT NULL DEFAULT '', wechat TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 department TEXT NOT NULL DEFAULT '', isTest INTEGER NOT NULL DEFAULT 0,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL COLLATE NOCASE UNIQUE,
 category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 totalStock INTEGER NOT NULL CHECK(totalStock >= 0),
 availableStock INTEGER NOT NULL CHECK(availableStock >= 0 AND availableStock <= totalStock),
 maxRentalDays INTEGER NOT NULL CHECK(maxRentalDays > 0), maxRentalQty INTEGER NOT NULL CHECK(maxRentalQty > 0),
 requireApproval INTEGER NOT NULL DEFAULT 1, value REAL NOT NULL DEFAULT 0 CHECK(value >= 0),
 image TEXT NOT NULL DEFAULT '', datasheetUrl TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('available','low_stock','unavailable')),
 isTest INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rentals (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 itemId TEXT REFERENCES items(id) ON DELETE SET NULL, itemCode TEXT NOT NULL, itemName TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0), startDate TEXT NOT NULL, endDate TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','active','returned','cancelled')),
 reason TEXT NOT NULL DEFAULT '', adminNotes TEXT NOT NULL DEFAULT '',
 approvedBy TEXT REFERENCES users(id) ON DELETE SET NULL, approvedAt TEXT, pickedAt TEXT, actualReturnDate TEXT,
 isTest INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rentals_user_status ON rentals(userId,status);
CREATE INDEX IF NOT EXISTS rentals_item_status ON rentals(itemId,status);
CREATE INDEX IF NOT EXISTS rentals_end_status ON rentals(endDate,status);
CREATE TABLE IF NOT EXISTS comments (
 id TEXT PRIMARY KEY, itemId TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 500), isPinned INTEGER NOT NULL DEFAULT 0,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_item_order ON comments(itemId,isPinned,createdAt);
CREATE TABLE IF NOT EXISTS verification_codes (
 id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL,
 userId TEXT REFERENCES users(id) ON DELETE CASCADE, codeHash TEXT NOT NULL,
 expiresAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
PRAGMA user_version = 1;
`;

const booleans = new Set(['active','firstRental','emailVerified','isTest','requireApproval','isPinned']);
const tables = new Set(['users','items','rentals','comments','verification_codes']);
const normalize = row => row && Object.fromEntries(Object.entries(row).map(([k,v]) => [k, booleans.has(k) ? !!v : v]));

class Store {
  constructor(filename = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'rental.sqlite')) {
    this.filename = filename === ':memory:' ? filename : path.resolve(filename);
    if (this.filename !== ':memory:') fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.filename);
    try {
      // Rollback journal works without WAL's shared-memory requirements. Deploy one application instance.
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 1) throw new Error('数据库版本高于当前应用，请恢复兼容版本');
      this.transaction(() => this.db.exec(schema));
      this.columns = Object.fromEntries([...tables].map(t => [t, new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name))]));
      if (this.filename !== ':memory:') fs.chmodSync(this.filename, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }

  check(table, fields = []) {
    if (!tables.has(table) || fields.some(f => !this.columns[table].has(f))) throw new Error('无效的数据字段');
  }
  all(table) { this.check(table); return this.db.prepare(`SELECT * FROM ${table} ORDER BY createdAt DESC, id`).all().map(normalize); }
  get(table, id) { return this.find(table, 'id', id); }
  find(table, field, value) {
    this.check(table, [field]);
    return normalize(this.db.prepare(`SELECT * FROM ${table} WHERE ${field}=?`).get(value));
  }
  insert(table, data) {
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...data };
    const keys = Object.keys(row); this.check(table, keys);
    this.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map(k => typeof row[k] === 'boolean' ? Number(row[k]) : row[k]));
    return this.get(table, row.id);
  }
  update(table, id, changes) {
    const row = { ...changes, updatedAt: new Date().toISOString() };
    const keys = Object.keys(row); this.check(table, keys);
    if (keys.includes('id')) throw new Error('不能修改数据ID');
    this.db.prepare(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`)
      .run(...keys.map(k => typeof row[k] === 'boolean' ? Number(row[k]) : row[k]), id);
    return this.get(table, id);
  }
  remove(table, id) { this.check(table); return this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('事务内不能等待异步操作');
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  counts() {
    return Object.fromEntries(['users','items','rentals','comments'].map(t => [t, this.db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n]));
  }
  async backup(directory = path.join(path.dirname(this.filename), 'backups'), retention = 7) {
    if (this.backupPromise) return this.backupPromise;
    this.backupPromise = (async () => {
      if (!Number.isInteger(retention) || retention < 1) throw new Error('备份保留数量无效');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const name = `backup-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.sqlite`;
      const destination = path.join(directory, name);
      const partial = destination + '.partial';
      const assets = destination + '.images';
      const partialAssets = assets + '.partial';
      try {
        await backup(this.db, partial);
        fs.chmodSync(partial, 0o600);
        const check = new DatabaseSync(partial, { readOnly: true });
        try {
          if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份完整性验证失败');
          if (check.prepare('PRAGMA foreign_key_check').all().length) throw new Error('备份关联数据验证失败');
          fs.mkdirSync(partialAssets, { mode: 0o700 });
          for (const image of referencedImages(check)) {
            fs.copyFileSync(requireImage(imageDirectory(this), image), path.join(partialAssets, image), fs.constants.COPYFILE_EXCL);
          }
        } finally { check.close(); }
        fs.renameSync(partialAssets, assets);
        fs.renameSync(partial, destination);
      } catch (error) {
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
        for (const dir of [partialAssets, assets]) if (fs.existsSync(dir)) removeImageBackup(dir);
        throw error;
      }
      const names = fs.readdirSync(directory).filter(n => /^backup-\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f\d-]{36}\.sqlite$/.test(n)).sort().reverse();
      for (const old of names.slice(retention)) {
        fs.unlinkSync(path.join(directory, old));
        const oldAssets = path.join(directory, old + '.images');
        if (fs.existsSync(oldAssets)) removeImageBackup(oldAssets);
      }
      return destination;
    })();
    try { return await this.backupPromise; } finally { this.backupPromise = null; }
  }
  close() { this.db.close(); }
}

module.exports = { Store };
