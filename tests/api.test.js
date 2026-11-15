// ทดสอบฝั่งเซิร์ฟเวอร์ด้วย mock ของ Apps Script: node tests/api.test.js
const assert = require('assert');
const { createEnv } = require('./gasmock');
const env = createEnv({ srcDir: require('path').join(__dirname, '..', 'apps-script'), ownerEmail: 'owner@gmail.com' });
const c = (fn, ...a) => env.call(fn, a);
const expectErr = (fn, re, ...a) => { try { c(fn, ...a); } catch (e) { assert(re.test(e.message), fn + ': ' + e.message); return e.message; } throw new Error(fn + ' should fail'); };
// จำลอง ID token ของ Google
const CID = '123-abc.apps.googleusercontent.com';
const exp = String(Math.floor(Date.now() / 1000) + 3600);
let tokN = 0;
const tok = (payload) => { const t = 'h.t' + (tokN++) + '.s'; env.googleTokens[t] = Object.assign({ aud: CID, iss: 'https://accounts.google.com', exp, email_verified: 'true' }, payload); return t; };
const login = (email, empId) => {
  const r = c('googleLogin', tok({ email }));
  return r.token ? r.token : c('verifyEmployeeId', r.pending, empId).token;
};

c('setup');
// admin login
expectErr('googleLogin', /GOOGLE_CLIENT_ID/, tok({ email: 'owner@gmail.com' }));
env.props.GOOGLE_CLIENT_ID = CID;
const adm = c('googleLogin', tok({ email: 'Owner@Gmail.com' }));
assert.equal(adm.user.role, 'admin');
assert(!adm.needEmployeeId, 'admin skips employee id step');
const A = adm.token;

// employees
c('adm_addEmployee', A, { employeeId: '001', name: 'สมชาย ใจดี' });
c('adm_addEmployee', A, { employeeId: 'EMP002', name: 'สมหญิง รักงาน', email: 'ignored@example.com' }); // อีเมลไม่ใช้แล้ว
expectErr('adm_addEmployee', /มีอยู่แล้ว/, A, { employeeId: '001', name: 'dup' });
expectErr('adm_addEmployee', /มีอยู่แล้ว/, A, { employeeId: 'emp002', name: 'dup' });
expectErr('adm_addEmployee', /ชื่อ/, A, { employeeId: 'E9', name: ' ' });
let emps = c('adm_listEmployees', A);
assert.equal(emps.length, 2); assert.equal(emps[0].employeeId, '001'); assert.equal(emps[0].email, ''); assert.equal(emps[1].email, '');
c('adm_updateEmployee', A, { employeeId: 'EMP002', name: 'สมหญิง ขยัน' });
assert.equal(c('adm_listEmployees', A)[1].name, 'สมหญิง ขยัน');

// upload
const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');
expectErr('adm_uploadTimesheet', /รองรับเฉพาะ/, A, { employeeId: '001', period: '2026-11', fileName: 'a.txt', mimeType: 'text/plain', base64: pdf });
expectErr('adm_uploadTimesheet', /รอบเดือน/, A, { employeeId: '001', period: '2026-13', fileName: 'a.pdf', mimeType: 'application/pdf', base64: pdf });
const up1 = c('adm_uploadTimesheet', A, { employeeId: '001', period: '2026-11', fileName: 'a.pdf', mimeType: 'application/pdf', base64: pdf });
assert.equal(up1.timesheet.version, 1); assert.equal(up1.replacedStatus, null);
c('adm_uploadTimesheet', A, { employeeId: '001', period: '2026-10', fileName: 'oct.pdf', mimeType: 'application/pdf', base64: pdf });

let d = c('adm_getDashboard', A, '2026-11');
assert.deepEqual(d.summary, { total: 2, notUploaded: 1, notViewed: 1, viewed: 0, correction: 0, confirmed: 0 });
assert.deepEqual(d.periods, ['2026-11', '2026-10']);

