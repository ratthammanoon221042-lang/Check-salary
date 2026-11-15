/* =========================================================
 * ส่วนกลางของหน้าเว็บ: ตัวช่วยสร้าง DOM, เรียก API, ล็อกอิน
 * ========================================================= */
var Core = (function () {
  var TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  /** สร้าง element อย่างปลอดภัย (ข้อความทั้งหมดใส่เป็น textContent) */
  function el(tag, props) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple') node[k] = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ---------- storage (อาจใช้ไม่ได้ในบางเบราว์เซอร์) ---------- */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ---------- API ---------- */
  var CONFIG = window.APP_CONFIG || {};
  function googleClientId() { var c = String(CONFIG.GOOGLE_CLIENT_ID || '').trim(); return /\.apps\.googleusercontent\.com$/.test(c) ? c : ''; }
  function apiConfigured() { return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(String(CONFIG.API_URL || '').trim()); }

  /** ส่งคำขอไปที่ Apps Script (Content-Type text/plain เพื่อเลี่ยง CORS preflight) */
  function apiRaw(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!apiConfigured()) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js'));
    return fetch(String(CONFIG.API_URL).trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: 'follow'
    }).catch(function () {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต แล้วลองใหม่');
    }).then(function (res) {
      return res.text().then(function (txt) {
        var j;
        try { j = JSON.parse(txt); } catch (e) {
          throw new Error('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ — ตรวจสอบว่า Deploy แบบ "Who has access: Anyone" และ API_URL ถูกต้อง');
        }
        if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
        return j.result;
      });
    });
  }
  /** เรียก API ที่ต้องล็อกอิน (ใส่ token ให้อัตโนมัติ) */
  function api(fn) {
    var args = [fn, App.token].concat(Array.prototype.slice.call(arguments, 1));
    return apiRaw.apply(null, args).catch(function (err) {
      var msg = errMsg(err);
      if (/^AUTH:/.test(String(err && err.message || err))) {
        toast(msg, 'error');
        App.logout(true);
      }
      throw err;
    });
  }
  function errMsg(err) {
    var m = String((err && err.message) || err || 'เกิดข้อผิดพลาด');
    m = m.replace(/^Exception:\s*/, '').replace(/^Error:\s*/, '').replace(/^AUTH:\s*/, '');
    return m;
  }

  /* ---------- UI helpers ---------- */
  function toast(msg, type) {
    var box = document.getElementById('toasts');
    var t = el('div', { class: 'toast ' + (type || ''), text: msg });
    box.appendChild(t);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, type === 'error' ? 6000 : 3500);
  }

  function modal(opts) {
    var back = el('div', { class: 'modal-back' });
    var closeBtn = el('button', { class: 'close-x', 'aria-label': 'ปิด', text: '×' });
    var box = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modal-head' }, el('h2', { text: opts.title || '' }), closeBtn),
      opts.body || null);
    back.appendChild(box);
    function close() {
      if (back.parentNode) back.parentNode.removeChild(back);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeBtn.addEventListener('click', close);
    back.addEventListener('mousedown', function (e) { if (e.target === back && !opts.sticky) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    return { close: close, box: box };
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var done = false;
      var ok = el('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), text: opts.okText || 'ตกลง' });
      var cancel = el('button', { class: 'btn', text: 'ยกเลิก' });
      var body = el('div', { class: 'stack' },
        typeof opts.message === 'string' ? el('p', { style: 'margin:0', text: opts.message }) : opts.message,
        el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, cancel, ok));
      var m = modal({ title: opts.title, body: body, onClose: function () { if (!done) resolve(false); } });
      cancel.addEventListener('click', function () { m.close(); });
      ok.addEventListener('click', function () { done = true; m.close(); resolve(true); });
    });
  }

  function busy(btn, on, text) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = text || 'กำลังดำเนินการ...';
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  function loading(text) {
    return el('div', { class: 'loading-block' }, el('span', { class: 'spinner' }),
      el('div', { style: 'margin-top:10px', text: text || 'กำลังโหลด...' }));
  }

  /* ---------- formatting ---------- */
  function fmt(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtShort(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function periodLabel(p) {
    if (!/^\d{4}-\d{2}$/.test(p || '')) return p || '';
    return TH_MONTHS[Number(p.slice(5, 7)) - 1] + ' ' + (Number(p.slice(0, 4)) + 543);
  }
  function currentPeriod() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    var y = '', m = '';
    parts.forEach(function (p) { if (p.type === 'year') y = p.value; if (p.type === 'month') m = p.value; });
    return y + '-' + m;
  }
  function shiftPeriod(p, delta) {
    var y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)) - 1 + delta;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m + 1 < 10 ? '0' : '') + (m + 1);
  }

  var STATUS_CLASS = { 'รอตรวจสอบ': 'b-pending', 'ขอแก้ไข': 'b-correction', 'ยืนยันแล้ว': 'b-confirmed', 'ถูกแทนที่': 'b-superseded' };
  function badge(status) {
    return el('span', { class: 'badge ' + (STATUS_CLASS[status] || 'b-none'), text: status || 'ยังไม่มีไฟล์' });
  }

  /* ---------- file viewer ---------- */
  function b64ToBytes(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** แสดงไฟล์ PDF/รูปภาพในกล่อง viewer */
  function renderFile(container, data) {
    clear(container);
    if (/^image\//.test(data.mimeType)) {
      return new Promise(function (resolve, reject) {
        var img = el('img', { alt: data.fileName });
        img.onload = function () { resolve(); };
        img.onerror = function () { reject(new Error('แสดงรูปภาพไม่ได้')); };
        img.src = 'data:' + data.mimeType + ';base64,' + data.base64;
        container.appendChild(img);
      });
    }
    if (data.mimeType === 'application/pdf') {
      if (!window.pdfjsLib) {
        container.appendChild(el('div', { class: 'viewer-empty', text: 'โหลดตัวแสดง PDF ไม่สำเร็จ กรุณากดดาวน์โหลดไฟล์เพื่อเปิดดู' }));
        return Promise.resolve();
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return pdfjsLib.getDocument({ data: b64ToBytes(data.base64) }).promise.then(function (pdf) {
        var width = Math.max(320, container.clientWidth - 20);
        var ratio = Math.min(window.devicePixelRatio || 1, 2);
        var chain = Promise.resolve();
        for (var n = 1; n <= pdf.numPages; n++) {
          (function (pageNo) {
            chain = chain.then(function () {
              return pdf.getPage(pageNo).then(function (page) {
                var base = page.getViewport({ scale: 1 });
                var vp = page.getViewport({ scale: (width / base.width) * ratio });
                var canvas = el('canvas');
                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                container.appendChild(canvas);
                return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
              });
            });
          })(n);
        }
        return chain;
      });
    }
    container.appendChild(el('div', { class: 'viewer-empty', text: 'ไม่รองรับการแสดงไฟล์ชนิดนี้' }));
    return Promise.resolve();
  }

  function downloadFile(data) {
    var blob = new Blob([b64ToBytes(data.base64)], { type: data.mimeType });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: data.fileName || 'timesheet' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  /** กล่องข้อความแก้ไข (บทสนทนา) */
  function thread(messages, mySender) {
    if (!messages || !messages.length) return el('div', { class: 'muted small', text: 'ยังไม่มีข้อความ' });
    return el('div', { class: 'thread' }, messages.map(function (m) {
      var mine = m.sender === mySender;
      return el('div', { class: 'msg ' + (mine ? 'msg-me' : 'msg-other') },
        m.message,
        el('div', { class: 'meta', text: m.sender + ' · ' + fmtShort(m.createdAt) + (m.version ? ' · ฉบับที่ ' + m.version : '') }));
    }));
  }

  function topbar(user, rightExtra) {
    var logoutBtn = el('button', { class: 'btn btn-sm', text: 'ออกจากระบบ', onclick: function () { App.logout(); } });
    return el('div', { class: 'topbar' },
      el('div', { class: 'topbar-inner' },
        el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: '✓' }), App.name),
        el('div', { class: 'spacer' }),
        rightExtra || null,
        el('div', { class: 'user-chip' }, el('b', { text: user.name || user.email }), user.email),
        logoutBtn));
  }

  return {
    el: el, clear: clear, store: store, api: api, apiRaw: apiRaw, apiConfigured: apiConfigured, googleClientId: googleClientId, errMsg: errMsg, toast: toast,
    modal: modal, confirmDialog: confirmDialog, busy: busy, loading: loading,
    fmt: fmt, fmtShort: fmtShort, periodLabel: periodLabel, currentPeriod: currentPeriod, shiftPeriod: shiftPeriod,
    badge: badge, renderFile: renderFile, downloadFile: downloadFile, thread: thread, topbar: topbar
  };
})();

