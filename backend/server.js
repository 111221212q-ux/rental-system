const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

let mongoose, User, Item, Rental, Comment;
let useMongo = false;

// ── JSON File Storage ────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

let users = [
  { id: '1', username: 'admin', email: 'admin@test.com', password: '$2a$10$placeholder', role: 'admin', active: true, phone: '13800138000', department: '信息中心', firstRental: false, wechat: '' },
  { id: '2', username: '20240001', email: '20240001@test.com', password: '$2a$10$placeholder', role: 'user', active: true, phone: '13800138001', department: '计算机学院', firstRental: true, wechat: '' },
  { id: '3', username: '20240002', email: '20240002@test.com', password: '$2a$10$placeholder', role: 'user', active: true, phone: '13800138002', department: '电子工程学院', firstRental: false, wechat: '' },
  { id: '4', username: '20240003', email: '20240003@test.com', password: '$2a$10$placeholder', role: 'user', active: true, phone: '13800138003', department: '管理学院', firstRental: true, wechat: '' },
  { id: '5', username: 'superadmin', email: 'superadmin@test.com', password: '$2a$10$placeholder', role: 'superadmin', active: true, phone: '13800138099', department: '信息中心', firstRental: false, wechat: '' },
];
let nextUserId = 6;

let items = [
  { id: '1', name: '笔记本电脑 Pro', code: 'LP001', category: '电子产品', description: '高性能笔记本电脑，适合办公和学习', totalStock: 10, availableStock: 8, maxRentalDays: 7, maxRentalQty: 1, requireApproval: true, value: 5000, status: 'available' },
  { id: '2', name: '办公椅', code: 'OC002', category: '办公用品', description: '人体工学办公椅', totalStock: 5, availableStock: 3, maxRentalDays: 3, maxRentalQty: 2, requireApproval: false, value: 500, status: 'available' },
  { id: '3', name: '投影仪', code: 'PJ003', category: '电子产品', description: '高清投影仪，适合会议和演示', totalStock: 3, availableStock: 1, maxRentalDays: 1, maxRentalQty: 1, requireApproval: true, value: 3000, status: 'available' },
  { id: '4', name: 'iPad Pro', code: 'IP004', category: '电子产品', description: '平板电脑，适合移动办公', totalStock: 5, availableStock: 4, maxRentalDays: 3, maxRentalQty: 1, requireApproval: true, value: 4000, status: 'available' },
  { id: '5', name: '移动电源', code: 'PB005', category: '电子产品', description: '10000mAh大容量移动电源', totalStock: 20, availableStock: 15, maxRentalDays: 1, maxRentalQty: 3, requireApproval: false, value: 200, status: 'available' },
  { id: '6', name: '会议桌', code: 'MT006', category: '办公用品', description: '可折叠会议桌，适合小型会议', totalStock: 2, availableStock: 0, maxRentalDays: 1, maxRentalQty: 1, requireApproval: true, value: 800, status: 'unavailable' },
];

let rentals = [
  { id: '1', userId: '2', itemId: '1', itemCode: 'LP001', itemName: '笔记本电脑 Pro', quantity: 1, startDate: '2024-05-20', endDate: '2024-05-22', status: 'approved', approvedBy: '1', approvedAt: '2024-05-19', createdAt: '2024-05-19', reason: '课程设计' },
  { id: '2', userId: '3', itemId: '3', itemCode: 'PJ003', itemName: '投影仪', quantity: 1, startDate: '2024-05-21', endDate: '2024-05-21', status: 'pending', createdAt: '2024-05-20', reason: '会议演示' },
];
let nextRentalId = 3;

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ users, items, rentals, nextUserId, nextRentalId }, null, 2), 'utf8'); }
  catch (err) { console.error('Save error:', err.message); }
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (d.users) users = d.users;
      if (d.items) items = d.items;
      if (d.rentals) rentals = d.rentals;
      if (d.nextUserId) nextUserId = d.nextUserId;
      if (d.nextRentalId) nextRentalId = d.nextRentalId;
      console.log('Loaded from file:', users.length, 'users,', items.length, 'items,', rentals.length, 'rentals');
    }
  } catch (err) { console.error('Load error:', err.message); }
}

