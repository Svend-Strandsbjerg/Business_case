import ExcelJS from 'exceljs';
import { test, expect, EMPTY_BUCKET } from './fixtures.mjs';

// Cloud ALM export v1 (docs/calm-export-design.md 6.5). Assertions stay on
// small values: specific cells, counts and short summaries.

const BTN = '#pm-mode-bar #calm-export-btn';
const DIALOG = '#calm-export-dialog';
const OK = '#calm-export-confirm';
const CANCEL = '#calm-export-cancel';
const WS = '#calm-export-workstream';

async function openPm(page) {
  await page.goto('/index.html');
  await page.waitForLoadState('load');
  await page.evaluate(() => window.selectArea('pm'));
}

// Start date 13 Jan 2027 (months view): column 1 = Feb, 2 = Mar, 3 = Apr, 4 = May.
async function setStart(page) {
  await page.evaluate(() => { icDates.start = new Date(2027, 0, 13); icAutoComputeEndDate(); icSetup(); });
}

async function paint(page, phI, spI, actI, cols) {
  await page.evaluate(([phI, spI, actI, cols]) => {
    const ph = icPhases[phI], sp = ph.subPhases[spI];
    const actId = actI === null ? null : sp.subSubPhases[actI].id;
    cols.forEach((c) => (actId ? icToggleCell(ph.id, sp.id, actId, c) : icToggleCell(ph.id, sp.id, c)));
  }, [phI, spI, actI, cols]);
}

// 1-based row number (excluding the header) of a node in the export order.
async function rowOf(page, phI, spI, actI) {
  return page.evaluate(([phI, spI, actI]) => {
    let n = 0;
    for (let p = 0; p < icPhases.length; p++) {
      const sps = icPhases[p].subPhases || [];
      for (let s = 0; s < sps.length; s++) {
        n += 1;
        if (p === phI && s === spI && actI === null) return n;
        const acts = sps[s].subSubPhases || [];
        for (let a = 0; a < acts.length; a++) {
          n += 1;
          if (p === phI && s === spI && a === actI) return n;
        }
      }
    }
    return -1;
  }, [phI, spI, actI]);
}

async function expectedCount(page) {
  return page.evaluate(() => icPhases.reduce((n, ph) => n + (ph.subPhases || []).reduce(
    (m, sp) => m + 1 + (sp.subSubPhases || []).length, 0), 0));
}

// Opens the dialog, optionally sets the Workstream, clicks Export, reads the
// download back and returns a small summary.
async function exportFile(page, workstream) {
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible();
  if (workstream !== undefined) await page.locator(WS).fill(workstream);
  const dl = page.waitForEvent('download');
  await page.locator(OK).click();
  const d = await dl;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await d.path());
  const ws = wb.getWorksheet('Items');
  const header = ws.getRow(1).values.slice(1);
  const cell = (row, col) => {
    const v = ws.getRow(row + 1).getCell(header.indexOf(col) + 1).value;
    return v === null || v === undefined ? '' : v;
  };
  const titles = [];
  for (let r = 2; r <= ws.rowCount; r++) titles.push(ws.getRow(r).getCell(header.indexOf('Title') + 1).value);
  const wm = wb.getWorksheet('App milestones');
  const msRows = [];
  for (let r = 1; r <= wm.rowCount; r++) msRows.push(wm.getRow(r).values.slice(1).map((v) => (v === null || v === undefined ? '' : v)));
  const column = (col) => titles.map((_, i) => cell(i + 1, col));
  const wp = wb.getWorksheet('App phases');
  const phRows = [];
  for (let r = 1; r <= wp.rowCount; r++) phRows.push(wp.getRow(r).values.slice(1).map((v) => (v === null || v === undefined ? '' : v)));
  return {
    ws,
    phRows,
    fileName: d.suggestedFilename(),
    msRows,
    column,
    sheets: wb.worksheets.map((w) => w.name),
    header,
    dataRows: ws.rowCount - 1,
    cell,
    titleCount: (t) => titles.filter((x) => x === t).length,
  };
}

function expectNoErrors(pageWatch) {
  expect(pageWatch.pageErrors, 'page errors').toEqual(EMPTY_BUCKET);
  expect(pageWatch.consoleErrors, 'console errors').toEqual(EMPTY_BUCKET);
}

