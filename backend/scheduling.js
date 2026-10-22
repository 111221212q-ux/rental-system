const categories = ['电子模块', '电机电池', '固定设备'];
const isEquipment = item => item.category === '固定设备';
const openStatuses = new Set(['pending', 'approved', 'active']);
const slotStart = row => Date.parse(`${row.startDate}T${row.startTime}:00+08:00`);
const slotEnd = row => Date.parse(`${row.endDate}T${row.endTime}:00+08:00`);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function slotFields(startDate, endDate, startTime, endTime, now = Date.now()) {
  if (startDate !== endDate) fail(400, '固定设备请选择同一天的时间段');
  if (![startTime, endTime].every(t => typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))) fail(400, '请选择有效的开始和结束时间');
  if (startTime >= endTime) fail(400, '结束时间必须晚于开始时间');
  const row = { bookingMode: 'timeslot', startDate, endDate, startTime, endTime };
  if (slotStart(row) < now) fail(400, '预约开始时间不能早于当前时间');
  return row;
}

function openReservations(store, itemId, now = Date.now()) {
  return store.all('rentals').filter(r => r.itemId === itemId && r.bookingMode === 'timeslot' && openStatuses.has(r.status) && slotEnd(r) > now);
}
function equipmentCapacity(store, item) {
  const active = store.all('rentals').filter(r => r.itemId === item.id && r.status === 'active').reduce((sum, r) => sum + r.quantity, 0);
  return Math.min(item.totalStock, item.availableStock + active);
}
function peakUsage(reservations) {
  const events = reservations.flatMap(r => [[slotStart(r), r.quantity], [slotEnd(r), -r.quantity]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let inUse = 0, peak = 0;
  for (const [, delta] of events) { inUse += delta; peak = Math.max(peak, inUse); }
  return peak;
}
function ensureCapacity(store, item, candidate, excludeId, now = Date.now()) {
  if (candidate && store.all('rentals').some(r => r.itemId === item.id && r.bookingMode === 'daily' && openStatuses.has(r.status))) fail(409, '该设备仍有旧的按天租借，请先结束旧租借');
  const reservations = openReservations(store, item.id, now).filter(r => r.id !== excludeId);
  if (candidate) reservations.push(candidate);
  if (peakUsage(reservations) > equipmentCapacity(store, item)) fail(409, '该时段设备已被预约，或设备数量不足，请选择其他时段');
}

module.exports = { categories, isEquipment, openStatuses, slotStart, slotEnd, slotFields, openReservations, equipmentCapacity, peakUsage, ensureCapacity };
