const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../backend/storage');
const { createApp, bootstrap, today } = require('../backend/server');
const day = offset => new Date(Date.parse(today()) + offset * 86400000).toISOString().slice(0,10);

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-scheduling-'));
  let store = new Store(path.join(root, 'rental.sqlite')), server, base, seq = 0;
  let now = Date.parse(day(1) + 'T08:00:00+08:00');
  async function listen() {
    const app = createApp({ store, jwtSecret: 'scheduling-test-secret-longer-than-24', rateLimits: false, clock: () => now });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = 'http://127.0.0.1:' + server.address().port;
  }
  await bootstrap(store, { INITIAL_ADMIN_PASSWORD: 'schedule-test-pass' }); await listen();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function request(method, url, data, token) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  }
  const admin = (await request('POST', '/api/auth/login', { username: 'sa_882f4ca6', password: 'schedule-test-pass' })).data.token;
  async function api(method, url, data) { return request(method, url, data, admin); }
  async function item(extra = {}) {
    const r = await api('POST', '/api/items', { name: '3D打印机', code: 'PRINTER-' + (++seq), totalStock: 1, category: '固定设备', requireApproval: true, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.item;
  }
  const booking = (item, extra = {}) => api('POST', '/api/rentals', { itemId: item.id, quantity: 1, startDate: day(1), endDate: day(1), startTime: '12:00', endTime: '14:00', reason: '打印课程模型', ...extra });
  return { root, admin, api, request, item, booking, get store() { return store; }, setTime: time => { now = Date.parse(day(1) + 'T' + time + ':00+08:00'); },
    restart: async () => { await new Promise(resolve => server.close(resolve)); store.close(); store = new Store(path.join(root, 'rental.sqlite')); await listen(); } };
}

test('three categories validated; daily categories preserve daily dates and fixed equipment persists exact Beijing times', async t => {
  const h = await fixture(t);
  for (const category of ['电子模块', '电机电池']) {
    const item = await h.item({ category });
    const r = await h.api('POST', '/api/rentals', { itemId: item.id, quantity: 1, startDate: day(1), endDate: day(2), reason: '电路实验' });
    assert.equal(r.status, 201); assert.equal(r.data.rental.bookingMode, 'daily'); assert.match(r.data.rental.endDate, /T23:59:59.999\+08:00$/);
  }
  assert.equal((await h.api('POST', '/api/items', { name: 'bad', code: 'BAD', category: '办公用品', totalStock: 1 })).status, 400);
  const printer = await h.item(), r = await h.booking(printer);
  assert.equal(r.status, 201); assert.equal(r.data.rental.bookingMode, 'timeslot');
  assert.equal(r.data.rental.startDate, day(1) + 'T12:00:00+08:00'); assert.equal(r.data.rental.endDate, day(1) + 'T14:00:00+08:00');
  await h.restart();
  const saved = (await h.api('GET', '/api/rentals/my')).data.find(row => row.id === r.data.rental.id);
  assert.equal(saved.startTime, '12:00'); assert.equal(saved.endTime, '14:00'); assert.equal(saved.bookingMode, 'timeslot');
  const backup = await h.store.backup(path.join(h.root, 'backups'));
  const db = new DatabaseSync(backup, { readOnly: true });
  try { assert.equal(db.prepare('SELECT endTime FROM rentals WHERE id=?').get(saved.id).endTime, '14:00'); } finally { db.close(); }
});

test('overlaps are atomic; adjacent slots, other dates and other equipment remain bookable', async t => {
  const h = await fixture(t), item = await h.item();
  const results = await Promise.all([h.booking(item), h.booking(item)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
  assert.equal((await h.booking(item, { startTime: '13:00', endTime: '15:00' })).status, 409);
  assert.equal((await h.booking(item, { startTime: '10:00', endTime: '12:00' })).status, 201);
  assert.equal((await h.booking(item, { startTime: '14:00', endTime: '16:00' })).status, 201);
  assert.equal((await h.booking(item, { startDate: day(2), endDate: day(2) })).status, 201);
  assert.equal((await h.booking(await h.item())).status, 201);
  const winner = results.find(r => r.status === 201).data.rental;
  assert.equal((await h.api('PUT', '/api/rentals/' + winner.id + '/reject', {})).status, 200);
  assert.equal((await h.booking(item)).status, 201);
});

test('capacity uses peak overlapping units instead of sum of all intersecting reservations; edits cannot strand reservations', async t => {
  const h = await fixture(t), item = await h.item({ totalStock: 2, maxRentalQty: 2 });
  assert.equal((await h.booking(item, { startTime: '10:00', endTime: '12:00' })).status, 201);
  assert.equal((await h.booking(item, { startTime: '12:00', endTime: '14:00' })).status, 201);
  assert.equal((await h.booking(item, { startTime: '11:00', endTime: '13:00' })).status, 201, 'two adjacent reservations do not consume two units at once');
  assert.equal((await h.booking(item, { startTime: '11:30', endTime: '12:30' })).status, 409);
  assert.equal((await h.api('PUT', '/api/items/' + item.id, { totalStock: 1 })).status, 409);
  assert.equal((await h.api('PUT', '/api/items/' + item.id + '/stock', { action: 'remove', quantity: 1 })).status, 409);
  assert.equal((await h.api('PUT', '/api/items/' + item.id, { category: '电子模块' })).status, 409);
  assert.equal((await h.api('PUT', '/api/items/' + item.id, { totalStock: 3 })).status, 200);
  assert.equal((await h.booking(item, { startTime: '11:30', endTime: '12:30' })).status, 201);
});

test('equipment schedule API hides personal details and auth is required', async t => {
  const h = await fixture(t), item = await h.item(); await h.booking(item);
  assert.equal((await h.request('GET', '/api/items/' + item.id + '/availability?date=' + day(1))).status, 401);
  const result = await h.api('GET', '/api/items/' + item.id + '/availability?date=' + day(1));
  assert.equal(result.status, 200); assert.equal(result.data.capacity, 1);
  assert.deepEqual(result.data.bookings, [{ startTime: '12:00', endTime: '14:00', quantity: 1 }]);
  assert.equal(JSON.stringify(result.data).includes('user'), false);
  assert.equal((await h.api('GET', '/api/items/' + item.id + '/availability?date=2026-02-30')).status, 400);
});

test('invalid, past, reversed, cross-day and over-quantity time slots create no records', async t => {
  const h = await fixture(t), item = await h.item();
  for (const extra of [{ startTime: '' },{ startTime: '12:00:30' },{ endTime: '24:00' },{ endTime: '12:00' },{ endTime: '11:59' },{ endDate: day(2) },{ startTime: '07:00', endTime: '09:00' },{ quantity: 0 },{ quantity: 2 }]) {
    const r = await h.booking(item, extra); assert.ok([400,409].includes(r.status), JSON.stringify({extra,r}));
  }
  assert.equal(h.store.counts().rentals, 0);
});

test('approved slots automatically start and finish at exact boundaries; adjacent uses release stock first and are idempotent', async t => {
  const h = await fixture(t), item = await h.item({ requireApproval: false });
  const first = (await h.booking(item)).data.rental;
  const next = (await h.booking(item, { startTime: '14:00', endTime: '16:00' })).data.rental; assert.ok(next);
  assert.equal((await h.api('PUT', '/api/rentals/' + first.id + '/pickup', {})).status, 409);
  h.setTime('11:59'); await h.api('GET', '/api/rentals/my');assert.equal(h.store.get('rentals',first.id).status,'approved');
  h.setTime('12:00'); await Promise.all([h.api('GET','/api/rentals/my'),h.api('GET','/api/items')]);
  assert.equal(h.store.get('rentals',first.id).status,'active');
  assert.equal(h.store.get('rentals',first.id).pickedAt,day(1)+'T04:00:00.000Z');
  assert.equal(h.store.get('items', item.id).availableStock, 0);
  assert.equal((await h.api('PUT','/api/rentals/'+first.id+'/return',{})).status,409);
  h.setTime('14:00'); await h.api('GET','/api/items');
  assert.equal(h.store.get('rentals',first.id).status,'returned');assert.equal(h.store.get('rentals',next.id).status,'active');
  assert.equal(h.store.get('rentals',first.id).actualReturnDate,day(1)+'T06:00:00.000Z');
  assert.equal(h.store.get('items',item.id).availableStock,0);
  const alerts = (await h.api('GET', '/api/notifications')).data.alerts;
  assert.equal(alerts.some(a=>a.rentalId===first.id&&a.type==='overdue'),false);
  h.setTime('16:00');await h.api('GET','/api/rentals/my');const saved=h.store.get('rentals',next.id);
  assert.equal(saved.status,'returned');await h.api('GET','/api/rentals/my');assert.deepEqual(h.store.get('rentals',next.id),saved);
  assert.equal(h.store.get('items', item.id).availableStock, 1);
  const immediate=await h.booking(item,{startTime:'16:00',endTime:'17:00'});assert.equal(immediate.status,201);assert.equal(immediate.data.rental.status,'active','no-approval booking at the current minute starts in its creation transaction');assert.equal(h.store.get('items',item.id).availableStock,0);
});

test('unreviewed slots cancel while approved missed slots complete without stock churn; completed holds allow category change', async t => {
  const h = await fixture(t), pendingItem = await h.item(), approvedItem = await h.item({ requireApproval: false });
  const pending = (await h.booking(pendingItem)).data.rental, approved = (await h.booking(approvedItem)).data.rental;
  h.setTime('14:00');
  assert.equal((await h.api('PUT', '/api/rentals/' + approved.id + '/pickup', {})).status, 409);
  assert.equal((await h.api('PUT', '/api/items/' + pendingItem.id, { category: '电子模块' })).status, 200);
  assert.equal(h.store.get('rentals', pending.id).status, 'cancelled'); assert.equal(h.store.get('rentals', approved.id).status, 'returned');
  assert.equal(h.store.get('rentals',approved.id).pickedAt,day(1)+'T04:00:00.000Z');assert.equal(h.store.get('rentals',approved.id).actualReturnDate,day(1)+'T06:00:00.000Z');
  assert.equal(h.store.get('items', approvedItem.id).availableStock, 1);
  assert.equal(h.store.get('items', pendingItem.id).availableStock, 1);
});

test('approval inside a running slot starts immediately; rejected and pending requests never become uses',async t=>{
  const h=await fixture(t),item=await h.item({totalStock:3,maxRentalQty:3});
  const pending=(await h.booking(item)).data.rental,rejected=(await h.booking(item)).data.rental,late=(await h.booking(item)).data.rental;
  assert.equal((await h.api('PUT','/api/rentals/'+rejected.id+'/reject',{})).status,200);
  h.setTime('13:00');const approved=await h.api('PUT','/api/rentals/'+late.id+'/approve',{status:'approved'});
  assert.equal(approved.data.rental.status,'active');assert.equal(approved.data.rental.pickedAt,day(1)+'T05:00:00.000Z');assert.equal(h.store.get('items',item.id).availableStock,2);
  assert.equal(h.store.get('rentals',pending.id).status,'pending');
  h.setTime('14:00');await h.api('GET','/api/rentals');
  assert.equal(h.store.get('rentals',pending.id).status,'cancelled');assert.equal(h.store.get('rentals',rejected.id).status,'rejected');assert.equal(h.store.get('rentals',late.id).status,'returned');assert.equal(h.store.get('items',item.id).availableStock,3);
});

test('restart catches up elapsed slots and starts current multi-unit use while preserving daily rentals',async t=>{
  const h=await fixture(t),item=await h.item({requireApproval:false,totalStock:3,maxRentalQty:3}),dailyItem=await h.item({category:'电子模块',requireApproval:false});
  const elapsed=(await h.booking(item,{startTime:'09:00',endTime:'10:00',quantity:2})).data.rental;
  const current=(await h.booking(item,{quantity:2})).data.rental;
  const daily=(await h.api('POST','/api/rentals',{itemId:dailyItem.id,quantity:1,startDate:day(1),endDate:day(2),reason:'按天实验'})).data.rental;
  const beforeDaily=h.store.get('rentals',daily.id);
  h.setTime('12:30');await h.restart();
  assert.equal(h.store.get('rentals',elapsed.id).status,'returned');assert.equal(h.store.get('rentals',current.id).status,'active');assert.equal(h.store.get('items',item.id).availableStock,1);assert.deepEqual(h.store.get('rentals',daily.id),beforeDaily);
  h.setTime('14:30');await h.restart();assert.equal(h.store.get('rentals',current.id).status,'returned');assert.equal(h.store.get('items',item.id).availableStock,3);assert.deepEqual(h.store.get('rentals',daily.id),beforeDaily);
});

test('automatic transitions roll back stock and all rows on failure and never credit or debit twice',async t=>{
  const h=await fixture(t),item=await h.item({requireApproval:false});const rental=(await h.booking(item)).data.rental;
  h.store.db.exec("CREATE TRIGGER fail_auto BEFORE UPDATE ON rentals WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'simulated transition failure'); END;");
  h.setTime('12:00');assert.equal((await h.api('GET','/api/rentals/my')).status,500);assert.equal(h.store.get('rentals',rental.id).status,'approved');assert.equal(h.store.get('items',item.id).availableStock,1);
  h.store.db.exec('DROP TRIGGER fail_auto');await h.api('GET','/api/rentals/my');assert.equal(h.store.get('items',item.id).availableStock,0);
  h.store.db.exec("CREATE TRIGGER fail_finish BEFORE UPDATE ON rentals WHEN NEW.status='returned' BEGIN SELECT RAISE(ABORT,'simulated completion failure'); END;");
  h.setTime('14:00');assert.equal((await h.api('GET','/api/rentals/my')).status,500);assert.equal(h.store.get('items',item.id).availableStock,0);assert.equal(h.store.get('rentals',rental.id).status,'active');
  h.store.db.exec('DROP TRIGGER fail_finish');await Promise.all([h.api('GET','/api/items'),h.api('GET','/api/rentals/my')]);assert.equal(h.store.get('items',item.id).availableStock,1);assert.equal(h.store.get('rentals',rental.id).status,'returned');
});

test('out-of-service stock never becomes negative and resumes when units become available',async t=>{
  const h=await fixture(t),item=await h.item({requireApproval:false});const rental=(await h.booking(item)).data.rental;
  h.store.update('items',item.id,{availableStock:0,status:'unavailable'});h.setTime('12:00');assert.equal((await h.api('GET','/api/items')).status,200);assert.equal(h.store.get('rentals',rental.id).status,'approved');assert.equal(h.store.get('items',item.id).availableStock,0);
  h.store.update('items',item.id,{availableStock:1,status:'available'});await h.api('GET','/api/rentals/my');assert.equal(h.store.get('rentals',rental.id).status,'active');assert.equal(h.store.get('items',item.id).availableStock,0);
});

test('legacy daily reservations prevent changing booking mode and cannot be ignored by a fixed-equipment calendar', async t => {
  const h = await fixture(t), item = await h.item({ category: '电子模块' });
  const daily = await h.api('POST', '/api/rentals', { itemId: item.id, quantity: 1, startDate: day(1), endDate: day(2), reason: '旧租借' });
  assert.equal(daily.status, 201);
  assert.equal((await h.api('PUT', '/api/items/' + item.id, { category: '固定设备' })).status, 409);
  h.store.update('items', item.id, { category: '固定设备' });
  assert.equal((await h.booking(item)).status, 409, 'legacy data already categorized as equipment must also be safe');
});

test('v1 migration preserves entity IDs, dates and image links, creates rollback copy, and is idempotent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-upgrade-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, 'rental.sqlite'), old = new DatabaseSync(filename);
  old.exec(fs.readFileSync(path.join(__dirname, 'fixtures/sqlite-v1.sql'), 'utf8'));
  old.exec("INSERT INTO users(id,username,email,password,createdAt,updatedAt) VALUES('u','2026000000011','old@example.com','hash','2026-01-01','2026-01-01'); INSERT INTO items(id,name,code,category,totalStock,availableStock,maxRentalDays,maxRentalQty,status,image,createdAt,updatedAt) VALUES('i','旧物品','OLD','电子产品',2,2,7,2,'available','https://example.com/old.jpg','2026-01-01','2026-01-01'); INSERT INTO rentals(id,userId,itemId,itemCode,itemName,quantity,startDate,endDate,status,createdAt,updatedAt) VALUES('r','u','i','OLD','旧物品',1,'2026-01-02','2026-01-03','returned','2026-01-01','2026-01-01'); INSERT INTO comments(id,itemId,userId,content,createdAt,updatedAt) VALUES('c','i','u','保留评论','2026-01-01','2026-01-01');"); old.close();
  let store = new Store(filename);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(store.get('items','i').category, '电子模块'); assert.equal(store.get('items','i').image, 'https://example.com/old.jpg');
  assert.equal(store.get('rentals','r').bookingMode, 'daily'); assert.equal(store.get('rentals','r').endDate, '2026-01-03');
  assert.equal(store.get('comments','c').content, '保留评论'); assert.equal(store.get('users','u').email, 'old@example.com');
  store.close(); const copies = fs.readdirSync(root).filter(n => n.includes('.pre-v2-')); assert.equal(copies.length, 1);
  const rollback = new DatabaseSync(path.join(root,copies[0]), { readOnly: true });
  try { assert.equal(rollback.prepare('PRAGMA user_version').get().user_version, 1); assert.equal(rollback.prepare('SELECT category FROM items').get().category, '电子产品'); } finally { rollback.close(); }
  store = new Store(filename); store.close(); assert.equal(fs.readdirSync(root).filter(n => n.includes('.pre-v2-')).length, 1);
});

test('frontend uses fixed time fields with stock zero and renders Beijing dates/times and all three selectors', () => {
  const vm = require('node:vm'), html = fs.readFileSync(path.join(__dirname,'../frontend/public/app.html'),'utf8');
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const helpers = html.split(/\r?\n/).filter(l => /^function (beijingDate|isFixedEquipment|canBookItem|rentalMoment|rentalRange)\(/.test(l)).join('\n');
  const context = vm.createContext({ Intl, Date }); vm.runInContext(helpers, context);
  assert.equal(vm.runInContext("canBookItem({category:'固定设备',totalStock:1,availableStock:0,status:'unavailable'})", context), true);
  assert.equal(vm.runInContext("canBookItem({category:'电子模块',totalStock:1,availableStock:0,status:'unavailable'})", context), false);
  assert.equal(vm.runInContext("rentalRange({bookingMode:'timeslot',startDate:'2026-10-23T12:00:00+08:00',endDate:'2026-10-23T14:00:00+08:00',startTime:'12:00',endTime:'14:00'})", context), '2026-10-23 12:00–14:00');
  for (const id of ['new-item-category','edit-item-category','item-category-filter']) {
    const select = html.match(new RegExp('<select[^>]*id="'+id+'"[^>]*>(.*?)</select>'))[1];
    for (const name of ['电子模块','电机电池','固定设备']) assert.ok(select.includes(name));
    assert.equal(select.includes('生活用品'), false);
  }
});

test('rental UI shows automatic equipment states and keeps manual controls only for daily loans',()=>{
  const vm=require('node:vm'),html=fs.readFileSync(path.join(__dirname,'../frontend/public/app.html'),'utf8');
  const helpers=html.split(/\r?\n/).filter(l=>/^function (beijingDate|rentalMoment|rentalRange|overdueLabel|rentalStatusLabel)\(/.test(l)).join('\n');
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',classList:{add(){},remove(){}}});return nodes.get(id)};
  const row=(id,status,bookingMode)=>({id,status,bookingMode,itemName:id,quantity:1,startDate:day(1)+'T12:00:00+08:00',endDate:day(1)+'T14:00:00+08:00',startTime:'12:00',endTime:'14:00'});
  const rows=[row('fixed-wait','approved','timeslot'),row('fixed-now','active','timeslot'),row('fixed-done','returned','timeslot'),row('daily-wait','approved','daily'),row('daily-now','active','daily')];
  const context=vm.createContext({Intl,Date,document:{getElementById:node},myRentals:rows,allRentals:rows,adminContact:null,esc:s=>String(s??'')});
  vm.runInContext(helpers+'\n'+html.slice(html.indexOf('function renderMyRentals()'),html.indexOf('// Admin'))+'\n'+html.slice(html.indexOf('function renderAdminPickup()'),html.indexOf('function renderAdminItems()')),context);
  vm.runInContext('renderMyRentals();renderAdminPickup();renderAdminActive()',context);
  const mine=node('my-rentals-table').innerHTML,pickup=node('pickup-table').innerHTML,active=node('active-table').innerHTML;
  for(const label of ['待使用','使用中','已完成','到预约开始时间自动使用','到预约结束时间自动完成'])assert.ok(mine.includes(label),label);
  assert.doesNotMatch(mine,/联系管理员开始使用|联系管理员结束使用/);
  assert.doesNotMatch(pickup,/pickupRental\('fixed-wait'\)/);assert.match(pickup,/到预约时间自动开始/);assert.match(pickup,/pickupRental\('daily-wait'\)/);
  assert.doesNotMatch(active,/returnRental\('fixed-now'\)/);assert.match(active,/到结束时间自动完成/);assert.match(active,/returnRental\('daily-now'\)/);
});

test('rental status polling skips inactive pages, hidden tabs and open forms and serializes updates',async()=>{
  const vm=require('node:vm'),html=fs.readFileSync(path.join(__dirname,'../frontend/public/app.html'),'utf8');let calls=0,done,modal=false,token='token';
  const visible=new Set(['page-my-rentals']);const doc={hidden:false,querySelector:()=>modal?{}:null,getElementById:id=>({classList:{contains:()=>!visible.has(id)}})};
  const context=vm.createContext({document:doc,gt:()=>token,adminTab:'active',refreshRentalPage:()=>{calls++;return new Promise(resolve=>{done=resolve})}});
  vm.runInContext(html.slice(html.indexOf('async function refreshVisibleRentals()'),html.indexOf('function renderPage(')),context);
  const first=vm.runInContext('refreshVisibleRentals()',context);await vm.runInContext('refreshVisibleRentals()',context);assert.equal(calls,1);done();await first;
  for(const change of [()=>{modal=true},()=>{modal=false;doc.hidden=true},()=>{doc.hidden=false;token=''},()=>{token='token';visible.clear()}]){change();await vm.runInContext('refreshVisibleRentals()',context);assert.equal(calls,1)}
});

test('failed schema upgrade rolls back all new fields and preserves the v1 database', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rental-upgrade-fail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const filename=path.join(root,'rental.sqlite'),old=new DatabaseSync(filename);
  old.exec(fs.readFileSync(path.join(__dirname,'fixtures/sqlite-v1.sql'),'utf8'));
  old.exec("INSERT INTO items(id,name,code,category,totalStock,availableStock,maxRentalDays,maxRentalQty,status,createdAt,updatedAt) VALUES('i','保留设备','KEEP','电子产品',1,1,7,1,'available','2026-01-01','2026-01-01'); CREATE TRIGGER prevent_upgrade BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT,'simulated migration failure'); END;");old.close();
  assert.throws(()=>new Store(filename),/simulated migration failure/);
  const check=new DatabaseSync(filename);
  try{
    assert.equal(check.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(check.prepare('PRAGMA table_info(rentals)').all().some(c=>c.name==='bookingMode'),false);
    assert.equal(check.prepare('SELECT name,category FROM items').get().name,'保留设备');
    assert.equal(check.prepare('SELECT category FROM items').get().category,'电子产品');
    check.exec('DROP TRIGGER prevent_upgrade');
  }finally{check.close();}
  const retried=new Store(filename);try{assert.equal(retried.get('items','i').category,'电子模块');}finally{retried.close();}
});
