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

  function exportXlsx() {
    if (window.currentArea !== 'pm') return;
    if (!window.icDates || !window.icDates.start) {
      alert('Set a project start date first');
      return;
    }
    // Snapshot rows and file name at click time: the UI stays interactive
    // while ExcelJS loads, so an edition switch or leaving PM must not mix in.
    var rows = collectRows();
    var name = fileName(window.pmSelectedType);
    window.icEnsureExcelJs(function () {
      var wb = new window.ExcelJS.Workbook();
      var ws = wb.addWorksheet('Items');
      ws.addRow(COLUMNS);
      rows.forEach(function (r) { ws.addRow(COLUMNS.map(function (c) { return r[c]; })); });
      wb.xlsx.writeBuffer().then(function (buf) { download(buf, name); });
    });
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
    btn.addEventListener('click', exportXlsx);
    host.insertBefore(btn, document.getElementById('pm-parked-btn'));
  }

  window.CalmExport = { COLUMNS: COLUMNS, collectRows: collectRows, exportXlsx: exportXlsx };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButton);
  else injectButton();
})();
