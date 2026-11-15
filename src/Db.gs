/**
 * ชั้นจัดการข้อมูลบน Google Sheet
 * ฟังก์ชันที่ลงท้ายด้วย _ เป็น private (หน้าเว็บเรียกใช้ตรงๆ ไม่ได้)
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
  if (!ss) ss = SpreadsheetApp.create(APP_NAME + ' (ฐานข้อมูล)');
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
