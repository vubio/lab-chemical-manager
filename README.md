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
- By default, the dosing planner prefers the fewest dilution steps and enlarges intermediate preparation volumes (up to the configured maximum, initially 500 µL) so each stock transfer meets the chosen minimum pipetting volume. Alternatively, choose **Smallest volume** to limit reagent use and permit more stages. For example, a 10 mM stock to 25 µM intermediate is a 1:400 dilution; at the default 0.5 µL pipetting minimum, it requires 200 µL total (0.5 µL stock + 199.5 µL solvent), not two serial steps. This is not a guarantee of practical pipette precision or chemical solubility.
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