// employee login & access control
expectErr('emp_listMyTimesheets', /AUTH/, A);
expectErr('adm_getDashboard', /AUTH/, 'garbage', '2026-11');
// ครั้งแรก: บัญชีไหนก็ได้ กรอกรหัสที่ยังไม่ผูก -> ผูกให้
const step1 = c('googleLogin', tok({ email: 'Somchai@Example.com' }));
assert.equal(step1.needEmployeeId, true); assert(!step1.token); assert.equal(step1.firstTime, true); assert.equal(step1.name, '');
expectErr('verifyEmployeeId', /ไม่พบรหัสพนักงาน.*เหลือ 4/, step1.pending, 'NOPE');
const E = c('verifyEmployeeId', step1.pending, ' 001 ').token;
expectErr('verifyEmployeeId', /หมดเวลา/, step1.pending, '001'); // ใช้ได้ครั้งเดียว
emps = c('adm_listEmployees', A);
assert.equal(emps[0].email, 'somchai@example.com'); assert(emps[0].linkedAt);
// ครั้งถัดไป: รู้จักชื่อแล้ว และต้องกรอกรหัสที่ผูกไว้เท่านั้น
const again = c('googleLogin', tok({ email: 'somchai@example.com' }));
assert.equal(again.firstTime, false); assert.equal(again.name, 'สมชาย ใจดี');
expectErr('verifyEmployeeId', /รหัสพนักงานไม่ถูกต้อง/, again.pending, 'EMP002'); // ใช้รหัสคนอื่นไม่ได้
// บัญชีอื่นมาใช้รหัสที่ผูกแล้ว -> ไม่ได้
const thief = c('googleLogin', tok({ email: 'thief@gmail.com' }));
expectErr('verifyEmployeeId', /ผูกกับบัญชี Google อื่นแล้ว \(s\*\*\*\*\*@example\.com\)/, thief.pending, '001');
expectErr('adm_getDashboard', /AUTH: ไม่มีสิทธิ์/, E, '2026-11');
const E2 = login('somying@example.com', 'emp002'); // ไม่สนตัวพิมพ์เล็ก-ใหญ่

let mine = c('emp_listMyTimesheets', E);
assert.equal(mine.timesheets.length, 2); assert.equal(mine.timesheets[0].period, '2026-11');
const tsId = mine.timesheets[0].id;
expectErr('emp_getFile', /ไม่พบ/, E2, tsId); // other employee can't see
expectErr('emp_confirm', /เปิดดู/, E, tsId, {}); // must view first
const f = c('emp_getFile', E, tsId);
assert.equal(Buffer.from(f.base64, 'base64').toString(), '%PDF-1.4 fake');
c('emp_getFile', E, tsId);
d = c('adm_getDashboard', A, '2026-11');
assert.equal(d.summary.viewed, 1);
assert.equal(d.rows.find(r => r.employee.employeeId === '001').timesheet.viewCount, 2);

// correction flow
expectErr('emp_requestCorrection', /กรุณาระบุ/, E, tsId, '   ');
let r = c('emp_requestCorrection', E, tsId, 'วันที่ 5 เข้างาน 08:00 ไม่ใช่ 09:00');
assert.equal(r.status, 'ขอแก้ไข'); assert.equal(r.messages.length, 1);
d = c('adm_getDashboard', A, '2026-11');
assert.equal(d.pendingReplies.length, 1); assert.equal(d.summary.correction, 1);
c('adm_reply', A, tsId, 'รับทราบ จะแก้ไขให้ครับ');
d = c('adm_getDashboard', A, '2026-11');
assert.equal(d.pendingReplies.length, 0);

