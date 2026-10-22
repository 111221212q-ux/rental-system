const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');const {DatabaseSync}=require('node:sqlite');const {BSON}=require('mongodb');const bcrypt=require('bcryptjs');const sharp=require('sharp');
const {Store}=require('../backend/storage');const {createApp}=require('../backend/server');
const {sourceDigest,readCurrent,digest,prepareRestore,applyRestore}=require('../backend/restore-legacy');
const oid=n=>new BSON.ObjectId(n.toString(16).padStart(24,'0'));
const password=bcrypt.hashSync('legacy-student-pass',4),adminPassword=bcrypt.hashSync('current-admin-pass',4);
function source(){
 const dates={createdAt:new Date('2026-05-01T01:00:00Z'),updatedAt:new Date('2026-05-02T02:00:00Z')};
 return {users:[{_id:oid(1),username:'current-admin',email:'old-admin@example.com',password,role:'superadmin',...dates},{_id:oid(2),username:'2026000000001',email:'student@example.com',password,role:'user',active:true,emailVerified:true,nickname:'同学',emailVerificationCode:'expired-code',...dates}],items:[{_id:oid(10),name:'旧设备',code:'SAME',category:'电子产品',stock:3,available:2,maxRentalDays:7,maxRentalQty:2,requiresApproval:true,value:20,status:'available',...dates}],rentals:[{_id:oid(20),item:oid(10),user:oid(2),quantity:1,startDate:new Date('2026-05-01'),endDate:new Date('2026-05-02'),status:'active',notes:'课程实验',approvedBy:oid(1),approvedAt:dates.updatedAt,totalCost:123,conditionOnReturn:'good',...dates},{_id:oid(21),item:oid(10),user:oid(2),quantity:1,startDate:new Date('2026-05-01'),endDate:new Date('2026-05-02'),status:'returned',returnDate:dates.updatedAt,approvedBy:oid(99),damageFee:19,...dates}],comments:[{_id:oid(30),item:oid(10),user:oid(1),content:'历史评论',isPinned:true,createdAt:dates.createdAt}]};
}
async function fixture(t){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'rental-recovery-test-'));const filename=path.join(root,'rental.sqlite');const store=new Store(filename);
 const admin=store.insert('users',{id:'current-admin-id',username:'current-admin',email:'current@example.com',password:adminPassword,role:'superadmin',emailVerified:true,passwordVersion:7,nickname:'现任管理员'});
 const image=await sharp({create:{width:4,height:4,channels:3,background:'#f00'}}).webp().toBuffer();const imageName=crypto.createHash('sha256').update(image).digest('hex')+'.webp';
 fs.mkdirSync(path.join(root,'uploads'));fs.writeFileSync(path.join(root,'uploads',imageName),image);
 const item=store.insert('items',{id:'current-item',name:'当前打印机',code:'SAME',category:'固定设备',totalStock:4,availableStock:4,maxRentalDays:7,maxRentalQty:1,requireApproval:true,value:0,status:'available',image:'/uploads/'+imageName});
 store.insert('rentals',{id:'current-rental',userId:admin.id,itemId:item.id,itemName:item.name,itemCode:item.code,quantity:1,startDate:'2026-10-23',endDate:'2026-10-23',startTime:'12:00',endTime:'14:00',bookingMode:'timeslot',status:'rejected'});
 store.insert('verification_codes',{id:'current-code',email:admin.email,purpose:'profile',userId:admin.id,codeHash:'current-hash',expiresAt:9999999999999});
 t.after(async()=>{try{store.close()}catch{}if(!path.resolve(root).startsWith(path.join(os.tmpdir(),'rental-recovery-test-')))throw new Error('Unexpected test directory');await fsp.rm(root,{recursive:true,force:true})});
 const old=source(),options={sourceAdminId:String(oid(1)),targetAdminId:admin.id,sourceItemId:String(oid(10)),targetItemId:item.id,expectedSha:sourceDigest(old)};
 return {root,filename,store,admin,item,image,imageName,old,options};
}

