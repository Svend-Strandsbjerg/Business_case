import ExcelJS from 'exceljs';
import { test, expect, EMPTY_BUCKET } from './fixtures.mjs';

// Cloud ALM export v1 (docs/calm-export-design.md 6.5). Assertions stay on
// small values: specific cells, counts and short summaries.

const BTN = '#pm-mode-bar #calm-export-btn';

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

// Clicks the button, reads the download back and returns a small summary.
async function exportFile(page) {
  const dl = page.waitForEvent('download');
  await page.locator(BTN).click();
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
  return {
    fileName: d.suggestedFilename(),
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

test('no start date: alert and no download', async ({ page, pageWatch }) => {
  await openPm(page);
  await page.evaluate(() => { icDates.start = null; icDates.end = null; icSetup(); });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  const dialogs = [];
  page.on('dialog', async (dlg) => { dialogs.push([dlg.type(), dlg.message()]); await dlg.accept(); });
  await page.locator(BTN).click();
  await page.waitForTimeout(1000);
  expect(dialogs).toEqual([['alert', 'Set a project start date first']]);
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
  expect(f.sheets).toEqual(['Items']);
  expect(f.header).toEqual(columns);
  expect(f.dataRows).toBe(count);

  // Row 1: sub-phase as Project Task, span = own days + activities' days.
  expect([f.cell(1, 'Row'), f.cell(1, 'Type'), f.cell(1, 'Title'), f.cell(1, 'Parent Row')])
    .toEqual([1, 'Project Task', names.sp0, '']);
  expect([f.cell(1, 'Timebox'), f.cell(1, 'Start Date'), f.cell(1, 'Due Date')])
    .toEqual([names.ph0, '2027-02-01', '2027-04-30']);
  // Row 2: first activity as Sub-task under row 1.
  expect([f.cell(2, 'Type'), f.cell(2, 'Title'), f.cell(2, 'Parent Row'), f.cell(2, 'Timebox')])
    .toEqual(['Sub-task', names.act0, 1, names.ph0]);
  expect([f.cell(2, 'Start Date'), f.cell(2, 'Due Date'), f.cell(2, 'Tags')])
    .toEqual(['2027-02-01', '2027-02-28', 'app-export,public']);
  expect([f.cell(2, 'Status'), f.cell(2, 'Source'), f.cell(2, 'Workstream')])
    .toEqual(['Open', 'Manually created', 'SAP S/4HANA Cloud Public Edition']);
  expect(['Description', 'Predecessors', 'Assigned Role', 'Assigned Person', 'References'].map((c) => f.cell(2, c)))
    .toEqual(['', '', '', '', '']);
  // Row 3: non-continuous painting -> first to last day, tag split.
  expect([f.cell(3, 'Start Date'), f.cell(3, 'Due Date'), f.cell(3, 'Tags')])
    .toEqual(['2027-02-01', '2027-04-30', 'app-export,public,split']);
  // An activity in the second phase points to its own sub-phase.
  expect([f.cell(act100Row, 'Parent Row'), f.cell(act100Row, 'Timebox'), f.cell(act100Row, 'Start Date'), f.cell(act100Row, 'Due Date')])
    .toEqual([sp10Row, names.ph1, '2027-05-01', '2027-05-31']);
  expect(f.cell(sp10Row, 'Type')).toBe('Project Task');
  // Nothing painted -> empty dates.
  expect([f.cell(4, 'Start Date'), f.cell(4, 'Due Date')]).toEqual(['', '']);
  expectNoErrors(pageWatch);
});

test('weeks view gives the same dates as months view', async ({ page, pageWatch }) => {
  await openPm(page);
  await setStart(page);
  await paint(page, 0, 0, 0, [1]);
  await paint(page, 0, 0, 1, [1, 3]);
  await paint(page, 0, 0, null, [2]);
  const summary = () => page.evaluate(() => window.CalmExport.collectRows().slice(0, 3)
    .map((r) => [r['Start Date'], r['Due Date'], r['Tags']]));
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
  const count = await expectedCount(page);
  const f = await exportFile(page);
  expect(f.fileName).toMatch(/^calm-tasks-private-new-\d{8}\.xlsx$/);
  expect(f.dataRows).toBe(count);
  expect([f.cell(1, 'Title'), f.cell(1, 'Workstream'), f.cell(1, 'Tags')])
    .toEqual([names.sp0, 'SAP Cloud ERP Private – New Implementation', 'app-export,private-new']);

  await page.evaluate(() => pmSelectType('public'));
  await setStart(page);
  await expect(page.locator('#calm-export-btn')).toHaveCount(1);
  const g = await exportFile(page);
  expect(g.fileName).toMatch(/^calm-tasks-public-\d{8}\.xlsx$/);
  expect(g.cell(1, 'Workstream')).toBe('SAP S/4HANA Cloud Public Edition');
  expectNoErrors(pageWatch);
});