// new version supersedes
const up2 = c('adm_uploadTimesheet', A, { employeeId: '001', period: '2026-11', fileName: 'a-fixed.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF v2').toString('base64') });
assert.equal(up2.timesheet.version, 2); assert.equal(up2.replacedStatus, 'ขอแก้ไข');
expectErr('emp_getFile', /ถูกแทนที่/, E, tsId);
mine = c('emp_listMyTimesheets', E);
const t2 = mine.timesheets.find(t => t.period === '2026-11');
assert.equal(t2.version, 2); assert.equal(t2.status, 'รอตรวจสอบ');
assert.equal(t2.messages.length, 2, 'thread continues across versions');
c('emp_getFile', E, t2.id);
const conf = c('emp_confirm', E, t2.id, { userAgent: 'TestUA' });
assert.equal(conf.status, 'ยืนยันแล้ว'); assert(conf.confirmedAt);
assert(/SHA-256 [0-9a-f]{64}/.test(conf.confirmDetail), conf.confirmDetail);
expectErr('emp_confirm', /ยืนยันไปแล้ว/, E, t2.id, {});
expectErr('emp_requestCorrection', /ยืนยันแล้ว/, E, t2.id, 'x');

const det = c('adm_getTimesheetDetail', A, t2.id);
assert.equal(det.versions.length, 2); assert.equal(det.messages.length, 2);
console.log('audit actions:', det.audit.map(a => a.action).join(', '));

// delete employee -> session revoked, history kept
c('adm_deleteEmployee', A, '001');
expectErr('emp_listMyTimesheets', /ถูกนำออก/, E);
assert.equal(c('adm_listEmployees', A).length, 1);
c('adm_addEmployee', A, { employeeId: '001', name: 'สมชาย ใจดี' });
assert.equal(c('adm_getDashboard', A, '2026-11').summary.confirmed, 1);
// เพิ่มกลับแล้วต้องผูกใหม่ (บัญชีอื่นผูกได้เพราะยังว่าง)
const E3 = login('somchai2@gmail.com', '001');
assert.equal(c('emp_listMyTimesheets', E3).timesheets.length, 2);

// ยกเลิกการผูก: session เดิมใช้ไม่ได้ และบัญชีใหม่ผูกแทนได้
c('adm_unlinkEmployee', A, '001');
expectErr('emp_listMyTimesheets', /ถูกนำออก/, E3);
assert.equal(c('adm_listEmployees', A).find(e => e.employeeId === '001').email, '');
const E4 = login('somchai@example.com', '001');
assert.equal(c('emp_listMyTimesheets', E4).profile.employeeId, '001');
expectErr('adm_unlinkEmployee', /AUTH/, E4, '001');
// บัญชีที่ผูกแล้วผูกรหัสอื่นเพิ่มไม่ได้
const twice = c('googleLogin', tok({ email: 'somchai@example.com' }));
expectErr('verifyEmployeeId', /รหัสพนักงานไม่ถูกต้อง/, twice.pending, 'EMP002');

// เดารหัสพนักงาน
const E2b = login('somying@example.com', 'EMP002');
const bf = c('googleLogin', tok({ email: 'somying@example.com' }));
for (let i = 0; i < 4; i++) expectErr('verifyEmployeeId', /ไม่ถูกต้อง/, bf.pending, 'X' + i);
expectErr('verifyEmployeeId', /หลายครั้ง/, bf.pending, 'X9');
expectErr('verifyEmployeeId', /หมดเวลา/, bf.pending, 'EMP002');
expectErr('verifyEmployeeId', /หมดเวลา/, 'garbage', 'EMP002');
expectErr('requestOtp', /ไม่รู้จักคำสั่ง/, 'somying@example.com'); // OTP ถูกเอาออกแล้ว

