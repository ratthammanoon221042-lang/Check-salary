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