// ── Try MongoDB ──────────────────────────────────────────
async function tryMongo() {
  try {
    mongoose = require('mongoose');
    User = require('./models/User');
    Item = require('./models/Item');
    Rental = require('./models/Rental');
    Comment = require('./models/Comment');
    const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://111221212q_db_user:njh.6f%40PNSL%21gYx@cluster0.jqph8ma.mongodb.net/rental-system?appName=Cluster0';
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 15000 });
    useMongo = true;
    console.log('Using MongoDB');

    // Only seed when database is completely empty (first deploy)
    const userCount = await User.countDocuments();
    const itemCount = await Item.countDocuments();
    if (userCount === 0 && itemCount === 0) {
      console.log('Seeding MongoDB...');
      const hp = await bcrypt.hash('admin123', 10);
      const huser = await bcrypt.hash('123456', 10);
      const hsuper = await bcrypt.hash('super123', 10);
      const u = await User.insertMany([
        { username: 'admin', email: 'admin@test.com', password: hp, role: 'admin', phone: '13800138000', department: '信息中心', firstRental: false },
        { username: '20240001', email: '20240001@test.com', password: huser, role: 'user', phone: '13800138001', department: '计算机学院', firstRental: true },
        { username: '20240002', email: '20240002@test.com', password: huser, role: 'user', phone: '13800138002', department: '电子工程学院', firstRental: false },
        { username: '20240003', email: '20240003@test.com', password: huser, role: 'user', phone: '13800138003', department: '管理学院', firstRental: true },
        { username: 'superadmin', email: 'superadmin@test.com', password: hsuper, role: 'superadmin', phone: '13800138099', department: '信息中心', firstRental: false },
      ]);
      const it = await Item.insertMany([
        { name: '笔记本电脑 Pro', code: 'LP001', category: '电子产品', description: '高性能笔记本电脑，适合办公和学习', stock: 10, available: 8, maxRentalDays: 7, maxRentalQty: 1, requiresApproval: true, value: 5000, status: 'available', dailyRate: 0 },
        { name: '办公椅', code: 'OC002', category: '办公用品', description: '人体工学办公椅', stock: 5, available: 3, maxRentalDays: 3, maxRentalQty: 2, requiresApproval: false, value: 500, status: 'available', dailyRate: 0 },
        { name: '投影仪', code: 'PJ003', category: '电子产品', description: '高清投影仪，适合会议和演示', stock: 3, available: 1, maxRentalDays: 1, maxRentalQty: 1, requiresApproval: true, value: 3000, status: 'available', dailyRate: 0 },
        { name: 'iPad Pro', code: 'IP004', category: '电子产品', description: '平板电脑，适合移动办公', stock: 5, available: 4, maxRentalDays: 3, maxRentalQty: 1, requiresApproval: true, value: 4000, status: 'available', dailyRate: 0 },
        { name: '移动电源', code: 'PB005', category: '电子产品', description: '10000mAh大容量移动电源', stock: 20, available: 15, maxRentalDays: 1, maxRentalQty: 3, requiresApproval: false, value: 200, status: 'available', dailyRate: 0 },
        { name: '会议桌', code: 'MT006', category: '办公用品', description: '可折叠会议桌，适合小型会议', stock: 2, available: 0, maxRentalDays: 1, maxRentalQty: 1, requiresApproval: true, value: 800, status: 'unavailable', dailyRate: 0 },
      ]);
      await Rental.insertMany([
        { item: it[0]._id, user: u[1]._id, quantity: 1, startDate: new Date('2024-05-20'), endDate: new Date('2024-05-22'), status: 'approved', approvedBy: u[0]._id, approvedAt: new Date('2024-05-19'), notes: '课程设计' },
        { item: it[2]._id, user: u[2]._id, quantity: 1, startDate: new Date('2024-05-21'), endDate: new Date('2024-05-21'), status: 'pending', notes: '会议演示' },
      ]);
      console.log('Seed complete');
    }
    return true;
  } catch (e) {
    console.log('MongoDB not available (' + e.message + '), using JSON file storage');
    return false;
  }
}

// ── Mongo serializers ────────────────────────────────────
function sItemM(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return { id: o._id.toString(), name: o.name, code: o.code, category: o.category, description: o.description || '', totalStock: o.stock, availableStock: o.available, maxRentalDays: o.maxRentalDays, maxRentalQty: o.maxRentalQty || 5, requireApproval: o.requiresApproval, value: o.value || 0, image: o.image || '', datasheetUrl: o.datasheetUrl || '', status: o.status };
}

