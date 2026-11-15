// Minimal in-memory mock of the Apps Script services used by the project.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function toSigned(buf) { return Array.from(buf, b => (b > 127 ? b - 256 : b)); }
function toBuf(arr) { return Buffer.from(arr.map(b => (b < 0 ? b + 256 : b))); }

function createEnv(opts) {
  const ownerEmail = opts.ownerEmail;
  const mails = [];
  const props = {};
  const cache = {};
  const sheetsById = {};
  const drive = { folders: {}, files: {} };

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    setValues(v) {
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.rows[this.r - 1 + i] || (this.sh.rows[this.r - 1 + i] = []);
        for (let j = 0; j < this.nc; j++) {
          let val = v[i][j];
          if (val instanceof Date) val = new Date(val.getTime());
          row[this.c - 1 + j] = val;
        }
      }
      return this;
    }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.rows[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) {
          const v = row[this.c - 1 + j];
          o.push(v === undefined ? '' : v instanceof Date ? new Date(v.getTime()) : v);
        }
        out.push(o);
      }
      return out;
    }
    setFontWeight() { return this; }
    setBackground() { return this; }
    setNumberFormats() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getLastRow() {
      for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i] && this.rows[i].some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
      return 0;
    }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    setFrozenRows() {}
    deleteRow(r) { this.rows.splice(r - 1, 1); }
    getName() { return this.name; }
  }
  class Spreadsheet {
    constructor() { this.id = 'SS' + crypto.randomUUID().slice(0, 8); this.sheets = {}; sheetsById[this.id] = this; }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.sheets[n] || null; }
    insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }
  }
  class Blob {
    constructor(bytes, type, name) { this.bytes = bytes; this.type = type; this.name = name; }
    getBytes() { return this.bytes.slice(); }
    getContentType() { return this.type; }
  }
  class File {
    constructor(blob) { this.id = 'F' + crypto.randomUUID().slice(0, 8); this.blob = blob; drive.files[this.id] = this; }
    getId() { return this.id; }
    getBlob() { return this.blob; }
    setDescription(d) { this.desc = d; }
    setTrashed(v) { this.trashed = !!v; }
  }
  class Folder {
    constructor(name) { this.id = 'D' + crypto.randomUUID().slice(0, 8); this.name = name; this.children = []; drive.folders[this.id] = this; }
    getId() { return this.id; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    getFoldersByName(n) {
      const list = this.children.filter(c => c.name === n);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    createFolder(n) { const f = new Folder(n); this.children.push(f); return f; }
    createFile(blob) { return new File(blob); }
  }

  const googleTokens = {}; // id_token -> tokeninfo payload (จำลอง Google)
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    SpreadsheetApp: {
      openById: id => { if (!sheetsById[id]) throw new Error('no ss'); return sheetsById[id]; },
      getActiveSpreadsheet: () => null,
      create: () => new Spreadsheet(),
      flush: () => {}
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => { const e = cache[k]; if (!e || e.exp < Date.now()) return null; return e.v; },
        put: (k, v, ttl) => { cache[k] = { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }; },
        remove: k => { delete cache[k]; }
      })
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => ownerEmail }) },
    MailApp: { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      createFolder: n => new Folder(n),
      getFolderById: id => { if (!drive.folders[id]) throw new Error('no folder'); return drive.folders[id]; },
      getFileById: id => { if (!drive.files[id]) throw new Error('no file'); return drive.files[id]; }
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, data) => toSigned(crypto.createHash(alg).update(typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuf(data)).digest()),
      base64Encode: bytes => toBuf(bytes).toString('base64'),
      base64Decode: s => toSigned(Buffer.from(s, 'base64')),
      newBlob: (bytes, type, name) => new Blob(bytes, type, name),
      formatDate: (d, tz, fmt) => {
        const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
        const g = t => p.find(x => x.type === t).value;
        return fmt.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day')).replace('HH', g('hour')).replace('mm', g('minute')).replace('ss', g('second'));
      }
    },
    UrlFetchApp: {
      fetch: url => {
        const m = String(url).match(/id_token=([^&]+)/);
        const info = m && googleTokens[decodeURIComponent(m[1])];
        return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t })
    }
  };
  vm.createContext(ctx);
  const dir = opts.srcDir;
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: 'gas-bundle.js' });

  // เรียกผ่าน doPost เหมือนที่หน้าเว็บเรียกจริง (setup เรียกตรง)
  function call(fn, args) {
    if (fn === 'setup') return ctx.setup();
    const res = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ fn, args }) } }).getContent());
    if (!res.ok) throw new Error(res.error);
    return res.result;
  }
  return { ctx, call, mails, props, sheetsById, drive, googleTokens };
}

module.exports = { createEnv };
