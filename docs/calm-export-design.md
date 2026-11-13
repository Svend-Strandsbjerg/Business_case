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
  - So the export must warn about `pdays` outside `[icDates.start, icDates.end]`,
    compared as day-numbers (6.4).

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
- **Called:** `_icDayNum`, `icEnsureExcelJs`. `_icDayNum` (6934) converts
  `icDates.start` and `icDates.end` to day-numbers for the "outside range" check
  (6.4); the dates themselves come from `pdays`. `icGetPeriods` and `_icColDays`
  are not called.
- **DOM:** `#pm-mode-bar .pm-mode-bar-inner`, `#pm-parked-btn`.
- **Not needed:** `pmTypeStates`, `_pmSavedIcState`, `icPtSnapshot`,
  `pmSnapshotIc`, `icGroups`. They were reachable, but they are not the source of
  truth in PM mode (1.2).

### 2.4 Verdict

**Add-only is feasible.** Everything the export needs is reachable from a
separately loaded file plus the one `<script src>` line. Nothing has to be
redefined, wrapped or patched.

Limitations, which do not block add-only:
- **Underscore-prefixed helper.** `_icDayNum` is internal and could be renamed
  later. `calm-export.js` should check that it exists and fall back to its own
  copy of `_icDayNum`.
- **Clusters.** There is no cluster per phase in PM mode (1.2), so "roll-out
  cluster" cannot be read from the Module 5 plan without changing code. This
  affects decision D3, not feasibility.

---

## 3. Mapping

### 3.1 Confirmed columns

> **Source:** the tenant's "Items For Creation Using Template" file, downloaded
> from the Cloud ALM tenant (2026-11-13). This replaces the earlier provisional
> list. SAP's rules: do not change the title or order of columns and do not add
> columns. `Parent Row` is the **Excel row number** of the parent; the header is
> row 1, so the first item is row 2. `calm-export.js` keeps the headers in one
> `COLUMNS` constant.

Items columns, in this order (44):

1. `Title`
2. `ID`
3. `Scope`
4. `Solution Process`
5. `Type`
6. `Story Points`
7. `Effort (Hours)`
8. `Source`
9. `Predecessor Row`
10. `Status`
11. `Requirement Status`
12. `Defect Status`
13. `Quality Gate Status`
14. `Risk Status`
15. `Impact (Risk)`
16. `Probability (Risk)`
17. `Category (Risk)`
18. `Mitigation Strategy (Risk)`
19. `Release`
20. `Timebox`
21. `Start`
22. `Planned Completion`
23. `Duration`
24. `Parent Row`
25. `Team`
26. `Assigned Role`
27. `User Type`
28. `Owner (Risk)`
29. `Responsible`
30. `Reviewer`
31. `Involved Parties`
32. `Workstreams`
33. `Deliverable`
34. `Classification`
35. `Sub-Classification`
36. `Test Classification`
37. `Description`
38. `External ID`
39. `References`
40. `Tags`
41. `Comments`
42. `External Reference Name`
43. `External Reference ID`
44. `External Reference URL`

Names used in 3.2 map as follows: `Start Date` → `Start`, `Due Date` →
`Planned Completion`, `Workstream` → `Workstreams`, `Predecessors` →
`Predecessor Row`, `Assigned Person` → `Responsible`. The v1 `Row` column does
not exist in the template. `Source` is `Manually Created`. `ID` stays empty
(an ID makes Cloud ALM treat the row as an update); `External ID` carries
`bc-<edition key>-<node id>`.

The unique ID column from "Download for update" is not created by a first
upload. It only matters for option (b) and (c).

### 3.2 Field-by-field

"Exists" means it is in the model as-is. "Derived" means it is computed from
existing data. "Missing" means it is not in the model.

