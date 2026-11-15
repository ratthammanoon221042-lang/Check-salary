// ทดสอบฝั่งเซิร์ฟเวอร์ด้วย mock ของ Apps Script: node tests/api.test.js
const assert = require('assert');
const { createEnv } = require('./gasmock');
const env = createEnv({ srcDir: require('path').join(__dirname, '..', 'apps-script'), ownerEmail: 'owner@gmail.com' });
const c = (fn, ...a) => env.call(fn, a);
const expectErr = (fn, re, ...a) => { try { c(fn, ...a); } catch (e) { assert(re.test(e.message), fn + ': ' + e.message); return e.message; } throw new Error(fn + ' should fail'); };
const lastCode = () => env.mails[env.mails.length - 1].subject.match(/\d{6}/)[0];
const clearCooldown = (email) => env.ctx.CacheService.getScriptCache().remove('otpcd_' + email);

c('setup');
// admin login
expectErr('requestOtp', /ไม่พบอีเมล/, 'nobody@x.com');
expectErr('requestOtp', /รูปแบบ/, 'bad');
c('requestOtp', 'Owner@Gmail.com');
expectErr('requestOtp', /รอ 1 นาที/, 'owner@gmail.com');
expectErr('verifyOtp', /ไม่ถูกต้อง \(เหลือ 4/, 'owner@gmail.com', '000000x' === lastCode() ? '111111' : (lastCode() === '000000' ? '111111' : '000000'));
const adm = c('verifyOtp', 'owner@gmail.com', lastCode());
assert.equal(adm.user.role, 'admin');
const A = adm.token;
expectErr('verifyOtp', /หมดอายุ/, 'owner@gmail.com', lastCode()); // single use

// employees
expectErr('adm_addEmployee', /อีเมลของผู้ดูแล/, A, { employeeId: 'E1', name: 'x', email: 'owner@gmail.com' });
c('adm_addEmployee', A, { employeeId: '001', name: 'สมชาย ใจดี', email: 'Somchai@Example.com' });
c('adm_addEmployee', A, { employeeId: 'EMP002', name: 'สมหญิง รักงาน', email: 'somying@example.com' });
expectErr('adm_addEmployee', /มีอยู่แล้ว/, A, { employeeId: '001', name: 'dup', email: 'z@example.com' });
expectErr('adm_addEmployee', /มีอยู่แล้ว/, A, { employeeId: 'E9', name: 'dup', email: 'somchai@example.com' });
let emps = c('adm_listEmployees', A);
assert.equal(emps.length, 2); assert.equal(emps[0].employeeId, '001'); assert.equal(emps[0].email, 'somchai@example.com');
c('adm_updateEmployee', A, { employeeId: 'EMP002', name: 'สมหญิง ขยัน', email: 'somying@example.com' });

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
c('requestOtp', 'somchai@example.com');
const E = c('verifyOtp', 'somchai@example.com', lastCode()).token;
expectErr('adm_getDashboard', /AUTH: ไม่มีสิทธิ์/, E, '2026-11');
c('requestOtp', 'somying@example.com');
const E2 = c('verifyOtp', 'somying@example.com', lastCode()).token;

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
expectErr('requestOtp', /ไม่พบอีเมล/, 'somchai@example.com');
assert.equal(c('adm_listEmployees', A).length, 1);
c('adm_addEmployee', A, { employeeId: '001', name: 'สมชาย ใจดี', email: 'somchai@example.com' });
assert.equal(c('adm_getDashboard', A, '2026-11').summary.confirmed, 1);

// OTP brute force
clearCooldown('somying@example.com');
c('requestOtp', 'somying@example.com');
const good = lastCode(); const bad = good === '123456' ? '654321' : '123456';
for (let i = 0; i < 4; i++) expectErr('verifyOtp', /ไม่ถูกต้อง/, 'somying@example.com', bad);
expectErr('verifyOtp', /หลายครั้ง/, 'somying@example.com', bad);
expectErr('verifyOtp', /หมดอายุ|หลายครั้ง/, 'somying@example.com', good);

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
console.log('ALL API TESTS PASSED');
