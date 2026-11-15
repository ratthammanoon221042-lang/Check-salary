/**
 * API ฝั่งพนักงาน
 */

function tsToClient_(t) {
  return {
    id: t.id,
    employeeId: t.employeeId,
    employeeName: t.employeeName,
    email: t.email,
    period: t.period,
    periodLabel: periodLabel_(t.period),
    version: t.version,
    status: t.status,
    fileName: t.fileName,
    mimeType: t.mimeType,
    fileHash: t.fileHash,
    uploadedAt: iso_(t.uploadedAt),
    firstViewedAt: iso_(t.firstViewedAt),
    lastViewedAt: iso_(t.lastViewedAt),
    viewCount: t.viewCount || 0,
    confirmedAt: iso_(t.confirmedAt),
    confirmDetail: t.confirmDetail,
    supersededAt: iso_(t.supersededAt)
  };
}

function msgToClient_(m) {
  return {
    id: m.id,
    timesheetId: m.timesheetId,
    sender: m.sender,
    senderEmail: m.senderEmail,
    message: m.message,
    createdAt: iso_(m.createdAt)
  };
}

function byCreated_(a, b) {
  return (a.createdAt ? a.createdAt.getTime() : 0) - (b.createdAt ? b.createdAt.getTime() : 0);
}

function findTimesheet_(id) {
  const all = readAll_(SCHEMA.TIMESHEETS);
  for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

/** ข้อความทั้งหมดของทุกฉบับในรอบเดือนเดียวกัน (ให้บทสนทนาต่อเนื่องเมื่อมีฉบับแก้ไข) */
function threadFor_(ts, allTimesheets, allMessages) {
  const ids = {};
  allTimesheets.forEach(function (t) {
    if (t.employeeId === ts.employeeId && t.period === ts.period) ids[t.id] = t.version;
  });
  return allMessages
    .filter(function (m) { return ids.hasOwnProperty(m.timesheetId); })
    .sort(byCreated_)
    .map(function (m) {
      const o = msgToClient_(m);
      o.version = ids[m.timesheetId];
      return o;
    });
}

function fileData_(ts) {
  const file = DriveApp.getFileById(ts.fileId);
  const blob = file.getBlob();
  return {
    id: ts.id,
    fileName: ts.fileName,
    mimeType: ts.mimeType || blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function requireOwnTimesheet_(s, id) {
  const ts = findTimesheet_(String(id || ''));
  if (!ts || ts.employeeId !== s.employee.employeeId) throw new Error('ไม่พบใบลงเวลานี้');
  if (ts.status === STATUS.SUPERSEDED) throw new Error('ใบลงเวลาฉบับนี้ถูกแทนที่ด้วยฉบับใหม่แล้ว กรุณารีเฟรชหน้า');
  return ts;
}

/** หน้าเว็บเรียก: รายการใบลงเวลาของฉัน */
function emp_listMyTimesheets(token) {
  const s = requireEmployee_(token);
  const all = readAll_(SCHEMA.TIMESHEETS);
  const msgs = readAll_(SCHEMA.MESSAGES);
  const mine = all.filter(function (t) {
    return t.employeeId === s.employee.employeeId && t.status !== STATUS.SUPERSEDED;
  });
  mine.sort(function (a, b) { return a.period < b.period ? 1 : a.period > b.period ? -1 : 0; });
  return {
    profile: { name: s.employee.name, employeeId: s.employee.employeeId, email: s.email },
    timesheets: mine.map(function (t) {
      const o = tsToClient_(t);
      o.messages = threadFor_(t, all, msgs);
      return o;
    })
  };
}

/** หน้าเว็บเรียก: เปิดดูไฟล์ (บันทึกเวลาที่เปิดดู) */
function emp_getFile(token, id) {
  const s = requireEmployee_(token);
  const data = withLock_(function () {
    const ts = requireOwnTimesheet_(s, id);
    const now = new Date();
    if (!ts.firstViewedAt) ts.firstViewedAt = now;
    ts.lastViewedAt = now;
    ts.viewCount = (ts.viewCount || 0) + 1;
    updateObj_(SCHEMA.TIMESHEETS, ts);
    audit_(s.email, 'employee', 'เปิดดูใบลงเวลา', ts.id, periodLabel_(ts.period) + ' ฉบับที่ ' + ts.version);
    return { ts: ts };
  });
  const out = fileData_(data.ts);
  out.timesheet = tsToClient_(data.ts);
  return out;
}

/** หน้าเว็บเรียก: ยืนยันว่าใบลงเวลาถูกต้อง */
function emp_confirm(token, id, clientInfo) {
  const s = requireEmployee_(token);
  return withLock_(function () {
    const ts = requireOwnTimesheet_(s, id);
    if (ts.status === STATUS.CONFIRMED) throw new Error('ใบลงเวลานี้ยืนยันไปแล้ว');
    if (!ts.firstViewedAt) throw new Error('กรุณาเปิดดูใบลงเวลาก่อนกดยืนยัน');
    const now = new Date();
    const ua = clientInfo && clientInfo.userAgent ? String(clientInfo.userAgent).slice(0, 300) : '';
    ts.status = STATUS.CONFIRMED;
    ts.confirmedAt = now;
    ts.confirmDetail = 'ยืนยันโดย ' + s.email +
      ' | เวลา ' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss') + ' (เวลาประเทศไทย)' +
      ' | ฉบับที่ ' + ts.version +
      ' | SHA-256 ' + ts.fileHash +
      (ua ? ' | อุปกรณ์ ' + ua : '');
    updateObj_(SCHEMA.TIMESHEETS, ts);
    audit_(s.email, 'employee', 'ยืนยันใบลงเวลา', ts.id, ts.confirmDetail);
    return tsToClient_(ts);
  });
}

/** หน้าเว็บเรียก: แจ้งขอแก้ไข / ส่งข้อความเพิ่มเติม */
function emp_requestCorrection(token, id, message) {
  const s = requireEmployee_(token);
  message = String(message || '').trim();
  if (!message) throw new Error('กรุณาระบุรายละเอียดที่ต้องการแก้ไข');
  if (message.length > MAX_MESSAGE_LEN) throw new Error('ข้อความยาวเกิน ' + MAX_MESSAGE_LEN + ' ตัวอักษร');
  return withLock_(function () {
    const ts = requireOwnTimesheet_(s, id);
    if (ts.status === STATUS.CONFIRMED) throw new Error('ใบลงเวลานี้ยืนยันแล้ว ไม่สามารถแจ้งแก้ไขได้');
    appendObj_(SCHEMA.MESSAGES, {
      id: newId_('M'),
      timesheetId: ts.id,
      employeeId: ts.employeeId,
      sender: SENDER.EMPLOYEE,
      senderEmail: s.email,
      message: message,
      createdAt: new Date()
    });
    ts.status = STATUS.CORRECTION;
    updateObj_(SCHEMA.TIMESHEETS, ts);
    audit_(s.email, 'employee', 'แจ้งขอแก้ไข', ts.id, message);
    const all = readAll_(SCHEMA.TIMESHEETS);
    const o = tsToClient_(ts);
    o.messages = threadFor_(ts, all, readAll_(SCHEMA.MESSAGES));
    return o;
  });
}