| Items column | App source | Availability | Notes |
|---|---|---|---|
| Type | Tree level | Derived | Depends on the chosen depth (3.3). |
| Title | `sp.name`, `act.name` (e.g. 14987 ff.) | Exists | Names are up to 91 chars (1.1). Truncate if the template sets a limit. |
| Description | None | Missing | Optional: "Activate phase X / sub-phase Y", generated. |
| Parent Row | Position in the tree | Derived | Row number of the parent row in the same sheet. |
| Predecessors | None | Missing | The app has no dependencies. One option is to chain sub-phases by phase order, but that would invent logic. **Leave empty in v1.** |
| Status | None | Missing | Constant `Open`. |
| Timebox | `ph.name` (`Discover` … `Run`) | Exists | Must match a phase that **already exists** in the Cloud ALM project. Checked in 6.4. |
| Deliverable | `ph.deliverables[]` (7053) | Exists, but at phase level only | Free text that Cloud ALM accepts as custom values. For depth B (3.3), the sub-phase name. |
| Workstream | IC cluster (`icGroups`, `ph.groupId`) | **Not available in PM** (1.2, 7363) | Constant or empty in v1 (D3). |
| Start Date | min(`pdays`) | Derived (1.3) | ISO `YYYY-MM-DD`. Empty if nothing is painted. |
| Due Date | max(`pdays`) | Derived (1.3) | Same as Start Date. |
| Tags | `pmSelectedType`, run count | Derived | E.g. `app-export,public`. Add `split` when the painting is not continuous (D7). |
| Assigned Role | `icITResources` / `icBizResources` names (8346) | Exists, but not linked to activities | Roles carry hours per period (6320), not per activity. Leave empty (D5). |
| Assigned Person | None | Missing | Must be an existing tenant user ID or email. Leave empty. |
| References | None | Missing | Empty. Format `[Label] (URL)` if used later. |
| Source | Constant | Derived | `Manually created`. |

Milestones (`icMilestones`, 5608) **do not become rows**:
- The upload cannot create milestones; they must exist in project setup first
  (D4).
- The export instead writes a second sheet, `App milestones`, as a checklist
  with: name, date (Monday of `md`), gate yes/no, phase.

### 3.3 Hierarchy depth

The tree has three levels: phase → sub-phase → activity. The phase is always the
**Timebox**, never a row.

| | **A: sub-phase → Project Task, activity → Sub-task** | **B: sub-phase → Deliverable, activity → Project Task** |
|---|---|---|
| Allowed pair | Project Task → Sub-task ✔ | No parent row needed ✔ |
| Rows (Public) | ~98 + 320 = ~418 (the spike wrote 418 + header) | ~320 |
| Structure in Cloud ALM | Real parent/child, so it can be expanded and rolled up | Flat list, grouped by the Deliverable filter |
| Dates | Both levels have dates. The sub-phase gets the union span. | Activity dates only |
| Re-parenting risk | Sub-tasks cannot be linked to requirements; only Project Task and User Story can | Activities stay Project Tasks, so they can be linked to Requirements later (Requirement → Project Task) |
| Sub-phase with no activities but own painting | Its own row ✔ | Lost, unless it is exported as a Project Task |
| Duplicate activity names (17–22 per edition) | Unambiguous: the parent row tells them apart | Unambiguous via Deliverable + Timebox |

**Recommendation: A.**
- It keeps the plan's structure and both levels of dates.
- It matches how the app shows the plan.
- B is better only if the project will trace requirements to the activities. In
  that case, choose B in D2.

---

## 4. Activate duplication

When a Cloud ALM project uses an SAP Activate roadmap template, Cloud ALM
generates the roadmap tasks itself. The app's activity names come from the same
roadmaps, so uploading the app's plan into such a project creates **two copies**
of every activity.

### (a) Project without a roadmap template; the app's plan is uploaded as project tasks

- **For:**
  - No duplicates.
  - One simple upload, with no matching and no ID handling.
  - Not affected by KBA 3561362, because nothing is exported from template
    tasks.
- **Against:**
  - The project loses the template tasks' SAP content: descriptions,
    accelerators and links.
  - Updates to the roadmap template are not received.
  - The Timebox phases must be created by hand in project setup.

### (b) Keep the template tasks; the app only supplies dates through "Download for update"

How it works:
1. The user downloads the template tasks from the Cloud ALM project (with unique
   IDs).
2. The user uploads that file into the app.
3. The app matches each row to an activity and writes Start and Due dates.
4. The user re-uploads the file.

