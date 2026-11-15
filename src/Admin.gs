/**
 * API ฝั่งผู้ดูแลระบบ (เจ้าของสคริปต์เท่านั้น)
 */

function empToClient_(e) {
  return { employeeId: e.employeeId, name: e.name, email: e.email, createdAt: iso_(e.createdAt) };
}

function currentFor_(timesheets, employeeId, period) {
  let cur = null;
  timesheets.forEach(function (t) {
    if (t.employeeId === employeeId && t.period === period && t.status !== STATUS.SUPERSEDED) {
      if (!cur || t.version > cur.version) cur = t;
    }
  });
  return cur;
}

/** หน้าเว็บเรียก: ข้อมูลแดชบอร์ดของรอบเดือน */
function adm_getDashboard(token, period) {
  requireAdmin_(token);
  if (!isValidPeriod_(period)) throw new Error('รอบเดือนไม่ถูกต้อง');
  const emps = readAll_(SCHEMA.EMPLOYEES);
  const all = readAll_(SCHEMA.TIMESHEETS);
  const msgs = readAll_(SCHEMA.MESSAGES);

  const summary = { total: emps.length, notUploaded: 0, notViewed: 0, viewed: 0, correction: 0, confirmed: 0 };
  const rows = emps.map(function (e) {
    const t = currentFor_(all, e.employeeId, period);
    let thread = [];
    if (!t) summary.notUploaded++;
    else {
      thread = threadFor_(t, all, msgs);
      if (t.status === STATUS.CONFIRMED) summary.confirmed++;
      else if (t.status === STATUS.CORRECTION) summary.correction++;
      else if (t.firstViewedAt) summary.viewed++;
      else summary.notViewed++;
    }
    const last = thread.length ? thread[thread.length - 1] : null;
    return {
      employee: empToClient_(e),
      timesheet: t ? tsToClient_(t) : null,
      messageCount: thread.length,
      awaitingReply: !!(t && t.status === STATUS.CORRECTION && last && last.sender === SENDER.EMPLOYEE)
    };
  });

  // คำขอแก้ไขที่ยังไม่ได้ตอบ (ทุกรอบเดือน)
  const empIds = {};
  emps.forEach(function (e) { empIds[e.employeeId] = e; });
  const pendingReplies = [];
  all.forEach(function (t) {
    if (t.status !== STATUS.CORRECTION || !empIds[t.employeeId]) return;
    const thread = threadFor_(t, all, msgs);
    const last = thread.length ? thread[thread.length - 1] : null;
    if (last && last.sender === SENDER.EMPLOYEE) {
      pendingReplies.push({ timesheet: tsToClient_(t), employeeName: empIds[t.employeeId].name, lastMessage: last });
    }
  });
  pendingReplies.sort(function (a, b) { return a.lastMessage.createdAt < b.lastMessage.createdAt ? 1 : -1; });

  const periodSet = {};
  all.forEach(function (t) { if (isValidPeriod_(t.period)) periodSet[t.period] = true; });

  return {
    period: period,
    periodLabel: periodLabel_(period),
    summary: summary,
    rows: rows,
    pendingReplies: pendingReplies,
    periods: Object.keys(periodSet).sort().reverse()
  };
}

/** หน้าเว็บเรียก: รายละเอียดใบลงเวลา (ทุกฉบับ ข้อความ และประวัติการใช้งาน) */
function adm_getTimesheetDetail(token, id) {
  requireAdmin_(token);
  const all = readAll_(SCHEMA.TIMESHEETS);
  let ts = null;
  all.forEach(function (t) { if (t.id === id) ts = t; });
  if (!ts) throw new Error('ไม่พบใบลงเวลา');
  const versions = all.filter(function (t) { return t.employeeId === ts.employeeId && t.period === ts.period; })
    .sort(function (a, b) { return b.version - a.version; });
  const ids = {};
  versions.forEach(function (v) { ids[v.id] = v.version; });
  const auditRows = readAll_(SCHEMA.AUDIT)
    .filter(function (a) { return ids.hasOwnProperty(a.timesheetId); })
    .sort(function (a, b) { return (b.timestamp ? b.timestamp.getTime() : 0) - (a.timestamp ? a.timestamp.getTime() : 0); })
    .map(function (a) {
      return { timestamp: iso_(a.timestamp), email: a.email, role: a.role, action: a.action, detail: a.detail, version: ids[a.timesheetId] };
    });
  return {
    timesheet: tsToClient_(ts),
    versions: versions.map(tsToClient_),
    messages: threadFor_(ts, all, readAll_(SCHEMA.MESSAGES)),
    audit: auditRows
  };
}

