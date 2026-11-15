/**
 * ============================================================
 *  ระบบตรวจสอบใบลงเวลา — โค้ดฝั่ง Google Apps Script (ไฟล์เดียว)
 * ============================================================
 *  วิธีใช้: คัดลอกไฟล์นี้ทั้งหมดไปวางแทนโค้ดใน Code.gs ของโปรเจกต์ Apps Script
 *  แล้วเลือกฟังก์ชัน setup กด Run หนึ่งครั้ง จากนั้น Deploy เป็น Web app
 *  (Execute as: Me, Who has access: Anyone) — รายละเอียดดูใน README.md
 *
 *  ไฟล์นี้ทำหน้าที่เป็น API ให้หน้าเว็บบน GitHub Pages เรียกใช้
 *  ข้อมูลเก็บใน Google Sheet และไฟล์ใบลงเวลาเก็บใน Google Drive ของคุณ
 */


/* ============================================================
 * ค่าตั้งต้น
 * ============================================================ */

/**
 * ค่าตั้งต้นของระบบ — แก้ไขได้ตามต้องการ
 */
const APP_NAME = 'ระบบตรวจสอบใบลงเวลา';
const TZ = 'Asia/Bangkok';

const OTP_TTL_SEC = 600;          // รหัส OTP ใช้ได้ 10 นาที
const OTP_COOLDOWN_SEC = 60;      // ขอรหัสใหม่ได้ทุก 1 นาที
const OTP_MAX_ATTEMPTS = 5;       // กรอกผิดได้สูงสุด 5 ครั้งต่อรหัส
const SESSION_TTL_SEC = 21600;    // อยู่ในระบบได้ 6 ชั่วโมง (สูงสุดของ CacheService)
const MAX_FILE_MB = 10;           // ขนาดไฟล์สูงสุดต่อไฟล์
const MAX_MESSAGE_LEN = 1000;

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const STATUS = {
  PENDING: 'รอตรวจสอบ',
  CORRECTION: 'ขอแก้ไข',
  CONFIRMED: 'ยืนยันแล้ว',
  SUPERSEDED: 'ถูกแทนที่'
};

const SENDER = { EMPLOYEE: 'พนักงาน', ADMIN: 'แอดมิน' };

/**
 * โครงสร้างชีต: [key ภายในโค้ด, หัวคอลัมน์ในชีต, ชนิด]
 * ชนิด: 'text' = เก็บเป็นข้อความเสมอ (กันรหัส 001 กลายเป็น 1), 'date', 'num', '' = ปกติ
 */
const SCHEMA = {
  EMPLOYEES: {
    name: 'พนักงาน',
    cols: [
      ['employeeId', 'รหัสพนักงาน', 'text'],
      ['name', 'ชื่อ-นามสกุล', 'text'],
      ['email', 'อีเมล', 'text'],
      ['createdAt', 'วันที่เพิ่ม', 'date']
    ]
  },
  TIMESHEETS: {
    name: 'ใบลงเวลา',
    cols: [
      ['id', 'รหัสใบลงเวลา', 'text'],
      ['employeeId', 'รหัสพนักงาน', 'text'],
      ['employeeName', 'ชื่อพนักงาน', 'text'],
      ['email', 'อีเมล', 'text'],
      ['period', 'รอบเดือน (ปปปป-ดด)', 'text'],
      ['version', 'ฉบับที่', 'num'],
      ['status', 'สถานะ', 'text'],
      ['fileName', 'ชื่อไฟล์', 'text'],
      ['fileId', 'Drive File ID', 'text'],
      ['fileHash', 'SHA-256 ของไฟล์', 'text'],
      ['mimeType', 'ชนิดไฟล์', 'text'],
      ['uploadedAt', 'วันที่อัปโหลด', 'date'],
      ['firstViewedAt', 'เปิดดูครั้งแรก', 'date'],
      ['lastViewedAt', 'เปิดดูล่าสุด', 'date'],
      ['viewCount', 'จำนวนครั้งที่เปิดดู', 'num'],
      ['confirmedAt', 'เวลาที่ยืนยัน', 'date'],
      ['confirmDetail', 'รายละเอียดการยืนยัน', 'text'],
      ['supersededAt', 'เวลาที่ถูกแทนที่', 'date']
    ]
  },
  MESSAGES: {
    name: 'ข้อความแก้ไข',
    cols: [
      ['id', 'รหัสข้อความ', 'text'],
      ['timesheetId', 'รหัสใบลงเวลา', 'text'],
      ['employeeId', 'รหัสพนักงาน', 'text'],
      ['sender', 'ผู้ส่ง', 'text'],
      ['senderEmail', 'อีเมลผู้ส่ง', 'text'],
      ['message', 'ข้อความ', 'text'],
      ['createdAt', 'เวลา', 'date']
    ]
  },
  AUDIT: {
    name: 'บันทึกกิจกรรม',
    cols: [
      ['timestamp', 'เวลา', 'date'],
      ['email', 'อีเมล', 'text'],
      ['role', 'บทบาท', 'text'],
      ['action', 'การกระทำ', 'text'],
      ['timesheetId', 'รหัสใบลงเวลา', 'text'],
      ['detail', 'รายละเอียด', 'text']
    ]
  }
};