Matching activities: by **normalized title** (trimmed, case-folded, whitespace
collapsed), together with the phase (Timebox). The title alone is not enough:
there are 17–22 duplicate activity names per edition (1.1). Two rows with the
same title in the same phase are matched by order of appearance and flagged. Any
row with no match is reported, and its dates are left untouched.

- **For:**
  - No duplicates.
  - The SAP content and links are kept.
- **Against:**
  - The app needs an **import** path and must write into a foreign file layout.
    That roughly doubles the scope.
  - Names can differ between the template version and the app's names (renamed
    or edited activities).
  - It needs a round-trip every time the plan changes.
- **KBA 3561362:** tasks generated from an Activate roadmap could not be exported
  to Excel and imported into another project. Option (b) only re-imports into
  the **same** project. That is the "Download for update" path, which is not the
  case the KBA describes.
  - Remaining risk: if download for update of template tasks hits the same
    defect on a given tenant release, (b) cannot work at all.
  - Verify this on the tenant before committing to (b).

### (c) Hybrid

Keep the roadmap template for its content, but upload the app's plan as
**separate project tasks**. Mark them with a tag (`app-export`) or a dedicated
Workstream (e.g. `App plan`). The template tasks are then ignored, or set to
"Not Relevant" in bulk in Cloud ALM.

- **For:** One simple upload, and the SAP content stays available.
- **Against:** Duplicates are visible to everyone, and the project team has to
  agree on which list is the real one.

### Recommendation: (a)

- It is the only option without duplicates or an import feature.
- It is not affected by the KBA.
- It fits "run a real project from the app's plan".

Move to (c) if the team wants the SAP template content. Do (b) only as a later
feature, after testing on the tenant that template tasks survive download for
update.

---

## 5. Open decisions for the human

| # | Decision | Recommendation |
|---|---|---|
| D1 | Option a / b / c (section 4) | **(a)**: a project without a roadmap template. |
| D2 | Hierarchy depth | **A**: sub-phase → Project Task, activity → Sub-task. Choose B if requirements will trace to activities. |
| D3 | Roll-out clusters as workstreams, tags or separate projects | Clusters do not exist in Module 5 (1.2, 7363). **v1: one Workstream per export, named after the edition, which the user can edit before export.** Separate projects per roll-out need a cluster concept in PM first, and that would mean changing code. |
| D4 | Milestones (the upload cannot create them) | Create them in Cloud ALM project setup by hand. **The export adds an `App milestones` checklist sheet** and warns if any exist. |
| D5 | Task owners (resources are roles with hours, not linked to activities) | **Leave Assigned Role and Person empty.** Assign owners in Cloud ALM. Writing a guessed role risks rejected rows, because persons must exist in the tenant. |
| D6 | Exclude parked items? | **Yes.** They are already outside `icPhases` (1.4). Report the count in the pre-export summary. |
| D7 | Non-continuous painted cells | **One row from min to max with tag `split`, plus a warning listing the affected activities.** Alternative: one row per run, titled "name (1/2)". That doubles rows and breaks predecessor numbering. |
| D8 | Which edition(s) first | **Only the edition that is open** (`pmSelectedType`). All four share the same phase names, so nothing is edition-specific. Public first for test fixtures. |

---

## 6. Implementation design

### 6.1 New files

- `calm-export.js` sits at the repo root, next to `index.html`. It is one IIFE
  and exposes a single namespace, `window.CalmExport`, with:
  - `collectRows()`: a pure function from `{phases, dates}` to row objects;
  - `checks()`;
  - `exportXlsx()`.
- One added line before `</body></html>` (17911) in **both** `index.html` and
  `business-case.html`:
  `<script src="calm-export.js"></script>`. CI runs `cmp`, which keeps the two
  files identical.
- `e2e/calm-export.spec.mjs` holds the E2E tests (6.5).
- Unit tests for the pure mapping are optional. `collectRows` takes its inputs as
  arguments, so a Node test can call it with no DOM. But `npm test` only runs
  the four existing `test_*.js`, and `package.json` must not change. **So the
  mapping is tested through Playwright `page.evaluate`** in the same spec.

