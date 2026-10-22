// Explicit, terminal-only recovery. No HTTP route and no source database writes.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {MongoClient,BSON}=require('mongodb');
const {Store}=require('./storage');
const {referencedImages}=require('./images');
const collections=['users','items','rentals','comments'];
const tables=[...collections,'verification_codes'];
const runKey='atlas-rental-system-v1';
function fail(message){throw Object.assign(new Error(message),{recoverySafe:true})}
function canonical(value){
  if(value instanceof Date)return {$date:value.toISOString()};
  if(value&&value._bsontype==='ObjectId')return {$oid:value.toHexString()};
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
  return value;
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function oid(value){const id=typeof value==='string'?value:value?.toHexString?.();if(!/^[a-f0-9]{24}$/.test(id||''))fail('旧记录ID无效');return id}
function sourceDigest(source){
  if(Object.keys(source).some(k=>!collections.includes(k))||collections.some(k=>!Array.isArray(source[k])))fail('旧快照集合不完整或含未审查集合');
  return digest(Object.fromEntries(collections.map(k=>[k,[...source[k]].sort((a,b)=>oid(a._id).localeCompare(oid(b._id)))])));
}
function readCurrent(db){
  const version=db.prepare('PRAGMA user_version').get().user_version;if(version!==2)fail('目标必须是已有的SQLite v2数据库');
  const state={version,schema:db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()};
  for(const table of tables)state[table]=db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  state.recovery=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_restore_runs'").get()?db.prepare('SELECT * FROM legacy_restore_runs ORDER BY sourceKey').all():[];
  return state;
}
function text(value,max=1000,fallback=''){if(value==null)return fallback;if(typeof value!=='string'||value.length>max||value.includes('\0'))fail('旧文本字段格式或长度无效');return value}
function label(value,max=100){const s=text(value,max);if(!s.trim()||/[<>]/.test(s))fail('旧名称、编码或身份字段无效');return s}
function integer(value,min=0){if(!Number.isSafeInteger(value)||value<min)fail('旧数量字段无效');return value}
function bool(value,fallback=false){if(value==null)return fallback;if(typeof value!=='boolean')fail('旧布尔字段无效');return value}
function iso(value,fallback){if(value==null&&fallback)return fallback;const d=new Date(value);if(value==null||!Number.isFinite(d.getTime()))fail('旧日期字段无效');return d.toISOString()}
function day(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso(value)))}
function prepareRestore(source,current,{sourceAdminId,targetAdminId,sourceItemId,targetItemId}={}){
  const sha=sourceDigest(source),rows={users:[],items:[],rentals:[],comments:[]},userMap=new Map(),itemMap=new Map();
  const report={sourceSha256:sha,sourceCounts:Object.fromEntries(collections.map(k=>[k,source[k].length])),added:{users:0,items:0,rentals:0,comments:0},mergedAdministrators:0,renamedItemCodes:[],missingHistoricalApprovers:0};
  const seen=new Set(),checkId=(type,id)=>{const key=type+':'+id;if(seen.has(key)||current[type].some(r=>r.id==='atlas-'+id))fail('旧记录ID重复或目标含未登记的恢复记录');seen.add(key)};
  const names=new Set(current.users.map(u=>u.username)),emails=new Set(current.users.map(u=>u.email.toLowerCase())),codes=new Set(current.items.map(i=>i.code.toLowerCase()));
  if(sourceItemId||targetItemId){const from=source.items.find(i=>oid(i._id)===sourceItemId),target=current.items.find(i=>i.id===targetItemId);if(!from||!target||from.code.toLowerCase()!==target.code.toLowerCase())fail('已审查的物品编码冲突映射不匹配')}
  if(!source.users.length)fail('旧用户集合为空，拒绝恢复');
  for(const u of source.users){
    const id=oid(u._id);checkId('users',id);
    const username=label(u.username,20),email=label(u.email,254).trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('旧邮箱格式无效');
    if(!/^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(u.password||''))fail('旧密码必须是有效bcrypt哈希，未导入明文密码');
    if(!['user','admin','superadmin'].includes(u.role))fail('旧账户角色无效');
    if(id===sourceAdminId){
      const target=current.users.find(c=>c.id===targetAdminId);
      if(!target||target.role!=='superadmin'||u.role!=='superadmin'||target.username!==username)fail('已指定的管理员映射不匹配');
      userMap.set(id,target.id);report.mergedAdministrators++;continue;
    }
    if(names.has(username)||emails.has(email))fail('发现未审查的账号或邮箱冲突，未覆盖现有账户');
    names.add(username);emails.add(email);userMap.set(id,'atlas-'+id);
    const createdAt=iso(u.createdAt);
    rows.users.push({id:'atlas-'+id,username,email,password:u.password,role:u.role,active:bool(u.active,true),firstRental:bool(u.firstRental,true),emailVerified:bool(u.emailVerified),nickname:text(u.nickname,80),wechat:text(u.wechat,100),phone:text(u.phone,50),department:text(u.department,100),isTest:bool(u.isTest),createdAt,updatedAt:iso(u.updatedAt,createdAt)});
  }
  if(!sourceAdminId||!targetAdminId||report.mergedAdministrators!==1)fail('必须明确指定唯一的来源与当前管理员映射');
  for(const i of source.items){
    const id=oid(i._id);checkId('items',id);let code=label(i.code,50);
    if(codes.has(code.toLowerCase())){
      const target=current.items.find(i=>i.id===targetItemId);
      if(id!==sourceItemId||!target||target.code.toLowerCase()!==code.toLowerCase())fail('发现未审查的物品编码冲突，未恢复任何记录');
      const oldCode=code;code=code.slice(0,35)+'-OLD-'+id.slice(-6);
      if(codes.has(code.toLowerCase()))fail('旧物品的新编码也发生冲突，请人工核对');
      report.renamedItemCodes.push({sourceId:id,targetId:target.id,oldCode,newCode:code});
    }
    codes.add(code.toLowerCase());itemMap.set(id,'atlas-'+id);
    const totalStock=integer(i.stock),availableStock=integer(i.available);if(availableStock>totalStock)fail('旧物品库存不一致');
    const active=source.rentals.filter(r=>oid(r.item)===id&&['active','overdue'].includes(r.status)).reduce((sum,r)=>sum+integer(r.quantity,1),0);
    if(active+availableStock>totalStock)fail('旧借出数量与库存冲突，请先人工核对');
    if(!['available','low_stock','unavailable'].includes(i.status))fail('旧物品状态无效');
    const createdAt=iso(i.createdAt),category=label(i.category,50);
    const value=i.value??0;if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('旧物品价值无效');
    const image=text(i.image,2000),datasheetUrl=text(i.datasheetUrl,2000);
    if(image&&!/^https?:\/\/[^\s"'<>]+$/i.test(image))fail('旧图片必须是已审查的外部链接');
    if(datasheetUrl&&!/^https?:\/\/[^\s"'<>]+$/i.test(datasheetUrl))fail('旧手册链接无效');
    rows.items.push({id:'atlas-'+id,name:label(i.name,100),code,category:['电子产品','electronics'].includes(category)?'电子模块':category,description:text(i.description,5000),totalStock,availableStock,maxRentalDays:integer(i.maxRentalDays??30,1),maxRentalQty:integer(i.maxRentalQty??5,1),requireApproval:bool(i.requiresApproval),value,image,datasheetUrl,status:i.status,isTest:bool(i.isTest),createdAt,updatedAt:iso(i.updatedAt,createdAt)});
  }
  for(const r of source.rentals){
    const id=oid(r._id);checkId('rentals',id);const userId=userMap.get(oid(r.user)),itemId=itemMap.get(oid(r.item));
    if(!userId||!itemId)fail('旧借用存在缺失用户或物品');
    const item=source.items.find(i=>oid(i._id)===oid(r.item)),status=r.status==='overdue'?'active':r.status;
    if(!['pending','approved','active','returned','rejected','cancelled'].includes(status))fail('旧借用状态无效');
    const startDate=day(r.startDate),endDate=day(r.endDate);if(endDate<startDate)fail('旧借用日期逆序');
    let approvedBy=r.approvedBy?userMap.get(oid(r.approvedBy)):null;if(r.approvedBy&&!approvedBy){approvedBy=null;report.missingHistoricalApprovers++}
    const createdAt=iso(r.createdAt);
    rows.rentals.push({id:'atlas-'+id,userId,itemId,itemCode:item.code,itemName:item.name,quantity:integer(r.quantity,1),startDate,endDate,status,bookingMode:'daily',startTime:'',endTime:'',reason:text(r.notes,5000),adminNotes:text(r.rejectReason,1000),approvedBy:approvedBy??null,approvedAt:r.approvedAt?iso(r.approvedAt):null,pickedAt:r.pickedAt?iso(r.pickedAt):null,actualReturnDate:r.returnDate?iso(r.returnDate):null,isTest:bool(r.isTest),createdAt,updatedAt:iso(r.updatedAt,createdAt)});
  }
  for(const c of source.comments){
    const id=oid(c._id);checkId('comments',id);const userId=userMap.get(oid(c.user)),itemId=itemMap.get(oid(c.item));if(!userId||!itemId)fail('旧评论存在缺失用户或物品');
    const content=text(c.content,500);if(!content.length)fail('旧评论为空');const createdAt=iso(c.createdAt);
    rows.comments.push({id:'atlas-'+id,userId,itemId,content,isPinned:bool(c.isPinned),createdAt,updatedAt:iso(c.updatedAt,createdAt)});
  }
  for(const key of collections)report.added[key]=rows[key].length;
  report.expectedCounts=Object.fromEntries(collections.map(k=>[k,current[k].length+rows[k].length]));
  return {rows,report};
}
function existingRun(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_restore_runs'").get()?db.prepare('SELECT * FROM legacy_restore_runs WHERE sourceKey=?').get(runKey):null}
function validateBackup(filename,before){
  const db=new DatabaseSync(filename,{readOnly:true});try{
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length||digest(readCurrent(db))!==digest(before))fail('恢复前备份不完整或备份期间数据已变化');
    for(const name of referencedImages(db)){
      const file=path.join(filename+'.images',name);if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==name.slice(0,64))fail('恢复前备份缺少有效图片');
    }
  }finally{db.close()}
}
async function applyRestore(store,source,options){
  const sha=sourceDigest(source);if(!options.expectedSha||sha!==options.expectedSha)fail('来源SHA不匹配，未应用任何恢复数据');
  const old=existingRun(store.db);if(old){if(old.sourceSha!==sha)fail('此来源已恢复过不同快照，拒绝再次覆盖');return {...JSON.parse(old.report),alreadyApplied:true}}
  const before=readCurrent(store.db),plan=prepareRestore(source,before,options);
  const directory=options.backupDirectory||path.join(path.dirname(store.filename),'recovery-backups',sha);
  const backup=await (options.backup||(()=>store.backup(directory,Number.MAX_SAFE_INTEGER)))();validateBackup(backup,before);
  return store.transaction(()=>{
    if(existingRun(store.db)||digest(readCurrent(store.db))!==digest(before))fail('备份期间目标数据发生变化，请重新预检，未导入旧记录');
    for(const table of collections)for(const row of plan.rows[table])store.insert(table,row);
    if(store.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||store.db.prepare('PRAGMA foreign_key_check').all().length)fail('恢复后完整性或关联校验失败');
    const after=readCurrent(store.db);
    for(const table of tables)for(const row of before[table])if(digest(after[table].find(r=>r.id===row.id))!==digest(row))fail('现有数据被改变，恢复已回滚');
    for(const table of collections)if(after[table].length!==plan.report.expectedCounts[table])fail('恢复记录数量不一致');
    const report={...plan.report,backup,alreadyApplied:false};
    store.db.exec('CREATE TABLE IF NOT EXISTS legacy_restore_runs (sourceKey TEXT PRIMARY KEY, sourceSha TEXT NOT NULL, sourcePayload TEXT NOT NULL, appliedAt TEXT NOT NULL, report TEXT NOT NULL)');
    store.db.prepare('INSERT INTO legacy_restore_runs VALUES(?,?,?,?,?)').run(runKey,sha,BSON.EJSON.stringify(source,{relaxed:false}),new Date().toISOString(),JSON.stringify(report));
    return report;
  });
}
async function readMongoSnapshot(uri){
  if(typeof uri!=='string'||!/^mongodb(?:\+srv)?:\/\//.test(uri))fail('旧数据库连接格式无效');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:20000,connectTimeoutMS:10000,appName:'rental-readonly-recovery'});
  try{await client.connect();const db=client.db('rental-system'),session=client.startSession({snapshot:true});try{
    const names=(await db.listCollections().toArray()).filter(c=>!c.name.startsWith('system.')).map(c=>c.name);if(names.some(n=>!collections.includes(n))||collections.some(n=>!names.includes(n)))fail('远端集合与审查快照不符');
    const source={};for(const key of collections)source[key]=await db.collection(key).find({},{session}).sort({_id:1}).toArray();return source;
  }finally{await session.endSession()}}finally{await client.close()}
}
async function readHiddenURI(){
  const {execFileSync}=require('node:child_process');let hidden=false;
  if(process.stdin.isTTY){execFileSync('stty',['-echo'],{stdio:'inherit'});hidden=true}
  const rl=require('node:readline').createInterface({input:process.stdin,output:process.stdout,terminal:false});
  try{return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{rl.close();failTimeout()},90000);const failTimeout=()=>reject(Object.assign(new Error('等待连接信息超时'),{recoverySafe:true}));rl.question('旧库连接（隐藏输入）：',line=>{clearTimeout(timeout);resolve(line.trim())});rl.once('close',()=>{clearTimeout(timeout);reject(Object.assign(new Error('未收到旧库连接'),{recoverySafe:true}))})})}
  finally{rl.close();if(hidden)execFileSync('stty',['echo'],{stdio:'inherit'});console.log()}
}
async function main(args=process.argv.slice(2)){
  const options={};for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--apply')options.apply=true;
    else if(['--file','--db','--expected-sha','--source-admin-id','--target-admin-id','--source-item-id','--target-item-id'].includes(key)){if(!args[i+1]||args[i+1].startsWith('--'))fail('缺少恢复参数');options[key.slice(2)]=args[++i]}
    else fail('未知恢复参数');
  }
  const filename=path.resolve(options.db||process.env.SQLITE_PATH||path.join(__dirname,'data/rental.sqlite'));
  if(!options['source-admin-id']||!options['target-admin-id'])fail('必须指定来源与当前管理员ID');
  if(options.apply&&!/^[a-f0-9]{64}$/.test(options['expected-sha']||''))fail('应用恢复前必须提供审查过的来源SHA');
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())fail('目标数据库文件不存在，未创建空库');
  let current;const check=new DatabaseSync(filename,{readOnly:true});try{current=readCurrent(check)}finally{check.close()}
  const source=options.file?BSON.EJSON.parse(fs.readFileSync(options.file,'utf8')):await readMongoSnapshot(await readHiddenURI());
  const settings={sourceAdminId:options['source-admin-id'],targetAdminId:options['target-admin-id'],sourceItemId:options['source-item-id'],targetItemId:options['target-item-id'],expectedSha:options['expected-sha']};
  const sha=sourceDigest(source);if(options.apply&&sha!==settings.expectedSha)fail('来源SHA不匹配，未打开目标写连接');
  const previous=current.recovery.find(r=>r.sourceKey===runKey);
  if(previous){if(previous.sourceSha!==sha)fail('此来源已恢复过不同快照，拒绝再次覆盖');console.log(JSON.stringify({mode:options.apply?'applied':'dry-run',...JSON.parse(previous.report),alreadyApplied:true},null,2));return}
  const plan=prepareRestore(source,current,settings);
  if(!options.apply){console.log(JSON.stringify({mode:'dry-run',...plan.report},null,2));return}
  const store=new Store(filename);try{console.log(JSON.stringify({mode:'applied',...await applyRestore(store,source,settings)},null,2))}finally{store.close()}
}
if(require.main===module)main().catch(error=>{console.error('恢复失败：'+(error.recoverySafe?error.message:'读取或处理失败（'+error.name+'），请检查连接、权限或文件。'));process.exitCode=1});
module.exports={canonical,digest,sourceDigest,readCurrent,prepareRestore,validateBackup,applyRestore,readMongoSnapshot,main};