/* ============================================================
 * ฐานข้อมูล Google Sheet / Drive
 * ============================================================ */

/**
 * ชั้นจัดการข้อมูลบน Google Sheet
 * ฟังก์ชันที่ลงท้ายด้วย _ เป็นฟังก์ชันภายใน
 */

let SS_CACHE_ = null;
const SHEET_CACHE_ = {};

function getSpreadsheet_() {
  if (SS_CACHE_) return SS_CACHE_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    SS_CACHE_ = SpreadsheetApp.openById(id);
    return SS_CACHE_;
  }
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create(APP_NAME + ' (ฐานข้อมูล)');
    try { ss.setSpreadsheetTimeZone(TZ); } catch (e) { /* ไม่เป็นไร */ }
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  SS_CACHE_ = ss;
  return ss;
}

function getSheet_(schema) {
  if (SHEET_CACHE_[schema.name]) return SHEET_CACHE_[schema.name];
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(schema.name);
  if (!sh) {
    sh = ss.insertSheet(schema.name);
    initSheet_(sh, schema);
  } else if (sh.getLastRow() === 0) {
    initSheet_(sh, schema);
  }
  SHEET_CACHE_[schema.name] = sh;
  return sh;
}

function initSheet_(sh, schema) {
  const headers = schema.cols.map(function (c) { return c[1]; });
  const r = sh.getRange(1, 1, 1, headers.length);
  r.setValues([headers]);
  r.setFontWeight('bold');
  r.setBackground('#e8eef7');
  sh.setFrozenRows(1);
}

function ensureAllSheets_() {
  Object.keys(SCHEMA).forEach(function (k) { getSheet_(SCHEMA[k]); });
}

function numberFormats_(schema) {
  return schema.cols.map(function (c) {
    if (c[2] === 'text') return '@';
    if (c[2] === 'date') return 'yyyy-mm-dd hh:mm:ss';
    if (c[2] === 'num') return '0';
    return 'General';
  });
}

function rowToObj_(schema, row, rowIndex) {
  const o = { _row: rowIndex };
  schema.cols.forEach(function (c, i) {
    let v = row[i];
    if (c[2] === 'text') {
      if (v instanceof Date) {
        // กันกรณีชีตแปลง "2026-11" เป็นวันที่เอง
        v = c[0] === 'period'
          ? Utilities.formatDate(v, TZ, 'yyyy-MM')
          : Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
      }
      v = v === null || v === undefined ? '' : String(v);
    } else if (c[2] === 'num') {
      v = v === '' || v === null || v === undefined ? 0 : Number(v);
    } else if (c[2] === 'date') {
      v = v instanceof Date ? v : (v ? new Date(v) : null);
    }
    o[c[0]] = v;
  });
  return o;
}

function objToRow_(schema, obj) {
  return schema.cols.map(function (c) {
    const v = obj[c[0]];
    if (v === null || v === undefined) return '';
    if (c[2] === 'text') return String(v);
    return v;
  });
}

function readAll_(schema) {
  const sh = getSheet_(schema);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, schema.cols.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    // ข้ามแถวว่าง
    if (values[i].join('') === '') continue;
    out.push(rowToObj_(schema, values[i], i + 2));
  }
  return out;
}

function writeRow_(schema, rowIndex, obj) {
  const sh = getSheet_(schema);
  const r = sh.getRange(rowIndex, 1, 1, schema.cols.length);
  r.setNumberFormats([numberFormats_(schema)]);
  r.setValues([objToRow_(schema, obj)]);
}

function appendObj_(schema, obj) {
  const sh = getSheet_(schema);
  const row = sh.getLastRow() + 1;
  writeRow_(schema, row, obj);
  obj._row = row;
  return obj;
}

function updateObj_(schema, obj) {
  if (!obj._row) throw new Error('ไม่พบตำแหน่งแถวของข้อมูล');
  writeRow_(schema, obj._row, obj);
  return obj;
}