/** หน้าเว็บเรียก: ดาวน์โหลด/ดูไฟล์ (ไม่นับเป็นการเปิดดูของพนักงาน) */
function adm_getFile(token, id) {
  requireAdmin_(token);
  const ts = findTimesheet_(String(id || ''));
  if (!ts) throw new Error('ไม่พบใบลงเวลา');
  return fileData_(ts);
}

/** หน้าเว็บเรียก: แอดมินตอบกลับคำขอแก้ไข */
function adm_reply(token, id, message) {
  const s = requireAdmin_(token);
  message = String(message || '').trim();
  if (!message) throw new Error('กรุณาพิมพ์ข้อความ');
  if (message.length > MAX_MESSAGE_LEN) throw new Error('ข้อความยาวเกิน ' + MAX_MESSAGE_LEN + ' ตัวอักษร');
  return withLock_(function () {
    const ts = findTimesheet_(String(id || ''));
    if (!ts) throw new Error('ไม่พบใบลงเวลา');
    appendObj_(SCHEMA.MESSAGES, {
      id: newId_('M'),
      timesheetId: ts.id,
      employeeId: ts.employeeId,
      sender: SENDER.ADMIN,
      senderEmail: s.email,
      message: message,
      createdAt: new Date()
    });
    audit_(s.email, 'admin', 'ตอบกลับข้อความ', ts.id, message);
    return true;
  });
}