test('button exists once in the PM bar and is visible only in PM mode', async ({ page, pageWatch }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('load');
  await expect(page.locator('#calm-export-btn')).toHaveCount(1);
  const order = await page.evaluate(() => {
    const b = document.getElementById('calm-export-btn');
    return { parent: b.parentElement.className, next: b.nextElementSibling && b.nextElementSibling.id, text: b.textContent };
  });
  expect(order).toEqual({ parent: 'pm-mode-bar-inner', next: 'pm-parked-btn', text: 'Export to Cloud ALM' });
  await page.evaluate(() => window.selectArea('ic'));
  await expect(page.locator(BTN)).toBeHidden();
  await page.evaluate(() => window.selectArea('pm'));
  await expect(page.locator(BTN)).toBeVisible();
  await page.evaluate(() => { pmSelectType('private-new'); pmSelectType('public'); });
  await expect(page.locator('#calm-export-btn')).toHaveCount(1);
  await expect(page.locator(BTN)).toBeVisible();
  await page.evaluate(() => window.selectArea('ic'));
  await expect(page.locator(BTN)).toBeHidden();
  expectNoErrors(pageWatch);
});

test('no start date: blocking reason in the dialog and no download', async ({ page, pageWatch }) => {
  await openPm(page);
  await page.evaluate(() => { icDates.start = null; icDates.end = null; icSetup(); });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  const dialogs = [];
  page.on('dialog', async (dlg) => { dialogs.push(dlg.type()); await dlg.accept(); });
  await page.locator(BTN).click();
  await expect(page.locator(DIALOG)).toHaveCount(1);
  await expect(page.locator(`${DIALOG} [data-group="blocking"]`)).toContainText('No project start date');
  await expect(page.locator(OK)).toBeDisabled();
  await page.locator(OK).click({ force: true });
  await page.waitForTimeout(1000);
  expect(dialogs).toEqual([]);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => typeof window.ExcelJS)).toBe('undefined');
  expectNoErrors(pageWatch);
});

test('happy path (months view): sheet, header, row count, parent and dates', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]); // first activity: Feb 2027
  await paint(page, 0, 0, null, [2]); // its sub-phase itself: Mar 2027
  await paint(page, 0, 0, 1, [1, 3]); // second activity: Feb + Apr (non-continuous)
  await paint(page, 1, 0, 0, [4]); // first activity of phase 2: May 2027
  const columns = await page.evaluate(() => window.CalmExport.COLUMNS);
  const names = await page.evaluate(() => ({
    ph0: icPhases[0].name, ph1: icPhases[1].name,
    sp0: icPhases[0].subPhases[0].name, act0: icPhases[0].subPhases[0].subSubPhases[0].name,
  }));
  const count = await expectedCount(page);
  const sp10Row = await rowOf(page, 1, 0, null);
  const act100Row = await rowOf(page, 1, 0, 0);

  const f = await exportFile(page);
  expect(f.fileName).toMatch(/^calm-tasks-public-\d{8}\.xlsx$/);
  expect(f.sheets).toEqual(['Items', 'App phases', 'App milestones']);
  expect(f.header).toEqual(columns);
  expect(f.dataRows).toBe(count);

  // Data row 1 (Excel row 2): sub-phase as Project Task, span = own days + activities' days.
  expect([f.cell(1, 'Type'), f.cell(1, 'Title'), f.cell(1, 'Parent Row')])
    .toEqual(['Project Task', names.sp0, '']);
  expect([f.cell(1, 'Timebox'), f.cell(1, 'Start'), f.cell(1, 'Planned Completion')])
    .toEqual([names.ph0, '2027-02-01', '2027-04-30']);
  // Data row 2: first activity as Sub-task; Parent Row = Excel row 2.
  expect([f.cell(2, 'Type'), f.cell(2, 'Title'), f.cell(2, 'Parent Row'), f.cell(2, 'Timebox')])
    .toEqual(['Sub-task', names.act0, 2, names.ph0]);
  expect([f.cell(2, 'Start'), f.cell(2, 'Planned Completion'), f.cell(2, 'Tags')])
    .toEqual(['2027-02-01', '2027-02-28', 'app-export,public']);
  expect([f.cell(2, 'Status'), f.cell(2, 'Source'), f.cell(2, 'Workstreams')])
    .toEqual(['Open', 'Manually Created', 'SAP S/4HANA Cloud Public Edition']);
  expect(['ID', 'Description', 'Predecessor Row', 'Assigned Role', 'Responsible', 'Team', 'Deliverable', 'References'].map((c) => f.cell(2, c)))
    .toEqual(['', '', '', '', '', '', '', '']);
  // Data row 3: non-continuous painting -> first to last day, tag split.
  expect([f.cell(3, 'Start'), f.cell(3, 'Planned Completion'), f.cell(3, 'Tags')])
    .toEqual(['2027-02-01', '2027-04-30', 'app-export,public,split']);
  // An activity in the second phase points to its own sub-phase's Excel row.
  expect([f.cell(act100Row, 'Parent Row'), f.cell(act100Row, 'Timebox'), f.cell(act100Row, 'Start'), f.cell(act100Row, 'Planned Completion')])
    .toEqual([sp10Row + 1, names.ph1, '2027-05-01', '2027-05-31']);
  expect(f.cell(sp10Row, 'Type')).toBe('Project Task');
  // Nothing painted -> empty dates.
  expect([f.cell(4, 'Start'), f.cell(4, 'Planned Completion')]).toEqual(['', '']);
  expectNoErrors(pageWatch);
});

