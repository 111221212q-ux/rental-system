const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const uiModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/public/rental-ui.js'),'utf8'),{module:uiModule,Date});
const ui=uiModule.exports;
const date='2030-01-02',now=Date.parse('2030-01-01T23:00:00+08:00');
const data=(bookings=[],capacity=2)=>({date,capacity,bookings});

test('timeline sweeps overlapping quantities, preserves half-open adjacency and checks the full chosen range',()=>{
  const model=ui.availability(data([{startTime:'09:00',endTime:'12:00',quantity:1},{startTime:'10:00',endTime:'11:00',quantity:2},{startTime:'12:00',endTime:'14:00',quantity:3}],3),{quantity:2,now});
  assert.equal(model.segments.find(s=>s.start===600).remaining,0);
  assert.equal(ui.selection(model,'09:00','10:00').valid,true);
  assert.equal(ui.selection(model,'09:00','11:30').valid,false);
  assert.equal(ui.selection(model,'11:00','12:00').valid,true);
  assert.equal(ui.selection(model,'14:00','15:00').valid,true);
  assert.equal(ui.selection(model,'15:00','14:00').valid,false);
  const adjacent=ui.availability(data([{startTime:'12:00',endTime:'14:00',quantity:1},{startTime:'14:00',endTime:'16:00',quantity:1}],1),{now});
  assert.equal(Math.max(...adjacent.segments.map(s=>s.used)),1);
});

test('Beijing current minute rounds up, future and past days differ, 24:00 never becomes an input value',()=>{
  const current=ui.availability(data(),{now:Date.parse(date+'T12:13:07+08:00')});
  assert.equal(current.cutoff,734);
  assert.equal(ui.selection(current,'12:13','14:00').valid,false);
  assert.equal(ui.selection(current,'12:14','14:00').valid,true);
  assert.equal(ui.availability(data(),{now}).cutoff,0);
  assert.equal(ui.availability(data(),{now:Date.parse('2030-01-03T00:00:00+08:00')}).segments.some(s=>s.selectable),false);
  const late=ui.availability(data(),{now:Date.parse(date+'T23:59:00+08:00')});
  assert.equal(late.segments.some(s=>s.selectable),false);
  assert.doesNotMatch(ui.timeline(current),/data-slot-end="24:00"/);
  assert.match(ui.timeline(current),/data-slot-end="23:59"/);
  assert.throws(()=>ui.minute('24:00'));
});

test('quantity changes, legacy bookings and invalid API data never advertise false availability',()=>{
  const bookings=[{startTime:'10:00',endTime:'12:00',quantity:1}];
  assert.equal(ui.selection(ui.availability(data(bookings),{quantity:1,now}),'10:00','11:00').valid,true);
  assert.equal(ui.selection(ui.availability(data(bookings),{quantity:2,now}),'10:00','11:00').valid,false);
  const blocked=ui.availability({...data(),legacyBlocked:true},{now});
  assert.equal(blocked.segments.some(s=>s.selectable),false);
  assert.equal(ui.selection(blocked,'10:00','11:00').valid,false);
  assert.doesNotMatch(ui.timeline(blocked),/data-slot-start/);
  assert.equal(ui.availability(data([],0),{now}).segments.some(s=>s.selectable),false);
  for(const invalid of [{...data(),capacity:'2'},{...data(),bookings:[{startTime:'<img>',endTime:'12:00',quantity:1}]},{...data(),bookings:[{startTime:'12:00',endTime:'11:00',quantity:1}]}])assert.throws(()=>ui.availability(invalid,{now}));
});

test('image URLs and text are escaped, and image failure affects only the media fallback',()=>{
  assert.doesNotMatch(ui.imageMarkup({image:'javascript:alert(1)',name:'x',category:'固定设备'}),/<img/);
  const html=ui.imageMarkup({image:'https://example.com/image.png',name:'"><img src=x>',category:'<script>x</script>'});
  assert.match(html,/loading="lazy"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|alt=""><img/);
  const outer={title:'3D打印机',button:'查看详情'},classes=new Set(['hidden']),message={};
  const fallback={classList:{remove:c=>classes.delete(c)},querySelector:()=>message};
  const image={onerror:()=>{},hidden:false,previousElementSibling:fallback,parentElement:{parentElement:outer}};
  ui.imageFailed(image);
  assert.equal(image.hidden,true);assert.equal(classes.has('hidden'),false);assert.equal(message.textContent,'图片暂不可用');
  assert.deepEqual(outer,{title:'3D打印机',button:'查看详情'});
});

