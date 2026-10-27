# Lab Chemical Manager (v1)

A static, local-first lab notebook companion for solution preparation, chemical stock records, cell-treatment planning, and timestamped experimental documentation.

## Start

Open `index.html` in Chrome/Edge/Firefox, or upload **all three** files (`index.html`, `styles.css`, `app.js`) to the root of a GitHub repository and enable **Settings → Pages → Deploy from a branch → main / root**. The web app does not require a build pipeline, account, server, or API key.

## Features

- Powder to molar stock using molecular weight
- Powder to mass/volume or % w/v stock
- Direct preparation using a target concentration and final volume
- Stock-to-working concentration, including molar/mass conversions with known molecular weight
- X-fold manufacturer concentrate (1000X → 1X)
- Lyophilized reconstitution (volume, optional vial mass, optional X labeling)
- % v/v solution preparation
- Experimental dosing with multiple final concentrations, matching volume of vehicle added per condition, serial intermediate dilution steps when needed, and minimum pipetting thresholds
- Chemical library: name, manufacturer, catalog, lot, CAS, molecular weight, stock, solvent, storage, dates, notes
- Automatic timestamped calculation history; history metadata can be edited without changing original calculations
- Reusable dosing templates and copy-ready laboratory records; CSV history and JSON backups

## Dosing planner interpretation

- By default, **volume per well is the final volume**, including the treatment addition. E.g., 500 µL per well with 1 µL of dosing solution means 499 µL medium + 1 µL treatment.
- If **existing medium volume** is selected, e.g., existing 500 µL medium + 1 µL treatment, the calculated final total is 501 µL.
- The method prepares each dose intermediate in the **same solvent as the stock**, with a fixed volume added per well, including the zero-dose vehicle-only control. Matching vehicle composition requires all intermediates to use only the same vehicle at identical composition; check precipitation and solution stability.
- The **Shared intermediates** strategy is the default. A plan is shown with **highest final dose first**, and its quick summary includes the source intermediate, fold dilution, preparation recipe in µL, and the amount to add per well. The result includes selectable **Shared intermediates**, **Independent / fewest steps**, and **Independent / smallest volume** alternatives; switching strategy recalculates and saves a new timestamped history record. When separate preparations are chosen, the planner prefers the fewest dilution steps and enlarges intermediate preparation volumes (up to the configured maximum, initially 500 µL) so each stock transfer meets the chosen minimum pipetting volume. Choose **Independent / smallest volume** to limit reagent use and permit more stages. For example, a 10 mM stock to 25 µM intermediate is a 1:400 dilution; at the default 0.5 µL pipetting minimum, it requires 200 µL total (0.5 µL stock + 199.5 µL solvent), not two serial steps. This is not a guarantee of practical pipette precision or chemical solubility.
- When sharing an intermediate, the planned preparation volume includes what is needed for **its own wells plus all downstream transfers**, within the user-selected maximum. If shared transfer amounts are impractical or exceed the cap, a condition can be prepared independently instead. Dense sets of concentrations do not have to form one long serial dilution.
- The dosing planner models one chemical per plan. For multiple drugs or mixed vehicles, make separate plans and account for combined vehicles manually.

## Data/storage and responsible use

All records are saved in browser **localStorage** on the current device and browser profile. They are **not** synchronized between devices or stored in the public GitHub repository. Browser data deletion, private mode, or a different web origin can lose access to those records. **Export a JSON backup regularly.** JSON files may contain unpublished experimental information; store them according to laboratory policy.

Values are arithmetic assistance, **not a validated laboratory electronic notebook, inventory tracking system, audit trail, or protocol**. Confirm independently before use: chemical purity, molecular form (salt/hydrate), molecular weight, solvent compatibility, density where relevant, solubility, stability, sterility, pH, pipette range, and supplier instructions. Percent w/v means **grams per 100 mL final solution**; percent v/v means **mL per 100 mL final solution**. X-fold strength has no intrinsic molar concentration.

## Planned enhancements

- Password-protected multi-device sync and shared laboratory inventory with a proper database
- Lot-linked consumption tracking, stock expiry reminders, QR labels
- More advanced dilution planning (aqueous carrier balancing, multi-compound plates, plate maps)
- Formula printing/PDF reports and SOP reference attachments