/** หน้าเว็บเรียก: อัปโหลดใบลงเวลา (ถ้ามีฉบับเดิมในรอบเดียวกัน จะถูกแทนที่) */
function adm_uploadTimesheet(token, payload) {
  const s = requireAdmin_(token);
  payload = payload || {};
  const employeeId = String(payload.employeeId || '').trim();
  const period = String(payload.period || '');
  const mimeType = String(payload.mimeType || '');
  let fileName = String(payload.fileName || 'timesheet').replace(/[\\/:*?"<>|]/g, '_');
  if (!isValidPeriod_(period)) throw new Error('รอบเดือนไม่ถูกต้อง');
  if (ALLOWED_MIME.indexOf(mimeType) < 0) throw new Error('รองรับเฉพาะไฟล์ PDF, JPG, PNG, WEBP, GIF');
  if (!payload.base64) throw new Error('ไม่พบข้อมูลไฟล์');

  const bytes = Utilities.base64Decode(payload.base64);
  if (bytes.length > MAX_FILE_MB * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน ' + MAX_FILE_MB + ' MB');

  const emp = readAll_(SCHEMA.EMPLOYEES).filter(function (e) { return e.employeeId === employeeId; })[0];
  if (!emp) throw new Error('ไม่พบพนักงานรหัส ' + employeeId);

  return withLock_(function () {
    const all = readAll_(SCHEMA.TIMESHEETS);
    const sameEmpPeriod = all.filter(function (t) { return t.employeeId === employeeId && t.period === period; });
    let version = 1;
    sameEmpPeriod.forEach(function (t) { if (t.version >= version) version = t.version + 1; });

    const ext = (fileName.match(/\.[A-Za-z0-9]+$/) || [''])[0];
    const storedName = period + '_' + employeeId + '_v' + version + ext;
    const blob = Utilities.newBlob(bytes, mimeType, storedName);
    const file = getPeriodFolder_(period).createFile(blob);
    file.setDescription('ใบลงเวลา ' + emp.name + ' (' + employeeId + ') ' + periodLabel_(period) +
      ' ฉบับที่ ' + version + ' | ไฟล์ต้นฉบับ: ' + fileName);

    const now = new Date();
    let replaced = null;
    sameEmpPeriod.forEach(function (t) {
      if (t.status !== STATUS.SUPERSEDED) {
        replaced = t.status;
        t.status = STATUS.SUPERSEDED;
        t.supersededAt = now;
        updateObj_(SCHEMA.TIMESHEETS, t);
      }
    });

    const ts = appendObj_(SCHEMA.TIMESHEETS, {
      id: newId_('T'),
      employeeId: employeeId,
      employeeName: emp.name,
      email: emp.email,
      period: period,
      version: version,
      status: STATUS.PENDING,
      fileName: fileName,
      fileId: file.getId(),
      fileHash: sha256Hex_(bytes),
      mimeType: mimeType,
      uploadedAt: now,
      firstViewedAt: null,
      lastViewedAt: null,
      viewCount: 0,
      confirmedAt: null,
      confirmDetail: '',
      supersededAt: null
    });
    audit_(s.email, 'admin', version > 1 ? 'อัปโหลดฉบับแก้ไข' : 'อัปโหลดใบลงเวลา', ts.id,
      emp.name + ' ' + periodLabel_(period) + ' ฉบับที่ ' + version + ' (' + fileName + ')' +
      (replaced ? ' แทนที่ฉบับเดิมซึ่งมีสถานะ: ' + replaced : ''));
    return { timesheet: tsToClient_(ts), replacedStatus: replaced };
  });
}

/* ---------- จัดการพนักงาน ---------- */

/** หน้าเว็บเรียก: รายชื่อพนักงาน */
function adm_listEmployees(token) {
  requireAdmin_(token);
  const all = readAll_(SCHEMA.TIMESHEETS);
  const counts = {};
  all.forEach(function (t) {
    if (t.status === STATUS.SUPERSEDED) return;
    counts[t.employeeId] = (counts[t.employeeId] || 0) + 1;
  });
  return readAll_(SCHEMA.EMPLOYEES).map(function (e) {
    const o = empToClient_(e);
    o.timesheetCount = counts[e.employeeId] || 0;
    return o;
  });
}

function validateEmployee_(e) {
  const out = {
    employeeId: String(e.employeeId || '').trim(),
    name: String(e.name || '').trim(),
    email: normEmail_(e.email)
  };
  if (!out.employeeId) throw new Error('กรุณากรอกรหัสพนักงาน');
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(out.employeeId)) throw new Error('รหัสพนักงานใช้ได้เฉพาะ A-Z, 0-9, . _ - (ไม่เกิน 30 ตัว)');
  if (!out.name) throw new Error('กรุณากรอกชื่อพนักงาน');
  if (!isValidEmail_(out.email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  if (out.email === adminEmail_()) throw new Error('อีเมลนี้เป็นอีเมลของผู้ดูแลระบบ ใช้เป็นอีเมลพนักงานไม่ได้');
  return out;
}

/** หน้าเว็บเรียก: เพิ่มพนักงาน */
function adm_addEmployee(token, data) {
  const s = requireAdmin_(token);
  const e = validateEmployee_(data || {});
  return withLock_(function () {
    const list = readAll_(SCHEMA.EMPLOYEES);
    list.forEach(function (x) {
      if (x.employeeId.toLowerCase() === e.employeeId.toLowerCase()) throw new Error('รหัสพนักงาน ' + e.employeeId + ' มีอยู่แล้ว');
      if (normEmail_(x.email) === e.email) throw new Error('อีเมล ' + e.email + ' มีอยู่แล้ว (' + x.name + ')');
    });
    e.createdAt = new Date();
    appendObj_(SCHEMA.EMPLOYEES, e);
    audit_(s.email, 'admin', 'เพิ่มพนักงาน', '', e.employeeId + ' ' + e.name + ' <' + e.email + '>');
    return empToClient_(e);
  });
}

/** หน้าเว็บเรียก: แก้ไขชื่อ/อีเมลพนักงาน (รหัสพนักงานแก้ไม่ได้) */
function adm_updateEmployee(token, data) {
  const s = requireAdmin_(token);
  const e = validateEmployee_(data || {});
  return withLock_(function () {
    const list = readAll_(SCHEMA.EMPLOYEES);
    const cur = list.filter(function (x) { return x.employeeId === e.employeeId; })[0];
    if (!cur) throw new Error('ไม่พบพนักงานรหัส ' + e.employeeId);
    list.forEach(function (x) {
      if (x !== cur && normEmail_(x.email) === e.email) throw new Error('อีเมล ' + e.email + ' มีอยู่แล้ว (' + x.name + ')');
    });
    const before = cur.name + ' <' + cur.email + '>';
    cur.name = e.name;
    cur.email = e.email;
    updateObj_(SCHEMA.EMPLOYEES, cur);
    audit_(s.email, 'admin', 'แก้ไขข้อมูลพนักงาน', '', cur.employeeId + ': ' + before + ' → ' + cur.name + ' <' + cur.email + '>');
    return empToClient_(cur);
  });
}

/** หน้าเว็บเรียก: ลบพนักงาน (ประวัติใบลงเวลายังเก็บไว้ในชีต) */
function adm_deleteEmployee(token, employeeId) {
  const s = requireAdmin_(token);
  employeeId = String(employeeId || '');
  return withLock_(function () {
    const cur = readAll_(SCHEMA.EMPLOYEES).filter(function (x) { return x.employeeId === employeeId; })[0];
    if (!cur) throw new Error('ไม่พบพนักงานรหัส ' + employeeId);
    deleteObj_(SCHEMA.EMPLOYEES, cur);
    audit_(s.email, 'admin', 'ลบพนักงาน', '', cur.employeeId + ' ' + cur.name + ' <' + cur.email + '>');
    return true;
  });
}