function sUserM(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return { id: o._id.toString(), username: o.username, email: o.email, role: o.role, phone: o.phone || '', department: o.department || '', wechat: o.wechat || '', active: o.active !== false, firstRental: o.firstRental !== false };
}

function isValidObjectId(id) {
  return mongoose?.Types?.ObjectId?.isValid(id);
}

async function sRentalM(r) {
  const user = r.user?.username ? r.user : await User.findById(r.user).lean();
  const item = r.item?.name ? r.item : await Item.findById(r.item).lean();
  return { id: r._id.toString(), userId: (r.user?._id || r.user).toString(), itemId: (r.item?._id || r.item).toString(), itemCode: item?.code || '', itemName: item?.name || '', userName: user?.username || '未知用户', quantity: r.quantity, startDate: r.startDate, endDate: r.endDate, status: r.status, reason: r.notes || '', approvedBy: r.approvedBy?.toString(), approvedAt: r.approvedAt, actualReturnDate: r.returnDate, createdAt: r.createdAt };
}

// ── Express ──────────────────────────────────────────────
const app = express();
app.use(cors({ origin: (_, cb) => cb(null, true) }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public'), { index: false }));

app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../frontend/public/app.html')));

// ── Auth Middleware ───────────────────────────────────────
function auth(req, res, next) {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No authentication token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    if (useMongo) {
      User.findById(decoded.userId).lean().then(user => {
        if (!user || !user.active) return res.status(401).json({ error: 'User not found or inactive' });
        req.user = user;
        next();
      }).catch(() => res.status(401).json({ error: 'Invalid authentication token' }));
    } else {
      const user = users.find(u => u.id === decoded.userId);
      if (!user || !user.active) return res.status(401).json({ error: 'User not found or inactive' });
      req.user = { ...user, _id: { toString: () => user.id } };
      next();
    }
  } catch (e) { res.status(401).json({ error: 'Invalid authentication token' }); }
}

function admin(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
  res.status(403).json({ error: '需要管理员权限' });
}

function superadmin(req, res, next) {
  if (req.user.role === 'superadmin') return next();
  res.status(403).json({ error: '需要超级管理员权限' });
}

// ── Auth Routes ──────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, wechat, phone } = req.body;
    if (!username || !password || password.length < 6)
      return res.status(400).json({ error: '学号和密码不能为空，密码至少6位' });

    if (useMongo) {
      const exists = await User.findOne({ username });
      if (exists) return res.status(400).json({ error: '学号已存在' });
      const hashed = await bcrypt.hash(password, 10);
      const user = await new User({ username, email: `${username}@test.com`, password: hashed, role: 'user', active: true, wechat: wechat || '', phone: phone || '', firstRental: true }).save();
      const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET || 'your-secret-key');
      return res.status(201).json({ message: '注册成功', token, user: { id: user._id.toString(), username: user.username, email: user.email, role: user.role } });
    } else {
      if (users.find(u => u.username === username)) return res.status(400).json({ error: '学号已存在' });
      const hashed = await bcrypt.hash(password, 10);
      const newUser = { id: String(nextUserId++), username, email: `${username}@test.com`, password: hashed, role: 'user', active: true, wechat: wechat || '', phone: phone || '', firstRental: true };
      users.push(newUser); saveData();
      const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET || 'your-secret-key');
      return res.status(201).json({ message: '注册成功', token, user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role } });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '学号和密码不能为空' });

    if (useMongo) {
      const user = await User.findOne({ username });
      if (!user) return res.status(401).json({ error: '学号或密码错误' });
      if (!user.active) return res.status(401).json({ error: '账号已被禁用' });
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: '学号或密码错误' });
      const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET || 'your-secret-key');
      return res.json({ message: '登录成功', token, user: { id: user._id.toString(), username: user.username, email: user.email, role: user.role } });
    } else {
      const user = users.find(u => u.username === username);
      if (!user) return res.status(401).json({ error: '学号或密码错误' });
      if (!user.active) return res.status(401).json({ error: '账号已被禁用' });
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        // Fallback: plaintext comparison for old data
        if (password !== user.password) return res.status(401).json({ error: '学号或密码错误' });
        // Upgrade to hash
        user.password = await bcrypt.hash(password, 10);
        saveData();
      }
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'your-secret-key');
      return res.json({ message: '登录成功', token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, (req, res) => {
  if (useMongo) return res.json({ user: sUserM(req.user) });
  const { password, ...u } = req.user;
  res.json({ user: u });
});

// ── Item Routes ──────────────────────────────────────────
app.get('/api/items', async (_, res) => {
  if (useMongo) { const list = await Item.find().sort({ createdAt: -1 }).lean(); return res.json(list.map(sItemM)); }
  res.json(items);
});

app.post('/api/items', auth, admin, async (req, res) => {
  try {
    const { name, code, category, description, totalStock, maxRentalDays, maxRentalQty, requireApproval, value, image, datasheetUrl } = req.body;
    if (!name || !code || !totalStock) return res.status(400).json({ error: '请填写必要信息：物品名称、编码、总库存' });
    if (useMongo) {
      if (await Item.findOne({ code })) return res.status(400).json({ error: '物品编码已存在' });
      const item = await new Item({ name, code, category: category || '电子产品', description: description || '', stock: parseInt(totalStock), available: parseInt(totalStock), maxRentalDays: parseInt(maxRentalDays) || 7, maxRentalQty: parseInt(maxRentalQty) || 5, requiresApproval: requireApproval || false, value: parseInt(value) || 0, image: image || '', datasheetUrl: datasheetUrl || '', dailyRate: 0 }).save();
      return res.status(201).json({ message: '物品添加成功', item: sItemM(item) });
    } else {
      if (items.find(i => i.code === code)) return res.status(400).json({ error: '物品编码已存在' });
      const newItem = { id: String(items.length + 1), name, code, category: category || '电子产品', description: description || '', totalStock: parseInt(totalStock), availableStock: parseInt(totalStock), maxRentalDays: parseInt(maxRentalDays) || 7, maxRentalQty: parseInt(maxRentalQty) || 5, requireApproval: requireApproval || false, value: parseInt(value) || 0, image: image || '', datasheetUrl: datasheetUrl || '', status: 'available' };
      items.push(newItem); saveData();
      return res.status(201).json({ message: '物品添加成功', item: newItem });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/items/:id', auth, admin, async (req, res) => {
  try {
    const { name, code, category, description, maxRentalDays, maxRentalQty, requireApproval, value, image, datasheetUrl } = req.body;
    if (useMongo) {
      const item = await Item.findById(req.params.id);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      if (code) { const dup = await Item.findOne({ code, _id: { $ne: item._id } }); if (dup) return res.status(400).json({ error: '物品编码已存在' }); item.code = code; }
      if (name) item.name = name;
      if (category) item.category = category;
      if (description) item.description = description;
      if (maxRentalDays) item.maxRentalDays = parseInt(maxRentalDays);
      if (maxRentalQty) item.maxRentalQty = parseInt(maxRentalQty);
      if (typeof requireApproval === 'boolean') item.requiresApproval = requireApproval;
      if (value) item.value = parseInt(value);
      if (image !== undefined) item.image = image;
      if (datasheetUrl !== undefined) item.datasheetUrl = datasheetUrl;
      await item.save();
      return res.json({ message: '物品更新成功', item: sItemM(item) });
    } else {
      const item = items.find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      if (code) { if (items.find(i => i.code === code && i.id !== req.params.id)) return res.status(400).json({ error: '物品编码已存在' }); item.code = code; }
      if (name) item.name = name;
      if (category) item.category = category;
      if (description) item.description = description;
      if (maxRentalDays) item.maxRentalDays = parseInt(maxRentalDays);
      if (maxRentalQty) item.maxRentalQty = parseInt(maxRentalQty);
      if (typeof requireApproval === 'boolean') item.requireApproval = requireApproval;
      if (value) item.value = parseInt(value);
      if (image !== undefined) item.image = image;
      if (datasheetUrl !== undefined) item.datasheetUrl = datasheetUrl;
      item.updatedAt = new Date(); saveData();
      return res.json({ message: '物品更新成功', item });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/items/:id', auth, admin, async (req, res) => {
  try {
    if (useMongo) {
      const item = await Item.findById(req.params.id);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      const has = await Rental.exists({ item: item._id, status: { $in: ['pending', 'approved', 'active'] } });
      if (has) return res.status(400).json({ error: '该物品存在租借记录，无法删除' });
      await Item.findByIdAndDelete(req.params.id);
    } else {
      const idx = items.findIndex(i => i.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: '物品不存在' });
      if (rentals.some(r => r.itemId === req.params.id && ['pending', 'approved', 'active'].includes(r.status)))
        return res.status(400).json({ error: '该物品存在租借记录，无法删除' });
      items.splice(idx, 1); saveData();
    }
    res.json({ message: '物品删除成功' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/items/:id/stock', auth, admin, async (req, res) => {
  try {
    const { action, quantity } = req.body;
    if (useMongo) {
      const item = await Item.findById(req.params.id);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      if (action === 'add') { item.stock += quantity; item.available += quantity; }
      else if (action === 'remove') { if (item.available < quantity) return res.status(400).json({ error: '可出库库存不足' }); item.available -= quantity; }
      else return res.status(400).json({ error: '无效的操作类型' });
      await item.save();
      return res.json({ message: action === 'add' ? `入库成功，增加 ${quantity} 件` : `出库成功，减少 ${quantity} 件`, item: sItemM(item) });
    } else {
      const item = items.find(i => i.id === req.params.id);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      if (action === 'add') { item.totalStock += quantity; item.availableStock += quantity; }
      else if (action === 'remove') { if (item.availableStock < quantity) return res.status(400).json({ error: '可出库库存不足' }); item.availableStock -= quantity; }
      else return res.status(400).json({ error: '无效的操作类型' });
      saveData();
      return res.json({ message: action === 'add' ? `入库成功，增加 ${quantity} 件` : `出库成功，减少 ${quantity} 件`, item });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rental Routes ────────────────────────────────────────
app.post('/api/rentals', auth, async (req, res) => {
  try {
    const { itemId, quantity, startDate, endDate, reason } = req.body;
    if (useMongo) {
      const item = await Item.findById(itemId);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      if (item.available < quantity) return res.status(400).json({ error: '库存不足' });
      const maxQty = item.maxRentalQty || 5;
      if (quantity > maxQty) return res.status(400).json({ error: `该物品单人限租 ${maxQty} 件` });
      // Anti-duplicate: reject if same user+item pending within 30s
      const recent = await Rental.findOne({ user: req.user._id, item: item._id, status: 'pending', createdAt: { $gte: new Date(Date.now() - 30000) } });
      if (recent) return res.status(400).json({ error: '请勿重复提交，您已有该物品的待审核申请' });
      const rental = await new Rental({ item: item._id, user: req.user._id, quantity, startDate: new Date(startDate), endDate: new Date(endDate), status: 'pending', notes: reason }).save();
      const result = await sRentalM(rental);
      return res.status(201).json({ message: '申请提交成功', rental: result });
    } else {
      const item = items.find(i => i.id === itemId);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      if (item.availableStock < quantity) return res.status(400).json({ error: '库存不足' });
      const maxQty = item.maxRentalQty || 5;
      if (quantity > maxQty) return res.status(400).json({ error: `该物品单人限租 ${maxQty} 件` });
      const now = Date.now();
      const recent = rentals.find(r => r.userId === req.user.id && r.itemId === itemId && r.status === 'pending' && (now - new Date(r.createdAt).getTime()) < 30000);
      if (recent) return res.status(400).json({ error: '请勿重复提交，您已有该物品的待审核申请' });
      const newRental = { id: String(nextRentalId++), userId: req.user.id, itemId, itemCode: item.code, itemName: item.name, quantity, startDate: new Date(startDate), endDate: new Date(endDate), reason, status: 'pending', createdAt: new Date() };
      rentals.push(newRental); saveData();
      return res.status(201).json({ message: '申请提交成功', rental: newRental });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rentals', auth, admin, async (req, res) => {
  if (useMongo) {
    const list = await Rental.find().populate('user', 'username').populate('item', 'name code').sort({ createdAt: -1 }).lean();
    const result = await Promise.all(list.map(r => sRentalM(r)));
    return res.json(result);
  }
  const result = rentals.map(r => ({ ...r, userName: users.find(u => u.id === r.userId)?.username || '未知用户' }));
  res.json(result);
});

app.get('/api/rentals/my', auth, async (req, res) => {
  if (useMongo) {
    const list = await Rental.find({ user: req.user._id }).populate('item', 'name code').sort({ createdAt: -1 }).lean();
    const result = list.map(r => ({ id: r._id.toString(), userId: r.user.toString(), itemId: r.item?._id?.toString() || r.item?.toString() || '', itemCode: r.item?.code || '', itemName: r.item?.name || '', userName: req.user.username, quantity: r.quantity, startDate: r.startDate, endDate: r.endDate, status: r.status, reason: r.notes || '', actualReturnDate: r.returnDate, createdAt: r.createdAt }));
    return res.json(result);
  }
  const userRentals = rentals.filter(r => r.userId === req.user.id).map(r => ({ ...r, userName: req.user.username }));
  res.json(userRentals);
});

app.put('/api/rentals/:id/approve', auth, admin, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    if (useMongo) {
      const rental = await Rental.findById(req.params.id);
      if (!rental) return res.status(404).json({ error: '申请不存在' });
      if (status === 'approved') {
        const item = await Item.findById(rental.item);
        if (!item || item.available < rental.quantity) return res.status(400).json({ error: '库存不足，无法批准' });
        item.available -= rental.quantity; await item.save();
        rental.status = 'approved'; rental.approvedBy = req.user._id; rental.approvedAt = new Date(); rental.notes = adminNotes || rental.notes;
      } else if (status === 'rejected') { rental.status = 'rejected'; rental.notes = adminNotes; }
      await rental.save();
      return res.json({ message: `申请已${status === 'approved' ? '批准' : '拒绝'}`, rental: await sRentalM(rental) });
    } else {
      const rental = rentals.find(r => r.id === req.params.id);
      if (!rental) return res.status(404).json({ error: '申请不存在' });
      if (status === 'approved') {
        const item = items.find(i => i.id === rental.itemId);
        if (item && item.availableStock >= rental.quantity) { item.availableStock -= rental.quantity; rental.status = 'approved'; rental.approvedBy = req.user.id; rental.approvedAt = new Date(); rental.adminNotes = adminNotes; }
        else return res.status(400).json({ error: '库存不足，无法批准' });
      } else if (status === 'rejected') { rental.status = 'rejected'; rental.adminNotes = adminNotes; }
      saveData();
      return res.json({ message: `申请已${status === 'approved' ? '批准' : '拒绝'}`, rental });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/rentals/:id/reject', auth, admin, async (req, res) => {
  try {
    const { adminNotes } = req.body;
    if (useMongo) {
      const rental = await Rental.findById(req.params.id);
      if (!rental) return res.status(404).json({ error: '申请不存在' });
      rental.status = 'rejected'; rental.notes = adminNotes; await rental.save();
      return res.json({ message: '申请已拒绝', rental: await sRentalM(rental) });
    } else {
      const rental = rentals.find(r => r.id === req.params.id);
      if (!rental) return res.status(404).json({ error: '申请不存在' });
      rental.status = 'rejected'; rental.adminNotes = adminNotes; saveData();
      return res.json({ message: '申请已拒绝', rental });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/rentals/:id/return', auth, async (req, res) => {
  try {
    if (useMongo) {
      const rental = await Rental.findById(req.params.id);
      if (!rental) return res.status(404).json({ error: '租借记录不存在' });
      if (rental.user.toString() !== req.user._id.toString() && req.user.role !== 'admin' && req.user.role !== 'superadmin')
        return res.status(403).json({ error: '无权操作此租借记录' });
      if (rental.status !== 'approved' && rental.status !== 'active') return res.status(400).json({ error: '该记录无需归还' });
      const item = await Item.findById(rental.item);
      if (item) { item.available += rental.quantity; await item.save(); }
      rental.status = 'returned'; rental.returnDate = new Date(); await rental.save();
      return res.json({ message: '归还成功', rental: await sRentalM(rental) });
    } else {
      const rental = rentals.find(r => r.id === req.params.id);
      if (!rental) return res.status(404).json({ error: '租借记录不存在' });
      if (rental.userId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin')
        return res.status(403).json({ error: '无权操作此租借记录' });
      if (rental.status !== 'approved' && rental.status !== 'active') return res.status(400).json({ error: '该记录无需归还' });
      const item = items.find(i => i.id === rental.itemId);
      if (item) item.availableStock += rental.quantity;
      rental.status = 'returned'; rental.actualReturnDate = new Date(); saveData();
      return res.json({ message: '归还成功', rental });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin Routes ─────────────────────────────────────────
app.get('/api/admin/users', auth, admin, async (req, res) => {
  if (useMongo) {
    const filter = req.user.role === 'superadmin' ? {} : { role: { $ne: 'superadmin' } };
    const list = await User.find(filter).lean();
    const result = await Promise.all(list.map(async u => {
      const r = await Rental.find({ user: u._id }).lean();
      return { id: u._id.toString(), username: u.username, email: u.email || '', role: u.role || 'user', wechat: u.wechat || '', phone: u.phone || '', active: u.active !== false, totalRentals: r.length, activeRentals: r.filter(x => ['approved', 'active'].includes(x.status)).length, pendingRentals: r.filter(x => x.status === 'pending').length, lastRental: r.length > 0 ? Math.max(...r.map(x => new Date(x.createdAt).getTime())) : null };
    }));
    return res.json(result);
  }
  const visibleUsers = req.user.role === 'superadmin' ? users : users.filter(u => u.role !== 'superadmin');
  const result = visibleUsers.map(u => {
    const userRentals = rentals.filter(r => r.userId === u.id);
    return { id: u.id, username: u.username, email: u.email || '', role: u.role || 'user', wechat: u.wechat || '', phone: u.phone || '', active: u.active !== false, totalRentals: userRentals.length, activeRentals: userRentals.filter(r => ['approved', 'active'].includes(r.status)).length, pendingRentals: userRentals.filter(r => r.status === 'pending').length, lastRental: userRentals.length > 0 ? Math.max(...userRentals.map(r => new Date(r.createdAt).getTime())) : null };
  });
  res.json(result);
});

// ── Superadmin: User Management ──────────────────────────
app.put('/api/admin/users/:id/role', auth, superadmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: '无效的角色' });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: '不能修改自己的角色' });

    if (useMongo) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      if (user.role === 'superadmin') return res.status(400).json({ error: '不能修改超级管理员' });
      user.role = role; await user.save();
      return res.json({ message: `用户角色已更新为 ${role === 'admin' ? '管理员' : '普通用户'}`, role });
    } else {
      const user = users.find(u => u.id === req.params.id);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      if (user.role === 'superadmin') return res.status(400).json({ error: '不能修改超级管理员' });
      user.role = role; saveData();
      return res.json({ message: `用户角色已更新为 ${role === 'admin' ? '管理员' : '普通用户'}`, role });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id/status', auth, superadmin, async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') return res.status(400).json({ error: '无效的状态' });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: '不能修改自己的状态' });

    if (useMongo) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      if (user.role === 'superadmin') return res.status(400).json({ error: '不能禁用超级管理员' });
      user.active = active; await user.save();
      return res.json({ message: active ? '账号已启用' : '账号已禁用', active });
    } else {
      const user = users.find(u => u.id === req.params.id);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      if (user.role === 'superadmin') return res.status(400).json({ error: '不能禁用超级管理员' });
      user.active = active; saveData();
      return res.json({ message: active ? '账号已启用' : '账号已禁用', active });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Comments ─────────────────────────────────────────────
app.get('/api/items/:id/comments', async (req, res) => {
  if (useMongo) {
    if (!isValidObjectId(req.params.id)) return res.json([]);
    const list = await Comment.find({ item: req.params.id }).populate('user', 'username role').sort({ isPinned: -1, createdAt: -1 }).lean();
    return res.json(list.map(c => ({ id: c._id.toString(), itemId: c.item.toString(), userId: c.user?._id?.toString() || '', username: c.user?.username || '未知', userRole: c.user?.role || 'user', content: c.content, isPinned: c.isPinned, createdAt: c.createdAt })));
  }
  res.json([]);
});

app.post('/api/items/:id/comments', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: '评论内容不能为空' });
    if (content.length > 500) return res.status(400).json({ error: '评论不能超过500字' });
    if (useMongo) {
      if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: '物品不存在' });
      const item = await Item.findById(req.params.id);
      if (!item) return res.status(404).json({ error: '物品不存在' });
      const c = await new Comment({ item: item._id, user: req.user._id, content: content.trim() }).save();
      await c.populate('user', 'username role');
      return res.status(201).json({ message: '评论成功', comment: { id: c._id.toString(), itemId: item._id.toString(), userId: req.user._id.toString(), username: req.user.username, userRole: req.user.role, content: c.content, isPinned: false, createdAt: c.createdAt } });
    }
    res.status(500).json({ error: '评论功能需要MongoDB' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/comments/:id', auth, async (req, res) => {
  try {
    if (useMongo) {
      if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: '评论不存在' });
      const c = await Comment.findById(req.params.id);
      if (!c) return res.status(404).json({ error: '评论不存在' });
      const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
      if (c.user.toString() !== req.user._id.toString() && !isAdmin) return res.status(403).json({ error: '无权删除' });
      await Comment.findByIdAndDelete(req.params.id);
      return res.json({ message: '评论已删除' });
    }
    res.status(500).json({ error: '评论功能需要MongoDB' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/comments/:id/pin', auth, admin, async (req, res) => {
  try {
    if (useMongo) {
      if (!isValidObjectId(req.params.id)) return res.status(404).json({ error: '评论不存在' });
      const c = await Comment.findById(req.params.id);
      if (!c) return res.status(404).json({ error: '评论不存在' });
      c.isPinned = !c.isPinned; await c.save();
      return res.json({ message: c.isPinned ? '已置顶' : '已取消置顶', isPinned: c.isPinned });
    }
    res.status(500).json({ error: '评论功能需要MongoDB' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notifications ────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  const now = new Date();
  const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (useMongo) {
    const filter = { status: { $in: ['approved', 'active'] } };
    if (!isAdmin) filter.user = req.user._id;
    const active = await Rental.find(filter).populate('user', 'username phone').populate('item', 'name').lean();
    const alerts = [];
    active.forEach(r => {
      const end = new Date(r.endDate);
      const uname = r.user?.username || '未知', phone = r.user?.phone || '', iname = r.item?.name || '未知';
      if (end < now) alerts.push({ type: 'overdue', rentalId: r._id.toString(), username: uname, phone, itemName: iname, endDate: r.endDate, daysOverdue: Math.floor((now - end) / (1000 * 60 * 60 * 24)) });
      else if (end <= inTwoDays) alerts.push({ type: 'due_soon', rentalId: r._id.toString(), username: uname, phone, itemName: iname, endDate: r.endDate, daysLeft: Math.ceil((end - now) / (1000 * 60 * 60 * 24)) });
    });
    return res.json({ alerts, total: alerts.length, hasOverdue: alerts.some(a => a.type === 'overdue') });
  }
  const alerts = [];
  rentals.forEach(r => {
    if (r.status !== 'approved' && r.status !== 'active') return;
    if (!isAdmin && r.userId !== req.user.id) return;
    const end = new Date(r.endDate);
    const u = users.find(x => x.id === r.userId);
    const i = items.find(x => x.id === r.itemId);
    if (end < now) alerts.push({ type: 'overdue', rentalId: r.id, username: u?.username || '未知', phone: u?.phone || '', itemName: i?.name || '未知', endDate: r.endDate, daysOverdue: Math.floor((now - end) / (1000 * 60 * 60 * 24)) });
    else if (end <= inTwoDays) alerts.push({ type: 'due_soon', rentalId: r.id, username: u?.username || '未知', phone: u?.phone || '', itemName: i?.name || '未知', endDate: r.endDate, daysLeft: Math.ceil((end - now) / (1000 * 60 * 60 * 24)) });
  });
  res.json({ alerts, total: alerts.length, hasOverdue: alerts.some(a => a.type === 'overdue') });
});

app.get('/api/health', async (_, res) => {
  if (useMongo) {
    const [uc, ic, rc] = await Promise.all([User.countDocuments(), Item.countDocuments(), Rental.countDocuments()]);
    return res.json({ status: 'ok', timestamp: new Date(), users: uc, items: ic, rentals: rc });
  }
  res.json({ status: 'ok', timestamp: new Date(), users: users.length, items: items.length, rentals: rentals.length });
});

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
async function start() {
  useMongo = await tryMongo();
  if (!useMongo) loadData();
  app.listen(PORT, () => console.log(`Server running on port ${PORT} (${useMongo ? 'MongoDB' : 'File'})`));
}
start();
