const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function fixture(api){
  const html=fs.readFileSync(path.join(__dirname,'../frontend/public/app.html'),'utf8');
  const source=html.slice(html.indexOf('let rejectionState='),html.indexOf('function renderAdminPickup()'));
  const nodes=new Map(),messages=[];
  const node=id=>{
    if(!nodes.has(id)){const classes=new Set(['hidden']);nodes.set(id,{value:'',textContent:'',disabled:false,isConnected:true,focus(){this.focused=true},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}})}
    return nodes.get(id);
  };
  const context=vm.createContext({allRentals:[{id:'r1',itemName:'3D打印机',status:'pending'}],document:{getElementById:node,activeElement:node('trigger')},api,toast:(...args)=>messages.push(args),renderAdminApprovals(){},enableBtn:b=>{b.disabled=false},disableBtn:b=>{b.disabled=true},prompt(){throw new Error('prompt() is not supported')}});
  vm.runInContext(source,context);
  return {context,node,messages,run:code=>vm.runInContext(code,context)};
}
test('reject opens an inline dialog without native prompt; cancel and reopen do not lock the action',()=>{
  const h=fixture(()=>{throw new Error('unexpected request')});
  h.run("rejectRental('r1')");assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),false);
  assert.match(h.node('reject-rental-summary').textContent,/3D打印机/);assert.equal(h.node('reject-rental-reason').focused,true);
  h.run('closeRejectRentalModal()');assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),true);
  h.run("rejectRental('r1')");assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),false);
});
test('inline rejection prevents double submission and submits reason; processed row closes and no lock remains',async()=>{
  const calls=[];let resolve;
  const h=fixture((method,url,body)=>{calls.push({method,url,body});return method==='PUT'?new Promise(done=>{resolve=done}):Promise.resolve([{id:'r1',status:'rejected'}])});
  h.run("rejectRental('r1')");h.node('reject-rental-reason').value='  设备维护，暂不开放  ';
  const pending=h.run('submitRejectRental()');await h.run('submitRejectRental()');h.run('closeRejectRentalModal()');
  assert.equal(calls.length,1);assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),false);
  assert.equal(calls[0].body.adminNotes,'设备维护，暂不开放');
  resolve({rental:{id:'r1',status:'rejected'}});await pending;
  assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),true);assert.equal(h.node('reject-rental-submit').disabled,false);
  assert.equal(h.run('rejectionBusy'),false);assert.equal(h.run('allRentals[0].status'),'rejected');
});
test('failed rejection keeps reason, unlocks retry, and successful mutation is not mislabeled if refresh fails',async()=>{
  let attempts=0;
  const h=fixture(async method=>{if(method==='GET')throw new Error('offline refresh');if(++attempts===1)throw new Error('请求超时，请重试');return{rental:{id:'r1',status:'rejected'}}});
  h.run("rejectRental('r1')");h.node('reject-rental-reason').value='稍后再预约';
  await h.run('submitRejectRental()');assert.equal(h.node('reject-rental-reason').value,'稍后再预约');assert.match(h.node('reject-rental-error').textContent,/超时/);
  assert.equal(h.run('rejectionBusy'),false);assert.equal(h.node('reject-rental-submit').disabled,false);
  await h.run('submitRejectRental()');assert.equal(h.run('allRentals[0].status'),'rejected');
  assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),true);assert.ok(h.messages.some(m=>m[0].includes('已拒绝，但列表刷新失败')));
});
test('empty reason has a default, overlong reason is rejected locally, and refresh keeps submissions serialized',async()=>{
  const calls=[];let finishRefresh;
  const h=fixture((method,url,body)=>{calls.push({method,url,body});return method==='PUT'?Promise.resolve({rental:{id:'r1',status:'rejected'}}):new Promise(done=>{finishRefresh=done})});
  h.run("rejectRental('r1')");h.node('reject-rental-reason').value='字'.repeat(1001);await h.run('submitRejectRental()');
  assert.equal(calls.length,0);assert.match(h.node('reject-rental-error').textContent,/1000/);
  h.node('reject-rental-reason').value='';const pending=h.run('submitRejectRental()');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0].body.adminNotes,'未通过');assert.equal(h.run('rejectionBusy'),true);
  h.run('closeRejectRentalModal()');assert.equal(h.node('reject-rental-modal').classList.contains('hidden'),false);
  await h.run('submitRejectRental()');assert.equal(calls.filter(c=>c.method==='PUT').length,1);
  finishRefresh([{id:'r1',status:'rejected'}]);await pending;assert.equal(h.run('rejectionBusy'),false);
});
