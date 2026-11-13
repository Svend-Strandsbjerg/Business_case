import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

// The app loads ExcelJS from this CDN URL at runtime (icEnsureExcelJs and the
// Investment Case export). Tests serve it from the pinned npm package instead,
// so no test ever reaches the network.
export const EXCELJS_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js';
const excelJsBody = readFileSync(
  fileURLToPath(new URL('../node_modules/exceljs/dist/exceljs.min.js', import.meta.url)),
);

// Page errors that already occur on load on main: early inline <script> blocks
// call dkkToDisplay / read hrYearRange before the main script defines them.
// They are tolerated (exact match) so tests catch any NEW error without
// changing app code. Remove entries once the app is fixed.
export const KNOWN_BASELINE_PAGE_ERRORS = [
  'dkkToDisplay is not defined',
  'hrYearRange is not defined',
];

// Shared fixture: fulfils the ExcelJS CDN request locally, aborts every other
// external request, and records console errors, unexpected page errors and blocked
// requests as short strings so tests assert on small summaries.
export const test = base.extend({
  pageWatch: [async ({ page, baseURL }, use) => {
    const localOrigin = new URL(baseURL).origin;
    const watch = { consoleErrors: [], pageErrors: [], blockedRequests: [] };

    await page.context().route('**/*', (route) => {
      const url = route.request().url();
      if (url === EXCELJS_CDN_URL) {
        return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: excelJsBody });
      }
      const { protocol, origin } = new URL(url);
      if (origin === localOrigin || protocol === 'data:' || protocol === 'blob:') return route.continue();
      watch.blockedRequests.push(origin.slice(0, 200));
      return route.abort('blockedbyclient');
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') watch.consoleErrors.push(msg.text().slice(0, 200));
    });
    page.on('pageerror', (err) => {
      const message = String(err.message);
      if (!KNOWN_BASELINE_PAGE_ERRORS.includes(message)) watch.pageErrors.push(message.slice(0, 200));
    });

    await use(watch);
  }, { auto: true }],
});

export { expect };