test('weeks view gives the same dates as months view', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  await paint(page, 0, 0, 1, [1, 3]);
  await paint(page, 0, 0, null, [2]);
  const summary = () => page.evaluate(() => window.CalmExport.collectRows().slice(0, 3)
    .map((r) => [r['Start'], r['Planned Completion'], r['Tags']]));
  const months = await summary();
  expect(months[0]).toEqual(['2027-02-01', '2027-04-30', 'app-export,public']);
  await page.evaluate(() => icSetPeriod('weeks'));
  expect(await page.evaluate(() => icPeriod)).toBe('weeks');
  expect(await summary()).toEqual(months);
  expectNoErrors(pageWatch);
});

test('a parked activity is not exported', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  const parked = await page.evaluate(() => {
    const ph = icPhases[0], sp = ph.subPhases[0], a = sp.subSubPhases[0];
    const before = icPhases.reduce((n, p) => n + p.subPhases.reduce((m, s) => m + s.subSubPhases.filter((x) => x.name === a.name).length, 0), 0);
    pmParkActivity(ph.id, sp.id, a.id);
    return { name: a.name, before, parkedCount: pmParked[pmSelectedType].length };
  });
  expect(parked.parkedCount).toBe(1);
  await paint(page, 1, 0, 0, [1]); // the export needs painting (blocking check)
  const count = await expectedCount(page);
  const f = await exportFile(page);
  expect(f.dataRows).toBe(count);
  expect(f.titleCount(parked.name)).toBe(parked.before - 1);
  expectNoErrors(pageWatch);
});

test('after an edition switch the export uses the new edition, and switching back still works', async ({ page, pageWatch }) => {
  await openPm(page);
  await page.evaluate(() => pmSelectType('private-new'));
  await setStart(page);
  const names = await page.evaluate(() => ({ sp0: icPhases[0].subPhases[0].name, edition: pmSelectedType }));
  expect(names.edition).toBe('private-new');
  await paint(page, 0, 0, 0, [1]);
  const count = await expectedCount(page);
  const f = await exportFile(page);
  expect(f.fileName).toMatch(/^calm-tasks-private-new-\d{8}\.xlsx$/);
  expect(f.dataRows).toBe(count);
  expect([f.cell(1, 'Title'), f.cell(1, 'Workstreams'), f.cell(1, 'Tags')])
    .toEqual([names.sp0, 'SAP Cloud ERP Private – New Implementation', 'app-export,private-new']);

  await page.evaluate(() => pmSelectType('public'));
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  await expect(page.locator('#calm-export-btn')).toHaveCount(1);
  const g = await exportFile(page);
  expect(g.fileName).toMatch(/^calm-tasks-public-\d{8}\.xlsx$/);
  expect(g.cell(1, 'Workstreams')).toBe('SAP S/4HANA Cloud Public Edition');
  expectNoErrors(pageWatch);
});

