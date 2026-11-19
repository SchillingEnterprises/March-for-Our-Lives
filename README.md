# March for Our Lives — Research Archive

An accessible static landing page for the research assets preserved in this repository.

## Preserved assets

- `src/db/Congress.db` — original SQLite database file.
- `src/db/temp/mass_shootings.db` — original SQLite database file retained in the project's temporary-data folder.
- `src/db/store/MSA/Stanford_MSA_Data_Dictionary (V.5).pdf` — preserved research data dictionary.
- `src/db/store/Abbreviations.sql` — original SQL state and territory abbreviation reference.
- `src/images/.png/Grades.png` — supporting original image file.

The Excel filename present under `src/db/store/__MACOSX` is a 181-byte macOS metadata sidecar, not a valid workbook. It is deliberately not linked as a downloadable spreadsheet.

## Local preview

This is a static site. From the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Quality checks

Run the dependency-free archive tests:

```bash
python -m unittest discover -s tests -v
```

GitHub Actions validates the static site and deploys it to GitHub Pages after changes merge to `master`. No Python runtime or external frontend packages are required.

## Research and data limitations

The databases and supporting materials are preserved in their original repository form. Their complete schema, collection period, provenance, definitions, license compatibility, and analytical methodology have not been independently validated by this archive presentation. Do not assume the datasets are current, complete, comparable, or suitable for redistribution without source-level review.

The landing page intentionally does not publish derived statistics or analysis. Review the sources, data dictionary, SQL transformations, repository license, and original source terms before using the files for research, public communication, policy work, or publication.

## Preservation

The modernization changes the repository's homepage and documentation only. Original databases, PDF, SQL reference, image, and license remain preserved.

## Security

See [SECURITY.md](SECURITY.md) for this repository's security, privacy, and responsible-use guidance.
