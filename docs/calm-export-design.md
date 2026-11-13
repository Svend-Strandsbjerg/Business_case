# Design: SAP Cloud ALM task export from the project plan

Status: design only (DEV-309 / DEV-310). No app code is changed by this document.

All line references are to `index.html` at commit `98642fe` (`business-case.html`
is byte-identical, so the same lines apply). "Spike" means a throwaway Playwright
check run locally against that commit (not committed, see section 2).

---

## 1. Data model (verified)

### 1.1 Where the plan lives at runtime

Module 5 (Project Management, `currentArea === 'pm'`) does **not** have its own
timeline engine. It reuses the Investment Case (IC) timeline globals and swaps
their content per edition.

| State | Declared | Content |
|---|---|---|
| `icPhases` | 5616 | Live tree: phase → `subPhases[]` → `subSubPhases[]` (activities). Each node has `id`, `name`, `painted`, and (once dated) `pdays`. Phases also have `color`, `groupId` (IC only), `deliverables[]` (set at 7053). |
| `icGroups` | 5611 | IC clusters (`grp1` "Implementation project", `grp2` "Roll out"). |
| `icMilestones` | 5608 | `[{id, md, name, isGate, phaseId, subPhaseId}]`; `md` = Monday day-number (pushed at 6996). |
| `icDates` | 5651 | `{start: Date\|null, end: Date\|null}`. |
| `icPeriod` | 5605 | `'months'` or `'weeks'`. |
| `icITResources` / `icBizResources` | 8346 / 8351 | Roles with `hours` keyed by **period index** (read at 6320); no link to activities. |
| `icParked` | 17292 | IC parked items. |
| `pmSelectedType` | 14981 | Current edition, default `'public'`. |
| `pmTypeKeys` | 14982 | `['public','private-new','private-conv','private-sdt']`. |
| `pmTypeStates` | 14983 | Per-edition snapshot, `null` until first visited. |
| `pmParked` | 14984 | Per-edition parked items. |
| `_pmSavedIcState` | 14985 | IC state saved while Module 5 is open. |

Defaults per edition come from `pmDefaultPhasesForType` (14987) via
`pmDefaultState`. The spike counted the defaults: all four editions have phases
`Discover|Prepare|Explore|Realize|Deploy|Run`. The counts are:

| Edition | Sub-phases | Activities | Duplicate activity names | Longest name |
|---|---|---|---|---|
| public | 98 | 320 | 22 | 91 chars |
| private-new | 102 | 340 | 17 | 89 chars |
| private-conv | 94 | 318 | 20 | 87 chars |
| private-sdt | 97 | 327 | 22 | 87 chars |

### 1.2 How the PM and IC states relate

- `selectArea` (5546) calls `pmEnter()` when you enter `pm` (5551), and
  `pmLeave()` when you leave (5550).
- `pmEnter` (17175) does three things:
  1. saves the IC state: `_pmSavedIcState = pmSnapshotIc()`;
  2. creates the edition's default state if it is missing;
  3. copies `pmTypeStates[pmSelectedType]` **into the `ic*` globals** with
     `pmApplySnapshot` (17155).
- `pmSelectType` (17177) writes the live `ic*` state back into
  `pmTypeStates[old]`, applies the new edition's state, and calls `icSetup()`.
- `pmLeave` (17176) stores the live state in `pmTypeStates[pmSelectedType]` and
  restores `_pmSavedIcState`.
- `pmSnapshotIc` (17151) copies phases, resources, period, `dateStart`/`dateEnd`
  (ms), vacation weeks and `milestones`. It does **not** copy `icGroups`.
  `pmApplySnapshot` (17155) does not touch `icGroups` either.
- `icPtSnapshot` (6066) is a different thing: the IC per-project-type snapshot
  (`icPtStates`, 6170–6176) and the saved project (`ic: icPtSnapshot()`, 12724).
  It includes `groups` and `parked`. Module 5 never uses it.
- In PM mode the timeline does not render clusters:
  `renderGroups = (currentArea !== 'pm') && ...` (7363).