test('a slow ExcelJS load still exports the click-time edition after a switch and leaving PM', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  const before = await page.evaluate(() => ({ sp0: icPhases[0].subPhases[0].name, edition: pmSelectedType }));
  const count = await expectedCount(page);
  // Hold the loader callback until the test releases it.
  await page.evaluate(() => {
    const orig = window.icEnsureExcelJs;
    window.icEnsureExcelJs = (cb) => { window.__releaseExcelJs = () => orig(cb); };
  });
  await page.locator(BTN).click();
  await page.locator(WS).fill('WS at click');
  const dl = page.waitForEvent('download');
  await page.locator(OK).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await page.evaluate(() => pmSelectType('private-new'));
  await setStart(page);
  await page.evaluate(() => { window.selectArea('ic'); window.__releaseExcelJs(); });
  const d = await dl;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await d.path());
  const ws = wb.getWorksheet('Items');
  const header = ws.getRow(1).values.slice(1);
  const cell = (col) => ws.getRow(2).getCell(header.indexOf(col) + 1).value;
  expect(before.edition).toBe('public');
  expect(d.suggestedFilename()).toMatch(/^calm-tasks-public-\d{8}\.xlsx$/);
  expect(ws.rowCount - 1).toBe(count);
  expect([cell('Title'), cell('Workstreams'), cell('Tags')])
    .toEqual([before.sp0, 'WS at click', 'app-export,public']);
  expectNoErrors(pageWatch);
});

// ---- v2: pre-export checks, editable Workstream, App milestones sheet ----

const groupText = (page, g) => page.locator(`${DIALOG} [data-group="${g}"]`);

test('nothing painted: blocking reason in the dialog and no download', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.locator(BTN).click();
  await expect(groupText(page, 'blocking')).toContainText('Nothing painted');
  await expect(groupText(page, 'blocking')).not.toContainText('No project start date');
  await expect(page.locator(OK)).toBeDisabled();
  await page.locator(OK).click({ force: true });
  await page.waitForTimeout(1000);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => typeof window.ExcelJS)).toBe('undefined');
  expectNoErrors(pageWatch);
});

test('checks(): structure, info messages and capped lists', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  const r = await page.evaluate(() => {
    const c = window.CalmExport.checks();
    const empty = c.warnings.find((w) => w.includes('no painted cells')) || '';
    return {
      keys: Object.keys(c),
      blocking: c.blocking.length,
      emptyHasMore: /\+\d+ more$/.test(empty),
      moreIsRest: Number((empty.match(/\+(\d+) more$/) || [])[1]) === parseInt(empty, 10) - 10,
      dup: c.info.includes('Upload into a Cloud ALM project WITHOUT an SAP Activate roadmap template, or every task will exist twice.'),
      timebox: c.info.some((i) => i.startsWith('Phases to create as Timebox') && i.includes(icPhases[0].name)),
      ms: c.info.some((i) => i.includes('milestones must be created')),
    };
  });
  expect(r).toEqual({ keys: ['blocking', 'warnings', 'info'], blocking: 0, emptyHasMore: true, moreIsRest: true, dup: true, timebox: true, ms: false });
  expectNoErrors(pageWatch);
});

test('painting after the end date warns "outside range"; inside the range does not', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]); // Feb 2027
  await page.locator(BTN).click();
  await expect(groupText(page, 'warnings')).not.toContainText('outside the project range');
  await page.locator(CANCEL).click();
  await paint(page, 0, 0, 1, [3]); // Apr 2027
  const name = await page.evaluate(() => { icDates.end = new Date(2027, 2, 31); return icPhases[0].subPhases[0].subSubPhases[1].name; });
  await page.locator(BTN).click();
  await expect(groupText(page, 'warnings')).toContainText(`1 items have painting outside the project range: ${name}`);
  await expect(page.locator(OK)).toBeEnabled();
  expectNoErrors(pageWatch);
});