## License

MIT. No external runtime dependencies.

## Per-condition wells and one extra well (October 2026)

- The **Wells per condition** editor follows the entered target concentrations; every new target defaults to 1 well, but each can be independently changed. Edits survive concentration reordering and are included in saved templates and calculation history. Older templates with a single well count remain usable.
- The dosing table now shows the actual well count, treatment/vehicle volume plus medium volume for those wells, and the equivalent recipe for **one extra well** (handling reserve). Medium totals honor the existing **Final volume** versus **Existing medium volume** selector.
- Intermediate sufficiency is calculated separately per target from `(wells + 1) × dose per well × (1 + percent overage/100)` before accounting for withdrawals into shared downstream solutions. The +1-well reserve does not change the concentration of any solution.
- Example with **500 µL final per well** and **1 µL dosing per well**: 3 wells require **3 µL treatment + 1497 µL medium = 1500 µL final**, and 3+1 wells require **4 µL treatment + 1996 µL medium = 2000 µL final**. In **Existing medium** mode, the corresponding recipes are **3 µL + 1500 µL medium** and **4 µL + 2000 µL medium**, yielding final volumes of 1503 and 2004 µL, respectively.

## Plate Layout (independent workspace)

The **Plate layout** page is separate from **Dosing planner**. Plate maps do not determine drug concentrations or reagent amounts, and dosing calculations do not modify plate maps. The dosing calculator retains its previous stand-alone design, including per-dose replicate counts and shared/independent dilution strategies.

- Select 6-, 12-, 24-, 48-, 96-, or 384-well plate formats. By default, **all wells are available** without making a selection.
- In **Select wells** mode, drag from one well to another to select a rectangular region. Hold **Ctrl** (Windows/Linux) or **Command** (Mac) while dragging to add another region; hold **Alt** to subtract. Select a subset first if only part of the plate is usable.
- Define up to **four experimental factors** with editable names and values (e.g., Cell line, Time, Medium, Treatment). Enter lists with commas, semicolons, or line breaks. Move factors up/down to control prominent-first label order.
- Set the number of replicates for each combination and click **Generate / replace well labels**. Allocation prefers a contiguous horizontal run within a row for each condition, selecting fresh rows when possible. If needed, it uses remaining wells row-by-row.
- In **Move labels** mode, drag a populated well to an empty well to move it, or to another populated well to swap their contents. **Shift + drag** in Select mode does the same. Click or double-click a well to change any of its four lines in the manual editor. Keyboard users can focus a well and press Enter to edit it.
- **Save layout** keeps a dated snapshot. Editing the current draft doesn't change older snapshots. Use **Copy plate note** or **Download plate map (.tsv)** for notebook documentation.
- Plate work-in-progress and saved layouts use browser storage key `labchem.plate.layouts.v1` and have their own **Backup / Restore plate layouts (.json)** actions. They are **not** included in the chemical/dosing JSON backup. Keep both backups if you need both types of data. Neither module uses cloud synchronization.

A label grid is **not randomization**. Review biological replicates, plate-edge effects, and treatment location when designing an experiment.

## Plate layout quality-of-life updates

- **Replicate batches:** Set a count for all condition combinations, for checked condition rows, or for any combination matching a selected factor value. Each replicate cell can still be changed independently.
- **Optional axis notes:** The normal plate map shows only labeled wells (A1, B3, etc.) with **no separate row/column header bands**. Use **Show notes** at the upper-left of the plate to reveal row/column labels and editable note fields; **Hide notes** returns to the compact plate. Notes are preserved when hidden and remain available in copied tables, saved layouts, and JSON backups.
- **Copy for OneNote:** **Copy condition table** and **Copy plate table** use `text/html` plus `text/plain` clipboard formats; supported apps like OneNote can paste an actual bordered table. **Copy plate note** includes layout metadata and the full table with row/column annotations. Plain-text fallback is used if the browser does not support formatted clipboard writes.
- **Module isolation:** This changes only the independent plate layout. The dosing calculator has not been coupled to the plate layout.

## Plate layout (v4)