The spike confirmed this:
- PM phases have no `groupId`.
- `icGroups.length` is still 2 (the IC's clusters, not rendered).
- After painting in PM, `pmTypeStates['public']...pdays` was still `{}`: the
  snapshot is stale while the edition is open.

**Decision: the export reads the live `ic*` globals while
`currentArea === 'pm'`. It never reads `pmTypeStates[pmSelectedType]`.**

Why:
- The live `ic*` globals are the only up-to-date copy of the open edition.
- The date helpers (`_icColDays`, `icGetPeriods`) only read the globals.

Exporting an edition that is not open would mean calling `pmSelectType`, which
changes what the user sees. That is out of scope for v1: export the open edition
only.

### 1.3 From painted cells to start and due dates

- `painted` is an index map `{colIndex: true}` for the **current view**.
- `pdays` is a hidden map `{dayNumber: 1}` of absolute painted days (the comment
  at 6931–6933 describes this).
- A day-number is `_icDayNum(d)` = UTC days since epoch of the local calendar
  date (6934). Convert it to ISO with
  `new Date(dn*86400000).toISOString().slice(0,10)`; this is timezone-stable.
- `_icColDays(i)` (6935) returns the day-numbers of column `i`, end exclusive:
  - **Months view:** calendar month `start.month + i`, from the 1st to the last
    day. Column 0 starts on the 1st of the start month, **not** on the start day.
  - **Weeks view:** 7 days Monday–Sunday from `_icWeekAnchor()` (6738), which is
    the Monday on or before `icDates.start`.
- Painting: `icToggleCell` (8003) flips `painted[idx]` and calls `_icPaintWrite`
  (7191). That adds or removes the column's day-numbers in `pdays` (7193–7194).
- When the view or start date changes, `_icRebuildNodePainted` (7196) rebuilds
  `painted` from `pdays` (7205–7207). `_icRebuildAllPainted` (7209) does this for
  every node.
- `icGetPeriods` (6839) gives the column count and labels, from start/end in
  months view or the week anchor in weeks view.

**Rule for the export:**
- `start` = min of the node's `pdays`; `due` = max of the node's `pdays`.
- Sub-phases and phases also have their own `pdays`. A parent's span is the union
  of its own `pdays` and its children's `pdays`, the same as
  `_icPhasePeriodLabel` (7056–7058).

Spike evidence:
- Start date 13 Jan 2027; first activity of Public painted in month columns 1 and
  3 (Feb and Apr).
- Result: 58 day-numbers, start `2027-02-01`, due `2027-04-30`.
- After `icSetPeriod('weeks')` the result was identical, shown as 9 painted week
  columns. **Dates do not depend on the view.**

Edge cases:
- Months view rounds to whole months. Painting January when the start is 13 Jan
  gives a start of 1 Jan, before the project start.
- Weeks view gives Monday to Sunday, so a due date can be a Sunday.

**No start date** (`icDates.start === null`):
- `_icColDays` returns `null` (6936). `_icPaintWrite` is then a no-op (7192), so
  only index-based `painted` exists ("legacy index mode").
- `icGetPeriods` labels are `M1, M2, …`. Spike: `{"start":null,"labels":["M1","M2","M3"],"col":null}`.
- **No real dates can be derived; the export must refuse** (section 6.4).
- When a start date is set later, `_icRebuildNodePainted` copies the indices into
  `pdays` once, using the current view (7198–7202).
  - Spike: painted columns 0 and 2, then start 1 Jun 2027, gave 61 days
    (Jun + Aug).
- When the start date is moved afterwards, `pdays` keep their absolute dates.
  They can then fall outside the visible columns.
  - Spike: moving the start to 1 Sep 2027 gave `painted` `[]`, with `pdays`
    still 61.
  - So the export must warn about `pdays` outside `[icDates.start, icDates.end]`.

### 1.4 Non-continuous painting and parked items

- **Non-continuous cells:** `pdays` is a set and can have gaps.
  - Spike: Feb + Apr gave 2 runs of consecutive days.
  - Taking min/max collapses the gap into one task from 1 Feb to 30 Apr.
  - Cloud ALM tasks have one start and one due date, so a gap cannot be shown on
    one row. The options are listed in section 5.
- **Parked items:**
  - In PM, `pmParkPhase` (17278), `pmParkSubPhase` (17184) and `pmParkActivity`
    (17185) **remove** the node from `icPhases` and push a copy to
    `pmParked[pmSelectedType]`.
  - The parked activity copy only stores names and parent ids, not `pdays`
    (17185).
  - So parked items are simply not in the live tree. Reading `icPhases` excludes
    them without extra work.
  - `icParked` (17292) is the IC's list and does not matter for Module 5.

---

## 2. Access from a separate file (verified)

### 2.1 Spike set-up

The spike files were `e2e/_spike/calm-spike.js`, `spike.spec.mjs` and
`stats.spec.mjs`. They are listed in `.git/info/exclude` and not committed.

- The spec reads `index.html` from disk and serves it through `page.route` with
  **one** extra `<script src="calm-export.js"></script>` line before
  `</body></html>` (17911). This is exactly what the feature will add.
- `calm-export.js` is served by the route from the spike file. The file on disk
  is unchanged.
- It uses `e2e/fixtures.mjs`, which serves ExcelJS from `node_modules` and
  records page and console errors.
- Result: `2 passed` (Chromium), with no new page or console errors.

### 2.2 What was proven

1. **State is readable.** Every needed name resolved from the separate script:

   ```
   icPhases, icGroups, icMilestones, icDates, pmTypeStates, pmParked,
   _pmSavedIcState, icParked, pmTypeKeys: object
   icPeriod, pmSelectedType, currentArea: string
   icGetPeriods, _icColDays, _icDayNum, _icWeekAnchor,
   icEnsureExcelJs, icPtSnapshot, pmSnapshotIc: function
   ```

   - The IC globals are declared with `var` inside a plain inline `<script>`
     (5605–5651 etc.), so they are properties of `window`.
   - The PM globals are top-level `var`s (14981–14985).
   - `pmApplySnapshot` **reassigns** `icPhases` (17157). So the export must read
     `window.icPhases` at click time and never cache it.
2. **ExcelJS is loadable.**
   - `typeof ExcelJS` was `undefined` before the click.
   - The click handler called `icEnsureExcelJs(cb)` (12768). That function
     injects the CDN script once and then calls `cb`.
   - The handler built a workbook with an `Items` sheet and downloaded
     `calm-spike.xlsx` (419 rows for Public).
   - The test read the file back with ExcelJS. Row 2 was
     `[1,"Project Task","Introduction to SAP Business Suite","Discover","2027-02-01","2027-04-30",""]`;
     row 3 was a `Sub-task` with parent row 1.
3. **A button can be added without changing existing code.**
   - The script inserts its own `<button>` into the existing PM bar,
     `#pm-mode-bar .pm-mode-bar-inner` (4732), before `#pm-parked-btn` (4740).
     It reuses the existing class `pm-parked-btn` for styling.
   - The bar is only visible in PM mode (CSS 2941/3189; the `pm-mode` class is
     toggled at 5578), so the button is too.
   - The bar markup is static and never re-rendered. After
     `pmSelectType('private-new')` and then `'public'`, the button was still
     there exactly once, and it still worked.

### 2.3 Globals the export depends on

- **Read:** `currentArea`, `pmSelectedType`, `icPhases`, `icDates`, `icPeriod`,
  `icMilestones`, `pmParked` (only to report counts).
- **Called:** `_icDayNum`, `icGetPeriods`, `_icColDays`, `icEnsureExcelJs`.
  `_icColDays` and `icGetPeriods` are only used for the "outside range" check;
  the dates come from `pdays`.
- **DOM:** `#pm-mode-bar .pm-mode-bar-inner`, `#pm-parked-btn`.
- **Not needed:** `pmTypeStates`, `_pmSavedIcState`, `icPtSnapshot`,
  `pmSnapshotIc`, `icGroups`. They were reachable, but they are not the source of
  truth in PM mode (1.2).

### 2.4 Verdict

**Add-only is feasible.** Everything the export needs is reachable from a
separately loaded file plus the one `<script src>` line. Nothing has to be
redefined, wrapped or patched.

Limitations, which do not block add-only:
- **Underscore-prefixed helpers.** `_icColDays` and `_icDayNum` are internal and
  could be renamed later. `calm-export.js` should check that they exist and fall
  back to its own copy of `_icDayNum`.
- **Clusters.** There is no cluster per phase in PM mode (1.2), so "roll-out
  cluster" cannot be read from the Module 5 plan without changing code. This
  affects decision D3, not feasibility.
