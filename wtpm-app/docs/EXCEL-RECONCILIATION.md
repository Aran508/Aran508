# Reconciliation: web app vs. `2.OEE MAIN SHEET- Nov'26.xlsx` (October 2026 data)

The October 2026 month in `OEE data 1` was imported from the raw cells (part numbers, quantities,
defects, losses, typed planned/operating times) and recalculated by the app's engine. The result
was compared with the workbook's own ` OEE Overall Summary 1` sheet. The comparison is automated in
`tests/reconcile.test.ts` and runs with `npm test`.

## Result

| Machine | Qty | Planned | Losses | Operating | %OEE (with mgmt) app / workbook |
|---|---|---|---|---|---|
| Robot Welding 4 | = | = | = | = | 43.97% / 43.97% |
| SPM Welding 1 | = | = | = | = | 29.47% / 29.47% |
| Ace 2 | = | = | = | = | 61.77% / 61.77% |
| Ace 8 | = | = | = | = | 56.23% / 56.23% |
| Sierra 1 | = | = | = | = | 54.64% / 54.64% |
| Robot Welding 1 | −18 | +75 min | = | = | differs (cells below) |
| Slewline Testing | −27 | = | = | −81 min | differs (cells below) |
| Sierra 2 | −63 | = | +10 min | +188.3 min | differs (cells below) |
| Mainline 1 Testing | = | = | = | = | 44.24% / 44.25% (defect cell) |

`=` means identical to the workbook. Every difference comes from one of these cells in `OEE data 1`:

| Cell(s) | What the workbook does | Effect in the workbook | App |
|---|---|---|---|
| `AN1298` `=SUM(M1298:M1307)` (Robot Welding 1, 10-Oct S1) | range runs into the next block | 18 pcs counted twice | counts them once |
| `AP671` `=…VLOOKUP(K664,…)` (Robot Welding 1, 06-Oct S1) | looks up row 664's shift (3 → 370 min) | planned 75 min too low | shift 1 → 445 min |
| `AN2214`, `AS2214` `…M2214:M2219` (Slewline Testing, 17-Oct S2) | range includes the first row of the next block | 27 pcs / 81 min counted twice | counts them once |
| `AN2643` `=SUM(M2643:M2652)` (Sierra 2, 22-Oct S2) | range runs into the next block | 63 pcs counted twice | counts them once |
| `AQ1406` typed `140` (Sierra 2, 14-Oct S2) | the loss cells of the block add up to 150 | 10 min of losses missing | 150 min |
| `AS2259` `=SUM(J2258:J2261,M2258:M2261)` (Sierra 2, 20-Oct S1) | adds cycle times and quantities instead of `SUMPRODUCT` | operating time 90.0 instead of 278.4 min | 278.4 min |
| `AO1777` `=SUM(O1777:O1781)` (Mainline 1 Testing, 13-Oct S1) | sums the R/W column instead of Defect | 2 defects missing | 2 defects |

## Also handled during import (no difference in the totals)

* **Blank shift cell.** In rows 94, 318, 348 and 1676 the Shift cell (K) was left empty, so the sheet
  carried the previous shift down, while the planner typed the planned time of the real shift
  (445 / 460 / 370). The importer takes the shift from that typed planned time and reports it
  (`npm run db:import` prints a note per row). Without this, two different shifts would merge.
* **Continuation blocks.** A second block for the same machine and shift with Planned Time typed as
  `0` (e.g. rows 14, 528, 1293) is the workbook's way of not counting the shift twice. The app treats
  it the same way.
* **Typed planned / operating times** (≈ 200 blocks, e.g. 240 for a half shift) are kept as record
  overrides with the reason “Typed value in Excel”.
* **Template rows** whose machine resolves to `#N/A` (76 blocks after row 3500) are ignored, as every
  SUMIFS in the workbook ignores them.

## Other formula issues found (do not change the monthly totals)

* About 40 blocks have `AO` (Defect) summing column O (R/W) instead of N — in October their R/W and
  Defect cells were equal or empty, except `AO1777` above.
* Eight blocks have a hand-typed `%P` (`AY`, e.g. `AY1487 = 1`) or broken `%A..%OEE` cells; only the
  block row's own percentages are affected — every report recalculates from the summed minutes.
* The revised-method columns `BC…BS` add the planned-downtime categories from the **first row of each
  block only**; the app adds them over the whole block.
* `1.DASHBOARD` Table4 total row: “Total Losses” shows `SUBTOTAL(109, [Planned Time])`; the app shows
  the real total losses.
* Duplicate keys in `Cycletime and Bore` (19 part + machine pairs): `VLOOKUP` uses the first one; the
  importer keeps the first one too.
