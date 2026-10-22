const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { Store } = require('./storage');

async function main() {
  const fs = require('node:fs');
  const filename = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'rental.sqlite');
  if (!fs.existsSync(filename)) throw new Error('数据库文件不存在，未创建空数据库');
  const store = new Store(filename);
  try { console.log('备份已保存：' + await store.backup(process.env.BACKUP_DIR)); }
  finally { store.close(); }
}

if (require.main === module) main().catch(e => { console.error('备份失败：' + e.message); process.exitCode = 1; });
module.exports = { main };
