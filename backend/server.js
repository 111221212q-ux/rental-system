const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Store } = require('./storage');
const defaultEmailService = require('./services/sms');

const dayMs = 86400000;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, name, max = 500, required = false) {
  if (value === undefined || value === null) { if (required) fail(400, `请填写${name}`); return ''; }
  if (typeof value !== 'string') fail(400, `${name}格式不正确`);
  const s = value.trim();
  if (s.length > max || (required && !s)) fail(400, `${name}长度不正确`);
  return s;
}
function integer(value, name, min = 1, max = 1000000) {
  if (!['string','number'].includes(typeof value) || value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(400, `${name}必须是${min}至${max}之间的整数`);
  return Number(value);
}
function emailAddress(value) {
  const s = text(value, '邮箱', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(400, '邮箱格式不正确');
  return s;
}
function validPassword(value) {
  if (typeof value !== 'string' || value.length < 6 || Buffer.byteLength(value, 'utf8') > 72) fail(400, '密码至少6位，且不超过72字节');
  return value;
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, '日期格式不正确');
  const timestamp = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value) fail(400, '日期无效');
  return value;
}
const stockStatus = (available, total) => available === 0 ? 'unavailable' : available <= total * 0.2 ? 'low_stock' : 'available';
const publicUser = user => {
  const { password, passwordVersion, isTest, ...safe } = user;
  return safe;
};

