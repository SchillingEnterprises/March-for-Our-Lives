# March for Our Lives — History & Prevention

A static, evidence-led guide to the history of firearm harm and prevention. It connects a limited 1966–2016 project archive with current federal public-health sources, research on firearm access and injury, historical context, and layered prevention strategies. The archive is an optional browser-based SQLite workbench—not the site's main evidence base and not an explanation of individual events.

## Run locally

From the repository root, vendor the pinned SQLite runtime, then start a static server:

```bash
bash scripts/vendor-sqljs.sh
python -m http.server 8000
```

Open `http://localhost:8000`. The sample database is loaded only when selected. A local `.db`, `.sqlite`, or `.sqlite3` file can also be opened from the browser. The explorer supports files up to 100 MB.

The application has no backend, account, analytics, tracking, paid API, or AI service. Current research and data are linked directly to their publishers and are not silently merged into the preserved archive. SQLite runs in a browser worker using the pinned, open-source `sql.js` 1.17.0 inline WebAssembly build, served from this site's own origin. The local setup script downloads the exact npm package release and extracts the runtime and MIT license; the browser does not load the SQL engine from a third-party CDN or fetch a companion WebAssembly file. Database files and query data remain in the current tab's worker memory and are never sent to a third-party runtime service, uploaded to an application backend, or saved by the page. The original databases remain available to download directly.

## Preserved assets

- `src/db/Congress.db` — original SQLite database file.
- `src/db/temp/mass_shootings.db` — original SQLite database file retained in the project's temporary-data folder.
- `src/db/store/MSA/Stanford_MSA_Data_Dictionary (V.5).pdf` — preserved research data dictionary.
- `src/db/store/Abbreviations.sql` — original SQL state and territory abbreviation reference.
- `src/images/.png/Grades.png` — supporting original image file.

The Excel filename under `src/db/store/__MACOSX` is a 181-byte macOS metadata sidecar, not a valid workbook, and is not linked as a spreadsheet.

## Quality checks

Run the dependency-free archive tests and JavaScript syntax check:

```bash
python -m unittest discover -s tests -v
node --check app.js
node --check db-worker.js
```

GitHub Actions validates the archive and deploys only the explicitly approved public files to GitHub Pages after changes merge to `master`.

## Research and data limitations

The databases and supporting materials are preserved in their original repository form. Their complete schema, collection period, provenance, definitions, license compatibility, and analytical methodology have not been independently validated. The explorer provides direct access to source records and basic structural checks, not verified or continuously updated research. Do not assume that the datasets are current, complete, comparable, or suitable for redistribution without source-level review.

The history and prevention narrative distinguishes population-level associations from individual causes and avoids treating mental-health or motive labels as predictive profiles. Evidence for reducing suicide, homicide, or firearm injury broadly is not automatically evidence for preventing rare public mass shootings specifically. The site does not generate AI summaries or interpretations. Review the sources, data dictionary, SQL transformations, repository license, and original source terms before using the files for research, public communication, policy work, or publication.

## Current evidence and source dates

The current-source check is dated November 20, 2026. CDC's firearm injury and death page, updated September 2, 2026, reports more than 44,000 firearm-related deaths in 2024—about 121 per day—with more than half suicides and one-third homicides. These figures describe all firearm deaths, not mass shootings. The latest complete annual mortality figures have a reporting lag; CDC's Vital Statistics Early Release (ViSER) dashboard provides selected provisional and final death measures with a stated three-month lag, but it is not a direct substitute for firearm-specific WISQARS reports. CDC archived its previous mortality dashboard on November 18, 2026; the site links to ViSER instead.

For ongoing research, the site links to CDC WISQARS (fatal, nonfatal, and cost-of-injury data), CDC's National Violent Death Reporting System (multi-source violent-death context), NCES's school-associated death indicator (with its own definition and historical cutoff), and a National Academies research-priorities report. A systematic review on household firearm access is linked in context. These sources answer different questions and should not be combined without harmonizing definitions, years, and populations.

## Policy, political control, and ICE

