/**
 * จุดเริ่มต้นของเว็บแอพ
 */

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.appName = APP_NAME;
  return t.evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * รันฟังก์ชันนี้ 1 ครั้งจากหน้า Apps Script Editor (เลือก setup แล้วกด Run)
 * เพื่ออนุญาตสิทธิ์ และสร้างชีต + โฟลเดอร์ Drive
 */
function setup() {
  ensureAllSheets_();
  const folder = getRootFolder_();
  const admin = adminEmail_();
  console.log('ตั้งค่าเสร็จแล้ว');
  console.log('ฐานข้อมูล Google Sheet: ' + getSpreadsheet_().getUrl());
  console.log('โฟลเดอร์เก็บไฟล์: ' + folder.getUrl());
  console.log('อีเมลผู้ดูแลระบบ: ' + admin);
  console.log('ส่งอีเมลได้อีกวันนี้: ' + MailApp.getRemainingDailyQuota() + ' ฉบับ');
}
