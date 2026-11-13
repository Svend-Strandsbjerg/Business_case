import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, EMPTY_BUCKET } from './fixtures.mjs';

// Golden file: an export made on main before bcBuildSessionData/pm/icPtStates
// existed (HR hires 120, industry food, SD entities 5, project type sd, IC
// resource "Golden PM" with hours, Discover painted in columns 0-2).
const GOLDEN = fileURLToPath(new URL('./fixtures/golden-main-export.json', import.meta.url));
// Values read on main right after importing the golden file into a fresh page.
const GOLDEN_ON_MAIN = {
  hrHires: 120, hrTotal: 'DKK 1,5 mio.', scIndustry: 'food', scPos: 20000, scTotal: 'DKK 16,1 mio.',
  icType: 'sd', icRes0: 'Golden PM', icRes0Hours: '{"0":80,"1":40}', icPainted: '0,1,2',
  icTotal: 'DKK –', sdEntities: 5,
};

// Up to `max` paths where a and b differ, so a failing equality prints a small list.
function diffPaths(a, b, path = '', out = [], max = 10) {
  if (out.length >= max) return out;
  if (a === b) return out;
  const isObj = (v) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path || '<root>'}: ${String(JSON.stringify(a)).slice(0, 60)} != ${String(JSON.stringify(b)).slice(0, 60)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffPaths(a[k], b[k], `${path}.${k}`, out, max);
  return out;
}
const withoutKeys = (obj, keys) => { const c = { ...obj }; keys.forEach((k) => delete c[k]); return c; };

async function openApp(page, area) {
  await page.goto('/index.html');
  await page.waitForLoadState('load');
  if (area) await goTo(page, area);
}
async function goTo(page, area) {
  await page.evaluate((a) => window.selectArea(a), area);
  await page.waitForTimeout(300);
}