- Row/column headers are compact and clickable. Click a label to open its note editor; blank headers display only the row/column identifier. Notes appear beneath the identifier only when saved, and are included in exports.
- **Auto-fill direction:** `Rows first` (default, compact horizontal rows) or `Columns first` (vertical columns). Changing the setting only changes the next generated layout; existing labels stay put until Generate.
- **Transpose current map:** swaps the axes of assigned wells and explicitly selected wells if the transposed bounding area fits the current plate. The action leaves the map unchanged if it would overflow. Axis notes stay attached to the physical row and column labels.
- **Copy plate table / Copy plate note:** HTML clipboard table with bold larger primary-factor values, subdued smaller secondary text, and finer tertiary labels. Falls back to plain text when the rich clipboard is unavailable.
- Row and column notes remain editable and persistent in saved layouts, backups, and TSV exports.

## Plate-reader matching and analysis export

On **Plate Layout**, click **Match reader values** after labeling the experimental wells. Copy the raw reader grid from Excel, a CSV file, or your reader software and paste the complete grid in the dialog. For a standard 96-well plate, this is 8 rows × 12 columns (A–H, 1–12). A full-length single row or column can also be matched; optional row/column headers are recognized. Use the alternate orientation selector when the source grid is 12 × 8 instead.

**Match values** pairs each numeric reading with the label currently assigned to that **physical well** (including manually moved labels) and assigns replicate numbers within each factor combination in plate order. Measurements in unlabeled wells are excluded from the statistical table but retained in a raw-grid export. Missing readings and unmapped wells are reported before export.

Available output formats are **Long (jamovi/Python)**, **Long + Well**, **Prism grouped** (for two factors), **Wide (conditions as columns)**, and **Plate matrix (raw readings)**. You can copy the matched table or download **CSV** and **XLSX**. Excel export includes the selected format, a long-data sheet, a plate-readings sheet, and metadata where applicable. The exporter works entirely in your browser—there is no server upload. Verify orientation and the matched-well summary before using results for analysis.

## Manual controls and special plate wells

On **Plate Layout**, either **double-click a well** to open its label editor or select several wells (Shift-click a range, Ctrl/⌘-click for additional wells) and choose **Edit / label selected wells**. Choose **Special control / extra well**, enter a label such as `Media only`, and apply it to the selected wells. The labels appear in muted gray so they cannot be mistaken for primary/secondary factor values. The older individual-factor editor remains available below the plate for normal labels.

Manual controls are stored as independent well assignments (`kind: "special"`) with the rest of the plate. They are preserved in saved layouts, plate-copy tables, and backup files. Regenerating factor labels can replace manual edits, so the page asks before doing so.

**Match reader values** keeps these readings separate from the Density × Erastin2 factor combinations. Its **Special controls** selector defaults to **Separate table**, with optional **Append above** or **Append below** for long-format exports, or **Exclude controls**. All formats keep the plate coordinates; Prism and wide layouts always use a separate controls table instead of inventing factor values. A separate **Download controls CSV** button saves control data; the Excel file includes a **Special controls** sheet (when controls are included), along with the regular analysis sheet and plate matrix. The raw plate matrix retains the original readings regardless of control selection.

A gray control label like `Media only` represents an experimental control, not a measured zero and not a treatment replicate. Verify the labeling and instrument-grid orientation before analysis.

## Dosing history on the planner page

The Dosing Planner has a collapsible **Recent dosing history** panel above the experiment setup, reading from the same browser-local history database as **Calculation history**. You can search by chemical or experiment, see recent records, expand to all, and use **View result**, **Reuse inputs**, or **Copy note**. Viewing a saved result does not create a new calculation; reusing inputs requires Generate to save a new timestamped plan.

Above every result's **Condition summary** table, the chemical name is shown beside **Copy table**. This copies **only the chemical name and the summary table**, omitting the "Condition summary" section title and the detailed recipes. Browsers that support rich clipboard writes copy a bordered HTML table suitable for OneNote, with a tab-delimited fallback when rich clipboard access is unavailable. Full detailed documentation is still available with **Copy lab note**.

The existing calculation-history page and saved records are unchanged. As before, browser-local storage does not automatically synchronize across computers; use JSON backup/export to preserve a durable copy.
