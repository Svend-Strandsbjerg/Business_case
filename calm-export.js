// SAP Cloud ALM task export for the Project Management module (Module 5).
// Design: docs/calm-export-design.md. Add-only: this file reads the app's
// globals and calls existing helpers; it never redefines or patches them.
(function () {
  'use strict';

  // PROVISIONAL Items headers (design 3.1). Replace with the tenant template's
  // headers and order once docs/calm-task-template.xlsx is available.
  var COLUMNS = [
    'Row', 'Type', 'Title', 'Description', 'Parent Row', 'Predecessors', 'Status',
    'Timebox', 'Deliverable', 'Workstream', 'Start Date', 'Due Date', 'Tags',
    'Assigned Role', 'Assigned Person', 'References', 'Source'
  ];

  // Workstream per edition (D3): the edition's display name, as in the PM bar.
  var WORKSTREAMS = {
    'public': 'SAP S/4HANA Cloud Public Edition',
    'private-new': 'SAP Cloud ERP Private – New Implementation',
    'private-conv': 'SAP Cloud ERP Private – System Conversion',
    'private-sdt': 'SAP Cloud ERP Private – Selective Data Transition'
  };

  var BUTTON_ID = 'calm-export-btn';

  // Use the app's _icDayNum when present; otherwise the same formula locally.
  function dayNum(d) {
    if (typeof window._icDayNum === 'function') return window._icDayNum(d);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Day-number -> ISO YYYY-MM-DD, in UTC (timezone-stable).
  function iso(dn) {
    var d = new Date(dn * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // Sorted painted day-numbers of a node (view-independent, from pdays).
  function days(node) {
    var out = [];
    if (node && node.pdays) {
      for (var k in node.pdays) {
        if (Object.prototype.hasOwnProperty.call(node.pdays, k) && node.pdays[k]) out.push(Number(k));
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  // True when the day-numbers form more than one run of consecutive days (D7).
  function isSplit(ds) {
    for (var i = 1; i < ds.length; i++) if (ds[i] !== ds[i - 1] + 1) return true;
    return false;
  }

  function makeRow(rowNo, type, title, parentRow, timebox, workstream, ds, edition) {
    var r = {};
    COLUMNS.forEach(function (c) { r[c] = ''; });
    r['Row'] = rowNo;
    r['Type'] = type;
    r['Title'] = title || '';
    r['Parent Row'] = parentRow;
    r['Status'] = 'Open';
    r['Timebox'] = timebox || '';
    r['Workstream'] = workstream;
    r['Start Date'] = ds.length ? iso(ds[0]) : '';
    r['Due Date'] = ds.length ? iso(ds[ds.length - 1]) : '';
    r['Tags'] = 'app-export,' + edition + (isSplit(ds) ? ',split' : '');
    r['Source'] = 'Manually created';
    return r;
  }

  // Rows for the open edition: per phase, each sub-phase is a Project Task,
  // followed by its activities as Sub-tasks (D2 = A). Inputs default to the
  // live globals, read at call time (pmApplySnapshot reassigns icPhases).
  function collectRows(opts) {
    opts = opts || {};
    var phases = opts.phases || window.icPhases || [];
    var edition = opts.edition || window.pmSelectedType || '';
    var workstream = opts.workstream !== undefined ? opts.workstream : (WORKSTREAMS[edition] || '');
    var rows = [];
    phases.forEach(function (ph) {
      (ph.subPhases || []).forEach(function (sp) {
        var acts = sp.subSubPhases || [];
        var span = days(sp);
        acts.forEach(function (a) { span = span.concat(days(a)); });
        span.sort(function (a, b) { return a - b; });
        // Drop days shared by the sub-phase and its activities before the split check.
        span = span.filter(function (d, i) { return i === 0 || d !== span[i - 1]; });
        var spRowNo = rows.length + 1;
        rows.push(makeRow(spRowNo, 'Project Task', sp.name, '', ph.name, workstream, span, edition));
        acts.forEach(function (a) {
          rows.push(makeRow(rows.length + 1, 'Sub-task', a.name, spRowNo, ph.name, workstream, days(a), edition));
        });
      });
    });
    return rows;
  }

  function fileName(edition) {
    return 'calm-tasks-' + edition + '-' + iso(dayNum(new Date())).replace(/-/g, '') + '.xlsx';
  }

  function download(buf, name) {
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  var MS_SHEET = 'App milestones';
  var MS_COLUMNS = ['Name', 'Date', 'Quality gate', 'Phase', 'Sub-phase'];
  var TITLE_MAX = 255; // PROVISIONAL until the tenant template is available (task 5).
  var DIALOG_ID = 'calm-export-dialog';
  var LIST_MAX = 10;

  // Milestone rows for the App milestones sheet (D4), sorted by date.
  function collectMilestones(opts) {
    opts = opts || {};
    var phases = opts.phases || window.icPhases || [];
    var ms = opts.milestones || window.icMilestones || [];
    var phById = {}, spById = {};
    phases.forEach(function (ph) {
      phById[ph.id] = ph.name || '';
      (ph.subPhases || []).forEach(function (sp) { spById[sp.id] = sp.name || ''; });
    });
    return ms.slice().sort(function (a, b) { return a.md - b.md; }).map(function (m) {
      return {
        'Name': m.name || '',
        'Date': typeof m.md === 'number' ? iso(m.md) : '',
        'Quality gate': m.isGate ? 'Yes' : 'No',
        'Phase': m.phaseId != null && phById[m.phaseId] !== undefined ? phById[m.phaseId] : '',
        'Sub-phase': m.subPhaseId != null && spById[m.subPhaseId] !== undefined ? spById[m.subPhaseId] : ''
      };
    });
  }

  // "a, b, c" capped at LIST_MAX names plus "+N more".
  function nameList(names) {
    var s = names.slice(0, LIST_MAX).join(', ');
    return names.length > LIST_MAX ? s + ' +' + (names.length - LIST_MAX) + ' more' : s;
  }

  // Pre-export checks (design 6.4): {blocking, warnings, info}, each a list of messages.
  function checks() {
    var out = { blocking: [], warnings: [], info: [] };
    var phases = window.icPhases || [];
    var start = window.icDates && window.icDates.start;
    var end = window.icDates && window.icDates.end;
    if (!start) out.blocking.push('No project start date: set a project start date; without it the plan has no calendar dates.');

    // Every node of the open-edition tree: phases, sub-phases and activities.
    var nodes = [];
    phases.forEach(function (ph) {
      nodes.push(ph);
      (ph.subPhases || []).forEach(function (sp) {
        nodes.push(sp);
        (sp.subSubPhases || []).forEach(function (a) { nodes.push(a); });
      });
    });
    var painted = 0, outside = [];
    var lo = start ? dayNum(start) : null;
    var hi = end ? dayNum(end) : null;
    nodes.forEach(function (n) {
      var ds = days(n);
      painted += ds.length;
      if (lo === null) return;
      for (var i = 0; i < ds.length; i++) {
        if (ds[i] < lo || (hi !== null && ds[i] > hi)) { outside.push(n.name || ''); return; }
      }
    });
    if (!painted) out.blocking.push('Nothing painted: paint at least one cell in the timeline.');

    var empty = [];
    phases.forEach(function (ph) {
      (ph.subPhases || []).forEach(function (sp) {
        (sp.subSubPhases || []).forEach(function (a) { if (!days(a).length) empty.push(a.name || ''); });
      });
    });
    if (empty.length) out.warnings.push(empty.length + ' activities have no painted cells and are exported with empty dates: ' + nameList(empty));
    if (outside.length) out.warnings.push(outside.length + ' items have painting outside the project range: ' + nameList(outside));

    var rows = collectRows();
    var split = rows.filter(function (r) { return /(^|,)split$/.test(r['Tags']); }).map(function (r) { return r['Title']; });
    if (split.length) out.warnings.push(split.length + ' items have non-continuous painting and are exported as one row from the first to the last day, tagged split: ' + nameList(split));
    var long = rows.filter(function (r) { return r['Title'].length > TITLE_MAX; }).map(function (r) { return r['Title']; });
    if (long.length) out.warnings.push(long.length + ' titles are longer than ' + TITLE_MAX + ' characters: ' + nameList(long));

    var timeboxes = [];
    rows.forEach(function (r) { if (r['Timebox'] && timeboxes.indexOf(r['Timebox']) < 0) timeboxes.push(r['Timebox']); });
    if (timeboxes.length) out.info.push('Phases to create as Timebox in Cloud ALM first: ' + nameList(timeboxes));
    var msCount = (window.icMilestones || []).length;
    if (msCount) out.info.push(msCount + ' milestones must be created in Cloud ALM project setup');
    var parked = ((window.pmParked || {})[window.pmSelectedType] || []).length;
    if (parked) out.info.push(parked + ' parked items are excluded from the export');
    out.info.push('Upload into a Cloud ALM project WITHOUT an SAP Activate roadmap template, or every task will exist twice.');
    return out;
  }

  function writeXlsx(rows, milestones, name) {
    window.icEnsureExcelJs(function () {
      var wb = new window.ExcelJS.Workbook();
      var ws = wb.addWorksheet('Items');
      ws.addRow(COLUMNS);
      rows.forEach(function (r) { ws.addRow(COLUMNS.map(function (c) { return r[c]; })); });
      var wm = wb.addWorksheet(MS_SHEET);
      wm.addRow(MS_COLUMNS);
      milestones.forEach(function (m) { wm.addRow(MS_COLUMNS.map(function (c) { return m[c]; })); });
      wb.xlsx.writeBuffer().then(function (buf) { download(buf, name); });
    });
  }

  function el(tag, cls, text, css) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (css) e.style.cssText = css;
    return e;
  }

  function closeDialog() {
    var ov = document.getElementById(DIALOG_ID);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  // One export dialog: grouped check results, a Workstream field (D3) and
  // Export / Cancel. Built here because _icShowModal takes no input field;
  // it reuses the app's existing modal classes.
  function openDialog() {
    if (window.currentArea !== 'pm') return;
    closeDialog();
    var res = checks();
    var edition = window.pmSelectedType || '';
    var ov = el('div', '', undefined, 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:1300;background:rgba(0,0,0,0.45);');
    ov.id = DIALOG_ID;
    var box = el('div', 'ic-restore-modal-box', undefined, 'max-width:560px;max-height:85vh;overflow:auto;box-sizing:border-box;');
    box.appendChild(el('div', 'ic-restore-modal-title', 'Export to Cloud ALM'));
    box.appendChild(el('div', 'ic-restore-modal-sub', 'Checks before export'));
    [['blocking', 'Blocking problems', '#ef4444'], ['warnings', 'Warnings', 'var(--text)'], ['info', 'Info', 'var(--text-secondary)']].forEach(function (g) {
      if (!res[g[0]].length) return;
      var sec = el('div', '', undefined, 'margin:0 0 12px;font-size:13px;line-height:1.5;');
      sec.setAttribute('data-group', g[0]);
      sec.appendChild(el('div', '', g[1], 'font-weight:700;color:' + g[2] + ';margin-bottom:4px;'));
      var ul = el('ul', '', undefined, 'margin:0;padding-left:18px;color:var(--text);');
      res[g[0]].forEach(function (m) { ul.appendChild(el('li', '', m)); });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
    var lab = el('label', '', 'Workstream', 'display:block;font-size:13px;font-weight:600;color:var(--text);margin:4px 0 4px;');
    var input = el('input', '', undefined, 'width:100%;box-sizing:border-box;font-size:13px;padding:6px 8px;margin-bottom:16px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);');
    input.type = 'text';
    input.id = 'calm-export-workstream';
    input.value = WORKSTREAMS[edition] || '';
    lab.htmlFor = input.id;
    box.appendChild(lab);
    box.appendChild(input);

    var actions = el('div', 'ic-restore-modal-actions');
    var cancel = el('button', 'ic-restore-cancel', 'Cancel');
    cancel.type = 'button';
    cancel.id = 'calm-export-cancel';
    cancel.onclick = closeDialog;
    var ok = el('button', 'ic-restore-confirm', 'Export');
    ok.type = 'button';
    ok.id = 'calm-export-confirm';
    if (res.blocking.length) { ok.disabled = true; ok.style.opacity = '0.5'; ok.style.cursor = 'not-allowed'; }
    ok.onclick = function () {
      if (ok.disabled) return;
      // Re-check at click time; if the state became blocking, show it instead.
      if (window.currentArea !== 'pm' || checks().blocking.length) { openDialog(); return; }
      // Snapshot rows, milestones, file name and Workstream at click time: the
      // UI stays interactive while ExcelJS loads, so later changes must not mix in.
      var rows = collectRows({ workstream: input.value.trim() });
      var milestones = collectMilestones();
      var name = fileName(window.pmSelectedType);
      closeDialog();
      writeXlsx(rows, milestones, name);
    };
    actions.appendChild(cancel);
    actions.appendChild(ok);
    box.appendChild(actions);
    ov.appendChild(box);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeDialog(); });
    document.body.appendChild(ov);
    input.focus();
  }

  // The PM bar markup is static, so the button is inserted once and stays
  // through edition switches; the existing CSS shows the bar only in PM mode.
  function injectButton() {
    var host = document.querySelector('#pm-mode-bar .pm-mode-bar-inner');
    if (!host || document.getElementById(BUTTON_ID)) return;
    var btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'pm-parked-btn';
    btn.textContent = 'Export to Cloud ALM';
    btn.addEventListener('click', openDialog);
    host.insertBefore(btn, document.getElementById('pm-parked-btn'));
  }

  window.CalmExport = {
    COLUMNS: COLUMNS, MS_COLUMNS: MS_COLUMNS, collectRows: collectRows,
    collectMilestones: collectMilestones, checks: checks, openDialog: openDialog,
    // v1 entry point, kept as an alias: it opens the dialog so the checks apply.
    exportXlsx: openDialog
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton);
  else injectButton();
})();