function deleteObj_(schema, obj) {
  getSheet_(schema).deleteRow(obj._row);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function audit_(email, role, action, timesheetId, detail) {
  try {
    appendObj_(SCHEMA.AUDIT, {
      timestamp: new Date(),
      email: email || '',
      role: role || '',
      action: action,
      timesheetId: timesheetId || '',
      detail: detail || ''
    });
  } catch (e) {
    console.error('audit failed', e);
  }
}

/* ---------- Drive ---------- */

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ }
  }
  const f = DriveApp.createFolder('ใบลงเวลาพนักงาน (' + APP_NAME + ')');
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function getPeriodFolder_(period) {
  const root = getRootFolder_();
  const it = root.getFoldersByName(period);
  return it.hasNext() ? it.next() : root.createFolder(period);
}

/* ---------- Utils ---------- */

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function normEmail_(e) {
  return String(e || '').trim().toLowerCase();
}

function isValidEmail_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function iso_(d) {
  return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : '';
}

function sha256Hex_(bytesOrString) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytesOrString);
  return digest.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function isValidPeriod_(p) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''));
}

const TH_MONTHS_ = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function periodLabel_(p) {
  if (!isValidPeriod_(p)) return p;
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(5, 7));
  return TH_MONTHS_[m - 1] + ' ' + (y + 543);
}

/* ============================================================
 * การยืนยันตัวตน (OTP)
 * ============================================================ */

/**
 * การยืนยันตัวตนด้วยรหัส OTP ทางอีเมล และการจัดการ session
 */

function adminEmail_() {
  const props = PropertiesService.getScriptProperties();
  let e = '';
  try { e = Session.getEffectiveUser().getEmail(); } catch (err) { e = ''; }
  e = normEmail_(e);
  if (e) {
    if (props.getProperty('ADMIN_EMAIL') !== e) props.setProperty('ADMIN_EMAIL', e);
    return e;
  }
  return normEmail_(props.getProperty('ADMIN_EMAIL'));
}

function findEmployeeByEmail_(email) {
  email = normEmail_(email);
  const list = readAll_(SCHEMA.EMPLOYEES);
  for (let i = 0; i < list.length; i++) {
    if (normEmail_(list[i].email) === email) return list[i];
  }
  return null;
}

function roleForEmail_(email) {
  if (email && email === adminEmail_()) return 'admin';
  if (findEmployeeByEmail_(email)) return 'employee';
  return null;
}

function genOtp_() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const n = parseInt(hex, 16) % 1000000;
  return ('000000' + n).slice(-6);
}

/** หน้าเว็บเรียก: ขอรหัส OTP */
function requestOtp(email) {
  email = normEmail_(email);
  if (!isValidEmail_(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  const role = roleForEmail_(email);
  if (!role) throw new Error('ไม่พบอีเมลนี้ในรายชื่อพนักงาน กรุณาติดต่อผู้ดูแลระบบ');

  const cache = CacheService.getScriptCache();
  if (cache.get('otpcd_' + email)) {
    throw new Error('เพิ่งส่งรหัสไปเมื่อสักครู่ กรุณารอ 1 นาทีก่อนขอรหัสใหม่');
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('วันนี้ระบบส่งอีเมลครบโควตาแล้ว กรุณาลองใหม่พรุ่งนี้หรือติดต่อผู้ดูแลระบบ');
  }

  const code = genOtp_();
  const exp = Date.now() + OTP_TTL_SEC * 1000;
  cache.put('otp_' + email, JSON.stringify({ h: sha256Hex_(code + '|' + email), a: 0, exp: exp }), OTP_TTL_SEC);
  cache.put('otpcd_' + email, '1', OTP_COOLDOWN_SEC);

  const minutes = Math.round(OTP_TTL_SEC / 60);
  MailApp.sendEmail({
    to: email,
    name: APP_NAME,
    subject: 'รหัสเข้าสู่ระบบ ' + code + ' — ' + APP_NAME,
    body: 'รหัสเข้าสู่ระบบของคุณคือ ' + code + '\nรหัสนี้ใช้ได้ ' + minutes +
      ' นาที\n\nหากคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร',
    htmlBody:
      '<div style="font-family:Tahoma,sans-serif;font-size:15px;color:#1f2937">' +
      '<p>รหัสเข้าสู่ระบบ <b>' + APP_NAME + '</b> ของคุณคือ</p>' +
      '<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">' + code + '</p>' +
      '<p>รหัสนี้ใช้ได้ ' + minutes + ' นาที ห้ามบอกรหัสนี้กับผู้อื่น</p>' +
      '<p style="color:#6b7280;font-size:13px">หากคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร</p></div>'
  });
  audit_(email, role, 'ขอรหัส OTP', '', '');
  return { ok: true, minutes: minutes };
}

/** หน้าเว็บเรียก: ยืนยันรหัส OTP แล้วรับ token */
function verifyOtp(email, code) {
  email = normEmail_(email);
  code = String(code || '').replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const key = 'otp_' + email;
  const raw = cache.get(key);
  if (!raw) throw new Error('รหัสหมดอายุหรือยังไม่ได้ขอรหัส กรุณาขอรหัสใหม่');
  const rec = JSON.parse(raw);
  if (rec.a >= OTP_MAX_ATTEMPTS) {
    cache.remove(key);
    throw new Error('กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่');
  }
  if (sha256Hex_(code + '|' + email) !== rec.h) {
    rec.a += 1;
    const remainSec = Math.max(1, Math.floor((rec.exp - Date.now()) / 1000));
    cache.put(key, JSON.stringify(rec), remainSec);
    const left = OTP_MAX_ATTEMPTS - rec.a;
    throw new Error(left > 0 ? 'รหัสไม่ถูกต้อง (เหลือ ' + left + ' ครั้ง)' : 'กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่');
  }
  cache.remove(key);

  const role = roleForEmail_(email);
  if (!role) throw new Error('ไม่พบอีเมลนี้ในรายชื่อพนักงาน');
  return createSession_(email, role, 'เข้าสู่ระบบ (รหัส OTP)');
}

function createSession_(email, role, how) {
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ email: email, role: role }), SESSION_TTL_SEC);
  audit_(email, role, how, '', '');
  return { token: token, user: sessionInfo_(email, role) };
}

