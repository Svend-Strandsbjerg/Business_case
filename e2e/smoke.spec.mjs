import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

test('app loads without console or page errors', async ({ page, pageWatch }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('load');
  await expect(page.locator('#tab-ic')).toBeAttached();
  await page.waitForTimeout(500);
  expect(pageWatch.pageErrors, 'page errors').toEqual([]);
  expect(pageWatch.consoleErrors, 'console errors').toEqual([]);
});

test('Investment Case Excel export downloads an .xlsx', async ({ page, pageWatch }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('load');
  await page.evaluate(() => window.selectArea('ic'));
  await page.locator('#ic-section .ic-export-btn').click();
  await expect(page.locator('#ic-export-overlay')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#ic-export-generate-btn').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const head = readFileSync(await download.path()).subarray(0, 2).toString('latin1');
  expect(head, 'xlsx (zip) signature').toBe('PK');
  expect(pageWatch.pageErrors, 'page errors').toEqual([]);
  expect(pageWatch.consoleErrors, 'console errors').toEqual([]);
});
