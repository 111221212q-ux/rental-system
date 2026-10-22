const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { Store } = require('../backend/storage');
const { createApp, bootstrap, start, today } = require('../backend/server');

const secret = 'sqlite-integration-test-secret-32-characters';
const userHash = bcrypt.hashSync('student-pass', 10);
const offsetDay = n => new Date(Date.parse(today()) + n * 86400000).toISOString().slice(0,10);

async function fixture(t, configured = false, sendSucceeds = true) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rental-sqlite-test-'));
  const filename = path.join(root, 'rental.sqlite');
  let store = new Store(filename), server, base, counter = 0;
  const messages = [];
  const emails = { isConfigured: () => configured, sendEmail: async (to, subject, content) => { messages.push({ to, subject, content }); return { success: sendSucceeds }; } };
  async function listen() {
    await bootstrap(store, { INITIAL_ADMIN_PASSWORD: 'admin-test-pass' });
    const app = createApp({ store, jwtSecret: secret, emailService: emails, rateLimits: false });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = 'http://127.0.0.1:' + server.address().port;
  }
  await listen();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); await fsp.rm(root, { recursive: true, force: true }); });
  async function request(method, url, body, token) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  async function login(username, password) {
    const response = await request('POST', '/api/auth/login', { username, password });
    assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.token;
  }
  const adminToken = await login('sa_882f4ca6', 'admin-test-pass');
  async function student(role = 'user') {
    const username = String(2026000000000 + (++counter));
    const user = store.insert('users', { username, email: username + '@example.com', password: userHash, role });
    return { ...user, token: await login(username, 'student-pass') };
  }
  async function item(extra = {}) {
    const result = await request('POST','/api/items', { name: '测试相机', code: 'CAM' + (++counter), totalStock: 1, maxRentalDays: 7, maxRentalQty: 2, requireApproval: true, ...extra }, adminToken);
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.item;
  }
  async function rental(user, item, extra = {}) {
    const result = await request('POST','/api/rentals',{ itemId: item.id, quantity: 1, startDate: today(), endDate: offsetDay(2), reason: '课程拍摄', ...extra }, user.token);
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.rental;
  }
  return { root, filename, get store() { return store; }, request, login, student, item, rental, adminToken, messages,
    code: () => messages.at(-1).content.match(/\d{6}/)[0],
    restart: async () => { await new Promise(resolve => server.close(resolve)); store.close(); store = new Store(filename); await listen(); },
  };
}