test('non-continuous activity is listed in the warning and tagged split', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 1, [1, 3]);
  const name = await page.evaluate(() => icPhases[0].subPhases[0].subSubPhases[1].name);
  await page.locator(BTN).click();
  await expect(groupText(page, 'warnings')).toContainText('non-continuous painting');
  await expect(groupText(page, 'warnings')).toContainText(name);
  await page.locator(CANCEL).click();
  const f = await exportFile(page);
  expect(f.cell(3, 'Title')).toBe(name);
  expect(f.cell(3, 'Tags')).toBe('app-export,public,split');
  expectNoErrors(pageWatch);
});

test('Workstream: default, changed value on every row, empty value leaves the column empty', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  await page.locator(BTN).click();
  await expect(page.locator(WS)).toHaveValue('SAP S/4HANA Cloud Public Edition');
  await page.locator(CANCEL).click();
  const f = await exportFile(page, 'Finance stream');
  const ws = f.column('Workstreams');
  expect([ws.length > 1, ws.filter((v) => v !== 'Finance stream').length]).toEqual([true, 0]);
  const g = await exportFile(page, '');
  expect(g.column('Workstreams').filter((v) => v !== '').length).toBe(0);
  expectNoErrors(pageWatch);
});

test('Cancel closes the dialog and produces no download', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.locator(BTN).click();
  await expect(page.locator(OK)).toBeEnabled();
  await page.locator(CANCEL).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => typeof window.ExcelJS)).toBe('undefined');
  expectNoErrors(pageWatch);
});

test('App milestones sheet: header only without milestones; gate milestone row with Monday date and phase', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  const f = await exportFile(page);
  expect(f.sheets).toEqual(['Items', 'App phases', 'App milestones']);
  expect(f.msRows).toEqual([['Name', 'Date', 'Quality gate', 'Phase', 'Sub-phase']]);

  // Monday 1 Mar 2027, linked to the second phase; plus an earlier unlinked one.
  const ph = await page.evaluate(() => {
    const md = Math.floor(Date.UTC(2027, 2, 1) / 86400000);
    icMilestones.push({ id: icNextMsId++, name: 'Go-live gate', md, isGate: true, phaseId: icPhases[1].id, subPhaseId: null });
    icMilestones.push({ id: icNextMsId++, name: 'Kick-off', md: md - 28, isGate: false, phaseId: null, subPhaseId: null });
    icRenderTimeline();
    return icPhases[1].name;
  });
  await page.locator(BTN).click();
  await expect(groupText(page, 'info')).toContainText('2 milestones must be created in Cloud ALM project setup');
  await page.locator(CANCEL).click();
  const g = await exportFile(page);
  expect(g.msRows).toEqual([
    ['Name', 'Date', 'Quality gate', 'Phase', 'Sub-phase'],
    ['Kick-off', '2027-02-01', 'No', '', ''],
    ['Go-live gate', '2027-03-01', 'Yes', ph, ''],
  ]);
  expectNoErrors(pageWatch);
});

test('v1 exportXlsx still exists and opens exactly one export dialog', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  expect(await page.evaluate(() => typeof window.CalmExport.exportXlsx)).toBe('function');
  await page.evaluate(() => window.CalmExport.exportXlsx());
  await expect(page.locator(DIALOG)).toHaveCount(1);
  await expect(page.locator(OK)).toBeEnabled();
  await page.locator(CANCEL).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);
  expect(downloads).toBe(0);
  expectNoErrors(pageWatch);
});

// ---- v3: exact tenant template header, Excel-row Parent Row, App phases sheet ----

const TEMPLATE_HEADER = ['Title', 'ID', 'Scope', 'Solution Process', 'Type', 'Story Points', 'Effort (Hours)',
  'Source', 'Predecessor Row', 'Status', 'Requirement Status', 'Defect Status', 'Quality Gate Status',
  'Risk Status', 'Impact (Risk)', 'Probability (Risk)', 'Category (Risk)', 'Mitigation Strategy (Risk)',
  'Release', 'Timebox', 'Start', 'Planned Completion', 'Duration', 'Parent Row', 'Team', 'Assigned Role',
  'User Type', 'Owner (Risk)', 'Responsible', 'Reviewer', 'Involved Parties', 'Workstreams', 'Deliverable',
  'Classification', 'Sub-Classification', 'Test Classification', 'Description', 'External ID', 'References',
  'Tags', 'Comments', 'External Reference Name', 'External Reference ID', 'External Reference URL'];

