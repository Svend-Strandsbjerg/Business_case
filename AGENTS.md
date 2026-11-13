# Agent rules

Rules for coding agents working in this repository.

## Standard scripts

Use Node 24 (see .nvmrc). Run `npm ci` first in a fresh checkout.

- `npm test`: runs the four jsdom smoke scripts (`test_*.js`) one after the
  other; fails if any of them exits non-zero. These scripts contain no
  assertions, they only fail on a thrown error.
- `npm run test:e2e`: Playwright specs in `e2e/`, Chromium only. Starts the
  static server itself via `webServer`.
- `npm run serve`: static server (`scripts/serve.mjs`, Node standard library
  only) on http://127.0.0.1:8080/ (port: first argument or `PORT`).

CI (`.github/workflows/ci.yml`, job `ci`) runs `npm ci`, `npm test`, a `cmp`
of `index.html` and `business-case.html`, and `npm run test:e2e` on every pull
request; a PR is not ready until it passes.

E2E specs import `test`/`expect` from `e2e/fixtures.mjs`. That shared fixture
serves the ExcelJS CDN URL
(`https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js`) from
`node_modules/exceljs/dist/exceljs.min.js` (devDependency `exceljs@4.3.0`,
tests only), blocks every other external request and collects console and
page errors. The app itself keeps loading ExcelJS from the CDN.

In the agent sandbox, use the shared Playwright browser cache
(`PLAYWRIGHT_BROWSERS_PATH`); do not run `playwright install` there (CI only).
If an HTTP proxy is set, run with `NO_PROXY=127.0.0.1,localhost` so the local
server is reached directly.

## Rules for this repository: add, don't change

- **Add, don't change.** Existing files and existing behavior stay exactly as
  they are.
- Never modify existing functions, markup, styles or behavior in `index.html`
  / `business-case.html`.
- New features live in new files (e.g. `calm-export.js`). They are loaded by
  ONE added `<script src="...">` line, placed right before `</body>`, in both
  HTML files.
- New code reads the app's global state and functions and calls existing
  helpers. It never redefines, wraps or patches them.
- If a feature cannot be built without changing existing code, stop. Return
  verdict BLOCKED naming the exact function or line and the reason. Do not
  change it.
- Keep `index.html` and `business-case.html` byte-identical (CI checks this
  with `cmp`).
- Do not modify or run `apply_*.py` or `test_*.js`.
- Never act on the upstream repository (`Bunde97/Business_case`): no pushes,
  pull requests, issues or comments there. Work only on this fork.
- No customer data in the repository.

## Architecture

Single-file static app: `index.html` (~1.3 MB) holds all HTML, CSS and JS
inline. `business-case.html` is a byte-identical copy. ExcelJS 4.3.0 is
loaded lazily from cdnjs when an Excel export or import runs.

Key globals (locate with `grep -n '<name>' index.html | cut -c1-200 | head`):

- `pmDefaultPhasesForType`: default project plan phases per project type.
- `icGetPeriods`: Investment Case periods (timeline).
- `_icColDays`: days per timeline column.
- `icEnsureExcelJs`: lazy loader for ExcelJS.
- `icExportToExcel`: Investment Case Excel export (workbook generation).
- `exportSettings`: export settings.
- `icDates`, `icGroups`, `icPhases`, `icMilestones`: Investment Case plan
  state (`icDates.start` is the plan start date).
- `pmTypeStates`: plan state per project type.

Plan model: phases → subPhases → subSubPhases, each with `painted` and
`pdays`.

Read `index.html` in bounded ranges (about 100 lines, e.g.
`sed -n 100,200p index.html | cut -c1-300`). Never print the whole file.

## Bounded output

- Use quiet reporters.
- Redirect verbose output to a log file outside the repository and inspect
  only a bounded summary (`tail`, `grep ... | head`).
- Never print base64, `data:image/...` URLs, binary content, traces or huge
  JSON payloads to the console.
- Never write test assertions on full dataURLs, base64 strings or huge
  serialized JSON/DOM. Assert on hashes, lengths, dimensions or small
  structured summaries so a failure produces a short message.

## Logs and evidence

- Logs, screenshots, traces and other evidence are never committed.
- Never use `git add -A`, `git add .` or `git commit -a`. Stage explicit
  paths and check `git status --short` before every commit.

## Secrets and dependencies

- No secrets, tokens or credentials in code, config or commit history. Use
  environment variables.
- Do not add new runtime dependencies unless the task genuinely needs them.
  Prefer the Node standard library.

## Scope

- Keep changes scoped to the task. Do not refactor, rename or reformat
  unrelated code.