test('fresh database has only admin; health explicitly identifies SQLite and no fallback data', async t => {
  const h = await fixture(t);
  assert.deepEqual(h.store.counts(), { users: 1, items: 0, rentals: 0, comments: 0 });
  const health = await h.request('GET','/api/health');
  assert.equal(health.data.storage,'sqlite'); assert.equal(health.data.mongoError, undefined);
  assert.equal(health.data.users,1); assert.equal(health.data.items,0);
  assert.equal(h.store.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(h.store.db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
});

test('registration validates, hashes passwords, rejects duplicates, and excludes secret fields', async t => {
  const h = await fixture(t);
  const body = { username: '2026000000999', email: 'Student@Example.com', password: 'strong-test-pass', nickname: '学生甲' };
  const r = await h.request('POST','/api/auth/register',body);
  assert.equal(r.status,201); assert.equal(r.data.user.email,'student@example.com'); assert.equal(r.data.user.role,'user');
  assert.ok(!Object.hasOwn(r.data.user,'password')); assert.ok(!Object.hasOwn(r.data.user,'passwordVersion'));
  assert.notEqual(h.store.get('users',r.data.user.id).password,body.password);
  assert.equal((await h.request('POST','/api/auth/register',body)).status,400);
  assert.equal((await h.request('POST','/api/auth/register',{ ...body, username:'2026000000998' })).status,400);
  for (const bad of [{username:'x'},{email:'bad-email'},{password:'123'},{password:{bad:true}}]) assert.equal((await h.request('POST','/api/auth/register',{...body,...bad})).status,400);
  assert.equal((await h.request('GET','/api/auth/me',undefined,r.data.token)).status,200);
});

test('registration email codes survive restart, reject invalid codes, and can only be consumed once', async t => {
  const h = await fixture(t,true), email = 'mail-test@example.com';
  assert.equal((await h.request('POST','/api/auth/send-reg-code',{email})).status,200);
  const code = h.code();
  assert.notEqual(h.store.all('verification_codes')[0].codeHash,code);
  await h.restart();
  const body = {username:'2026000000888', email, password:'student-pass'};
  assert.equal((await h.request('POST','/api/auth/register',{...body,verificationCode:'000000'})).status,400);
  assert.equal(h.store.all('verification_codes')[0].attempts,1);
  assert.equal((await h.request('POST','/api/auth/register',{...body,verificationCode:code})).status,201);
  assert.equal(h.store.all('verification_codes').length,0);
  assert.equal((await h.request('POST','/api/auth/register',{...body,username:'2026000000887',verificationCode:code})).status,400);
});

test('profile verification expires, limits attempts, and is invalidated by email change', async t => {
  const h = await fixture(t,true), u = await h.student();
  await h.request('POST','/api/auth/send-verification',{},u.token);
  for (let i=0;i<5;i++) assert.equal((await h.request('POST','/api/auth/verify-email',{code:'000000'},u.token)).status,400);
  assert.equal((await h.request('POST','/api/auth/verify-email',{code:h.code()},u.token)).status,400);
  let entry = h.store.all('verification_codes')[0];
  h.store.update('verification_codes',entry.id,{ attempts:0, expiresAt:Date.now()-1 });
  assert.equal((await h.request('POST','/api/auth/verify-email',{code:h.code()},u.token)).status,400);
  await h.request('PUT','/api/auth/profile',{email:'changed@example.com'},u.token);
  assert.equal(h.store.all('verification_codes').length,0);
  assert.equal(h.store.get('users',u.id).emailVerified,false);
  assert.equal((await h.request('POST','/api/auth/send-verification',{},u.token)).status,200);
  assert.equal((await h.request('POST','/api/auth/verify-email',{code:h.code()},u.token)).status,200);
  assert.equal(h.store.get('users',u.id).emailVerified,true);
});

test('failed configured email sends do not leave usable codes', async t => {
  const h = await fixture(t,true,false);
  assert.equal((await h.request('POST','/api/auth/send-reg-code',{email:'a@example.com'})).status,502);
  assert.equal(h.messages.length,1);
  assert.equal(h.store.all('verification_codes').length,0);
});

test('manual approval, pickup and return preserve frontend shapes and stock', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item(), r = await h.rental(u,i);
  assert.equal(r.status,'pending'); assert.equal(r.itemCode,i.code); assert.equal(r.userName,u.username);
  assert.ok(r.endDate.endsWith('T23:59:59.999+08:00'));
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/approve`,{status:'approved'},h.adminToken)).status,200);
  assert.equal(h.store.get('items',i.id).availableStock,1);
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)).status,200);
  assert.equal(h.store.get('items',i.id).availableStock,0);
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/return`,{},h.adminToken)).status,200);
  assert.equal(h.store.get('items',i.id).availableStock,1);
  assert.ok(h.store.get('rentals',r.id).actualReturnDate);
});