test('recovery preserves current rows, bcrypt login, stock and time modes; complete archive and pinned image backup survive',async t=>{
 const h=await fixture(t),before=readCurrent(h.store.db);const report=await applyRestore(h.store,h.old,h.options);
 assert.deepEqual(report.added,{users:1,items:1,rentals:2,comments:1});assert.equal(report.mergedAdministrators,1);assert.equal(report.renamedItemCodes.length,1);assert.equal(report.missingHistoricalApprovers,1);
 assert.deepEqual(h.store.get('users',h.admin.id),h.admin);assert.equal(h.store.get('users','atlas-'+oid(2)).password,password);
 const item=h.store.get('items','atlas-'+oid(10));assert.equal(item.availableStock,2);assert.equal(item.totalStock,3);assert.equal(item.category,'电子模块');assert.match(item.code,/SAME-OLD-/);
 const active=h.store.get('rentals','atlas-'+oid(20));assert.equal(active.status,'active');assert.equal(active.bookingMode,'daily');assert.equal(active.approvedBy,h.admin.id);assert.equal(active.startDate,'2026-05-01');assert.equal(active.itemCode,'SAME');
 assert.equal(h.store.get('rentals','atlas-'+oid(21)).approvedBy,null);assert.equal(h.store.get('comments','atlas-'+oid(30)).userId,h.admin.id);
 const archive=h.store.db.prepare('SELECT * FROM legacy_restore_runs').get();const recovered=BSON.EJSON.parse(archive.sourcePayload);
 assert.equal(sourceDigest(recovered),sourceDigest(h.old));assert.equal(recovered.rentals[0].totalCost,123);assert.equal(recovered.users[1].emailVerificationCode,'expired-code');assert.equal(h.store.all('verification_codes').length,1);
 assert.match(report.backup,/recovery-backups/);assert.deepEqual(fs.readFileSync(path.join(report.backup+'.images',h.imageName)),h.image);
 const backup=new DatabaseSync(report.backup,{readOnly:true});try{assert.equal(digest(readCurrent(backup)),digest(before))}finally{backup.close()}
 const app=createApp({store:h.store,jwtSecret:'recovery-test-secret-at-least-24',rateLimits:false,emailService:{isConfigured:()=>false}});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 try{for(const [username,pwd]of[['current-admin','current-admin-pass'],['2026000000001','legacy-student-pass']]){
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:pwd})});assert.equal(response.status,200);
 }}finally{await new Promise(resolve=>server.close(resolve))}
});

test('same snapshot is idempotent while another snapshot, missing hash and source mismatches cannot modify target',async t=>{
 const h=await fixture(t);await assert.rejects(applyRestore(h.store,h.old,{...h.options,expectedSha:'f'.repeat(64)}),/SHA/);
 await applyRestore(h.store,h.old,h.options);const before=digest(readCurrent(h.store.db));
 assert.equal((await applyRestore(h.store,h.old,h.options)).alreadyApplied,true);assert.equal(digest(readCurrent(h.store.db)),before);
 h.old.users[1].nickname='已变化';await assert.rejects(applyRestore(h.store,h.old,{...h.options,expectedSha:sourceDigest(h.old)}),/不同快照/);assert.equal(digest(readCurrent(h.store.db)),before);
});

test('only the explicit superadmin pair can merge; unknown identity and email collisions fail closed',async t=>{
 const h=await fixture(t),current=readCurrent(h.store.db);assert.throws(()=>prepareRestore(h.old,current,{...h.options,sourceAdminId:String(oid(99))}),/冲突|映射/);
 assert.throws(()=>prepareRestore(h.old,current,{...h.options,targetAdminId:'not-here'}),/映射/);
 const role=source();role.users[0].role='admin';assert.throws(()=>prepareRestore(role,current,h.options),/映射/);
 const email=source();email.users[1].email=h.admin.email;assert.throws(()=>prepareRestore(email,current,h.options),/邮箱冲突/);
 assert.equal(digest(readCurrent(h.store.db)),digest(current));
});

test('invalid source quantities, dates, passwords and broken required references produce no partial records',async t=>{
 const h=await fixture(t),before=digest(readCurrent(h.store.db));
 for(const mutate of [s=>{s.users[1].password='plaintext'},s=>{s.rentals[0].user=oid(98)},s=>{s.items[0].available=3},s=>{s.rentals[0].quantity=-1},s=>{s.rentals[0].endDate='invalid'},s=>{s.items[0].name='<script>'},s=>{s.comments[0].item=oid(98)}]){
  const old=source();mutate(old);await assert.rejects(applyRestore(h.store,old,{...h.options,expectedSha:sourceDigest(old)}));assert.equal(digest(readCurrent(h.store.db)),before);
 }
});

test('backup failure, missing image and a write during backup abort recovery without losing the concurrent change',async t=>{
 const h=await fixture(t),before=digest(readCurrent(h.store.db));
 await assert.rejects(applyRestore(h.store,h.old,{...h.options,backup:async()=>{throw new Error('disk full')}}),/disk full/);assert.equal(digest(readCurrent(h.store.db)),before);
 await assert.rejects(applyRestore(h.store,h.old,{...h.options,backup:async()=>{
  const filename=await h.store.backup(path.join(h.root,'damaged-backup'));fs.unlinkSync(path.join(filename+'.images',h.imageName));return filename;
 }}),/图片/);assert.equal(digest(readCurrent(h.store.db)),before);
 await assert.rejects(applyRestore(h.store,h.old,{...h.options,backup:async()=>{
  const filename=await h.store.backup(path.join(h.root,'concurrent-backup'));
  h.store.db.prepare('UPDATE verification_codes SET attempts=1 WHERE id=?').run('current-code');return filename;
 }}),/目标数据发生变化/);
 assert.equal(h.store.all('users').length,1);assert.equal(h.store.get('verification_codes','current-code').attempts,1);assert.equal(h.store.db.prepare("SELECT name FROM sqlite_master WHERE name='legacy_restore_runs'").get(),undefined);
});

