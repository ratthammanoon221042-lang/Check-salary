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
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess_' + token, JSON.stringify({ email: email, role: role }), SESSION_TTL_SEC);
  audit_(email, role, 'เข้าสู่ระบบ', '', '');
  return { token: token, user: sessionInfo_(email, role) };
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