test('concurrent last-unit pickups cannot oversell, duplicate return credits stock once', async t => {
  const h = await fixture(t), a = await h.student(), b = await h.student(), i = await h.item({requireApproval:false});
  const r1 = await h.rental(a,i), r2 = await h.rental(b,i);
  const results = await Promise.all([r1,r2].map(r => h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  assert.equal(h.store.get('items',i.id).availableStock,0);
  const active = h.store.all('rentals').find(r=>r.status==='active');
  const returned = await Promise.all([1,2].map(()=>h.request('PUT',`/api/rentals/${active.id}/return`,{},h.adminToken)));
  assert.deepEqual(returned.map(r=>r.status).sort(),[200,409]);
  assert.equal(h.store.get('items',i.id).availableStock,1);
});

test('changing approval setting does not double-deduct; repeat approval/pickup is rejected', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item({requireApproval:false}), r = await h.rental(u,i);
  await h.request('PUT',`/api/items/${i.id}`,{requireApproval:true},h.adminToken);
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/approve`,{status:'approved'},h.adminToken)).status,409);
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)).status,200);
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)).status,409);
  assert.equal(h.store.get('items',i.id).availableStock,0);
});

test('transaction rollback restores stock and user state when rental status write fails', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item({requireApproval:false}), r = await h.rental(u,i);
  h.store.db.exec("CREATE TRIGGER simulate_failure BEFORE UPDATE OF status ON rentals WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)).status,500);
  assert.equal(h.store.get('items',i.id).availableStock,1);
  assert.equal(h.store.get('rentals',r.id).status,'approved');
  assert.equal(h.store.get('users',u.id).firstRental,true);
});

test('invalid quantities and dates never create rental records', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item();
  const body = {itemId:i.id,quantity:1,startDate:today(),endDate:offsetDay(2),reason:'借用'};
  for (const quantity of [0,-1,1.5,null,{},'NaN',3]) assert.equal((await h.request('POST','/api/rentals',{...body,quantity},u.token)).status,400);
  for (const dates of [{startDate:'bad'},{startDate:'2026-02-30'},{startDate:offsetDay(-1)},{endDate:today()},{endDate:offsetDay(8)}]) assert.equal((await h.request('POST','/api/rentals',{...body,...dates},u.token)).status,400);
  assert.equal(h.store.counts().rentals,0); assert.equal(h.store.get('items',i.id).availableStock,1);
});

test('expired uncollected rentals cancel on personal view without stock debit or overdue notice', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item({requireApproval:false}), r = await h.rental(u,i);
  h.store.update('rentals',r.id,{startDate:offsetDay(-3),endDate:offsetDay(-1)});
  assert.equal((await h.request('GET','/api/rentals/my',undefined,u.token)).data[0].status,'cancelled');
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)).status,409);
  assert.equal(h.store.get('items',i.id).availableStock,1);
  assert.equal((await h.request('GET','/api/notifications',undefined,u.token)).data.hasOverdue,false);
});

test('end date remains valid for all of its Beijing calendar day', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item({requireApproval:false}), r = await h.rental(u,i);
  h.store.update('rentals',r.id,{endDate:today()});
  assert.equal((await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken)).status,200);
  const notice = (await h.request('GET','/api/notifications',undefined,u.token)).data;
  assert.equal(notice.hasOverdue,false); assert.equal(notice.alerts[0].daysLeft,0);
});

test('stock editing rejects below borrowed quantity and accepts zero value/empty description', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item({requireApproval:false}), r = await h.rental(u,i);
  await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken);
  assert.equal((await h.request('PUT',`/api/items/${i.id}`,{totalStock:0},h.adminToken)).status,400);
  const update = await h.request('PUT',`/api/items/${i.id}`,{value:0,description:''},h.adminToken);
  assert.equal(update.status,200); assert.equal(update.data.item.value,0);
  for (const bad of [{totalStock:-1},{maxRentalQty:0},{requireApproval:'false'},{image:'https://example.com/\" onclick=\"x'}]) assert.equal((await h.request('PUT',`/api/items/${i.id}`,bad,h.adminToken)).status,400);
});

test('active records and users cannot be deleted; completed item history survives item deletion', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item({requireApproval:false}), r = await h.rental(u,i);
  await h.request('PUT',`/api/rentals/${r.id}/pickup`,{},h.adminToken);
  for(const endpoint of [`/api/rentals/${r.id}`,`/api/items/${i.id}`,`/api/admin/users/${u.id}`]) assert.equal((await h.request('DELETE',endpoint,undefined,h.adminToken)).status,400);
  await h.request('PUT',`/api/rentals/${r.id}/return`,{},h.adminToken);
  assert.equal((await h.request('DELETE',`/api/items/${i.id}`,undefined,h.adminToken)).status,200);
  const history = (await h.request('GET','/api/rentals/my',undefined,u.token)).data[0];
  assert.equal(history.itemName,i.name); assert.equal(history.itemCode,i.code); assert.equal(history.itemId,'');
});

test('comment creation, pin and ownership checks work in SQLite', async t => {
  const h = await fixture(t), a = await h.student(), b = await h.student(), i = await h.item();
  const response = await h.request('POST',`/api/items/${i.id}/comments`,{content:'<script>测试</script>'},a.token);
  assert.equal(response.status,201); const c = response.data.comment;
  assert.equal(c.username,a.username); assert.equal(c.userId,a.id); assert.equal(c.userRole,'user');
  assert.equal((await h.request('DELETE',`/api/comments/${c.id}`,undefined,b.token)).status,403);
  assert.equal((await h.request('PUT',`/api/comments/${c.id}/pin`,{},a.token)).status,403);
  assert.equal((await h.request('PUT',`/api/comments/${c.id}/pin`,{},h.adminToken)).data.isPinned,true);
  assert.equal((await h.request('GET',`/api/items/${i.id}/comments`)).data[0].content,'<script>测试</script>');
  assert.equal((await h.request('DELETE',`/api/comments/${c.id}`,undefined,a.token)).status,200);
  assert.equal((await h.request('POST',`/api/items/${i.id}/comments`,{content:' '},a.token)).status,400);
  assert.equal((await h.request('POST',`/api/items/${i.id}/comments`,{content:'x'.repeat(501)},a.token)).status,400);
});

test('auth rejects missing/forged tokens; disabled users and non-super admins cannot escalate', async t => {
  const h = await fixture(t), u = await h.student(), admin = await h.student('admin');
  assert.equal((await h.request('GET','/api/auth/me')).status,401);
  assert.equal((await h.request('GET','/api/auth/me',undefined,'invalid')).status,401);
  assert.equal((await h.request('POST','/api/items',{name:'x'},u.token)).status,403);
  assert.equal((await h.request('PUT',`/api/admin/users/${u.id}/role`,{role:'admin'},admin.token)).status,403);
  assert.equal((await h.request('POST','/api/seed/test-users',{},admin.token)).status,403);
  assert.equal((await h.request('PUT',`/api/admin/users/${u.id}/status`,{active:false},h.adminToken)).status,200);
  assert.equal((await h.request('GET','/api/auth/me',undefined,u.token)).status,401);
  assert.equal((await h.request('POST','/api/auth/login',{username:u.username,password:'student-pass'})).status,401);
  const list = (await h.request('GET','/api/admin/users',undefined,h.adminToken)).data;
  assert.ok(list.every(user => !('password' in user) && !('passwordVersion' in user)));
});

test('password change revokes old token and retains new credentials through restart', async t => {
  const h = await fixture(t), u = await h.student();
  assert.equal((await h.request('PUT','/api/auth/password',{currentPassword:'bad',newPassword:'new-test-pass'},u.token)).status,400);
  const changed = await h.request('PUT','/api/auth/password',{currentPassword:'student-pass',newPassword:'new-test-pass'},u.token);
  assert.equal(changed.status,200);
  assert.equal((await h.request('GET','/api/auth/me',undefined,u.token)).status,401);
  await h.restart();
  assert.equal((await h.request('GET','/api/auth/me',undefined,changed.data.token)).status,200);
  assert.ok(await h.login(u.username,'new-test-pass'));
  assert.equal(h.store.counts().users,2);
});

test('all entity types survive closing and reopening the database', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item(), r = await h.rental(u,i);
  await h.request('POST',`/api/items/${i.id}/comments`,{content:'重启后保留'},u.token);
  const counts = h.store.counts();
  await h.restart();
  assert.deepEqual(h.store.counts(),counts);
  assert.equal((await h.request('GET','/api/rentals/my',undefined,u.token)).data[0].id,r.id);
  assert.equal((await h.request('GET',`/api/items/${i.id}/comments`)).data[0].content,'重启后保留');
});

test('SQLite backup restores independently with intact relations and retains only seven snapshots', async t => {
  const h = await fixture(t), u = await h.student(), i = await h.item(); await h.rental(u,i);
  await h.request('POST',`/api/items/${i.id}/comments`,{content:'备份验证'},u.token);
  const directory = path.join(h.root,'backups'); let latest;
  await fsp.mkdir(directory); await fsp.writeFile(path.join(directory,'keep-this.txt'),'保留');
  for(let n=0;n<9;n++) latest = await h.store.backup(directory);
  assert.equal((await fsp.readdir(directory)).filter(f=>f.endsWith('.sqlite')).length,7);
  assert.ok(fs.existsSync(path.join(directory,'keep-this.txt')));
  const restored = path.join(h.root,'restored.sqlite'); await fsp.copyFile(latest,restored);
  const restoredStore = new Store(restored);
  try {
    assert.deepEqual(restoredStore.counts(),h.store.counts());
    assert.equal(restoredStore.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(restoredStore.db.prepare('PRAGMA foreign_key_check').all(),[]);
    const restoredApp = createApp({store:restoredStore,jwtSecret:secret,emailService:{isConfigured:()=>false},rateLimits:false});
    const restoredServer = await new Promise(resolve=>{const s=restoredApp.listen(0,'127.0.0.1',()=>resolve(s));});
    try { const res=await fetch(`http://127.0.0.1:${restoredServer.address().port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.username,password:'student-pass'})});assert.equal(res.status,200); }
    finally{await new Promise(resolve=>restoredServer.close(resolve));}
  } finally { restoredStore.close(); }
});

