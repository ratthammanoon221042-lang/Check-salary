/* =========================================================
 * หน้าผู้ดูแลระบบ
 * ========================================================= */
var AdminApp = (function () {
  var el = Core.el;
  var state = {
    user: null,
    tab: 'dashboard',
    period: Core.currentPeriod(),
    dash: null,
    filter: 'all',
    search: '',
    employees: null
  };
  var main = null, tabsBar = null;

  var TABS = [
    ['dashboard', 'ภาพรวม'],
    ['upload', 'อัปโหลดใบลงเวลา'],
    ['employees', 'จัดการพนักงาน']
  ];

  function render(root, user) {
    state.user = user;
    var links = el('div', { class: 'row small' },
      user.sheetUrl ? el('a', { href: user.sheetUrl, target: '_blank', rel: 'noopener', text: 'เปิด Google Sheet' }) : null,
      user.folderUrl ? el('a', { href: user.folderUrl, target: '_blank', rel: 'noopener', text: 'โฟลเดอร์ไฟล์' }) : null);
    var top = Core.topbar(user, links);
    tabsBar = el('div', { class: 'tabs' });
    top.appendChild(tabsBar);
    root.appendChild(top);
    main = el('div', { class: 'container' });
    root.appendChild(main);
    go('dashboard');
  }

  function renderTabs() {
    Core.clear(tabsBar);
    var pending = state.dash ? state.dash.pendingReplies.length : 0;
    TABS.forEach(function (t) {
      tabsBar.appendChild(el('button', { class: 'tab' + (state.tab === t[0] ? ' active' : ''), onclick: function () { go(t[0]); } },
        t[1], t[0] === 'dashboard' && pending ? el('span', { class: 'count', text: String(pending) }) : null));
    });
  }

  function go(tab) {
    state.tab = tab;
    renderTabs();
    Core.clear(main);
    if (tab === 'dashboard') Dashboard();
    else if (tab === 'upload') Upload();
    else Employees();
  }

  function periodPicker(onChange) {
    var input = el('input', { class: 'input', type: 'month', value: state.period, style: 'width:auto;min-width:170px' });
    input.addEventListener('change', function () {
      if (/^\d{4}-\d{2}$/.test(input.value)) { state.period = input.value; onChange(); }
    });
    var prev = el('button', { class: 'btn btn-sm', text: '‹', 'aria-label': 'เดือนก่อนหน้า', onclick: function () { state.period = Core.shiftPeriod(state.period, -1); onChange(); } });
    var next = el('button', { class: 'btn btn-sm', text: '›', 'aria-label': 'เดือนถัดไป', onclick: function () { state.period = Core.shiftPeriod(state.period, 1); onChange(); } });
    return el('div', { class: 'row' }, prev, input, next, el('b', { text: Core.periodLabel(state.period) }));
  }

  function loadDash() {
    return Core.api('adm_getDashboard', state.period).then(function (d) {
      state.dash = d;
      renderTabs();
      return d;
    });
  }

  function rowState(r) {
    var t = r.timesheet;
    if (!t) return 'none';
    if (t.status === 'ยืนยันแล้ว') return 'confirmed';
    if (t.status === 'ขอแก้ไข') return 'correction';
    return t.firstViewedAt ? 'viewed' : 'notViewed';
  }

  /* ======================= แดชบอร์ด ======================= */
  function Dashboard() {
    Core.clear(main);
    var head = el('div', { class: 'section-title' }, el('h2', { style: 'font-size:19px', text: 'สถานะใบลงเวลา' }), el('div', { class: 'spacer' }), periodPicker(Dashboard));
    main.appendChild(head);
    var body = el('div', {}, Core.loading());
    main.appendChild(body);
    loadDash().then(function (d) {
      if (state.tab !== 'dashboard' || d.period !== state.period) return;
      Core.clear(body);
      drawDash(body, d);
    }).catch(function (e) { Core.clear(body).appendChild(el('div', { class: 'callout callout-bad', text: Core.errMsg(e) })); });
  }

  function drawDash(body, d) {
    var s = d.summary;
    var STATS = [
      ['all', 'พนักงานทั้งหมด', s.total, 'var(--primary)'],
      ['none', 'ยังไม่อัปโหลด', s.notUploaded, 'var(--muted)'],
      ['waiting', 'รอตรวจสอบ', s.notViewed + s.viewed, 'var(--warn)'],
      ['correction', 'ขอแก้ไข', s.correction, 'var(--bad)'],
      ['confirmed', 'ยืนยันแล้ว', s.confirmed, 'var(--ok)']
    ];
    body.appendChild(el('div', { class: 'stats' }, STATS.map(function (x) {
      var pct = s.total ? Math.round(x[2] / s.total * 100) : 0;
      return el('button', { class: 'stat' + (state.filter === x[0] ? ' active' : ''), onclick: function () { state.filter = x[0]; Core.clear(body); drawDash(body, d); } },
        el('div', { class: 'label', text: x[1] }),
        el('div', { class: 'value', text: String(x[2]) }),
        el('div', { class: 'bar', style: 'background:linear-gradient(90deg,' + x[3] + ' ' + (x[0] === 'all' ? 100 : pct) + '%,var(--gray-soft) 0)' }));
    })));

    // คำขอแก้ไขที่รอตอบ (ทุกเดือน)
    if (d.pendingReplies.length) {
      body.appendChild(el('div', { class: 'card', style: 'margin-bottom:16px;border-color:var(--bad)' },
        el('h2', { text: 'คำขอแก้ไขที่รอคุณตอบ (' + d.pendingReplies.length + ')' }),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, el('th', { text: 'พนักงาน' }), el('th', { text: 'รอบเดือน' }), el('th', { text: 'ข้อความล่าสุด' }), el('th', { text: 'เวลา' }))),
          el('tbody', {}, d.pendingReplies.map(function (p) {
            return el('tr', { class: 'clickable', onclick: function () { openDetail(p.timesheet.id); } },
              el('td', { text: p.employeeName }),
              el('td', { class: 'nowrap', text: p.timesheet.periodLabel }),
              el('td', { text: p.lastMessage.message.length > 90 ? p.lastMessage.message.slice(0, 90) + '…' : p.lastMessage.message }),
              el('td', { class: 'nowrap', text: Core.fmtShort(p.lastMessage.createdAt) }));
          }))))));
    }

    // ตารางพนักงาน
    var search = el('input', { class: 'input', type: 'search', placeholder: 'ค้นหาชื่อ / รหัส / อีเมล', value: state.search, style: 'max-width:280px' });
    var tbody = el('tbody');
    function drawRows() {
      Core.clear(tbody);
      var q = state.search.toLowerCase();
      var rows = d.rows.filter(function (r) {
        var st = rowState(r);
        if (state.filter === 'none' && st !== 'none') return false;
        if (state.filter === 'waiting' && st !== 'viewed' && st !== 'notViewed') return false;
        if (state.filter === 'correction' && st !== 'correction') return false;
        if (state.filter === 'confirmed' && st !== 'confirmed') return false;
        if (q && (r.employee.name + ' ' + r.employee.employeeId + ' ' + r.employee.email).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      if (!rows.length) {
        tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'empty', text: d.rows.length ? 'ไม่พบรายการ' : 'ยังไม่มีพนักงาน — เพิ่มได้ที่แท็บ "จัดการพนักงาน"' })));
        return;
      }
      rows.forEach(function (r) {
        var t = r.timesheet;
        var viewCell = !t ? '-' : (t.firstViewedAt
          ? el('span', {}, el('span', { class: 'badge b-viewed', text: 'เปิดดูแล้ว' }), el('div', { class: 'muted small', text: Core.fmtShort(t.firstViewedAt) + ' · ' + t.viewCount + ' ครั้ง' }))
          : el('span', { class: 'muted small', text: 'ยังไม่เปิดดู' }));
        var action = t
          ? el('button', { class: 'btn btn-sm', text: 'รายละเอียด', onclick: function (e) { e.stopPropagation(); openDetail(t.id); } })
          : el('button', { class: 'btn btn-sm btn-primary', text: 'อัปโหลด', onclick: function (e) { e.stopPropagation(); quickUpload(r.employee, false); } });
        tbody.appendChild(el('tr', { class: t ? 'clickable' : '', onclick: t ? function () { openDetail(t.id); } : null },
          el('td', {}, el('div', { style: 'font-weight:600', text: r.employee.name }), el('div', { class: 'muted small', text: r.employee.employeeId + ' · ' + r.employee.email })),
          el('td', {}, Core.badge(t ? t.status : ''), r.awaitingReply ? el('div', { class: 'small', style: 'color:var(--bad);margin-top:2px', text: '● รอคุณตอบ' }) : null),
          el('td', { class: 'nowrap', text: t ? 'ฉบับที่ ' + t.version : '-' }),
          el('td', {}, viewCell),
          el('td', { class: 'nowrap', text: t && t.confirmedAt ? Core.fmt(t.confirmedAt) : '-' }),
          el('td', { style: 'text-align:right' }, action)));
      });
    }
    search.addEventListener('input', function () { state.search = search.value; drawRows(); });
    var filterLabel = { all: 'ทั้งหมด', none: 'ยังไม่อัปโหลด', waiting: 'รอตรวจสอบ', correction: 'ขอแก้ไข', confirmed: 'ยืนยันแล้ว' }[state.filter];
    body.appendChild(el('div', { class: 'card' },
      el('div', { class: 'section-title' },
        el('h2', { text: d.periodLabel + ' · ' + filterLabel }),
        el('div', { class: 'spacer' }), search),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'พนักงาน' }), el('th', { text: 'สถานะ' }), el('th', { text: 'ฉบับ' }),
          el('th', { text: 'การเปิดดู' }), el('th', { text: 'เวลาที่ยืนยัน' }), el('th'))),
        tbody))));
    drawRows();
  }

  /* ======================= รายละเอียดใบลงเวลา ======================= */
  function openDetail(id) {
    var body = el('div', {}, Core.loading());
    var m = Core.modal({ title: 'รายละเอียดใบลงเวลา', wide: true, body: body });
    Core.api('adm_getTimesheetDetail', id).then(function (d) {
      drawDetail(body, d, m);
    }).catch(function (e) { Core.clear(body).appendChild(el('div', { class: 'callout callout-bad', text: Core.errMsg(e) })); });
  }

  function drawDetail(body, d, m) {
    Core.clear(body);
    var t = d.timesheet;
    var isCurrent = t.status !== 'ถูกแทนที่';
    var viewer = el('div', { class: 'viewer' }, Core.loading('กำลังเปิดไฟล์...'));
    var dl = el('button', { class: 'btn btn-sm', text: 'ดาวน์โหลด', disabled: true });

    // ข้อมูลหลัก
    var info = el('dl', { class: 'kv' },
      el('dt', { text: 'พนักงาน' }), el('dd', { text: t.employeeName + ' (' + t.employeeId + ')' }),
      el('dt', { text: 'อีเมล' }), el('dd', { text: t.email }),
      el('dt', { text: 'รอบเดือน' }), el('dd', { text: t.periodLabel }),
      el('dt', { text: 'ฉบับที่' }), el('dd', { text: String(t.version) }),
      el('dt', { text: 'สถานะ' }), el('dd', {}, Core.badge(t.status)),
      el('dt', { text: 'อัปโหลด' }), el('dd', { text: Core.fmt(t.uploadedAt) }),
      el('dt', { text: 'เปิดดูครั้งแรก' }), el('dd', { text: Core.fmt(t.firstViewedAt) }),
      el('dt', { text: 'เปิดดูล่าสุด' }), el('dd', { text: t.lastViewedAt ? Core.fmt(t.lastViewedAt) + ' (' + t.viewCount + ' ครั้ง)' : '-' }),
      el('dt', { text: 'ยืนยันเมื่อ' }), el('dd', { text: Core.fmt(t.confirmedAt) }),
      el('dt', { text: 'ไฟล์ต้นฉบับ' }), el('dd', { text: t.fileName }),
      el('dt', { text: 'SHA-256' }), el('dd', { class: 'mono', text: t.fileHash }));

    var confirmProof = t.confirmDetail
      ? el('div', { class: 'callout callout-ok small', style: 'margin-top:12px' }, el('b', { text: 'หลักฐานการยืนยัน: ' }), t.confirmDetail)
      : null;

    // ข้อความ
    var replyBox = el('textarea', { class: 'input', maxlength: '1000', placeholder: 'พิมพ์ข้อความตอบกลับพนักงาน' });
    var replyBtn = el('button', { class: 'btn btn-primary', text: 'ส่งข้อความ' });
    replyBtn.addEventListener('click', function () {
      var msg = replyBox.value.trim();
      if (!msg) { Core.toast('กรุณาพิมพ์ข้อความ', 'error'); return; }
      Core.busy(replyBtn, true, 'กำลังส่ง...');
      Core.api('adm_reply', t.id, msg).then(function () {
        Core.toast('ส่งข้อความแล้ว', 'ok');
        return Core.api('adm_getTimesheetDetail', t.id).then(function (nd) { drawDetail(body, nd, m); });
      }).then(function () { refreshDashSoon(); })
        .catch(function (e) { Core.busy(replyBtn, false); Core.toast(Core.errMsg(e), 'error'); });
    });
    var newVerBtn = el('button', { class: 'btn', text: 'อัปโหลดฉบับแก้ไข' });
    newVerBtn.addEventListener('click', function () {
      m.close();
      quickUpload({ employeeId: t.employeeId, name: t.employeeName }, true, t.period, t.status);
    });

    var msgCard = el('div', { class: 'card' },
      el('h3', { text: 'ข้อความแก้ไข' }),
      Core.thread(d.messages, 'แอดมิน'),
      isCurrent && t.status !== 'ยืนยันแล้ว'
        ? el('div', { class: 'stack', style: 'margin-top:14px' }, replyBox,
          el('div', { class: 'row', style: 'justify-content:flex-end' }, newVerBtn, replyBtn))
        : null,
      isCurrent && t.status === 'ยืนยันแล้ว'
        ? el('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, newVerBtn)
        : null);

    // ฉบับต่างๆ
    var verCard = d.versions.length > 1 ? el('div', { class: 'card' },
      el('h3', { text: 'ทุกฉบับของรอบเดือนนี้' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'ฉบับ' }), el('th', { text: 'สถานะ' }), el('th', { text: 'อัปโหลด' }), el('th', { text: 'ยืนยัน' }))),
        el('tbody', {}, d.versions.map(function (v) {
          return el('tr', { class: 'clickable' + (v.id === t.id ? '' : ''), style: v.id === t.id ? 'font-weight:600' : '',
            onclick: function () { if (v.id !== t.id) Core.api('adm_getTimesheetDetail', v.id).then(function (nd) { drawDetail(body, nd, m); }); } },
            el('td', { text: String(v.version) + (v.id === t.id ? ' (กำลังดู)' : '') }),
            el('td', {}, Core.badge(v.status)),
            el('td', { class: 'nowrap', text: Core.fmtShort(v.uploadedAt) }),
            el('td', { class: 'nowrap', text: v.confirmedAt ? Core.fmtShort(v.confirmedAt) : '-' }));
        }))))) : null;

    // ประวัติกิจกรรม
    var auditCard = el('div', { class: 'card' },
      el('h3', { text: 'ประวัติกิจกรรม' }),
      d.audit.length ? el('div', { class: 'table-wrap', style: 'max-height:260px;overflow:auto' }, el('table', { class: 'table' },
        el('tbody', {}, d.audit.map(function (a) {
          return el('tr', {},
            el('td', { class: 'nowrap small', text: Core.fmt(a.timestamp) }),
            el('td', { class: 'small', text: a.action + ' (ฉบับที่ ' + a.version + ')' }),
            el('td', { class: 'small muted', text: a.email }));
        })))) : el('div', { class: 'muted small', text: 'ยังไม่มีกิจกรรม' }));

    body.appendChild(el('div', { class: 'grid-2' },
      el('div', {},
        el('div', { class: 'section-title' }, el('h3', { style: 'margin:0', text: 'ไฟล์' }), el('div', { class: 'spacer' }), dl),
        viewer),
      el('div', {},
        el('div', { class: 'card' }, info, confirmProof),
        msgCard, verCard, auditCard)));

    Core.api('adm_getFile', t.id).then(function (data) {
      dl.disabled = false;
      dl.onclick = function () { Core.downloadFile(data); };
      return Core.renderFile(viewer, data);
    }).catch(function (e) {
      Core.clear(viewer).appendChild(el('div', { class: 'viewer-empty', text: 'เปิดไฟล์ไม่สำเร็จ: ' + Core.errMsg(e) }));
    });
  }

  function refreshDashSoon() {
    if (state.tab === 'dashboard') Dashboard();
    else loadDash().catch(function () {});
  }

  /* ======================= อัปโหลด ======================= */
  var MAX_MB = 10;
  var ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function readB64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
      r.readAsDataURL(file);
    });
  }

  function checkFile(file) {
    if (ACCEPT.indexOf(file.type) < 0) return 'รองรับเฉพาะ PDF, JPG, PNG, WEBP, GIF';
    if (file.size > MAX_MB * 1024 * 1024) return 'ไฟล์ใหญ่เกิน ' + MAX_MB + ' MB';
    return '';
  }

  function uploadOne(employeeId, period, file) {
    return readB64(file).then(function (b64) {
      return Core.api('adm_uploadTimesheet', { employeeId: employeeId, period: period, fileName: file.name, mimeType: file.type, base64: b64 });
    });
  }

  /** อัปโหลดให้พนักงานคนเดียว (จากแดชบอร์ด / รายละเอียด) */
  function quickUpload(emp, isRevision, period, prevStatus) {
    period = period || state.period;
    var fileInput = el('input', { type: 'file', accept: ACCEPT.join(','), class: 'input' });
    var btn = el('button', { class: 'btn btn-primary', text: 'อัปโหลด' });
    var warn = isRevision || prevStatus
      ? el('div', { class: 'callout callout-warn small' }, 'ฉบับเดิม' + (prevStatus ? ' (สถานะ: ' + prevStatus + ')' : '') +
        ' จะถูกเก็บไว้เป็นประวัติ และพนักงานต้องตรวจสอบและยืนยันฉบับใหม่อีกครั้ง')
      : null;
    var body = el('div', { class: 'stack' },
      el('div', {}, 'พนักงาน: ', el('b', { text: emp.name + ' (' + emp.employeeId + ')' })),
      el('div', {}, 'รอบเดือน: ', el('b', { text: Core.periodLabel(period) })),
      warn,
      el('label', { class: 'field' }, el('span', { text: 'ไฟล์ใบลงเวลา (PDF หรือรูปภาพ ไม่เกิน ' + MAX_MB + ' MB)' }), fileInput),
      el('div', { class: 'row', style: 'justify-content:flex-end' }, btn));
    var m = Core.modal({ title: isRevision ? 'อัปโหลดฉบับแก้ไข' : 'อัปโหลดใบลงเวลา', body: body });
    btn.addEventListener('click', function () {
      var f = fileInput.files[0];
      if (!f) { Core.toast('กรุณาเลือกไฟล์', 'error'); return; }
      var err = checkFile(f);
      if (err) { Core.toast(err, 'error'); return; }
      Core.busy(btn, true, 'กำลังอัปโหลด...');
      uploadOne(emp.employeeId, period, f).then(function (res) {
        m.close();
        Core.toast('อัปโหลดฉบับที่ ' + res.timesheet.version + ' ของ ' + emp.name + ' แล้ว', 'ok');
        state.period = period;
        refreshDashSoon();
      }).catch(function (e) { Core.busy(btn, false); Core.toast(Core.errMsg(e), 'error'); });
    });
  }

  function Upload() {
    Core.clear(main);
    var items = []; // {file, employeeId, status, msg}
    var emps = [];
    var current = {}; // employeeId -> status เดิมในรอบนี้

    var head = el('div', { class: 'section-title' }, el('h2', { style: 'font-size:19px', text: 'อัปโหลดใบลงเวลา' }), el('div', { class: 'spacer' }), periodPicker(function () { Upload(); }));
    main.appendChild(head);

    var fileInput = el('input', { type: 'file', multiple: true, accept: ACCEPT.join(','), class: 'hidden' });
    var drop = el('div', { class: 'dropzone' },
      el('div', { style: 'font-weight:600;font-size:16px', text: 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์' }),
      el('div', { class: 'hint', style: 'margin-top:6px', text: 'เลือกได้หลายไฟล์พร้อมกัน · PDF / รูปภาพ ไม่เกิน ' + MAX_MB + ' MB ต่อไฟล์' }),
      el('div', { class: 'hint', text: 'เคล็ดลับ: ตั้งชื่อไฟล์ให้มีรหัสพนักงาน (เช่น EMP001.pdf) ระบบจะจับคู่พนักงานให้อัตโนมัติ' }),
      fileInput);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });

    var tbody = el('tbody');
    var uploadAllBtn = el('button', { class: 'btn btn-primary', text: 'อัปโหลดทั้งหมด', disabled: true });
    var clearBtn = el('button', { class: 'btn', text: 'ล้างรายการ', onclick: function () { items = items.filter(function (i) { return i.status === 'uploading'; }); drawItems(); } });
    var listCard = el('div', { class: 'card hidden' },
      el('div', { class: 'section-title' }, el('h2', { text: 'ไฟล์ที่เลือก' }), el('div', { class: 'spacer' }), clearBtn, uploadAllBtn),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'ไฟล์' }), el('th', { text: 'พนักงาน' }), el('th', { text: 'สถานะ' }), el('th'))),
        tbody)));

    var info = el('div', { class: 'muted small', style: 'margin-top:10px' }, Core.loading('กำลังโหลดรายชื่อพนักงาน...'));
    main.appendChild(el('div', { class: 'card' }, drop, info));
    main.appendChild(listCard);

    Promise.all([Core.api('adm_listEmployees'), loadDash()]).then(function (res) {
      emps = res[0];
      res[1].rows.forEach(function (r) { if (r.timesheet) current[r.employee.employeeId] = r.timesheet.status; });
      Core.clear(info).appendChild(document.createTextNode(
        'พนักงาน ' + emps.length + ' คน · อัปโหลดแล้วในเดือนนี้ ' + Object.keys(current).length + ' คน'));
      drawItems();
    }).catch(function (e) { Core.clear(info).appendChild(el('span', { style: 'color:var(--bad)', text: Core.errMsg(e) })); });

    function guess(name) {
      var base = name.replace(/\.[^.]+$/, '').toLowerCase();
      var byId = emps.filter(function (e) {
        var id = e.employeeId.toLowerCase();
        var re = new RegExp('(^|[^a-z0-9])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
        return re.test(base);
      });
      if (byId.length === 1) return byId[0].employeeId;
      var byName = emps.filter(function (e) { return e.name && base.indexOf(e.name.toLowerCase().split(/\s+/)[0]) >= 0; });
      if (byName.length === 1) return byName[0].employeeId;
      return '';
    }

    function addFiles(list) {
      Array.prototype.forEach.call(list, function (f) {
        var err = checkFile(f);
        items.push({ file: f, employeeId: err ? '' : guess(f.name), status: err ? 'invalid' : 'ready', msg: err });
      });
      drawItems();
    }

    function drawItems() {
      Core.clear(tbody);
      listCard.classList.toggle('hidden', !items.length);
      var seen = {};
      function isReady(i) { return (i.status === 'ready' || i.status === 'failed') && i.employeeId; }
      items.forEach(function (it) { if (isReady(it)) seen[it.employeeId] = (seen[it.employeeId] || 0) + 1; });
      items.forEach(function (it, idx) {
        var sel = el('select', { class: 'input', disabled: it.status !== 'ready' && it.status !== 'failed' });
        sel.appendChild(el('option', { value: '', text: '— เลือกพนักงาน —' }));
        emps.forEach(function (e) {
          sel.appendChild(el('option', { value: e.employeeId, text: e.employeeId + ' · ' + e.name, selected: e.employeeId === it.employeeId }));
        });
        sel.addEventListener('change', function () { it.employeeId = sel.value; if (it.status === 'failed') { it.status = 'ready'; it.msg = ''; } drawItems(); });
        var statusCell;
        if (it.status === 'done') statusCell = el('span', { class: 'badge b-confirmed', text: 'อัปโหลดแล้ว' });
        else if (it.status === 'uploading') statusCell = el('span', {}, el('span', { class: 'spinner', style: 'width:16px;height:16px;border-width:2px' }), ' กำลังอัปโหลด');
        else if (it.status === 'invalid') statusCell = el('span', { class: 'small', style: 'color:var(--bad)', text: it.msg });
        else if (it.status === 'failed') statusCell = el('span', { class: 'small', style: 'color:var(--bad)', text: 'ไม่สำเร็จ: ' + it.msg + ' (กดอัปโหลดอีกครั้งเพื่อลองใหม่)' });
        else {
          var notes = [];
          if (!it.employeeId) notes.push(el('span', { class: 'small', style: 'color:var(--warn)', text: 'ยังไม่ได้เลือกพนักงาน' }));
          else {
            if (current[it.employeeId]) notes.push(el('div', { class: 'small', style: 'color:var(--warn)', text: 'จะแทนที่ฉบับเดิม (' + current[it.employeeId] + ')' }));
            if (seen[it.employeeId] > 1) notes.push(el('div', { class: 'small', style: 'color:var(--bad)', text: 'เลือกพนักงานซ้ำกับไฟล์อื่น' }));
            if (!notes.length) notes.push(el('span', { class: 'small muted', text: 'พร้อมอัปโหลด' }));
          }
          statusCell = el('div', {}, notes);
        }
        tbody.appendChild(el('tr', {},
          el('td', {}, el('div', { style: 'font-weight:500;word-break:break-all', text: it.file.name }), el('div', { class: 'muted small', text: (it.file.size / 1024 / 1024).toFixed(2) + ' MB' })),
          el('td', { style: 'min-width:220px' }, sel),
          el('td', {}, statusCell),
          el('td', { style: 'text-align:right' }, it.status !== 'uploading' && it.status !== 'done'
            ? el('button', { class: 'btn btn-sm btn-danger', text: 'นำออก', onclick: function () { items.splice(idx, 1); drawItems(); } }) : null)));
      });
      var ready = items.filter(isReady);
      var dup = Object.keys(seen).some(function (k) { return seen[k] > 1; });
      uploadAllBtn.disabled = !ready.length || dup || items.some(function (i) { return i.status === 'uploading'; });
      uploadAllBtn.textContent = ready.length ? 'อัปโหลด ' + ready.length + ' ไฟล์' : 'อัปโหลดทั้งหมด';
    }

    uploadAllBtn.addEventListener('click', function () {
      var ready = items.filter(function (i) { return (i.status === 'ready' || i.status === 'failed') && i.employeeId; });
      var replacing = ready.filter(function (i) { return current[i.employeeId]; });
      var go2 = replacing.length
        ? Core.confirmDialog({ title: 'ยืนยันการแทนที่', message: 'มี ' + replacing.length + ' ไฟล์ที่จะแทนที่ฉบับเดิมของเดือน ' + Core.periodLabel(state.period) + ' พนักงานต้องยืนยันฉบับใหม่อีกครั้ง ต้องการดำเนินการต่อหรือไม่?', okText: 'อัปโหลดต่อ' })
        : Promise.resolve(true);
      go2.then(function (ok) {
        if (!ok) return;
        var period = state.period;
        var chain = Promise.resolve();
        ready.forEach(function (it) {
          chain = chain.then(function () {
            it.status = 'uploading'; drawItems();
            return uploadOne(it.employeeId, period, it.file).then(function (res) {
              it.status = 'done';
              current[it.employeeId] = res.timesheet.status;
            }).catch(function (e) { it.status = 'failed'; it.msg = Core.errMsg(e); }).then(drawItems);
          });
        });
        chain.then(function () {
          var done = ready.filter(function (i) { return i.status === 'done'; }).length;
          Core.toast('อัปโหลดสำเร็จ ' + done + '/' + ready.length + ' ไฟล์', done === ready.length ? 'ok' : 'error');
          loadDash().catch(function () {});
        });
      });
    });
  }

  /* ======================= จัดการพนักงาน ======================= */
  function Employees() {
    Core.clear(main);
    var idIn = el('input', { class: 'input', placeholder: 'เช่น EMP001', maxlength: '30' });
    var nameIn = el('input', { class: 'input', placeholder: 'ชื่อ-นามสกุล' });
    var emailIn = el('input', { class: 'input', type: 'email', placeholder: 'name@example.com' });
    var addBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: '+ เพิ่มพนักงาน' });
    var form = el('form', { style: 'display:grid;grid-template-columns:1fr 2fr 2fr auto;gap:10px;align-items:end' },
      el('label', { class: 'field' }, el('span', { text: 'รหัสพนักงาน' }), idIn),
      el('label', { class: 'field' }, el('span', { text: 'ชื่อ-นามสกุล' }), nameIn),
      el('label', { class: 'field' }, el('span', { text: 'อีเมล (ใช้ล็อกอิน)' }), emailIn),
      addBtn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      Core.busy(addBtn, true, 'กำลังเพิ่ม...');
      Core.api('adm_addEmployee', { employeeId: idIn.value, name: nameIn.value, email: emailIn.value }).then(function (emp) {
        Core.busy(addBtn, false);
        Core.toast('เพิ่ม ' + emp.name + ' แล้ว', 'ok');
        idIn.value = ''; nameIn.value = ''; emailIn.value = '';
        idIn.focus();
        load();
      }).catch(function (e2) { Core.busy(addBtn, false); Core.toast(Core.errMsg(e2), 'error'); });
    });

    var search = el('input', { class: 'input', type: 'search', placeholder: 'ค้นหา', style: 'max-width:240px' });
    var tbody = el('tbody');
    var countEl = el('span', { class: 'muted' });
    main.appendChild(el('div', { class: 'card' }, el('h2', { text: 'เพิ่มพนักงาน' }), form,
      el('p', { class: 'hint', style: 'margin:10px 0 0', text: 'พนักงานจะล็อกอินด้วยอีเมลนี้ (รับรหัส OTP ทางอีเมล) · รหัสพนักงานแก้ไขภายหลังไม่ได้' })));
    main.appendChild(el('div', { class: 'card' },
      el('div', { class: 'section-title' }, el('h2', { text: 'รายชื่อพนักงาน' }), countEl, el('div', { class: 'spacer' }), search),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'รหัส' }), el('th', { text: 'ชื่อ-นามสกุล' }), el('th', { text: 'อีเมล' }), el('th', { text: 'ใบลงเวลา' }), el('th', { text: 'เพิ่มเมื่อ' }), el('th'))),
        tbody))));

    // ปรับฟอร์มบนจอเล็ก
    if (window.matchMedia('(max-width: 760px)').matches) form.style.gridTemplateColumns = '1fr';

    function draw() {
      Core.clear(tbody);
      var list = state.employees || [];
      countEl.textContent = '(' + list.length + ' คน)';
      var q = search.value.trim().toLowerCase();
      var rows = list.filter(function (e) { return !q || (e.employeeId + ' ' + e.name + ' ' + e.email).toLowerCase().indexOf(q) >= 0; });
      if (!rows.length) {
        tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'empty', text: list.length ? 'ไม่พบรายการ' : 'ยังไม่มีพนักงาน' })));
        return;
      }
      rows.forEach(function (e) {
        tbody.appendChild(el('tr', {},
          el('td', { class: 'nowrap', style: 'font-weight:600', text: e.employeeId }),
          el('td', { text: e.name }),
          el('td', { text: e.email }),
          el('td', { text: e.timesheetCount + ' รอบ' }),
          el('td', { class: 'nowrap small muted', text: Core.fmtShort(e.createdAt) }),
          el('td', { class: 'nowrap', style: 'text-align:right' },
            el('button', { class: 'btn btn-sm', text: 'แก้ไข', onclick: function () { edit(e); } }), ' ',
            el('button', { class: 'btn btn-sm btn-danger', text: 'ลบ', onclick: function () { del(e); } }))));
      });
    }
    search.addEventListener('input', draw);

    function load() {
      Core.clear(tbody).appendChild(el('tr', {}, el('td', { colspan: '6' }, Core.loading())));
      Core.api('adm_listEmployees').then(function (list) { state.employees = list; draw(); })
        .catch(function (e) { Core.clear(tbody).appendChild(el('tr', {}, el('td', { colspan: '6', style: 'color:var(--bad)', text: Core.errMsg(e) }))); });
    }

    function edit(emp) {
      var n = el('input', { class: 'input', value: emp.name });
      var em = el('input', { class: 'input', type: 'email', value: emp.email });
      var save = el('button', { class: 'btn btn-primary', type: 'submit', text: 'บันทึก' });
      var f = el('form', { class: 'stack' },
        el('label', { class: 'field' }, el('span', { text: 'รหัสพนักงาน' }), el('input', { class: 'input', value: emp.employeeId, disabled: true })),
        el('label', { class: 'field' }, el('span', { text: 'ชื่อ-นามสกุล' }), n),
        el('label', { class: 'field' }, el('span', { text: 'อีเมล' }), em),
        el('div', { class: 'row', style: 'justify-content:flex-end' }, save));
      var m = Core.modal({ title: 'แก้ไขข้อมูลพนักงาน', body: f });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        Core.busy(save, true, 'กำลังบันทึก...');
        Core.api('adm_updateEmployee', { employeeId: emp.employeeId, name: n.value, email: em.value }).then(function () {
          m.close(); Core.toast('บันทึกแล้ว', 'ok'); load();
        }).catch(function (e) { Core.busy(save, false); Core.toast(Core.errMsg(e), 'error'); });
      });
    }

    function del(emp) {
      Core.confirmDialog({
        title: 'ลบพนักงาน',
        danger: true,
        okText: 'ลบพนักงาน',
        message: el('div', { class: 'stack' },
          el('p', { style: 'margin:0' }, 'ต้องการลบ ', el('b', { text: emp.name + ' (' + emp.employeeId + ')' }), ' ออกจากระบบหรือไม่?'),
          el('p', { class: 'hint', style: 'margin:0', text: 'พนักงานจะล็อกอินไม่ได้ทันที แต่ประวัติใบลงเวลาและการยืนยันทั้งหมดยังเก็บไว้ในชีต หากเพิ่มกลับด้วยรหัสเดิม ประวัติจะกลับมาแสดง' }))
      }).then(function (ok) {
        if (!ok) return;
        Core.api('adm_deleteEmployee', emp.employeeId).then(function () { Core.toast('ลบ ' + emp.name + ' แล้ว', 'ok'); load(); })
          .catch(function (e) { Core.toast(Core.errMsg(e), 'error'); });
      });
    }

    load();
  }

  return { render: render };
})();