/** Client ID ของ Google Sign-In ตั้งค่าที่ Project Settings → Script Properties → GOOGLE_CLIENT_ID */
function googleClientId_() {
  return String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim();
}

/** หน้าเว็บเรียก: ล็อกอินด้วยบัญชี Google (ส่ง ID token ที่ได้จากปุ่ม Sign in with Google มา) */
function googleLogin(idToken) {
  const clientId = googleClientId_();
  if (!clientId) throw new Error('ผู้ดูแลยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID ใน Apps Script (Project Settings → Script Properties)');
  idToken = String(idToken || '');
  if (!/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(idToken)) throw new Error('ข้อมูลการล็อกอินไม่ถูกต้อง กรุณาลองใหม่');

  // ให้ Google ตรวจลายเซ็นและอายุของ token
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('ยืนยันบัญชี Google ไม่สำเร็จ กรุณาลองใหม่');
  const info = JSON.parse(res.getContentText());
  if (info.aud !== clientId) throw new Error('ยืนยันบัญชี Google ไม่สำเร็จ (Client ID ไม่ตรงกัน)');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') throw new Error('ยืนยันบัญชี Google ไม่สำเร็จ');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('การล็อกอินหมดอายุ กรุณาลองใหม่');
  if (String(info.email_verified) !== 'true') throw new Error('บัญชี Google นี้ยังไม่ได้ยืนยันอีเมล');

  const email = normEmail_(info.email);
  const role = roleForEmail_(email);
  if (!role) throw new Error('บัญชี ' + email + ' ไม่อยู่ในรายชื่อพนักงาน — ถ้ามีหลายบัญชี ให้เลือกบัญชีที่แจ้งไว้กับบริษัท หรือติดต่อผู้ดูแลระบบ');
  return createSession_(email, role, 'เข้าสู่ระบบ (บัญชี Google)');
}

function sessionInfo_(email, role) {
  if (role === 'admin') {
    return {
      email: email,
      role: 'admin',
      name: 'ผู้ดูแลระบบ',
      sheetUrl: getSpreadsheet_().getUrl(),
      folderUrl: getRootFolder_().getUrl()
    };
  }
  const emp = findEmployeeByEmail_(email);
  return { email: email, role: 'employee', name: emp ? emp.name : '', employeeId: emp ? emp.employeeId : '' };
}

/** หน้าเว็บเรียก: ตรวจสอบ token ที่เก็บไว้ (คืน null ถ้าหมดอายุ) */
function getSession(token) {
  try {
    const s = requireSession_(token);
    return sessionInfo_(s.email, s.role);
  } catch (e) {
    return null;
  }
}

/** หน้าเว็บเรียก: ออกจากระบบ */
function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return true;
}