test('manual backup CLI works outside source directory', async t => {
  const h = await fixture(t);
  const result = spawnSync(process.execPath,[path.resolve(__dirname,'../backend/backup.js')],{ cwd:os.tmpdir(),env:{...process.env,SQLITE_PATH:h.filename,BACKUP_DIR:path.join(h.root,'manual-backups')},encoding:'utf8' });
  assert.equal(result.status,0,result.stderr);
  assert.equal((await fsp.readdir(path.join(h.root,'manual-backups'))).length,1);
});

test('superadmin test-data cleanup restores stock and never removes real students', async t => {
  const h = await fixture(t), real = await h.student(), i = await h.item({totalStock:10});
  await h.request('POST','/api/seed/test-users',{},h.adminToken);
  assert.equal((await h.request('POST','/api/seed/test-data',{},h.adminToken)).status,200);
  assert.equal(h.store.get('items',i.id).availableStock,9);
  assert.equal((await h.request('POST','/api/seed/clean-test',{},h.adminToken)).status,200);
  assert.equal(h.store.get('items',i.id).availableStock,10);
  assert.ok(h.store.get('users',real.id)); assert.equal(h.store.counts().rentals,0);
});

test('broken database cannot silently fallback or overwrite its file', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(),'rental-sqlite-fail-')); t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  const filename=path.join(root,'broken.sqlite'); await fsp.writeFile(filename,'not a sqlite database');
  assert.throws(()=>new Store(filename)); assert.equal(await fsp.readFile(filename,'utf8'),'not a sqlite database');
  await assert.rejects(start({JWT_SECRET:'short',SQLITE_PATH:path.join(root,'unused.sqlite')}),/JWT_SECRET/);
  assert.equal(fs.existsSync(path.join(root,'unused.sqlite')),false);
});