async function bootstrap(store, env = process.env) {
  if (store.counts().users) return;
  const username = text(env.INITIAL_ADMIN_USERNAME || 'sa_882f4ca6', '管理员用户名', 20, true);
  const password = validPassword(env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url'));
  const hashed = await bcrypt.hash(password, 10);
  if (!env.INITIAL_ADMIN_PASSWORD) {
    if (store.filename === ':memory:') throw new Error('内存数据库首次启动需配置 INITIAL_ADMIN_PASSWORD');
    fs.writeFileSync(path.join(path.dirname(store.filename), 'initial-admin.txt'), `用户名：${username}\n密码：${password}\n登录后请修改密码并妥善保管本文件。\n`, { flag: 'wx', mode: 0o600 });
  }
  store.transaction(() => {
    if (!store.counts().users) store.insert('users', { username, email: env.INITIAL_ADMIN_EMAIL || 'admin@rental.local', password: hashed, role: 'superadmin', firstRental: false, nickname: '管理员' });
  });
}

function createApp({ store, jwtSecret = process.env.JWT_SECRET, emailService = defaultEmailService, rateLimits = true } = {}) {
  if (!store) throw new Error('需要 SQLite 存储');
  if (!jwtSecret || jwtSecret.length < 24) throw new Error('JWT_SECRET 必须至少24字符');
  const app = express();
  app.set('trust proxy', 1);
  const origins = ['https://nbbhlsyclkdc.sealosbja.site', 'https://rental.gggffxu.xyz', 'http://localhost:5000', 'http://localhost:3000', ...(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)];
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)) }));
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => {
    req.body ||= {};
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: http:; connect-src 'self'; frame-src 'none'; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.static(path.join(__dirname, '../frontend/public'), { index: false }));
  app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../frontend/public/app.html')));
  if (rateLimits) {
    app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: '请求过于频繁，请15分钟后再试' }, standardHeaders: true, legacyHeaders: false }));
    app.use('/api', rateLimit({ windowMs: 60000, limit: 180, message: { error: '请求过于频繁，请稍后再试' }, standardHeaders: true, legacyHeaders: false }));
  }
  const token = user => jwt.sign({ userId: user.id, version: user.passwordVersion }, jwtSecret, { expiresIn: '7d' });
  function auth(req, res, next) {
    try {
      const bearer = req.get('Authorization');
      if (!bearer?.startsWith('Bearer ')) fail(401, '请先登录');
      const decoded = jwt.verify(bearer.slice(7), jwtSecret);
      const user = store.get('users', decoded.userId);
      if (!user || !user.active || decoded.version !== user.passwordVersion) fail(401, '登录已失效，请重新登录');
      req.user = user; next();
    } catch { res.status(401).json({ error: '登录已失效，请重新登录' }); }
  }
  const admin = (req, _, next) => { if (!['admin','superadmin'].includes(req.user.role)) fail(403, '需要管理员权限'); next(); };
  const superadmin = (req, _, next) => { if (req.user.role !== 'superadmin') fail(403, '需要超级管理员权限'); next(); };
  const find = (table, id, message) => { const row = store.get(table, id); if (!row) fail(404, message); return row; };
  const rentalDTO = row => {
    const user = store.get('users', row.userId);
    return { ...row, startDate: row.startDate + 'T00:00:00+08:00', endDate: row.endDate + 'T23:59:59.999+08:00', userName: user?.username || '未知用户', userNickname: user?.nickname || '', itemId: row.itemId || '' };
  };
  function expireRentals() {
    store.db.prepare("UPDATE rentals SET status='cancelled', updatedAt=? WHERE status='approved' AND endDate < ?").run(new Date().toISOString(), today());
  }
  function setStock(item, availableStock, totalStock = item.totalStock) {
    return store.update('items', item.id, { totalStock, availableStock, status: stockStatus(availableStock, totalStock) });
  }
  const codeId = (email, purpose, userId = '') => crypto.createHash('sha256').update(`${email}|${purpose}|${userId}`).digest('hex');
  const codeHash = code => crypto.createHmac('sha256', jwtSecret).update(code).digest('hex');
  async function sendCode(email, purpose, userId = null) {
    if (!emailService.isConfigured()) fail(400, '邮件服务未配置');
    const id = codeId(email, purpose, userId || '');
    const existing = store.get('verification_codes', id);
    if (existing && Date.now() - Date.parse(existing.createdAt) < 60000) fail(429, '请60秒后重新发送验证码');
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = codeHash(code);
    store.transaction(() => {
      store.remove('verification_codes', id);
      store.insert('verification_codes', { id, email, purpose, userId, codeHash: hash, expiresAt: Date.now() + 600000 });
    });
    let result;
    try { result = await emailService.sendEmail(email, '邮箱验证', `您的验证码为：${code}\n有效期10分钟，请勿泄露。\n——租借系统`); }
    catch { result = { success: false }; }
    if (!result.success) {
      if (store.get('verification_codes', id)?.codeHash === hash) store.remove('verification_codes', id);
      fail(502, '验证码发送失败，请稍后重试');
    }
  }
  function verifyCode(email, purpose, code, userId = null) {
    const entry = store.get('verification_codes', codeId(email, purpose, userId || ''));
    if (!entry || entry.expiresAt <= Date.now()) fail(400, '验证码不存在或已过期，请重新获取');
    if (entry.attempts >= 5) fail(400, '验证码错误次数过多，请重新获取');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || codeHash(code) !== entry.codeHash) {
      store.update('verification_codes', entry.id, { attempts: entry.attempts + 1 }); fail(400, '验证码错误');
    }
    return entry.id;
  }
  app.post('/api/auth/send-reg-code', async (req, res) => {
    const email = emailAddress(req.body.email);
    if (store.find('users', 'email', email)) fail(400, '该邮箱已被注册');
    await sendCode(email, 'register'); res.json({ message: '验证码已发送到您的邮箱' });
  });
  app.post('/api/auth/register', async (req, res) => {
    const username = text(req.body.username, '学号', 20, true);
    if (!/^\d{13}$/.test(username)) fail(400, '学号必须是13位数字');
    const email = emailAddress(req.body.email), password = validPassword(req.body.password);
    const nickname = text(req.body.nickname, '昵称', 50), wechat = text(req.body.wechat, '微信', 100), phone = text(req.body.phone, '手机', 30);
    const configured = emailService.isConfigured();
    if (configured) verifyCode(email, 'register', req.body.verificationCode);
    const hashed = await bcrypt.hash(password, 10);
    const user = store.transaction(() => {
      const id = configured ? verifyCode(email, 'register', req.body.verificationCode) : null;
      const result = store.insert('users', { username, email, password: hashed, nickname, wechat, phone, emailVerified: configured });
      if (id) store.remove('verification_codes', id);
      return result;
    });
    res.status(201).json({ message: '注册成功', token: token(user), user: publicUser(user) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const username = text(req.body.username, '学号', 20, true);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = store.find('users', 'username', username);
    if (!user || !user.active || !await bcrypt.compare(password, user.password)) fail(401, '学号或密码错误');
    const current = store.get('users', user.id);
    if (!current.active || current.password !== user.password) fail(401, '登录已失效，请重新登录');
    res.json({ message: '登录成功', token: token(current), user: publicUser(current) });
  });
  app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
  app.put('/api/auth/profile', auth, (req, res) => {
    const changes = {};
    for (const [key, max] of [['nickname',50],['wechat',100],['phone',30],['department',100]]) if (req.body[key] !== undefined) changes[key] = text(req.body[key], key, max);
    if (req.body.email !== undefined) { changes.email = emailAddress(req.body.email); if (changes.email !== req.user.email) changes.emailVerified = false; }
    const user = store.transaction(() => {
      const updated = store.update('users', req.user.id, changes);
      if (changes.emailVerified === false) for (const code of store.all('verification_codes').filter(c => c.userId === req.user.id)) store.remove('verification_codes', code.id);
      return updated;
    });
    res.json({ message: '资料更新成功', user: publicUser(user) });
  });
  app.put('/api/auth/username', auth, (req, res) => {
    if (typeof req.body.username !== 'string' || !/^\d{13}$/.test(req.body.username)) fail(400, '学号必须是13位数字');
    res.json({ message: '学号修改成功', user: publicUser(store.update('users', req.user.id, { username: req.body.username })) });
  });
  app.put('/api/auth/password', auth, async (req, res) => {
    const password = validPassword(req.body.newPassword);
    if (typeof req.body.currentPassword !== 'string' || !await bcrypt.compare(req.body.currentPassword, req.user.password)) fail(400, '当前密码错误');
    const hashed = await bcrypt.hash(password, 10);
    const user = store.transaction(() => {
      const current = find('users', req.user.id, '用户不存在');
      if (current.password !== req.user.password) fail(409, '密码已修改，请重新登录');
      return store.update('users', current.id, { password: hashed, passwordVersion: current.passwordVersion + 1 });
    });
    res.json({ message: '密码修改成功', token: token(user), user: publicUser(user) });
  });
  app.post('/api/auth/send-verification', auth, async (req, res) => { await sendCode(req.user.email, 'profile', req.user.id); res.json({ message: '验证码已发送到您的邮箱' }); });
  app.post('/api/auth/verify-email', auth, (req, res) => {
    const id = verifyCode(req.user.email, 'profile', req.body.code, req.user.id);
    const user = store.transaction(() => { store.remove('verification_codes', id); return store.update('users', req.user.id, { emailVerified: true }); });
    res.json({ message: '邮箱验证成功', user: publicUser(user) });
  });

  function itemFields(body, existing = null) {
    const row = existing ? { ...existing } : { maxRentalDays: 7, maxRentalQty: 5, requireApproval: true, value: 0, description: '', image: '', datasheetUrl: '', category: '电子产品' };
    for (const [key, max] of [['name',150],['code',50],['category',50],['description',5000],['image',2000],['datasheetUrl',2000]]) {
      if (body[key] !== undefined) row[key] = text(body[key], key, max, ['name','code','category'].includes(key));
    }
    if (!row.name || !row.code) fail(400, '请填写物品名称和编码');
    row.code = row.code.toUpperCase();
    for (const key of ['image','datasheetUrl']) if (row[key]) {
      try { const u = new URL(row[key]); if (!['http:','https:'].includes(u.protocol) || /["'<>\s]/.test(row[key])) throw new Error(); }
      catch { fail(400, '图片或手册链接须为有效的 HTTP/HTTPS 地址'); }
    }
    if (body.totalStock !== undefined || !existing) {
      const total = integer(body.totalStock, '总库存', 0);
      const borrowed = existing ? existing.totalStock - existing.availableStock : 0;
      if (total < borrowed) fail(400, '总库存不能少于已借出或出库数量');
      row.totalStock = total; row.availableStock = total - borrowed;
    }
    for (const key of ['maxRentalDays','maxRentalQty']) if (body[key] !== undefined) row[key] = integer(body[key], key, 1, 3650);
    if (body.requireApproval !== undefined) { if (typeof body.requireApproval !== 'boolean') fail(400, '审核选项必须为布尔值'); row.requireApproval = body.requireApproval; }
    if (body.value !== undefined) { if (!['number','string'].includes(typeof body.value) || !Number.isFinite(Number(body.value)) || Number(body.value) < 0) fail(400, '物品价值无效'); row.value = Number(body.value); }
    row.status = stockStatus(row.availableStock, row.totalStock);
    delete row.id; delete row.createdAt; delete row.updatedAt;
    return row;
  }
  app.get('/api/items', (_, res) => res.json(store.all('items')));
  app.post('/api/items', auth, admin, (req, res) => res.status(201).json({ message: '物品添加成功', item: store.insert('items', itemFields(req.body)) }));
  app.put('/api/items/:id', auth, admin, (req, res) => {
    const item = store.transaction(() => store.update('items', req.params.id, itemFields(req.body, find('items', req.params.id, '物品不存在'))));
    res.json({ message: '物品更新成功', item });
  });
  app.delete('/api/items/:id', auth, admin, (req, res) => {
    store.transaction(() => {
      find('items', req.params.id, '物品不存在');
      if (store.all('rentals').some(r => r.itemId === req.params.id && ['pending','approved','active'].includes(r.status))) fail(400, '该物品存在未结束的租借，无法删除');
      store.remove('items', req.params.id);
    }); res.json({ message: '物品删除成功' });
  });
  app.put('/api/items/:id/stock', auth, admin, (req, res) => {
    const quantity = integer(req.body.quantity, '数量');
    const item = store.transaction(() => {
      const i = find('items', req.params.id, '物品不存在');
      if (req.body.action === 'add') return setStock(i, i.availableStock + quantity, i.totalStock + quantity);
      if (req.body.action !== 'remove') fail(400, '无效的操作类型');
      if (i.availableStock < quantity) fail(400, '可出库库存不足');
      return setStock(i, i.availableStock - quantity);
    }); res.json({ message: '库存更新成功', item });
  });

  app.post('/api/rentals', auth, (req, res) => {
    const startDate = dateOnly(req.body.startDate), endDate = dateOnly(req.body.endDate);
    const quantity = integer(req.body.quantity, '租借数量');
    const reason = text(req.body.reason, '用途', 1000, true);
    if (startDate < today()) fail(400, '开始时间不能早于今天');
    if (endDate <= startDate) fail(400, '结束日须晚于开始日');
    const rental = store.transaction(() => {
      const item = find('items', text(req.body.itemId, '物品ID', 100, true), '物品不存在');
      if (quantity > item.availableStock) fail(400, '库存不足');
      if (quantity > item.maxRentalQty) fail(400, `该物品单人限租 ${item.maxRentalQty} 件`);
      if ((Date.parse(endDate) - Date.parse(startDate)) / dayMs > item.maxRentalDays) fail(400, `租借天数不能超过 ${item.maxRentalDays} 天`);
      if (store.all('rentals').some(r => r.userId === req.user.id && r.itemId === item.id && ['pending','approved'].includes(r.status) && Date.now() - Date.parse(r.createdAt) < 30000)) fail(400, '请勿重复提交申请');
      return store.insert('rentals', { userId: req.user.id, itemId: item.id, itemCode: item.code, itemName: item.name, quantity, startDate, endDate, reason, status: item.requireApproval ? 'pending' : 'approved' });
    }); res.status(201).json({ message: '申请已提交，请等待管理员确认', rental: rentalDTO(rental) });
  });
  app.get('/api/rentals', auth, admin, (_, res) => { expireRentals(); res.json(store.all('rentals').map(rentalDTO)); });
  app.get('/api/rentals/my', auth, (req, res) => { expireRentals(); res.json(store.all('rentals').filter(r => r.userId === req.user.id).map(rentalDTO)); });
  function decide(req, rejected = false) {
    return store.transaction(() => {
      const rental = find('rentals', req.params.id, '申请不存在');
      if (rental.status !== 'pending') fail(409, '该申请已经处理，请刷新页面');
      const status = rejected ? 'rejected' : req.body.status;
      if (!['approved','rejected'].includes(status)) fail(400, '审批状态无效');
      if (status === 'approved' && rental.endDate < today()) fail(400, '申请已过期');
      return store.update('rentals', rental.id, { status, adminNotes: text(req.body.adminNotes, '审批备注', 1000), approvedBy: req.user.id, approvedAt: new Date().toISOString() });
    });
  }
  app.put('/api/rentals/:id/approve', auth, admin, (req, res) => res.json({ message: '申请已处理', rental: rentalDTO(decide(req)) }));
  app.put('/api/rentals/:id/reject', auth, admin, (req, res) => res.json({ message: '申请已拒绝', rental: rentalDTO(decide(req, true)) }));
  app.put('/api/rentals/:id/pickup', auth, admin, (req, res) => {
    expireRentals();
    const rental = store.transaction(() => {
      const r = find('rentals', req.params.id, '租借记录不存在');
      if (r.status !== 'approved') fail(409, '该记录无需领取');
      const item = find('items', r.itemId, '物品不存在');
      if (item.availableStock < r.quantity) fail(400, '库存不足');
      setStock(item, item.availableStock - r.quantity);
      store.update('users', r.userId, { firstRental: false });
      return store.update('rentals', r.id, { status: 'active', pickedAt: new Date().toISOString() });
    }); res.json({ message: '已确认领取', rental: rentalDTO(rental) });
  });
  app.put('/api/rentals/:id/return', auth, admin, (req, res) => {
    const rental = store.transaction(() => {
      const r = find('rentals', req.params.id, '租借记录不存在');
      if (r.status !== 'active') fail(409, '该记录无需归还');
      const item = find('items', r.itemId, '物品不存在');
      if (item.availableStock + r.quantity > item.totalStock) fail(409, '库存记录不一致，请先核对库存');
      setStock(item, item.availableStock + r.quantity);
      return store.update('rentals', r.id, { status: 'returned', actualReturnDate: new Date().toISOString() });
    }); res.json({ message: '归还成功', rental: rentalDTO(rental) });
  });
  app.delete('/api/rentals/:id', auth, admin, (req, res) => {
    store.transaction(() => { const r = find('rentals', req.params.id, '租借记录不存在'); if (r.status === 'active') fail(400, '请先归还物品，再删除租借记录'); store.remove('rentals', r.id); });
    res.json({ message: '已删除' });
  });
  app.post('/api/rentals/:id/urge', auth, admin, async (req, res) => {
    const r = find('rentals', req.params.id, '租借记录不存在');
    if (r.status !== 'active') fail(400, '仅可催还租借中的物品');
    const user = find('users', r.userId, '用户不存在');
    if (!emailService.isConfigured()) fail(400, '邮件服务未配置');
    const result = await emailService.sendEmail(user.email, '租借归还提醒', `${user.username}同学，您租借的「${r.itemName}」请及时联系管理员归还。`);
    if (!result.success) fail(502, '邮件发送失败，请稍后重试');
    res.json({ message: '已通知用户归还', email: '邮件发送成功' });
  });

  app.get('/api/admin/users', auth, admin, (req, res) => {
    const rentals = store.all('rentals');
    res.json(store.all('users').filter(u => req.user.role === 'superadmin' || u.role !== 'superadmin').map(u => {
      const own = rentals.filter(r => r.userId === u.id);
      return { ...publicUser(u), totalRentals: own.length, activeRentals: own.filter(r => ['approved','active'].includes(r.status)).length, pendingRentals: own.filter(r => r.status === 'pending').length, lastRental: own.length ? Math.max(...own.map(r => Date.parse(r.createdAt))) : null };
    }));
  });
  function editableUser(req) {
    const user = find('users', req.params.id, '用户不存在');
    if (user.id === req.user.id || user.role === 'superadmin') fail(400, '不能操作自己或超级管理员');
    return user;
  }
  app.put('/api/admin/users/:id/role', auth, superadmin, (req, res) => {
    const u = editableUser(req);
    if (!['user','admin'].includes(req.body.role)) fail(400, '无效的角色');
    store.update('users', u.id, { role: req.body.role }); res.json({ message: '用户角色已更新', role: req.body.role });
  });
  app.put('/api/admin/users/:id/status', auth, superadmin, (req, res) => {
    const u = editableUser(req); if (typeof req.body.active !== 'boolean') fail(400, '用户状态无效');
    store.update('users', u.id, { active: req.body.active }); res.json({ message: '用户状态已更新', active: req.body.active });
  });
  app.delete('/api/admin/users/:id', auth, superadmin, (req, res) => {
    store.transaction(() => {
      const u = editableUser(req);
      if (store.all('rentals').some(r => r.userId === u.id && r.status === 'active')) fail(400, '该用户仍有借出物品，请先归还');
      store.remove('users', u.id);
    }); res.json({ message: '用户及相关租借、评论已删除' });
  });
  const commentDTO = c => { const u = store.get('users', c.userId); return { ...c, username: u?.username || '未知', nickname: u?.nickname || '', userRole: u?.role || 'user' }; };
  app.get('/api/items/:id/comments', (req, res) => res.json(store.all('comments').filter(c => c.itemId === req.params.id).sort((a,b) => Number(b.isPinned) - Number(a.isPinned) || b.createdAt.localeCompare(a.createdAt)).map(commentDTO)));
  app.post('/api/items/:id/comments', auth, (req, res) => {
    find('items', req.params.id, '物品不存在');
    const comment = store.insert('comments', { itemId: req.params.id, userId: req.user.id, content: text(req.body.content, '评论内容', 500, true) });
    res.status(201).json({ message: '评论成功', comment: commentDTO(comment) });
  });
  app.delete('/api/comments/:id', auth, (req, res) => {
    const c = find('comments', req.params.id, '评论不存在');
    if (c.userId !== req.user.id && !['admin','superadmin'].includes(req.user.role)) fail(403, '无权删除');
    store.remove('comments', c.id); res.json({ message: '评论已删除' });
  });
  app.put('/api/comments/:id/pin', auth, admin, (req, res) => {
    const c = find('comments', req.params.id, '评论不存在'); const updated = store.update('comments', c.id, { isPinned: !c.isPinned });
    res.json({ message: '评论置顶状态已更新', isPinned: updated.isPinned });
  });
  const contact = u => ({ wechat: u?.wechat || '', phone: u?.phone || '', email: u?.email || '', nickname: u?.nickname || '', location: process.env.CONTACT_LOCATION || '15-234' });
  app.get('/api/contact/admin', (_, res) => { const users = store.all('users').filter(u => u.active); res.json(contact(users.find(u => u.role === 'superadmin') || users.find(u => u.role === 'admin'))); });
  app.get('/api/contact/user/:username', (req, res) => { const u = store.find('users','username',req.params.username); if (!u?.active) fail(404,'用户不存在'); res.json(contact(u)); });
  app.get('/api/notifications', auth, (req, res) => {
    expireRentals(); const currentDay = today(), alerts = [];
    for (const r of store.all('rentals').filter(r => r.status === 'active' && (['admin','superadmin'].includes(req.user.role) || r.userId === req.user.id))) {
      const diff = Math.round((Date.parse(r.endDate) - Date.parse(currentDay)) / dayMs), u = store.get('users', r.userId);
      if (diff <= 2) alerts.push({ rentalId: r.id, username: u?.username || '未知', phone: u?.phone || '', wechat: u?.wechat || '', itemName: r.itemName, endDate: r.endDate, type: diff < 0 ? 'overdue' : 'due_soon', ...(diff < 0 ? { daysOverdue: -diff } : { daysLeft: diff }) });
    }
    res.json({ alerts, total: alerts.length, hasOverdue: alerts.some(a => a.type === 'overdue') });
  });
  app.get('/api/sms/status', auth, admin, (_, res) => res.json({ configured: emailService.isConfigured() }));
  app.post('/api/sms/test', auth, admin, async (req, res) => {
    if (!emailService.isConfigured()) fail(400, '邮件服务未配置');
    const result = await emailService.sendEmail(emailAddress(req.body.to), '租借系统测试', '这是一封来自租借系统的测试邮件。');
    if (!result.success) fail(502, '邮件发送失败'); res.json({ success: true, message: '邮件发送成功' });
  });

  app.post('/api/seed/test-users', auth, superadmin, async (_, res) => {
    const password = await bcrypt.hash('test123', 10), data = [];
    store.transaction(() => { for (let n = 1; n <= 3; n++) {
      const username = 'test00' + n;
      if (store.find('users','username',username)) { data.push({ username, status: '已存在' }); continue; }
      store.insert('users', { username, email: username + '@test.invalid', password, nickname: '测试学生' + n, isTest: true });
      data.push({ username, password: 'test123', status: '已创建' });
    } }); res.json({ message: '测试用户已准备', data });
  });
  function seedRentals(overdueOnly = false) {
    const users = store.all('users').filter(u => u.isTest && u.active);
    const items = store.all('items').filter(i => i.availableStock > 0);
    if (!users.length || !items.length) fail(400, '请先生成测试用户并添加有库存的物品');
    let count = 0;
    store.transaction(() => {
      const statuses = overdueOnly ? ['active'] : ['pending','approved','active','returned','rejected','cancelled'];
      for (let n = 0; n < statuses.length; n++) {
        const status = statuses[n], user = users[n % users.length], item = store.get('items', items[n % items.length].id);
        const reason = '测试租借:' + (overdueOnly ? '逾期' : status);
        if (store.all('rentals').some(r => r.isTest && r.reason === reason)) continue;
        if (status === 'active' && item.availableStock === 0) continue;
        const offset = overdueOnly ? -20 : 3;
        const endDate = new Date(Date.parse(today()) + offset * dayMs).toISOString().slice(0,10);
        const startDate = new Date(Date.parse(endDate) - dayMs).toISOString().slice(0,10);
        store.insert('rentals', { userId: user.id, itemId: item.id, itemCode: item.code, itemName: item.name, quantity: 1, status, startDate, endDate, reason, isTest: true, ...(status === 'returned' ? { actualReturnDate: new Date().toISOString() } : {}) });
        if (status === 'active') setStock(item, item.availableStock - 1);
        count++;
      }
    }); return count;
  }
  app.post('/api/seed/test-data', auth, superadmin, (_, res) => res.json({ message: `已创建 ${seedRentals()} 条测试租借` }));
  app.post('/api/seed-overdue', auth, superadmin, (_, res) => res.json({ message: `已创建 ${seedRentals(true)} 条逾期租借` }));
  app.post('/api/seed/clean-test', auth, superadmin, (_, res) => {
    const result = store.transaction(() => {
      const users = store.all('users').filter(u => u.isTest), ids = new Set(users.map(u => u.id));
      const rentals = store.all('rentals').filter(r => r.isTest || ids.has(r.userId));
      for (const r of rentals) { if (r.status === 'active') { const item = find('items', r.itemId, '物品不存在'); setStock(item, item.availableStock + r.quantity); } store.remove('rentals', r.id); }
      for (const u of users) store.remove('users', u.id);
      return { users: users.length, rentals: rentals.length };
    }); res.json({ message: `已删除 ${result.users} 个测试用户和 ${result.rentals} 条测试租借` });
  });
  app.get('/api/health', (_, res) => {
    store.db.prepare('SELECT 1').get();
    res.json({ status: 'ok', storage: 'sqlite', timestamp: new Date().toISOString(), ...store.counts(), emailConfigured: emailService.isConfigured(), backup: app.locals.backupState || { enabled: false, lastSuccess: null } });
  });
  app.use('/api', (_, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const message = error.message || '';
    if (/UNIQUE constraint failed: users\.username/.test(message)) return res.status(400).json({ error: '学号已存在' });
    if (/UNIQUE constraint failed: users\.email/.test(message)) return res.status(400).json({ error: '邮箱已被注册' });
    if (/UNIQUE constraint failed: items\.code/.test(message)) return res.status(400).json({ error: '物品编码已存在' });
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('API error:', error.code || error.name);
    res.status(status).json({ error: status >= 500 ? '服务暂时不可用，请稍后重试' : message });
  });
  return app;
}

async function start(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 24) throw new Error('JWT_SECRET 必须至少24字符');
  const store = new Store(env.SQLITE_PATH);
  try { await bootstrap(store, env); } catch (error) { store.close(); throw error; }
  const app = createApp({ store, jwtSecret: env.JWT_SECRET });
  const backupState = app.locals.backupState = { enabled: true, lastSuccess: null, lastError: null };
  const runBackup = async () => {
    try { await store.backup(env.BACKUP_DIR); backupState.lastSuccess = new Date().toISOString(); backupState.lastError = null; }
    catch (error) { backupState.lastError = '备份失败'; console.error('Automatic backup failed:', error.code || error.name); }
  };
  await runBackup();
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const s = app.listen(Number(env.PORT || 5000), '0.0.0.0', () => { s.off('error', reject); resolve(s); });
      s.once('error', reject);
    });
  } catch (error) { store.close(); throw error; }
  console.log('Server running with SQLite on port ' + server.address().port);
  const timer = setInterval(runBackup, 24 * 60 * 60 * 1000); timer.unref();
  let closing;
  const onSignal = () => close().then(() => process.exit(0)).catch(() => process.exit(1));
  const close = () => closing ||= (async () => {
    clearInterval(timer);
    for (const signal of ['SIGTERM','SIGINT']) process.off(signal, onSignal);
    await new Promise(resolve => server.close(resolve));
    if (store.backupPromise) await store.backupPromise;
    store.close();
  })();
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, onSignal);
  return { app, store, server, close };
}
if (require.main === module) start().catch(error => { console.error('启动失败：' + error.message); process.exitCode = 1; });
module.exports = { createApp, bootstrap, start, today };
