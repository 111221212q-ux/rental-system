(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RentalUI=factory();
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function minute(value){
    if(typeof value!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('时间数据无效，请刷新重试');
    const [h,m]=value.split(':').map(Number);return h*60+m;
  }
  function time(value){return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0')}
  function availability(data,{quantity=1,now=Date.now()}={}){
    const midnight=Date.parse(data.date+'T00:00:00+08:00');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||!Number.isFinite(midnight)||!Number.isInteger(data.capacity)||data.capacity<0||!Number.isInteger(quantity)||quantity<1||!Array.isArray(data.bookings))throw new Error('时段数据无效，请刷新重试');
    const cutoff=Math.min(1440,Math.max(0,Math.ceil((now-midnight)/60000)));
    const bookings=data.bookings.map(b=>{
      const start=minute(b.startTime),end=minute(b.endTime);
      if(end<=start||!Number.isInteger(b.quantity)||b.quantity<1)throw new Error('时段数据无效，请刷新重试');
      return {start,end,quantity:b.quantity};
    });
    const edges=[...new Set([0,1440,cutoff,...bookings.flatMap(b=>[b.start,b.end])])].sort((a,b)=>a-b);
    const segments=edges.slice(0,-1).map((start,i)=>{
      const end=edges[i+1],used=bookings.filter(b=>b.start<end&&b.end>start).reduce((sum,b)=>sum+b.quantity,0);
      const remaining=Math.max(0,data.capacity-used),past=end<=cutoff;
      return {start,end,used,remaining,past,selectable:!past&&!data.legacyBlocked&&remaining>=quantity&&start<Math.min(end,1439)};
    });
    return {date:data.date,capacity:data.capacity,quantity,legacyBlocked:!!data.legacyBlocked,cutoff,segments};
  }
  function selection(model,startTime,endTime){
    if(!startTime||!endTime)return {valid:false,message:'请选择开始和结束时间，也可点击下方可用区间快速填写。'};
    let start,end;try{start=minute(startTime);end=minute(endTime)}catch(e){return {valid:false,message:e.message}}
    if(end<=start)return {valid:false,message:'结束时间须晚于开始时间。'};
    if(start<model.cutoff)return {valid:false,message:'所选开始时间已过，请选择之后的时段。'};
    if(model.legacyBlocked)return {valid:false,message:'设备仍有旧的按天租借，请联系管理员。'};
    const covered=model.segments.filter(s=>s.start<end&&s.end>start);
    const remaining=Math.min(...covered.map(s=>s.remaining));
    if(remaining<model.quantity)return {valid:false,message:'所选时段余量不足，请更换时间或减少数量。'};
    return {valid:true,message:`已选 ${startTime}–${endTime} · ${model.quantity} 台 · 时段内至少剩余 ${remaining} 台`};
  }
  function timeline(model){
    if(model.legacyBlocked)return '<div class="booking-notice">该设备仍有旧的按天租借，请联系管理员结束后再预约。</div>';
    const state=s=>s.past?'past':s.remaining<model.quantity?'full':s.used?'partial':'free';
    const upcoming=model.segments.filter(s=>!s.past&&s.start<1439);
    return `<div class="availability-header"><strong>当日预约时间轴</strong><span>按 ${model.quantity} 台查看 · 总容量 ${model.capacity} 台</span></div>
      <div class="availability-legend"><span class="legend-free">可选</span><span class="legend-partial">部分占用</span><span class="legend-full">余量不足</span><span class="legend-past">已过时段</span></div>
      <div class="availability-track" aria-hidden="true">${model.segments.map(s=>`<span class="segment-${state(s)}" style="flex:${s.end-s.start}" title="${time(s.start)}–${time(s.end)}，剩余${s.remaining}台"></span>`).join('')}</div>
      <div class="availability-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      <p class="availability-help">点击可选区间填写时间，再按需要调整到分钟。最晚结束时间为 23:59。</p>
      <div class="availability-slots" role="group" aria-label="当日预约区间">${upcoming.map(s=>`<button type="button" class="availability-slot segment-${state(s)}" data-slot-start="${time(s.start)}" data-slot-end="${time(Math.min(s.end,1439))}" ${s.selectable?'':'disabled'}><strong>${time(s.start)}–${time(Math.min(s.end,1439))}</strong><span>${s.selectable?'可选 · ':'不可选 · '}余 ${s.remaining}/${model.capacity} 台</span></button>`).join('')||'<p class="booking-notice">当天已无可预约时段，请选择其他日期。</p>'}</div>`;
  }
  function imageMarkup(item,{detail=false}={}){
    const src=typeof item.image==='string'&&!/["'<>\s]/.test(item.image)&&(/^https?:\/\//i.test(item.image)||/^\/uploads\/[a-f0-9]{64}\.webp$/.test(item.image))?item.image:'';
    const paths=item.category==='固定设备'?'<rect x="4" y="7" width="24" height="18" rx="3"/><path d="M10 7V3h12v4M10 25v4h12v-4M10 15h12M24 11h.01"/>':item.category==='电机电池'?'<rect x="5" y="8" width="23" height="16" rx="3"/><path d="M28 13h3v6h-3M14 11l-4 7h6l-2 4 7-8h-6l2-3"/>':'<rect x="8" y="8" width="16" height="16" rx="3"/><path d="M12 3v5m8-5v5M12 24v5m8-5v5M3 12h5m-5 8h5m16-8h5m-5 8h5M13 13h6v6h-6z"/>';
    return `<div class="item-media${detail?' item-media-detail':''}"><div class="media-placeholder${src?' hidden':''}"><svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5">${paths}</svg><strong>${escape(item.category||'物品图片')}</strong><span class="media-fallback-text">暂无图片</span></div>${src?`<img src="${escape(src)}" alt="${escape(item.name)}" width="640" height="480" ${detail?'':'loading="lazy"'} decoding="async" onerror="RentalUI.imageFailed(this)">`:''}</div>`;
  }
  function imageFailed(image){
    image.onerror=null;image.hidden=true;
    const fallback=image.previousElementSibling;if(!fallback)return;
    fallback.classList.remove('hidden');
    const message=fallback.querySelector('.media-fallback-text');if(message)message.textContent='图片暂不可用';
  }
  return {availability,selection,timeline,imageMarkup,imageFailed,minute,time};
});