test('production entry point takes an initial backup and persists across a clean stop', async t => {
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'rental-sqlite-start-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  const env={JWT_SECRET:secret,INITIAL_ADMIN_PASSWORD:'admin-test-pass',SQLITE_PATH:path.join(root,'app.sqlite'),PORT:'0'};
  const running=await start(env);
  try {
    const res=await fetch('http://127.0.0.1:'+running.server.address().port+'/api/health');const health=await res.json();
    assert.equal(health.storage,'sqlite');assert.equal(health.backup.enabled,true);assert.ok(health.backup.lastSuccess);assert.equal(health.backup.lastError,null);
  } finally{await running.close();}
  const saved=new DatabaseSync(env.SQLITE_PATH,{readOnly:true});
  try{assert.equal(saved.prepare('SELECT count(*) AS n FROM users').get().n,1);}finally{saved.close();}
});

test('frontend token replacement preserves remembered storage and Beijing date crosses UTC boundary', () => {
  const vm=require('node:vm');
  const html=fs.readFileSync(path.resolve(__dirname,'../frontend/public/app.html'),'utf8');
  const functions=html.split(/\r?\n/).filter(line=>/^(const TK =|function (beijingDate|gt|st|gu|su|ca)\()/.test(line)).join('\n');
  const storage=()=>{const entries=new Map();return{getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};};
  const localStorage=storage(),sessionStorage=storage();
  const context=vm.createContext({localStorage,sessionStorage,Intl,Date,JSON,document:{getElementById:()=>({checked:false})}});
  vm.runInContext(functions,context);
  localStorage.setItem('rental_token','revoked-token');localStorage.setItem('rental_user',JSON.stringify({nickname:'old'}));
  vm.runInContext("st('replacement-token');su({nickname:'new'})",context);
  assert.equal(vm.runInContext('gt()',context),'replacement-token');assert.equal(vm.runInContext('gu().nickname',context),'new');assert.equal(sessionStorage.getItem('rental_token'),null);
  assert.equal(vm.runInContext("beijingDate(new Date('2026-10-21T17:00:00Z'))",context),'2026-10-22');
  vm.runInContext('ca()',context);assert.equal(vm.runInContext('gt()',context),null);
});