function requireSession_(token) {
  if (!token || typeof token !== 'string') throw new Error('AUTH: กรุณาเข้าสู่ระบบ');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) throw new Error('AUTH: หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  const s = JSON.parse(raw);
  // ต่ออายุ session ทุกครั้งที่ใช้งาน
  cache.put('sess_' + token, raw, SESSION_TTL_SEC);
  return s;
}

function requireAdmin_(token) {
  const s = requireSession_(token);
  if (s.role !== 'admin' || s.email !== adminEmail_()) throw new Error('AUTH: ไม่มีสิทธิ์ผู้ดูแลระบบ');
  return s;
}

function requireEmployee_(token) {
  const s = requireSession_(token);
  if (s.role !== 'employee') throw new Error('AUTH: หน้านี้สำหรับพนักงานเท่านั้น');
  const emp = findEmployeeByEmail_(s.email);
  if (!emp) {
    CacheService.getScriptCache().remove('sess_' + token);
    throw new Error('AUTH: บัญชีของคุณถูกนำออกจากระบบแล้ว');
  }
  s.employee = emp;
  return s;
}

/* ============================================================
 * API ฝั่งพนักงาน
 * ============================================================ */

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

/* ============================================================
 * API ฝั่งผู้ดูแลระบบ
 * ============================================================ */

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

/* ============================================================
 * จุดรับคำขอจากหน้าเว็บ (API)
 * ============================================================ */

/** รายชื่อคำสั่งที่หน้าเว็บเรียกได้ (คำสั่งอื่นเรียกไม่ได้) */
function apiFunctions_() {
  return {
    requestOtp: requestOtp,
    verifyOtp: verifyOtp,
    googleLogin: googleLogin,
    getSession: getSession,
    logout: logout,
    emp_listMyTimesheets: emp_listMyTimesheets,
    emp_getFile: emp_getFile,
    emp_confirm: emp_confirm,
    emp_requestCorrection: emp_requestCorrection,
    adm_getDashboard: adm_getDashboard,
    adm_getTimesheetDetail: adm_getTimesheetDetail,
    adm_getFile: adm_getFile,
    adm_reply: adm_reply,
    adm_uploadTimesheet: adm_uploadTimesheet,
    adm_listEmployees: adm_listEmployees,
    adm_addEmployee: adm_addEmployee,
    adm_updateEmployee: adm_updateEmployee,
    adm_deleteEmployee: adm_deleteEmployee
  };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** หน้าเว็บส่งคำขอมาที่นี่: { fn: 'ชื่อคำสั่ง', args: [...] } */
function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = apiFunctions_()[req.fn];
    if (!fn) throw new Error('ไม่รู้จักคำสั่ง: ' + req.fn);
    const result = fn.apply(null, Array.isArray(req.args) ? req.args : []);
    return jsonOut_({ ok: true, result: result === undefined ? null : result });
  } catch (err) {
    return jsonOut_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** เปิด URL ของ Web app ในเบราว์เซอร์เพื่อเช็กว่า API พร้อมใช้งาน */
function doGet() {
  return jsonOut_({ ok: true, app: APP_NAME, message: 'API พร้อมใช้งาน — นำ URL นี้ไปใส่ใน config.js บน GitHub' });
}

/**
 * รันฟังก์ชันนี้ 1 ครั้งจาก Apps Script Editor (เลือก setup แล้วกด Run)
 * เพื่ออนุญาตสิทธิ์ และสร้างชีต + โฟลเดอร์ Drive
 */
function setup() {
  ensureAllSheets_();
  const ss = getSpreadsheet_();
  try { ss.setSpreadsheetTimeZone(TZ); } catch (e) { /* ไม่เป็นไร */ }
  const folder = getRootFolder_();
  console.log('ตั้งค่าเสร็จแล้ว');
  console.log('ฐานข้อมูล Google Sheet: ' + ss.getUrl());
  console.log('โฟลเดอร์เก็บไฟล์: ' + folder.getUrl());
  console.log('อีเมลผู้ดูแลระบบ: ' + adminEmail_());
  console.log('GOOGLE_CLIENT_ID: ' + (googleClientId_() || 'ยังไม่ได้ตั้งค่า (ต้องตั้งถ้าจะใช้ปุ่มล็อกอินด้วย Google)'));
  // เรียกครั้งเดียวเพื่อให้ Google ขอสิทธิ์เชื่อมต่อภายนอก (ใช้ตรวจการล็อกอินด้วย Google)
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', { muteHttpExceptions: true });
  console.log('ส่งอีเมลได้อีกวันนี้: ' + MailApp.getRemainingDailyQuota() + ' ฉบับ');
}
