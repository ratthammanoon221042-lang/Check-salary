/* =========================================================
 * หน้าผู้ดูแลระบบ
 * ========================================================= */
var AdminApp = (function () {
  var el = Core.el;
  var state = {
    user: null,
    tab: 'dashboard',
    uploadMode: 'split',
    split: null,
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
          el('td', {}, el('div', { style: 'font-weight:600', text: r.employee.name }), el('div', { class: 'muted small', text: r.employee.employeeId + (r.employee.email ? ' · ' + r.employee.email : ' · ยังไม่เคยเข้าระบบ') })),
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
      el('dt', { text: 'บัญชี Google' }), el('dd', { text: t.email || '-' }),
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

    body.appendChild(el('div', { class: 'grid-2 wide-left' },
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

  function modeToggle() {
    function chip(mode, label) {
      return el('button', { class: 'chip' + (state.uploadMode === mode ? ' active' : ''), onclick: function () { state.uploadMode = mode; Upload(); } }, label);
    }
    return el('div', { class: 'chips', style: 'margin-bottom:14px' },
      chip('split', 'PDF รวมหลายคน (แยกให้อัตโนมัติ)'),
      chip('separate', 'ไฟล์แยกรายคนอยู่แล้ว'));
  }

  function Upload() {
    Core.clear(main);
    if (state.uploadMode === 'split') return SplitUpload();
    var items = []; // {file, employeeId, status, msg}
    var emps = [];
    var current = {}; // employeeId -> status เดิมในรอบนี้

    var head = el('div', { class: 'section-title' }, el('h2', { style: 'font-size:19px', text: 'อัปโหลดใบลงเวลา' }), el('div', { class: 'spacer' }), periodPicker(function () { Upload(); }));
    main.appendChild(head);
    main.appendChild(modeToggle());

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

  /* ======================= แยก PDF รวมหลายคน ======================= */
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  var SKIP = '__skip';
  var loadedScripts = {};

  function loadScript(url) {
    if (loadedScripts[url]) return loadedScripts[url];
    loadedScripts[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete loadedScripts[url]; reject(new Error('โหลดตัวแยกไฟล์ PDF ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต')); };
      document.head.appendChild(s);
    });
    return loadedScripts[url];
  }

  function bytesToB64(bytes) {
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  var NAME_TITLES = /^(นางสาว|นาย|นาง|น\.ส\.|นส\.|ด\.ช\.|ด\.ญ\.|mrs\.?|mr\.?|ms\.?|miss)\s*/i;
  function normText(s) {
    return String(s || '').normalize('NFC')
      .replace(/ํา/g, 'ำ')            // ํ + า → ำ (PDF บางไฟล์แยกสระอำ)
      .replace(/[​-‍﻿]/g, '')
      .toLowerCase();
  }
  function compactText(s) { return normText(s).replace(/\s+/g, ''); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** หาว่าหน้านี้เป็นของพนักงานคนไหน จากรหัสพนักงานหรือชื่อ-นามสกุลในข้อความของหน้า */
  function detectEmployee(text, emps) {
    var flat = normText(text), comp = compactText(text);
    var hits = [];
    emps.forEach(function (e) {
      var score = 0, by = [];
      var id = normText(e.employeeId);
      if (id && new RegExp('(^|[^a-z0-9])' + escRe(id) + '($|[^a-z0-9])').test(flat)) { score += 1; by.push('รหัส'); }
      var nm = compactText(String(e.name || '').replace(NAME_TITLES, ''));
      if (nm.length >= 4 && comp.indexOf(nm) >= 0) { score += 2 + nm.length / 1000; by.push('ชื่อ'); }
      if (score) hits.push({ e: e, score: score, by: by.join('+') });
    });
    if (!hits.length) return null;
    hits.sort(function (a, b) { return b.score - a.score; });
    if (hits.length > 1 && hits[1].score === hits[0].score) {
      return { ambiguous: true, candidates: hits.filter(function (h) { return h.score === hits[0].score; }).map(function (h) { return h.e.name; }) };
    }
    return { employeeId: hits[0].e.employeeId, by: hits[0].by };
  }

  /** คำนวณว่าแต่ละหน้าเป็นของใคร: เลือกเอง > ระบบเจอ > ต่อจากหน้าก่อน */
  function resolvePages(pages) {
    var prev = '';
    pages.forEach(function (p) {
      if (p.manual !== undefined) { p.assigned = p.manual; p.how = 'manual'; }
      else if (p.auto && p.auto.employeeId) { p.assigned = p.auto.employeeId; p.how = 'auto'; }
      else if (p.auto && p.auto.ambiguous) { p.assigned = ''; p.how = 'ambiguous'; }
      else if (prev) { p.assigned = prev; p.how = 'inherit'; }
      else { p.assigned = ''; p.how = 'none'; }
      prev = p.assigned && p.assigned !== SKIP ? p.assigned : '';
    });
  }

  function pageRanges(nums) {
    var out = [], start = null, last = null;
    nums.forEach(function (n) {
      if (start === null) { start = last = n; return; }
      if (n === last + 1) { last = n; return; }
      out.push(start === last ? String(start) : start + '–' + last);
      start = last = n;
    });
    if (start !== null) out.push(start === last ? String(start) : start + '–' + last);
    return out.join(', ');
  }

  function SplitUpload() {
    Core.clear(main);
    main.appendChild(el('div', { class: 'section-title' }, el('h2', { style: 'font-size:19px', text: 'อัปโหลดใบลงเวลา' }), el('div', { class: 'spacer' }), periodPicker(function () { Upload(); })));
    main.appendChild(modeToggle());

    var emps = [], current = {};
    var empById = {};
    var sp = state.split; // { fileName, bytes, pdf, pages, groups status }

    var fileInput = el('input', { type: 'file', accept: 'application/pdf', class: 'hidden' });
    var drop = el('div', { class: 'dropzone' },
      el('div', { style: 'font-weight:600;font-size:16px', text: sp ? 'เลือกไฟล์ PDF รวมไฟล์ใหม่' : 'ลากไฟล์ PDF รวมมาวาง หรือคลิกเพื่อเลือกไฟล์' }),
      el('div', { class: 'hint', style: 'margin-top:6px', text: 'ระบบจะอ่านรหัสพนักงานหรือชื่อ-นามสกุลในแต่ละหน้า แล้วแยกเป็นไฟล์ของแต่ละคนให้' }),
      el('div', { class: 'hint', text: 'หน้าที่ไม่พบชื่อ จะถือว่าเป็นหน้าต่อของคนก่อนหน้า · ตรวจสอบและแก้ได้ก่อนอัปโหลด' }),
      fileInput);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) openPdf(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) openPdf(fileInput.files[0]); fileInput.value = ''; });

    var info = el('div', { class: 'muted small', style: 'margin-top:10px' }, Core.loading('กำลังโหลดรายชื่อพนักงาน...'));
    main.appendChild(el('div', { class: 'card' }, drop, info));
    var summaryCard = el('div', { class: 'card hidden' });
    var pagesCard = el('div', { class: 'card hidden' });
    main.appendChild(summaryCard);
    main.appendChild(pagesCard);

    var ready = Promise.all([Core.api('adm_listEmployees'), loadDash()]).then(function (res) {
      emps = res[0];
      emps.forEach(function (e) { empById[e.employeeId] = e; });
      current = {};
      res[1].rows.forEach(function (r) { if (r.timesheet) current[r.employee.employeeId] = r.timesheet.status; });
      Core.clear(info).appendChild(document.createTextNode('พนักงาน ' + emps.length + ' คน · อัปโหลดแล้วในเดือน ' + Core.periodLabel(state.period) + ' ' + Object.keys(current).length + ' คน'));
      if (sp) { sp.pages.forEach(function (p) { p.auto = detectEmployee(p.text, emps); }); drawAll(); }
    }).catch(function (e) { Core.clear(info).appendChild(el('span', { style: 'color:var(--bad)', text: Core.errMsg(e) })); });

    function openPdf(file) {
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { Core.toast('กรุณาเลือกไฟล์ PDF', 'error'); return; }
      Core.clear(summaryCard).appendChild(Core.loading('กำลังอ่านไฟล์...'));
      summaryCard.classList.remove('hidden');
      pagesCard.classList.add('hidden');
      var progress = summaryCard.querySelector('.loading-block div');
      file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        if (!window.pdfjsLib) throw new Error('โหลดตัวอ่าน PDF ไม่สำเร็จ กรุณารีเฟรชหน้า');
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return Promise.all([ready, pdfjsLib.getDocument({ data: bytes.slice() }).promise]).then(function (r) {
          var pdf = r[1];
          var pages = [];
          var chain = Promise.resolve();
          for (var n = 1; n <= pdf.numPages; n++) {
            (function (pageNo) {
              chain = chain.then(function () {
                progress.textContent = 'กำลังอ่านหน้า ' + pageNo + ' / ' + pdf.numPages;
                return pdf.getPage(pageNo).then(function (page) {
                  return page.getTextContent().then(function (tc) {
                    var text = tc.items.map(function (it) { return it.str; }).join(' ');
                    pages.push({ n: pageNo, text: text, auto: detectEmployee(text, emps) });
                  });
                });
              });
            })(n);
          }
          return chain.then(function () {
            state.split = sp = { fileName: file.name, bytes: bytes, pdf: pdf, pages: pages, done: {} };
            drawAll();
          });
        });
      }).catch(function (e) {
        Core.clear(summaryCard).appendChild(el('div', { class: 'callout callout-bad', text: 'อ่านไฟล์ไม่สำเร็จ: ' + Core.errMsg(e) }));
      });
    }

    function groupsOf() {
      var map = {}, order = [];
      sp.pages.forEach(function (p) {
        if (!p.assigned || p.assigned === SKIP) return;
        if (!map[p.assigned]) { map[p.assigned] = []; order.push(p.assigned); }
        map[p.assigned].push(p.n);
      });
      return order.map(function (id) { return { employeeId: id, pages: map[id] }; });
    }

    function drawAll() {
      resolvePages(sp.pages);
      drawSummary();
      drawPages();
    }

    function drawSummary() {
      Core.clear(summaryCard);
      summaryCard.classList.remove('hidden');
      var groups = groupsOf();
      var unassigned = sp.pages.filter(function (p) { return !p.assigned; });
      var textLen = sp.pages.reduce(function (a, p) { return a + p.text.trim().length; }, 0);
      var found = {};
      groups.forEach(function (g) { found[g.employeeId] = true; });
      var missing = emps.filter(function (e) { return !found[e.employeeId]; });

      summaryCard.appendChild(el('div', { class: 'section-title' },
        el('h2', { text: sp.fileName }),
        el('span', { class: 'muted', text: sp.pages.length + ' หน้า → ' + groups.length + ' คน' })));

      if (textLen < 10 * sp.pages.length) {
        summaryCard.appendChild(el('div', { class: 'callout callout-warn', style: 'margin-bottom:12px' },
          el('b', { text: 'ไฟล์นี้น่าจะเป็นภาพสแกน ระบบอ่านชื่อในไฟล์ไม่ได้' }), el('br'),
          'กรุณาเลือกพนักงานที่หน้าแรกของแต่ละคนด้านล่าง หน้าถัดไปที่ยังไม่ได้เลือกจะเป็นของคนเดียวกันอัตโนมัติ'));
      }
      if (unassigned.length) {
        summaryCard.appendChild(el('div', { class: 'callout callout-bad', style: 'margin-bottom:12px' },
          'ยังมี ', el('b', { text: unassigned.length + ' หน้า' }), ' ที่ไม่ได้ระบุพนักงาน (หน้า ' + pageRanges(unassigned.map(function (p) { return p.n; })) + ') — เลือกพนักงาน หรือเลือก "ไม่ใช้หน้านี้"'));
      }

      var rows = groups.map(function (g) {
        var e = empById[g.employeeId] || { name: '?', employeeId: g.employeeId };
        var st = sp.done[g.employeeId];
        var stCell;
        if (st === 'done') stCell = el('span', { class: 'badge b-confirmed', text: 'อัปโหลดแล้ว' });
        else if (st === 'uploading') stCell = el('span', {}, el('span', { class: 'spinner', style: 'width:16px;height:16px;border-width:2px' }), ' กำลังอัปโหลด');
        else if (st && st.error) stCell = el('span', { class: 'small', style: 'color:var(--bad)', text: 'ไม่สำเร็จ: ' + st.error });
        else if (current[g.employeeId]) stCell = el('span', { class: 'small', style: 'color:var(--warn)', text: 'จะแทนที่ฉบับเดิม (' + current[g.employeeId] + ')' });
        else stCell = el('span', { class: 'small muted', text: 'พร้อมอัปโหลด' });
        return el('tr', {},
          el('td', {}, el('div', { style: 'font-weight:600', text: e.name }), el('div', { class: 'muted small', text: e.employeeId })),
          el('td', { class: 'nowrap', text: 'หน้า ' + pageRanges(g.pages) + ' (' + g.pages.length + ' หน้า)' }),
          el('td', {}, stCell));
      });

      var todo = groups.filter(function (g) { return sp.done[g.employeeId] !== 'done'; });
      var busyNow = groups.some(function (g) { return sp.done[g.employeeId] === 'uploading'; });
      var goBtn = el('button', { class: 'btn btn-primary', text: todo.length ? 'แยกไฟล์และอัปโหลด ' + todo.length + ' คน' : 'อัปโหลดครบแล้ว', disabled: !todo.length || !!unassigned.length || busyNow });
      goBtn.addEventListener('click', function () { uploadGroups(todo); });
      var resetBtn = el('button', { class: 'btn', text: 'ล้างไฟล์', disabled: busyNow, onclick: function () { state.split = null; Upload(); } });

      summaryCard.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'พนักงาน' }), el('th', { text: 'หน้าที่แยกได้' }), el('th', { text: 'สถานะ' }))),
        el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: '3', class: 'empty', text: 'ยังไม่พบพนักงานในไฟล์นี้ — เลือกพนักงานให้แต่ละหน้าด้านล่าง' }))))));
      if (missing.length) {
        summaryCard.appendChild(el('p', { class: 'small', style: 'margin:10px 0 0;color:var(--warn)' },
          'ไม่พบในไฟล์นี้ ' + missing.length + ' คน: ', missing.map(function (e) { return e.name; }).join(', ')));
      }
      summaryCard.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, resetBtn, goBtn));
    }

    var thumbs = {};
    function drawPages() {
      Core.clear(pagesCard);
      pagesCard.classList.remove('hidden');
      pagesCard.appendChild(el('div', { class: 'section-title' },
        el('h2', { text: 'ตรวจสอบทีละหน้า' }),
        el('span', { class: 'muted small', text: 'คลิกที่ภาพเพื่อดูขนาดใหญ่ · เปลี่ยนพนักงานได้ที่ช่องเลือก' })));
      var grid = el('div', { class: 'page-grid' });
      pagesCard.appendChild(grid);
      var HOW = {
        auto: function (p) { return ['ok', 'พบ' + p.auto.by]; },
        manual: function () { return ['info', 'เลือกเอง']; },
        inherit: function () { return ['muted', 'ต่อจากหน้าก่อน']; },
        ambiguous: function (p) { return ['bad', 'พบหลายคน: ' + p.auto.candidates.join(', ')]; },
        none: function () { return ['bad', 'ไม่พบชื่อ ต้องเลือกเอง']; }
      };
      var COLORS = { ok: 'var(--ok)', info: 'var(--info)', muted: 'var(--muted)', bad: 'var(--bad)' };
      sp.pages.forEach(function (p) {
        var sel = el('select', { class: 'input', style: 'min-height:34px;padding:4px 8px;font-size:13px' });
        sel.appendChild(el('option', { value: '', text: '— ยังไม่ระบุ —', selected: !p.assigned }));
        sel.appendChild(el('option', { value: SKIP, text: '✕ ไม่ใช้หน้านี้', selected: p.assigned === SKIP }));
        emps.forEach(function (e) { sel.appendChild(el('option', { value: e.employeeId, text: e.employeeId + ' · ' + e.name, selected: p.assigned === e.employeeId })); });
        sel.addEventListener('change', function () { p.manual = sel.value; drawAll(); });
        var how = HOW[p.how](p);
        var thumb = thumbs[p.n] || (thumbs[p.n] = el('div', { class: 'page-thumb' }, el('span', { class: 'spinner' })));
        thumb.onclick = function () { zoomPage(p.n); };
        var emp = empById[p.assigned];
        grid.appendChild(el('div', { class: 'page-card' + (p.assigned ? '' : ' unassigned') },
          thumb,
          el('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0 4px' },
            el('b', { class: 'small', text: 'หน้า ' + p.n }),
            p.manual !== undefined ? el('button', { class: 'linkbtn small', text: 'ให้ระบบเลือก', onclick: function () { delete p.manual; drawAll(); } }) : null),
          sel,
          el('div', { class: 'small', style: 'margin-top:4px;color:' + COLORS[how[0]], text: how[1] + (emp && p.how === 'inherit' ? ' (' + emp.name + ')' : '') })));
      });
      renderThumbs();
    }

    var thumbsBusy = false;
    function renderThumbs() {
      if (thumbsBusy) return;
      thumbsBusy = true;
      var chain = Promise.resolve();
      sp.pages.forEach(function (p) {
        chain = chain.then(function () {
          var box = thumbs[p.n];
          if (!box || box.dataset.done) return;
          return sp.pdf.getPage(p.n).then(function (page) {
            var base = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: 300 / base.width });
            var c = el('canvas');
            c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
              Core.clear(box).appendChild(c);
              box.dataset.done = '1';
            });
          });
        });
      });
      chain.catch(function () {}).then(function () { thumbsBusy = false; });
    }

    function zoomPage(n) {
      var box = el('div', { class: 'viewer', style: 'max-height:75vh' });
      Core.modal({ title: 'หน้า ' + n, wide: true, body: el('div', {}, box) });
      Core.zoomableViewer(box, { pdf: sp.pdf, pages: [n] });
    }

    function uploadGroups(groups) {
      var replacing = groups.filter(function (g) { return current[g.employeeId]; });
      var ask = replacing.length
        ? Core.confirmDialog({ title: 'ยืนยันการแทนที่', okText: 'อัปโหลดต่อ', message: 'มี ' + replacing.length + ' คนที่มีใบลงเวลาเดือน ' + Core.periodLabel(state.period) + ' อยู่แล้ว ฉบับเดิมจะถูกแทนที่ และพนักงานต้องยืนยันฉบับใหม่อีกครั้ง ต้องการดำเนินการต่อหรือไม่?' })
        : Promise.resolve(true);
      ask.then(function (ok) {
        if (!ok) return;
        var period = state.period;
        var base = sp.fileName.replace(/\.pdf$/i, '');
        var src = null;
        var chain = loadScript(PDFLIB_URL).then(function () {
          return PDFLib.PDFDocument.load(sp.bytes, { ignoreEncryption: true });
        }).then(function (doc) { src = doc; });
        groups.forEach(function (g) {
          chain = chain.then(function () {
            sp.done[g.employeeId] = 'uploading';
            drawSummary();
            return PDFLib.PDFDocument.create().then(function (out) {
              return out.copyPages(src, g.pages.map(function (n) { return n - 1; })).then(function (copied) {
                copied.forEach(function (pg) { out.addPage(pg); });
                return out.save();
              });
            }).then(function (bytes) {
              if (bytes.length > MAX_MB * 1024 * 1024) throw new Error('ไฟล์ที่แยกได้ใหญ่เกิน ' + MAX_MB + ' MB');
              return Core.api('adm_uploadTimesheet', {
                employeeId: g.employeeId, period: period, mimeType: 'application/pdf',
                fileName: base + '_' + g.employeeId + '.pdf', base64: bytesToB64(bytes)
              });
            }).then(function (res) {
              sp.done[g.employeeId] = 'done';
              current[g.employeeId] = res.timesheet.status;
            }).catch(function (e) {
              sp.done[g.employeeId] = { error: Core.errMsg(e) };
            }).then(drawSummary);
          });
        });
        chain.catch(function (e) { Core.toast(Core.errMsg(e), 'error'); }).then(function () {
          var okCount = groups.filter(function (g) { return sp.done[g.employeeId] === 'done'; }).length;
          drawSummary();
          Core.toast('แยกและอัปโหลดสำเร็จ ' + okCount + '/' + groups.length + ' คน', okCount === groups.length ? 'ok' : 'error');
          loadDash().catch(function () {});
        });
      });
    }

    if (sp) { Core.clear(summaryCard).appendChild(Core.loading()); summaryCard.classList.remove('hidden'); }
  }

  /* ======================= จัดการพนักงาน ======================= */
  function Employees() {
    Core.clear(main);
    var idIn = el('input', { class: 'input', placeholder: 'เช่น EMP001', maxlength: '30' });
    var nameIn = el('input', { class: 'input', placeholder: 'ชื่อ-นามสกุล' });
    var addBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: '+ เพิ่มพนักงาน' });
    var form = el('form', { style: 'display:grid;grid-template-columns:1fr 2fr auto;gap:10px;align-items:end' },
      el('label', { class: 'field' }, el('span', { text: 'รหัสพนักงาน' }), idIn),
      el('label', { class: 'field' }, el('span', { text: 'ชื่อ-นามสกุล' }), nameIn),
      addBtn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      Core.busy(addBtn, true, 'กำลังเพิ่ม...');
      Core.api('adm_addEmployee', { employeeId: idIn.value, name: nameIn.value }).then(function (emp) {
        Core.busy(addBtn, false);
        Core.toast('เพิ่ม ' + emp.name + ' แล้ว', 'ok');
        idIn.value = ''; nameIn.value = '';
        idIn.focus();
        load();
      }).catch(function (e2) { Core.busy(addBtn, false); Core.toast(Core.errMsg(e2), 'error'); });
    });

    var search = el('input', { class: 'input', type: 'search', placeholder: 'ค้นหา', style: 'max-width:240px' });
    var tbody = el('tbody');
    var countEl = el('span', { class: 'muted' });
    main.appendChild(el('div', { class: 'card' }, el('h2', { text: 'เพิ่มพนักงาน' }), form,
      el('p', { class: 'hint', style: 'margin:10px 0 0', text: 'พนักงานกดลงชื่อเข้าใช้ด้วย Google แล้วกรอกรหัสพนักงาน — ครั้งแรกระบบจะผูกบัญชี Google นั้นกับรหัสนี้ให้เอง · รหัสพนักงานแก้ไขภายหลังไม่ได้' })));
    main.appendChild(el('div', { class: 'card' },
      el('div', { class: 'section-title' }, el('h2', { text: 'รายชื่อพนักงาน' }), countEl, el('div', { class: 'spacer' }), search),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'รหัส' }), el('th', { text: 'ชื่อ-นามสกุล' }), el('th', { text: 'บัญชี Google ที่ผูกไว้' }), el('th', { text: 'ใบลงเวลา' }), el('th', { text: 'เพิ่มเมื่อ' }), el('th'))),
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
          el('td', {}, e.email
            ? el('div', {}, el('div', { text: e.email }), el('div', { class: 'small muted', text: 'ผูกเมื่อ ' + Core.fmtShort(e.linkedAt) }))
            : el('span', { class: 'small muted', text: 'ยังไม่เคยเข้าระบบ' })),
          el('td', { text: e.timesheetCount + ' รอบ' }),
          el('td', { class: 'nowrap small muted', text: Core.fmtShort(e.createdAt) }),
          el('td', { class: 'nowrap', style: 'text-align:right' },
            el('button', { class: 'btn btn-sm', text: 'แก้ไขชื่อ', onclick: function () { edit(e); } }), ' ',
            e.email ? el('button', { class: 'btn btn-sm', text: 'ยกเลิกการผูก', onclick: function () { unlink(e); } }) : null, e.email ? ' ' : null,
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
      var save = el('button', { class: 'btn btn-primary', type: 'submit', text: 'บันทึก' });
      var f = el('form', { class: 'stack' },
        el('label', { class: 'field' }, el('span', { text: 'รหัสพนักงาน' }), el('input', { class: 'input', value: emp.employeeId, disabled: true })),
        el('label', { class: 'field' }, el('span', { text: 'ชื่อ-นามสกุล' }), n),
        el('div', { class: 'row', style: 'justify-content:flex-end' }, save));
      var m = Core.modal({ title: 'แก้ไขชื่อพนักงาน', body: f });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        Core.busy(save, true, 'กำลังบันทึก...');
        Core.api('adm_updateEmployee', { employeeId: emp.employeeId, name: n.value }).then(function () {
          m.close(); Core.toast('บันทึกแล้ว', 'ok'); load();
        }).catch(function (e) { Core.busy(save, false); Core.toast(Core.errMsg(e), 'error'); });
      });
    }

    function unlink(emp) {
      Core.confirmDialog({
        title: 'ยกเลิกการผูกบัญชี Google',
        okText: 'ยกเลิกการผูก',
        message: el('div', { class: 'stack' },
          el('p', { style: 'margin:0' }, el('b', { text: emp.name + ' (' + emp.employeeId + ')' }), ' ผูกอยู่กับบัญชี ', el('b', { text: emp.email })),
          el('p', { class: 'hint', style: 'margin:0', text: 'หลังยกเลิก บัญชีนี้จะเข้าระบบไม่ได้ทันที และบัญชี Google ถัดไปที่กรอกรหัสนี้จะถูกผูกแทน ใช้เมื่อพนักงานเปลี่ยนบัญชี หรือมีคนอื่นผูกรหัสนี้ไปโดยไม่ถูกต้อง' }))
      }).then(function (ok) {
        if (!ok) return;
        Core.api('adm_unlinkEmployee', emp.employeeId).then(function () { Core.toast('ยกเลิกการผูกบัญชีของ ' + emp.name + ' แล้ว', 'ok'); load(); })
          .catch(function (e) { Core.toast(Core.errMsg(e), 'error'); });
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