test('v3 Items sheet matches the tenant template: header, parent rows, constants, plain-string dates', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  await paint(page, 0, 0, null, [2]);
  await paint(page, 1, 0, 0, [4]);
  const count = await expectedCount(page);
  const f = await exportFile(page);
  const ws = f.ws;
  // AC2: exact header, no extra columns.
  expect(f.header).toEqual(TEMPLATE_HEADER);
  expect(ws.getRow(1).cellCount).toBe(44);
  expect(ws.columnCount).toBe(44);
  const col = (name) => TEMPLATE_HEADER.indexOf(name) + 1;
  const raw = (r, name) => ws.getRow(r).getCell(col(name)).value;
  const val = (r, name) => { const v = raw(r, name); return v === null || v === undefined ? '' : v; };
  // AC3: row 2 is a Project Task without parent; row 3 a Sub-task under row 2.
  expect([val(2, 'Type'), val(2, 'Parent Row')]).toEqual(['Project Task', '']);
  expect([val(3, 'Type'), raw(3, 'Parent Row')]).toEqual(['Sub-task', 2]);
  expect(ws.rowCount - 1).toBe(count);
  const bad = { parent: [], source: [], status: [], date: [], id: [], ext: [] };
  const ext = new Set();
  for (let r = 2; r <= ws.rowCount; r++) {
    const type = val(r, 'Type');
    if (type === 'Sub-task') {
      const p = raw(r, 'Parent Row');
      if (typeof p !== 'number' || p < 2 || p >= r || val(p, 'Type') !== 'Project Task') bad.parent.push(r);
    } else if (type !== 'Project Task' || val(r, 'Parent Row') !== '') bad.parent.push(r);
    if (val(r, 'Source') !== 'Manually Created') bad.source.push(r);
    if (val(r, 'Status') !== 'Open') bad.status.push(r);
    for (const c of ['Start', 'Planned Completion']) {
      const v = val(r, c);
      if (v !== '' && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) bad.date.push(`${r}:${c}`);
    }
    if (val(r, 'ID') !== '') bad.id.push(r);
    const e = val(r, 'External ID');
    if (typeof e !== 'string' || !/^bc-public-/.test(e) || ext.has(e)) bad.ext.push(r);
    ext.add(e);
  }
  expect(bad).toEqual({ parent: [], source: [], status: [], date: [], id: [], ext: [] });
  // AC4: dates were written as text, not Date cells.
  expect([typeof raw(2, 'Start'), raw(2, 'Start'), raw(2, 'Planned Completion')]).toEqual(['string', '2027-02-01', '2027-03-31']);
  const ids = await page.evaluate(() => [icPhases[0].subPhases[0].id, icPhases[0].subPhases[0].subSubPhases[0].id]);
  expect([val(2, 'External ID'), val(3, 'External ID')]).toEqual([`bc-public-${ids[0]}`, `bc-public-${ids[1]}`]);
  expectNoErrors(pageWatch);
});

test('v3 App phases sheet: six phases in order with first and last painted day', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 1, 0, 0, [1]); // phase 2, activity: Feb 2027
  await paint(page, 1, 1, null, [3]); // phase 2, another sub-phase itself: Apr 2027
  await paint(page, 0, 0, 0, [2]); // phase 1: Mar 2027
  const phases = await page.evaluate(() => icPhases.map((p) => p.name));
  expect(phases.length).toBe(6);
  const f = await exportFile(page);
  expect(f.sheets).toEqual(['Items', 'App phases', 'App milestones']);
  expect(f.phRows[0]).toEqual(['Phase', 'Start', 'End']);
  expect(f.phRows.slice(1).map((r) => r[0])).toEqual(phases);
  expect(f.phRows[2]).toEqual([phases[1], '2027-02-01', '2027-04-30']);
  expect(f.phRows[1]).toEqual([phases[0], '2027-03-01', '2027-03-31']);
  expect(f.phRows[3]).toEqual([phases[2], '', '']);
  expect(f.msRows).toEqual([['Name', 'Date', 'Quality gate', 'Phase', 'Sub-phase']]);
  expectNoErrors(pageWatch);
});