// Export through the header Export button; returns the parsed file and its name.
async function exportViaButton(page) {
  const dl = page.waitForEvent('download');
  await page.locator('.header-io-btn.export[onclick="exportSettings()"]').click();
  const download = await dl;
  const path = await download.path();
  return { name: download.suggestedFilename(), data: JSON.parse(readFileSync(path, 'utf8')) };
}
// Import through the header file input (same path as a user picking a file).
async function importViaInput(page, data, testInfo) {
  const file = testInfo.outputPath(`import-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(data));
  await page.locator('#import-file-input').setInputFiles(file);
  await expect.poll(() => page.evaluate(() => document.getElementById('io-import-status')?.textContent || ''))
    .toContain('restored');
}

// The AC1 state: two project types with different IC states, a Public plan in
// Module 5 with a start date, painted activities and a parked item, and a
// second edition with a change. Ends in the given area.
async function buildState(page, endArea) {
  await openApp(page, 'ic');
  await page.evaluate(() => {
    var sl = document.getElementById('sl-hires'); sl.value = 140; sl.dispatchEvent(new Event('input'));
    selectIndustry('food');
    sdP.entities = 6;
    icApplyProjectType('hr', false); icSetTypeLabel('hr');
    icITResources[0].name = 'HR Lead'; icITResources[0].hours = { 0: 60, 1: 30 };
    icPhases[0].painted = { 0: true, 1: true };
    icApplyProjectType('sd', false); icSetTypeLabel('sd');
    icITResources[0].name = 'SD Lead'; icITResources[0].hours = { 2: 50 };
    icPhases[1].painted = { 3: true };
    icSetup();
  });
  await goTo(page, 'pm');
  await page.evaluate(() => {
    icDates.start = new Date(2027, 0, 4);
    icPhases[0].painted = { 0: true };
    icPhases[0].subPhases[0].painted = { 0: true, 1: true };
    var ph = icPhases[1]; pmParkSubPhase(ph.id, ph.subPhases[0].id);
    icSetup();
    pmSelectType('private-new');
    icPhases[0].name = 'Discover (private)';
    icPhases[0].painted = { 5: true };
    icSetup();
  });
  await goTo(page, endArea);
}

const icSummary = (s) => ({ type: s.icProjectType, res0: s.ic.itRes[0].name, painted: s.ic.phases[1].painted });

async function roundTrip(page, area, testInfo) {
  const first = await exportViaButton(page);
  await openApp(page, area);
  await importViaInput(page, first.data, testInfo);
  const second = await exportViaButton(page);
  return { first, second };
}

test('AC1: round trip from the Investment Case is lossless', async ({ page, pageWatch }, testInfo) => {
  await buildState(page, 'ic');
  const { first, second } = await roundTrip(page, 'ic', testInfo);
  expect(first.name).toMatch(/^business-case-\d{4}-\d{2}-\d{2}\.json$/);
  const s = first.data;
  expect(icSummary(s)).toEqual({ type: 'sd', res0: 'SD Lead', painted: { 3: true } });
  expect(s.icPtStates.hr.itRes[0].name).toBe('HR Lead');
  expect(s.pm.selectedType).toBe('private-new');
  expect(new Date(s.pm.typeStates.public.dateStart).toISOString().slice(0, 10)).toBe(new Date(2027, 0, 4).toISOString().slice(0, 10));
  expect(s.pm.typeStates.public.phases[0].subPhases[0].painted).toEqual({ 0: true, 1: true });
  expect(s.pm.typeStates['private-new'].phases[0].name).toBe('Discover (private)');
  expect(s.pm.parked.public.length).toBe(1);
  expect(diffPaths(withoutKeys(first.data, ['exportedAt']), withoutKeys(second.data, ['exportedAt']))).toEqual([]);

  // Entering Module 5 after the import shows the restored edition plan.
  await goTo(page, 'pm');
  const pm = await page.evaluate(() => ({ type: pmSelectedType, ph0: icPhases[0].name, parkedPublic: pmParked.public.length, ic: _pmSavedIcState.itRes[0].name }));
  expect(pm).toEqual({ type: 'private-new', ph0: 'Discover (private)', parkedPublic: 1, ic: 'SD Lead' });
  expect(pageWatch.pageErrors, 'page errors').toEqual(EMPTY_BUCKET);
  expect(pageWatch.consoleErrors, 'console errors').toEqual(EMPTY_BUCKET);
});

test('AC2: export from inside Module 5 keeps IC as IC and PM as PM', async ({ page, pageWatch }, testInfo) => {
  await buildState(page, 'ic');
  const fromIc = await exportViaButton(page);
  await goTo(page, 'pm');
  const { first, second } = await roundTrip(page, 'pm', testInfo);
  expect(icSummary(first.data)).toEqual({ type: 'sd', res0: 'SD Lead', painted: { 3: true } });
  // Same project as the IC export; only the current area differs.
  expect(first.data.area).toBe('pm');
  expect(diffPaths(withoutKeys(fromIc.data, ['exportedAt', 'area']), withoutKeys(first.data, ['exportedAt', 'area']))).toEqual([]);
  expect(diffPaths(withoutKeys(first.data, ['exportedAt']), withoutKeys(second.data, ['exportedAt']))).toEqual([]);

  // After importing inside Module 5 the screen still shows the PM plan and
  // leaving Module 5 shows the IC state.
  const live = await page.evaluate(() => ({ ph0: icPhases[0].name, ic: _pmSavedIcState.itRes[0].name }));
  expect(live).toEqual({ ph0: 'Discover (private)', ic: 'SD Lead' });
  await goTo(page, 'ic');
  expect(await page.evaluate(() => [icITResources[0].name, icPhases[0].name])).toEqual(['SD Lead', 'Discover']);
  expect(pageWatch.pageErrors, 'page errors').toEqual(EMPTY_BUCKET);
  expect(pageWatch.consoleErrors, 'console errors').toEqual(EMPTY_BUCKET);
});

test('exporting does not change state', async ({ page }) => {
  await buildState(page, 'pm');
  const snap = () => page.evaluate(() => JSON.stringify([pmTypeStates, pmParked, _pmSavedIcState, icPtStates, icPhases, icITResources, currentArea, pmSelectedType]));
  const before = await snap();
  await page.evaluate(() => { bcBuildSessionData(); });
  await exportViaButton(page);
  expect((await snap()) === before, 'state unchanged by export').toBe(true);
});

for (const area of ['hr', 'sc', 'sd']) {
  test(`AC3: round trip from module ${area}`, async ({ page, pageWatch }, testInfo) => {
    await buildState(page, area);
    const { first, second } = await roundTrip(page, area, testInfo);
    expect(first.data.area).toBe(area);
    expect(icSummary(first.data)).toEqual({ type: 'sd', res0: 'SD Lead', painted: { 3: true } });
    expect([first.data.hrParams.hires, first.data.industry, first.data.sd.params.entities]).toEqual([140, 'food', 6]);
    expect(diffPaths(withoutKeys(first.data, ['exportedAt']), withoutKeys(second.data, ['exportedAt']))).toEqual([]);
    expect(pageWatch.pageErrors, 'page errors').toEqual(EMPTY_BUCKET);
    expect(pageWatch.consoleErrors, 'console errors').toEqual(EMPTY_BUCKET);
  });
}

test('AC4: an old export (golden file from main) imports as before', async ({ page, pageWatch }, testInfo) => {
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  expect('pm' in golden || 'icPtStates' in golden).toBe(false);
  await openApp(page);
  await importViaInput(page, golden, testInfo);
  const v = await page.evaluate(() => {
    var t = function (id) { var e = document.getElementById(id); return e ? e.textContent : null; };
    return { hrHires: p.hires, hrTotal: t('totalBenefits'), scIndustry: currentIndustry, scPos: scP.posPerYear,
      scTotal: t('sc-totalBenefits'), icType: icProjectType, icRes0: icITResources[0].name,
      icRes0Hours: JSON.stringify(icITResources[0].hours), icPainted: Object.keys(icPhases[0].painted).join(','),
      icTotal: t('ic-total-investment'), sdEntities: sdP.entities };
  });
  expect(v).toEqual(GOLDEN_ON_MAIN);
  // Keys absent from old files leave Module 5 and the per-type IC states untouched.
  const untouched = await page.evaluate(() => [Object.values(pmTypeStates).every((x) => x === null), pmSelectedType, icPtStates.hr]);
  expect(untouched).toEqual([true, 'public', null]);
  expect(pageWatch.pageErrors, 'page errors').toEqual(EMPTY_BUCKET);
  expect(pageWatch.consoleErrors, 'console errors').toEqual(EMPTY_BUCKET);
});

test('AC6: ProjectDocument get/apply round trip and version check', async ({ page, pageWatch }) => {
  await buildState(page, 'ic');
  const doc = await page.evaluate(() => window.ProjectDocument.get());
  expect([doc.schema, doc.schemaVersion, typeof doc.savedAt]).toEqual(['bc-project', 1, 'string']);
  expect(await page.evaluate(() => [ProjectDocument.SCHEMA, ProjectDocument.SCHEMA_VERSION])).toEqual(['bc-project', 1]);
  expect(icSummary(doc.session)).toEqual({ type: 'sd', res0: 'SD Lead', painted: { 3: true } });

  await openApp(page, 'ic');
  await page.evaluate((d) => window.ProjectDocument.apply(d), doc);
  const again = await page.evaluate(() => window.ProjectDocument.get());
  expect(diffPaths(withoutKeys(doc.session, ['exportedAt']), withoutKeys(again.session, ['exportedAt']))).toEqual([]);

  // Unknown version / wrong schema: clear error, nothing changes.
  const state = () => page.evaluate(() => { var s = bcBuildSessionData(); delete s.exportedAt; return JSON.stringify(s); });
  const before = await state();
  const errors = await page.evaluate((d) => {
    var msgs = [];
    var bad = JSON.parse(JSON.stringify(d)); bad.schemaVersion = 99;
    bad.session.icProjectType = 'hr'; bad.session.hrParams.hires = 1;
    try { ProjectDocument.apply(bad); msgs.push('no error'); } catch (e) { msgs.push(e.message); }
    try { ProjectDocument.apply({ schema: 'other', schemaVersion: 1, session: d.session }); msgs.push('no error'); } catch (e) { msgs.push(e.message); }
    return msgs;
  }, doc);
  expect(errors[0]).toContain('Unsupported project document version: 99');
  expect(errors[1]).toContain('Not a project document');
  expect((await state()) === before, 'state unchanged by rejected apply').toBe(true);
  expect(await page.evaluate(() => ProjectDocument.migrate({ schemaVersion: 1, x: 1 }).x)).toBe(1);
  expect(pageWatch.pageErrors, 'page errors').toEqual(EMPTY_BUCKET);
  expect(pageWatch.consoleErrors, 'console errors').toEqual(EMPTY_BUCKET);
});
