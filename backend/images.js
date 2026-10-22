const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');

const imageName = /^[a-f0-9]{64}\.webp$/;
const imageURL = /^\/uploads\/([a-f0-9]{64}\.webp)$/;
const maxInputBytes = 8 * 1024 * 1024;
const maxStoredBytes = 100 * 1024 * 1024;
const reject = (status, message) => Object.assign(new Error(message), { status });
sharp.cache(false);
sharp.concurrency(1);

function imageDirectory(store) { return path.join(path.dirname(store.filename), 'uploads'); }
function localImageName(url) { return typeof url === 'string' ? imageURL.exec(url)?.[1] : undefined; }
function imageFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(n => imageName.test(n)).map(name => ({ name, stat: fs.lstatSync(path.join(directory, name)) })).filter(f => f.stat.isFile());
}
function referencedImages(db) {
  return [...new Set(db.prepare('SELECT image FROM items').all().map(i => localImageName(i.image)).filter(Boolean))];
}
function requireImage(directory, name) {
  const filename = path.join(directory, name);
  if (!imageName.test(name) || !fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) throw reject(400, '图片不存在，请重新上传');
  return filename;
}
function createImageUpload(store, { quota = maxStoredBytes } = {}) {
  const directory = imageDirectory(store);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxInputBytes, files: 1, fields: 0, parts: 2, headerPairs: 50 },
    fileFilter: (_, file, cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype)) }).single('image');
  let busy = false;
  return async (req, res, next) => {
    if (busy) return next(reject(429, '图片正在处理中，请稍后再试'));
    busy = true;
    try {
      await new Promise((resolve, fail) => parse(req, res, error => error ? fail(error) : resolve()));
      if (!req.file) throw reject(400, '请选择 JPG、PNG 或 WebP 图片');
      const input = req.file.buffer;
      const signature = input.subarray(0, 12);
      if (!(signature.subarray(0,3).equals(Buffer.from([255,216,255])) || signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (signature.toString('ascii',0,4) === 'RIFF' && signature.toString('ascii',8,12) === 'WEBP'))) throw reject(400, '文件不是有效图片');
      let result;
      try {
        const image = sharp(input, { limitInputPixels: 16000000, limitInputChannels: 4, failOn: 'warning' });
        const meta = await image.metadata();
        if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('unsupported');
        result = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 3 }).toBuffer({ resolveWithObject: true });
      } catch { throw reject(400, '图片损坏、格式不支持或像素超过1600万，请换一张图片'); }
      if (result.data.length > 1024 * 1024) throw reject(400, '图片内容过大，请缩小图片后重试');
      const name = crypto.createHash('sha256').update(result.data).digest('hex') + '.webp';
      const filename = path.join(directory, name);
      if (!fs.existsSync(filename)) {
        const used = imageFiles(directory).reduce((sum, f) => sum + f.stat.size, 0);
        if (used + result.data.length > quota) throw reject(507, '图片存储空间已满，请联系管理员整理图片或扩容');
        const disk = fs.statfsSync(directory);
        if (disk.bavail * disk.bsize < result.data.length * 8 + 16 * 1024 * 1024) throw reject(507, '服务器磁盘空间不足，请联系管理员');
        const partial = filename + '.' + crypto.randomUUID() + '.partial';
        try { fs.writeFileSync(partial, result.data, { mode: 0o600, flag: 'wx' }); fs.renameSync(partial, filename); }
        finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
      }
      res.status(201).json({ url: '/uploads/' + name, width: result.info.width, height: result.info.height, bytes: result.data.length });
    } catch (error) {
      if (error instanceof multer.MulterError) next(reject(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过8 MB' : '每次请选择一张图片上传'));
      else next(error.status ? error : reject(500, '图片上传失败，请稍后重试'));
    } finally { busy = false; }
  };
}

module.exports = { createImageUpload, imageDirectory, localImageName, imageName, referencedImages, requireImage };
