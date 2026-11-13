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

// Bounded recording: each bucket keeps a total count plus at most
// MAX_RECORDED messages, each truncated to MAX_MESSAGE_CHARS, so a failing
// assertion on a bucket always prints a small diff.
export const MAX_RECORDED = 5;
export const MAX_MESSAGE_CHARS = 200;
const newBucket = () => ({ count: 0, first: [] });
const record = (bucket, message) => {
  bucket.count += 1;
  if (bucket.first.length < MAX_RECORDED) bucket.first.push(String(message).slice(0, MAX_MESSAGE_CHARS));
};
export const EMPTY_BUCKET = Object.freeze({ count: 0, first: [] });

// Shared fixture: fulfils the ExcelJS CDN request locally, aborts every other
// external request, and records console errors, unexpected page errors and blocked
// requests in bounded buckets ({ count, first }) so tests assert on small summaries.
export const test = base.extend({
  pageWatch: [async ({ page, baseURL }, use) => {
    const localOrigin = new URL(baseURL).origin;
    const watch = { consoleErrors: newBucket(), pageErrors: newBucket(), blockedRequests: newBucket() };

    await page.context().route('**/*', (route) => {
      const url = route.request().url();
      if (url === EXCELJS_CDN_URL) {
        return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: excelJsBody });
      }
      const { protocol, origin } = new URL(url);
      if (origin === localOrigin || protocol === 'data:' || protocol === 'blob:') return route.continue();
      record(watch.blockedRequests, origin);
      return route.abort('blockedbyclient');
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') record(watch.consoleErrors, msg.text());
    });
    page.on('pageerror', (err) => {
      const message = String(err.message);
      if (!KNOWN_BASELINE_PAGE_ERRORS.includes(message)) record(watch.pageErrors, message);
    });

    await use(watch);
  }, { auto: true }],
});

export { expect };