// private functions not callable
expectErr('readAll_', /ไม่รู้จักคำสั่ง/);
expectErr('setup_', /ไม่รู้จักคำสั่ง/);
// period stored as text
const ss = Object.values(env.sheetsById)[0];
console.log('sheets:', Object.keys(ss.sheets).join(', '));
assert.equal(ss.tz, 'Asia/Bangkok');
const ping = JSON.parse(env.ctx.doGet().getContent());
assert(ping.ok);
const badReq = JSON.parse(env.ctx.doPost({ postData: { contents: 'not json' } }).getContent());
assert.equal(badReq.ok, false);
// ---- ตรวจ ID token ของ Google ----
assert.equal(c('emp_listMyTimesheets', login('somying@example.com', 'EMP002')).profile.employeeId, 'EMP002');
expectErr('googleLogin', /Client ID ไม่ตรง/, tok({ email: 'somying@example.com', aud: 'other.apps.googleusercontent.com' }));
expectErr('googleLogin', /ยังไม่ได้ยืนยันอีเมล/, tok({ email: 'somying@example.com', email_verified: 'false' }));
expectErr('googleLogin', /หมดอายุ/, tok({ email: 'somying@example.com', exp: '1000' }));
expectErr('googleLogin', /ยืนยันบัญชี Google ไม่สำเร็จ/, tok({ email: 'somying@example.com', iss: 'evil.com' }));
expectErr('googleLogin', /ยืนยันบัญชี Google ไม่สำเร็จ/, 'h.unknown.s');
expectErr('googleLogin', /ไม่ถูกต้อง/, 'not a jwt');

// ---- ลบใบลงเวลา ----
const pdfB = (t) => Buffer.from('%PDF ' + t).toString('base64');
const upd = (v) => c('adm_uploadTimesheet', A, { employeeId: 'EMP002', period: '2026-12', fileName: v + '.pdf', mimeType: 'application/pdf', base64: pdfB(v) }).timesheet;
const v1 = upd('v1');
const Ey = login('somying@example.com', 'EMP002');
c('emp_getFile', Ey, v1.id);
c('emp_requestCorrection', Ey, v1.id, 'วันที่ 3 ผิด');
const v2 = upd('v2-wrong-file');
expectErr('adm_deleteTimesheet', /AUTH/, Ey, v2.id);
// ลบฉบับที่แนบผิด -> ฉบับ 1 กลับมาเป็นปัจจุบัน (สถานะขอแก้ไขเหมือนเดิม)
const del = c('adm_deleteTimesheet', A, v2.id);
assert.equal(del.restored.version, 1); assert.equal(del.restored.status, 'ขอแก้ไข');
assert(env.drive.files[Object.keys(env.drive.files).find(k => env.drive.files[k].blob.name === '2026-12_EMP002_v2.pdf')].trashed, 'file trashed');
let mineY = c('emp_listMyTimesheets', Ey).timesheets.find(t => t.period === '2026-12');
assert.equal(mineY.id, v1.id); assert.equal(mineY.messages.length, 1);
expectErr('adm_deleteTimesheet', /ไม่พบ/, A, v2.id);
// ฉบับใหม่ต่อจากนี้เป็นฉบับที่ 2
assert.equal(upd('v2-ok').version, 2);
// ลบฉบับเดียวที่เหลือของอีกคน
const lone = c('adm_uploadTimesheet', A, { employeeId: '001', period: '2026-12', fileName: 'x.pdf', mimeType: 'application/pdf', base64: pdfB('x') }).timesheet;
assert.equal(c('adm_deleteTimesheet', A, lone.id).restored, null);
// ลบทั้งเดือน
const before = c('adm_getDashboard', A, '2026-11').summary.confirmed;
const dp = c('adm_deletePeriod', A, '2026-12');
assert.equal(dp.deleted, 2);
assert.equal(c('adm_getDashboard', A, '2026-12').summary.notUploaded, 2);
assert.equal(c('adm_getDashboard', A, '2026-11').summary.confirmed, before, 'other months untouched');
assert(!c('emp_listMyTimesheets', Ey).timesheets.some(t => t.period === '2026-12'));
assert.equal(c('adm_deletePeriod', A, '2026-12').deleted, 0);
expectErr('adm_deletePeriod', /AUTH/, Ey, '2026-11');
const auditActs = Object.values(env.sheetsById)[0].sheets['บันทึกกิจกรรม'].rows.map(r => r[3]);
assert(auditActs.includes('ลบใบลงเวลา') && auditActs.includes('ลบใบลงเวลาทั้งเดือน'));

console.log('ALL API TESTS PASSED');