### 6.2 Button

- Where: inserted into `#pm-mode-bar .pm-mode-bar-inner` (4732), directly before
  `#pm-parked-btn` (4740).
- Look: class `pm-parked-btn`, label "Export to Cloud ALM".
- When: at `DOMContentLoaded`, or straight away if the DOM is already parsed.
- It is visible only in PM mode, through the existing CSS (2941). It was
  verified to survive edition switches (2.2).
- On click:
  1. If `currentArea !== 'pm'`, return.
  2. Run `checks()`. If there is a blocking error, show the problems in an
     `alert` or `confirm` and stop.
  3. If there are only warnings, ask the user to confirm.
  4. `icEnsureExcelJs(build)` (12768) loads ExcelJS lazily; it does nothing if
     ExcelJS is already loaded. `build` then writes the workbook and downloads
     `calm-tasks-<edition>-<yyyymmdd>.xlsx`, using a Blob and an `<a download>`
     link (the pattern proven in the spike).

### 6.3 Lookup sheets

- **Do not fill them in v1.** Cloud ALM validates against its own project
  values. Copying the lists into the file adds nothing and can drift from the
  tenant.
- When the template (`docs/calm-task-template.xlsx`) is available, the better
  approach is to write the **same sheet names** as the template, with the values
  the export uses (Types, Status, Timebox, Deliverable, Workstreams). The sheets
  then serve as a readable list of values the project must contain.
- Always write the extra sheet `App milestones` (D4).

### 6.4 Checks before export

| Check | Severity | Rule |
|---|---|---|
| No start date | **Blocking** | `icDates.start === null` → "Set a project start date; without it the plan has no calendar dates" (1.3). |
| Nothing painted | **Blocking** | Zero `pdays` in the whole tree. |
| Activity with no painted cells | Warning | List up to 10 names plus a count. Export them with empty dates. Whether Cloud ALM accepts empty dates is assumed, not verified; T5 confirms it. |
| Painting outside the project range | Warning | Compare day-numbers only: `lo = _icDayNum(icDates.start)`, `hi = icDates.end ? _icDayNum(icDates.end) : null`. A `pdays` key `k` (as a number) is outside when `k < lo` or (`hi !== null` and `k > hi`). `icDates.end` is a `Date` (5651, 6693), so it must never be compared directly with a key. If `hi` is `null`, only the lower bound is checked (1.3). |
| Non-continuous painting | Warning | More than one run of consecutive day-numbers (D7). |
| Phase names vs Timebox | Info | List the distinct `ph.name` values that will be written to Timebox. The user must create them in Cloud ALM first. |
| Milestones present | Info | "N milestones must be created in Cloud ALM project setup" (D4). |
| Parked items | Info | `pmParked[pmSelectedType].length` excluded (D6). |
| Title length | Warning | Names longer than the template limit. The limit is unknown until the template is available; assume 255 for now. |

### 6.5 E2E tests

- File: `e2e/calm-export.spec.mjs`.
- It imports `test`, `expect` and `EMPTY_BUCKET` from `e2e/fixtures.mjs`, the
  same as `smoke.spec.mjs`, so ExcelJS comes from `node_modules` and new
  page or console errors fail the test.
- No route rewriting is needed: the real `<script src>` line is in the HTML.

Test setup (as in the spike):
1. `selectArea('pm')`.
2. `icDates.start = new Date(2027,0,13); icAutoComputeEndDate(); icSetup();`
3. Paint with `icToggleCell(ph, sp, act, idx)`.

Cases:
1. The button exists once in the PM bar and is hidden outside PM.
2. With no start date, clicking shows the blocking message and creates no
   download. Accept the dialog with `page.on('dialog')`.
3. Happy path, months view:
   - Download the file and read it with ExcelJS.
   - Check that the header row equals `COLUMNS`.
   - Check the row count = sub-phases + activities.
   - Check row 2 is a `Project Task` with the right Timebox, start and due.
   - Check row 3 is a `Sub-task` with `Parent Row` = 1.
   - Assert **small values only**: specific cells and counts, never the whole
     sheet.
