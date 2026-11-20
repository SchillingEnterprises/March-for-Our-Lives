# Security and Data Handling Policy

## Scope

This repository preserves research files and provides a static SQLite explorer. The browser application reads selected database files in a local Web Worker and does not upload database contents to a backend.

## Data handling

- Treat the databases as research artifacts whose provenance, collection period, schema, licensing, and disclosure status require independent review.
- Do not add personal, confidential, or restricted records, credentials, or private exports.
- Before redistribution or analysis, review the original source terms, data dictionary, schema, transformations, and applicable privacy requirements.
- Do not upload database contents or extracts to public issues, pull requests, CI logs, or artifacts.
- The explorer downloads its pinned, open-source `sql.js` JavaScript and WebAssembly runtime from jsDelivr. The selected database is processed in the browser worker; its contents are not sent to that CDN or stored by the page.
- CSV files are generated in the browser and downloaded to the user's device. Closing the database releases the worker's in-memory copy.
- Preserve original files and history; do not replace or migrate databases without a documented backup and review plan.

## Reporting

Report suspected vulnerabilities or data exposure privately through GitHub's private vulnerability reporting feature when available. Do not publish sensitive records in a report.