test('late failure rolls back users, items, rentals and archive together',async t=>{
 const h=await fixture(t);h.store.db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON comments WHEN NEW.id LIKE 'atlas-%' BEGIN SELECT RAISE(ABORT,'injected late failure'); END");
 const before=digest(readCurrent(h.store.db));await assert.rejects(applyRestore(h.store,h.old,h.options),/injected/);assert.equal(digest(readCurrent(h.store.db)),before);
});

test('source digest covers all BSON fields independently of record/key ordering',()=>{
 const a=source(),b=source();b.users.reverse();b.items[0]=Object.fromEntries(Object.entries(b.items[0]).reverse());assert.equal(sourceDigest(a),sourceDigest(b));
 b.users[0].emailVerificationCode='different';assert.notEqual(sourceDigest(a),sourceDigest(b));
});

test('CLI dry-run is byte-preserving; missing targets are never created; failures do not echo private data',async t=>{
 const h=await fixture(t),input=path.join(h.root,'source.json');fs.writeFileSync(input,BSON.EJSON.stringify(h.old));
 const cli=path.join(__dirname,'../backend/restore-legacy.js'),before=fs.readFileSync(h.filename);
 const args=['--file',input,'--db',h.filename,'--source-admin-id',h.options.sourceAdminId,'--target-admin-id',h.admin.id,'--source-item-id',h.options.sourceItemId,'--target-item-id',h.item.id];
 const dry=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).mode,'dry-run');assert.deepEqual(fs.readFileSync(h.filename),before);
 const missing=path.join(h.root,'missing.sqlite');const refused=spawnSync(process.execPath,[cli,'--db',missing],{encoding:'utf8'});assert.notEqual(refused.status,0);assert.equal(fs.existsSync(missing),false);
 h.old.users[1].password='do-not-log-private-password';fs.writeFileSync(input,BSON.EJSON.stringify(h.old));const invalid=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
 assert.notEqual(invalid.status,0);assert.doesNotMatch(invalid.stdout+invalid.stderr,/do-not-log-private-password|student@example/);
});

test('CLI rejects wrong/missing SHA and invalid admin mapping before a WAL target is opened for writing',async t=>{
 const h=await fixture(t),input=path.join(h.root,'source.json');fs.writeFileSync(input,BSON.EJSON.stringify(h.old));
 h.store.db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE)');const before=fs.readFileSync(h.filename),schema=digest(readCurrent(h.store.db));
 const cli=path.join(__dirname,'../backend/restore-legacy.js'),base=['--file',input,'--db',h.filename,'--source-admin-id',h.options.sourceAdminId,'--target-admin-id',h.admin.id,'--source-item-id',h.options.sourceItemId,'--target-item-id',h.item.id,'--apply'];
 for(const [extra,pattern]of [[[],/来源SHA/],[['--expected-sha','f'.repeat(64)],/SHA不匹配/],[['--expected-sha',h.options.expectedSha,'--target-admin-id','wrong-target'],/映射不匹配/]]){
  const r=spawnSync(process.execPath,[cli,...base,...extra],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,pattern);assert.equal(h.store.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.deepEqual(fs.readFileSync(h.filename),before);assert.equal(digest(readCurrent(h.store.db)),schema);
 }
});

test('only the reviewed item pair can rename its code; new or mismatched target conflicts stop recovery',async t=>{
 const h=await fixture(t),before=readCurrent(h.store.db);
 assert.throws(()=>prepareRestore(h.old,before,{...h.options,sourceItemId:undefined,targetItemId:undefined}),/未审查/);
 assert.throws(()=>prepareRestore(h.old,before,{...h.options,targetItemId:'different'}),/映射不匹配/);
 h.store.insert('items',{...h.item,id:'another-current-item',name:'另一当前物品',code:'EXTRA'});
 const old=source();old.items.push({...old.items[0],_id:oid(11),code:'EXTRA'});
 await assert.rejects(applyRestore(h.store,old,{...h.options,expectedSha:sourceDigest(old)}),/未审查/);assert.equal(h.store.all('users').length,1);
});