function fixture(api){
  const html=fs.readFileSync(path.join(__dirname,'../frontend/public/app.html'),'utf8');
  const source=html.slice(html.indexOf('const equipmentViews='),html.indexOf('function gt()'));
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{id,value:id.endsWith('-qty')?'1':id.endsWith('-start')?date:'',dataset:{},textContent:'',innerHTML:'',children:[],setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},remove(){nodes.delete(id)},appendChild(child){this.children.push(child)},contains(){return true}});
    return nodes.get(id);
  }
  const context=vm.createContext({RentalUI:ui,Date,Map,Number,api,document:{getElementById:node,createElement:()=>({})},beijingDate:()=>date,isFixedEquipment:i=>i.category==='固定设备'});
  vm.runInContext(source,context);
  return {node,nodes,run:code=>vm.runInContext(code,context)};
}

test('late availability replies cannot overwrite a newer date; forms have independent request state',async()=>{
  const requests=[];const h=fixture(()=>new Promise(resolve=>requests.push(resolve)));
  const first=h.run("loadEquipmentAvailability('detail-rental','printer')");
  h.node('detail-rental-start').value='2030-01-03';
  const second=h.run("loadEquipmentAvailability('detail-rental','printer')");
  const modal=h.run("loadEquipmentAvailability('rental','printer')");
  requests[1]({...data(),date:'2030-01-03',capacity:3});await second;
  requests[2](data([],4));await modal;
  requests[0](data([],1));await first;
  assert.equal(h.run("equipmentModel('detail-rental').capacity"),3);
  assert.equal(h.run("equipmentModel('rental').capacity"),4);
  assert.match(h.node('detail-rental-availability').innerHTML,/总容量 3 台/);
});

test('loading, clear date, failure, retry and replaced forms discard stale data and reject wrong-date replies',async()=>{
  let result=data();const h=fixture(async()=>{if(result instanceof Error)throw result;return result});
  await h.run("loadEquipmentAvailability('rental','printer')");
  result=new Error('offline');await h.run("loadEquipmentAvailability('rental','printer')");
  assert.equal(h.run("equipmentModel('rental')"),null);
  assert.match(h.node('rental-availability').textContent,/offline/);
  const retry=h.node('rental-availability').children.find(n=>n.textContent==='重新查询');assert.ok(retry);
  h.node('rental-start').setAttribute('aria-invalid','true');h.node('rental-start-error').textContent='请先成功查询当天预约余量';h.node('rental-error').textContent='请先成功查询当天预约余量';
  result=data([],5);await retry.onclick();assert.equal(h.run("equipmentModel('rental').capacity"),5);
  assert.equal(h.node('rental-start')['aria-invalid'],undefined);assert.equal(h.nodes.has('rental-start-error'),false);assert.equal(h.node('rental-error').textContent,'');
  h.node('rental-start').value='';await h.run("loadEquipmentAvailability('rental','printer')");
  assert.equal(h.run("equipmentModel('rental')"),null);
  h.node('rental-start').value=date;result={...data(),date:'2030-01-03'};await h.run("loadEquipmentAvailability('rental','printer')");
  assert.equal(h.run("equipmentModel('rental')"),null);assert.match(h.node('rental-availability').textContent,/日期/);
  let resolve;const late=fixture(()=>new Promise(done=>{resolve=done}));
  const pending=late.run("loadEquipmentAvailability('rental','printer')");
  late.nodes.delete('rental-availability');const replacement=late.node('rental-availability');
  resolve(data());await pending;assert.equal(replacement.innerHTML,'');assert.equal(late.run("equipmentModel('rental')"),null);
});

test('valid selection clears field feedback and 409 refreshes capacity without discarding form values',async()=>{
  let calls=0;const h=fixture(async()=>data([],++calls===1?2:0));
  await h.run("loadEquipmentAvailability('rental','printer')");
  h.node('rental-start-time').value='12:00';h.node('rental-end-time').value='14:00';h.node('rental-reason').value='课程模型';
  h.node('rental-start-time').setAttribute('aria-invalid','true');h.node('rental-start-time').setAttribute('aria-describedby','rental-start-time-error');
  h.node('rental-start-time-error').textContent='请选择开始和结束时间';h.node('rental-error').textContent='请选择开始和结束时间';
  h.run("updateBookingSelection('rental')");
  assert.equal(h.nodes.has('rental-start-time-error'),false);assert.equal(h.node('rental-start-time')['aria-invalid'],undefined);assert.equal(h.node('rental-start-time')['aria-describedby'],undefined);
  assert.equal(h.node('rental-error').textContent,'');
  await h.run("showRentalSubmissionError('rental',{id:'printer',category:'固定设备'},{status:409,message:'该时段已被预约'})");
  assert.equal(calls,2);assert.equal(h.run("equipmentModel('rental').capacity"),0);
  assert.equal(h.node('rental-start-time').value,'12:00');assert.equal(h.node('rental-reason').value,'课程模型');
  assert.match(h.node('rental-selection').textContent,/余量不足/);
  await h.run("showRentalSubmissionError('rental',{id:'printer',category:'固定设备'},{status:502,message:'网络问题'})");assert.equal(calls,2);
});