4. Weeks view gives the same dates as months view, for cells painted in months
   view.
5. Non-continuous painting: the row has tag `split` and a warning was shown.
6. A parked activity does not appear (as a title count).
7. After an edition switch, the export uses the new edition's names.

---

## 7. Task breakdown

Each task is one PR, sized to close in one fix cycle. The "add, don't change"
rule applies to all of them.

**T1: Skeleton and button**
- Scope:
  - `calm-export.js` with the IIFE, `window.CalmExport` and the button
    injection (6.2).
  - The `<script src>` line in both HTML files.
  - The click handler only calls `icEnsureExcelJs` and downloads an `Items`
    sheet that contains just the header row.
- AC:
  - The button is visible only in PM and survives edition switches.
  - The two HTML files are still identical (`cmp`).
  - The downloaded file has an `Items` sheet with the `COLUMNS` header.
  - E2E cases 1 and part of 3 pass.
- Dependencies: none. Decisions D1 and D8 are assumed to be (a) and the current
  edition.

**T2: Row mapping and dates**
- Scope:
  - `collectRows()` for hierarchy depth A (or B, per D2).
  - Dates from `pdays` (1.3), parent rows, Timebox, Status `Open`, Source,
    Tags, Workstream (D3).
- AC:
  - E2E cases 3, 4, 6 and 7 pass.
  - Row count = sub-phases + activities of the open edition.
  - Dates are ISO strings and do not depend on the view.
- Dependencies: T1, D2, D3.

**T3: Checks before export**
- Scope:
  - `checks()` with the table in 6.4.
  - The confirm/alert flow.
  - Handling of non-continuous painting according to D7.
- AC: E2E cases 2 and 5 pass; blocking checks prevent any download.
- Dependencies: T2, D7.

**T4: Milestones sheet and lookup sheets**
- Scope: the `App milestones` sheet (D4); lookup sheets according to 6.3.
- AC: an E2E test with one added milestone shows it in the sheet with the right
  Monday date.
- Dependencies: T2, D4.

**T5: Adopt the real tenant template**
- Scope:
  - Replace `COLUMNS` with the headers from `docs/calm-task-template.xlsx`.
  - Update the title length limit.
  - Remove the "provisional" note from this document.
- AC:
  - The E2E header assertion matches the template.
  - A manual test upload into a Cloud ALM sandbox project succeeds. The human
    does this, because the sandbox cannot reach SAP.
- Dependencies: T2, and the human providing the template.

**T6 (optional, only if D1 = b or c): Date update through "Download for update"**
- Scope: import a Cloud ALM download, match rows by normalized title and phase
  (section 4 b), write the dates, and export the file again.
- AC: matched, unmatched and ambiguous rows are counted in the dialog; unique
  IDs are preserved.
- Dependencies: T2, a tenant test of KBA 3561362.

---

## 8. Risks

- **Unknown column headers.** The real template may use different headers,
  required columns or date formats. Mitigation: the `COLUMNS` constant, and T5
  before any real use.
- **Internal helper.** `_icDayNum` is an underscore-prefixed internal and could
  change in a future app edit. Mitigation: check that it exists, keep a local
  fallback copy, and use E2E tests as guards.
- **Reassigned globals.** `pmApplySnapshot` replaces `icPhases` (17157).
  Mitigation: always read `window.icPhases` at click time.
- **Month rounding.** Months view paints whole calendar months, so a start date
  can be before `icDates.start` (1.3). Mitigation: the "outside range" warning.
  Optionally, clamp to the project start (a small decision for T3).
- **Duplicates if the wrong option is used.** Uploading into a project with a
  roadmap template doubles the tasks (section 4). Mitigation: D1, and a sentence
  in the export dialog.
- **Timebox mismatch.** Rows can be rejected if the phases do not exist in the
  Cloud ALM project. Mitigation: the "Info" check lists the phase names.
- **KBA 3561362.** This only matters for options (b) and (c). Test on the tenant
  first.
- **Upload size.** About 420 rows per edition, which is not expected to be a
  limit. This has not been verified against tenant limits.