The homepage summarizes two 2026 county-level studies with different interventions and outcomes. De Sousa Lima Azevedo and Siegel's cross-sectional panel study covered 637 counties from 2000–2023 and found five state-law categories associated with lower firearm-suicide rates; its authors call for confirmation with multilevel modeling. Schleimer and colleagues' study used difference-in-differences with synthetic controls across 750 counties in 14 states and found no association between point-of-sale comprehensive background-check policies in six states and county firearm-homicide rates. Neither result is a universal verdict on all gun laws, and neither directly measures public mass shootings.

ICE activity counts are not crime-prevention outcomes. A 2024 NBER working paper on Secure Communities found reduced crime reporting by Hispanic victims and increased victimization, while total reported crime was unchanged. A separate 2021 survey experiment found lower trust in local law enforcement when local officers cooperated with ICE. These findings concern particular interior-enforcement contexts and broader public safety; they do not establish the effect of current ICE operations on firearm attacks. The ICE ERO dashboard covers enforcement activity through December 31, 2024.

The preserved archive contains no policy, ICE, political-control, or post-April-2016 outcome series. It cannot support a comparison of political parties or government offices. Timeline overlap is not causation; credible estimates need harmonized outcome definitions, population-adjusted rates, policy implementation dates, and appropriate comparison groups. See the [2026 firearm-suicide study](https://pmc.ncbi.nlm.nih.gov/articles/PMC13487550/), [2026 background-check study](https://pmc.ncbi.nlm.nih.gov/articles/PMC13263779/), [NBER Secure Communities study](https://www.nber.org/papers/w32109), [ICE ERO statistics](https://www.ice.gov/statistics), and [trust experiment](https://doi.org/10.1017/S1537592719003943).

## Findings from the preserved snapshot

The `Mass_Shootings` table contains 307 records, 48 fields, 41 represented calendar years, and dates from 1966-08-01 through 2016-04-29. It has 65 records dated 2015 and 70 dated 2016, but the latest year ends in April. Those two years account for 135 records (44%); that concentration is a property of this file, not evidence of an increase in real-world incidence. No stable inclusion rule or collection history is documented here.

The file has 748 blank/`NULL` cells among 14,736 (5.1%); 735 are in the seven optional source fields. All 307 rows have at least one populated source field. `CaseID` has 305 distinct values in 307 rows (two excess occurrences); no full rows are identical across all 48 fields. The browser audit also flags nine `Day of Week`/`Date` disagreements, one conflict among 272 recognized `Date - Detailed` values, and 35 `Date - Detailed` entries that did not match the two checked formats. These are review flags, not proof of which source field is wrong.

Several measures need cleaning before statistical use: three rows have `Number of Victim Fatalities` greater than `Total Number of Fatalities`; the labels do not reconcile as one denominator in 133 rows when total fatalities plus injuries are compared with `Total Number of Victims`. The 48-field table has valid coordinate bounds and no missing coordinate pairs, but that does not verify geocoding accuracy. `Average Shooter Age` is stored as text with 31 nonnumeric/mixed entries; six firearm-count fields are also text with `Unknown` or mixed-format values. Category casing varies (`Handgun`/`handgun`, for example), and `School Related` contains one `Killed` value outside its usual Yes/No/Unknown labels. The `Class` field contains codes (`MS`, `SPK`, `FMS`, `GD`) with no repository codebook. Do not silently normalize, impute, or interpret these fields.

The database has no populated legislative comparison: `NRA_vs_Legislation` and the separate Congress database's `US_Congress` table are empty. This snapshot therefore cannot support an assessment of legislation, legislator behavior, policy effects, current prevalence, state-level risk, or causal claims. For advocacy analysis, start with current official outcome data, document the policy and population being evaluated, and match the measure to the prevention goal. Use the archived rows only as a limited historical case study; do not extend their trend line beyond April 2016.

## Preservation and security

The original databases, PDF, SQL reference, image, and license remain unchanged. See [SECURITY.md](SECURITY.md) for data-handling and responsible-use guidance.