/* =========================================================
 * การเริ่มต้นแอพ และหน้าล็อกอิน
 * ========================================================= */
var App = (function () {
  var el = Core.el;
  var TOKEN_KEY = 'tsc_token';
  var self = { token: null, user: null, name: (window.APP_CONFIG && window.APP_CONFIG.APP_NAME) || 'ระบบตรวจสอบใบลงเวลา' };

  function root() { return Core.clear(document.getElementById('app')); }

  self.start = function () {
    document.title = self.name;
    if (!Core.apiConfigured() || !Core.googleClientId()) return showNotConfigured();
    var t = Core.store.get(TOKEN_KEY);
    if (!t) return showLogin();
    Core.apiRaw('getSession', t).then(function (user) {
      if (!user) { Core.store.del(TOKEN_KEY); return showLogin(); }
      self.token = t;
      route(user);
    }).catch(function () { showLogin(); });
  };

  function showNotConfigured() {
    root().appendChild(el('div', { class: 'login-wrap' },
      el('div', { class: 'card login-card' },
        el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: '✓' }), self.name),
        el('div', { class: 'callout callout-warn', style: 'margin-top:12px' },
          el('b', { text: 'ยังตั้งค่าระบบไม่ครบ' }), el('br'),
          Core.apiConfigured()
            ? 'กรุณาใส่ GOOGLE_CLIENT_ID (ลงท้ายด้วย .apps.googleusercontent.com) ในไฟล์ config.js ใน GitHub ตามขั้นตอนใน README'
            : 'กรุณาใส่ URL ของ Apps Script Web app (ลงท้ายด้วย /exec) ที่ API_URL ในไฟล์ config.js ใน GitHub ตามขั้นตอนใน README'))));
  }

  function route(user) {
    self.user = user;
    var r = root();
    if (user.role === 'admin') AdminApp.render(r, user);
    else EmployeeApp.render(r, user);
  }

  self.logout = function (silent) {
    var t = self.token;
    self.token = null;
    self.user = null;
    Core.store.del(TOKEN_KEY);
    if (t) Core.apiRaw('logout', t).catch(function () {});
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
    document.querySelectorAll('.modal-back').forEach(function (n) { n.remove(); });
    showLogin();
    if (!silent) Core.toast('ออกจากระบบแล้ว');
  };

  function loginCard() {
    var body = el('div');
    var errBox = el('div', { class: 'err', style: 'margin-top:10px;text-align:center' });
    root().appendChild(el('div', { class: 'login-wrap' },
      el('div', { class: 'card login-card' },
        el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: '✓' }), self.name),
        el('p', { class: 'muted', style: 'text-align:center;margin:0 0 18px', text: 'ตรวจสอบและยืนยันใบลงเวลาของคุณ' }),
        body, errBox)));
    return { body: body, err: errBox };
  }

  function loggedIn(res) {
    self.token = res.token;
    Core.store.set(TOKEN_KEY, res.token);
    route(res.user);
  }

  /** ขั้นที่ 1: กดปุ่มลงชื่อเข้าใช้ด้วย Google */
  function showLogin() {
    var card = loginCard();
    var gBox = el('div', { class: 'google-box' }, Core.loading('กำลังโหลด...'));
    var gStatus = el('div', { class: 'hint', style: 'text-align:center' });
    card.body.appendChild(el('div', { class: 'stack' }, gBox, gStatus));

    function onCredential(resp) {
      card.err.textContent = '';
      gStatus.textContent = 'กำลังตรวจสอบบัญชี...';
      Core.apiRaw('googleLogin', resp.credential).then(function (res) {
        if (res.needEmployeeId) showEmployeeIdStep(res);
        else loggedIn(res);
      }).catch(function (e) {
        gStatus.textContent = 'กดปุ่มด้านบน แล้วเลือกบัญชี Google ที่แจ้งไว้กับบริษัท';
        card.err.textContent = Core.errMsg(e);
      });
    }

    loadGoogle().then(function () {
      google.accounts.id.initialize({ client_id: Core.googleClientId(), callback: onCredential, ux_mode: 'popup', auto_select: false, context: 'signin' });
      Core.clear(gBox);
      google.accounts.id.renderButton(gBox, { type: 'standard', theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'th', width: Math.min(340, Math.max(220, gBox.clientWidth || 300)) });
      gStatus.textContent = 'กดปุ่มด้านบน แล้วเลือกบัญชี Google ที่แจ้งไว้กับบริษัท';
    }).catch(function () {
      Core.clear(gBox);
      card.err.textContent = 'โหลดปุ่มล็อกอินของ Google ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า';
    });
  }

  /** ขั้นที่ 2 (พนักงาน): กรอกรหัสพนักงาน */
  function showEmployeeIdStep(res) {
    var card = loginCard();
    var idInput = el('input', { class: 'input', style: 'font-size:20px;text-align:center;letter-spacing:2px', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'เช่น EMP001' });
    var goBtn = el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit', text: 'เข้าสู่ระบบ' });
    var form = el('form', { class: 'stack' },
      el('div', { class: 'callout callout-info', style: 'text-align:center' },
        'สวัสดี คุณ', el('b', { text: res.name || '' }), el('br'), el('span', { class: 'small', text: res.email })),
      el('label', { class: 'field' }, el('span', { text: 'กรอกรหัสพนักงานของคุณ' }), idInput),
      goBtn,
      el('div', { style: 'text-align:center' },
        el('button', { class: 'linkbtn small', type: 'button', text: 'ไม่ใช่คุณ? ใช้บัญชี Google อื่น', onclick: function () {
          try { google.accounts.id.disableAutoSelect(); } catch (e) {}
          showLogin();
        } })));
    card.body.appendChild(form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      card.err.textContent = '';
      if (!idInput.value.trim()) { card.err.textContent = 'กรุณากรอกรหัสพนักงาน'; return; }
      Core.busy(goBtn, true, 'กำลังตรวจสอบ...');
      Core.apiRaw('verifyEmployeeId', res.pending, idInput.value.trim()).then(loggedIn).catch(function (e2) {
        Core.busy(goBtn, false);
        var msg = Core.errMsg(e2);
        card.err.textContent = msg;
        if (/หมดเวลา|หลายครั้ง|ไม่พบบัญชี/.test(msg)) {
          setTimeout(function () { showLogin(); Core.toast(msg, 'error'); }, 1500);
        } else {
          idInput.select();
        }
      });
    });
    idInput.focus();
  }

  var googleLoader = null;
  function loadGoogle() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (googleLoader) return googleLoader;
    googleLoader = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { googleLoader = null; reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return googleLoader;
  }

  return self;
})();
