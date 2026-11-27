"""Dependency-free checks for the static research archive front page."""

from html.parser import HTMLParser
import sqlite3
from pathlib import Path
import unittest
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]


class ArchiveParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.resources = []
        self.images_without_alt = []
        self.landmarks = set()
        self.ids = []
        self.language = False
        self.fragment_targets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.language = bool(attrs.get("lang"))
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        href = attrs.get("href", "")
        if href.startswith("#") and len(href) > 1:
            self.fragment_targets.append(href[1:])
        if tag in {"header", "main", "footer", "nav"}:
            self.landmarks.add(tag)
        for name in ("href", "src"):
            value = attrs.get(name, "")
            parsed = urlparse(value)
            if value and not parsed.scheme and not value.startswith(("#", "mailto:", "data:")):
                self.resources.append(unquote(parsed.path))
        if tag == "img" and not attrs.get("alt", "").strip():
            self.images_without_alt.append(attrs.get("src", "(missing src)"))


class ResearchArchiveTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / "index.html").read_text(encoding="utf-8")
        self.parser = ArchiveParser()
        self.parser.feed(self.source)

    def test_branded_404_and_robots_are_present(self):
        self.assertTrue((ROOT / "404.html").is_file())
        self.assertTrue((ROOT / "robots.txt").is_file())
        page = (ROOT / "404.html").read_text(encoding="utf-8")
        self.assertIn('<html lang="en">', page)
        self.assertIn('<main id="main">', page)
        self.assertIn("./index.html#research", page)
        self.assertIn("Original data and source materials remain unchanged", page)

    def test_404_page_local_references_resolve_without_escaping_archive_root(self):
        page = ArchiveParser()
        page.feed((ROOT / "404.html").read_text(encoding="utf-8"))
        failures = []
        archive_root = ROOT.resolve()
        for reference in page.resources:
            target = (ROOT / reference).resolve()
            if not target.is_relative_to(archive_root):
                failures.append(f"404 path escapes archive root: {reference}")
            elif not target.exists():
                failures.append(f"Missing local 404-page reference: {reference}")
        self.assertEqual(failures, [], "\\n".join(failures))

    def test_homepage_is_accessible_and_semantic(self):
        self.assertTrue(self.parser.language)
        for landmark in ("header", "main", "footer", "nav"):
            with self.subTest(landmark=landmark):
                self.assertIn(landmark, self.parser.landmarks)
        self.assertIn('href="#main"', self.source)

    def test_internal_fragment_links_resolve_to_unique_ids(self):
        duplicates = sorted({value for value in self.parser.ids if self.parser.ids.count(value) > 1})
        self.assertEqual(duplicates, [], f"Duplicate HTML ids: {duplicates}")
        missing = sorted(set(self.parser.fragment_targets) - set(self.parser.ids))
        self.assertEqual(missing, [], f"Broken in-page links: {missing}")

    def test_all_local_assets_resolve_without_escaping_archive_root(self):
        failures = []
        archive_root = ROOT.resolve()
        for path in self.parser.resources:
            target = (ROOT / path).resolve()
            if not target.is_relative_to(archive_root):
                failures.append(f"Path escapes archive root: {path}")
            elif not target.exists():
                failures.append(f"Missing local asset: {path}")
        self.assertEqual(failures, [], "\\n".join(failures))

    def test_images_have_alt_text(self):
        self.assertEqual(self.parser.images_without_alt, [])

    def test_page_has_a_single_primary_heading(self):
        class HeadingCounter(HTMLParser):
            def __init__(self):
                super().__init__()
                self.count = 0

            def handle_starttag(self, tag, attrs):
                if tag == "h1":
                    self.count += 1

        headings = HeadingCounter()
        headings.feed(self.source)
        self.assertEqual(headings.count, 1)

    def test_original_data_and_document_assets_are_preserved(self):
        required = (
            "src/db/Congress.db",
            "src/db/temp/mass_shootings.db",
            "src/db/store/MSA/Stanford_MSA_Data_Dictionary (V.5).pdf",
            "src/db/store/Abbreviations.sql",
            "src/images/.png/Grades.png",
            "LICENSE",
        )
        for path in required:
            with self.subTest(path=path):
                self.assertTrue((ROOT / path).is_file())

    def test_archived_sqlite_databases_pass_read_only_integrity_check(self):
        databases = (
            "src/db/Congress.db",
            "src/db/temp/mass_shootings.db",
        )
        for relative_path in databases:
            with self.subTest(database=relative_path):
                path = (ROOT / relative_path).resolve()
                uri = f"file:{path.as_posix()}?mode=ro"
                with sqlite3.connect(uri, uri=True) as database:
                    result = database.execute("PRAGMA integrity_check").fetchone()
                self.assertEqual(result, ("ok",))

    def test_original_binary_assets_have_expected_file_signatures(self):
        signatures = {
            "src/db/Congress.db": b"SQLite format 3\x00",
            "src/db/temp/mass_shootings.db": b"SQLite format 3\x00",
            "src/db/store/MSA/Stanford_MSA_Data_Dictionary (V.5).pdf": b"%PDF-",
            "src/images/.png/Grades.png": b"\x89PNG\r\n\x1a\n",
        }
        for relative_path, expected in signatures.items():
            with self.subTest(path=relative_path):
                path = ROOT / relative_path
                self.assertGreater(path.stat().st_size, len(expected))
                with path.open("rb") as original:
                    self.assertEqual(original.read(len(expected)), expected)

    def test_sql_reference_retains_its_state_abbreviation_statements(self):
        sql = (ROOT / "src/db/store/Abbreviations.sql").read_text(encoding="utf-8")
        self.assertIn("SELECT REPLACE(state", sql)
        self.assertIn('"KY", "Kentucky"', sql)
        self.assertIn('"LA", "Louisiana"', sql)
        self.assertIn('"VI", "Virgin Islands"', sql)

    def test_sidecar_excel_file_is_not_advertised_as_a_workbook(self):
        sidecar = ROOT / "src/db/store/__MACOSX/MSA/._Stanford_MSA_Database_for_release_06142016.xlsx"
        self.assertEqual(sidecar.stat().st_size, 181)
        self.assertNotIn("Download Excel", self.source)
        self.assertIn("metadata sidecar", self.source)

    def test_research_limitations_are_explicit(self):
        for phrase in ("not a live incident census", "not been independently validated", "provenance"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_history_and_current_prevention_story_leads_the_archive(self):
        self.assertIn("Understand the past.", self.source)
        self.assertIn('id="history"', self.source)
        self.assertIn('id="why"', self.source)
        self.assertIn('id="policy"', self.source)
        self.assertIn('id="prevention"', self.source)
        self.assertIn('id="sources"', self.source)
        self.assertLess(self.source.index('id="prevention"'), self.source.index('id="explorer"'))
        self.assertIn("No credible “best party” ranking", self.source)
        self.assertIn("Secure Communities", self.source)
        self.assertIn("through December 31, 2024", self.source)
        for source in (
            "https://pmc.ncbi.nlm.nih.gov/articles/PMC13487550/",
            "https://pmc.ncbi.nlm.nih.gov/articles/PMC13263779/",
            "https://www.nber.org/papers/w32109",
            "https://www.ice.gov/statistics",
            "https://doi.org/10.1017/S1537592719003943",
        ):
            with self.subTest(source=source):
                self.assertIn(source, self.source)
        self.assertIn("more than <strong>44,000</strong>", self.source)
        self.assertIn("Current-source check: November 20, 2026", self.source)
        for source in (
            "https://www.cdc.gov/firearm-violence/data-research/facts-stats/index.html",
            "https://wisqars.cdc.gov/",
            "https://www.cdc.gov/nchs/nvss/vsrr/viser.html",
            "https://www.cdc.gov/nvdrs/about/index.html",
            "https://nces.ed.gov/programs/coe/indicator/a01",
            "https://doi.org/10.7326/M13-1301",
        ):
            with self.subTest(source=source):
                self.assertIn(source, self.source)

    def test_browser_sqlite_runtime_is_pinned_and_served_from_same_origin(self):
        worker = (ROOT / "db-worker.js").read_text(encoding="utf-8")
        vendor_script = (ROOT / "scripts/vendor-sqljs.sh").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")

        self.assertIn('const SQL_JS_RUNTIME = "./vendor/sql.js/sql-wasm-inline.js";', worker)
        self.assertIn("importScripts(SQL_JS_RUNTIME)", worker)
        self.assertIn("SQL = await self.initSqlJs()", worker)
        self.assertNotIn("cdn.jsdelivr.net", worker)
        self.assertIn('SQL_JS_VERSION="1.17.0"', vendor_script)
        self.assertIn("npm pack --silent --ignore-scripts", vendor_script)
        self.assertIn("dist/sql-wasm-inline.js", vendor_script)
        self.assertEqual(workflow.count("bash scripts/vendor-sqljs.sh"), 2)
        self.assertIn("vendor/sql.js/sql-wasm-inline.js", workflow)
        self.assertIn("vendor/sql.js/LICENSE", workflow)
        self.assertTrue((ROOT / "vendor/sql.js/sql-wasm-inline.js").is_file())
        self.assertTrue((ROOT / "vendor/sql.js/LICENSE").is_file())

    def test_old_notebook_runtime_is_not_loaded(self):
        self.assertNotIn("require.min.js", self.source)
        self.assertNotIn("CodeMirror", self.source)
        self.assertNotIn("jupyter", self.source.lower())

    def test_explorer_exposes_local_database_controls_and_privacy_limits(self):
        self.assertIn('type="file"', self.source)
        self.assertIn('id="record-search"', self.source)
        self.assertIn('id="export-csv"', self.source)
        self.assertIn('id="profile-variable"', self.source)
        self.assertIn('id="profile-chart"', self.source)
        self.assertIn('id="story-title"', self.source)
        self.assertIn("not a random sample", self.source)
        self.assertIn("database files and query data are never sent to a third-party runtime service", self.source)
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        for behavior in (
            "file.arrayBuffer()",
            "MAX_EXPORT_ROWS",
            "updateProfile()",
            "new Worker(\"./db-worker.js\")",
        ):
            with self.subTest(behavior=behavior):
                self.assertIn(behavior, app)
        self.assertNotIn("fetch(", app.replace("fetch(SAMPLE_DATABASE_URL)", ""))
        worker = (ROOT / "db-worker.js").read_text(encoding="utf-8")
        for behavior in (
            "new SQL.Database(new Uint8Array(buffer))",
            "database.close()",
            "PRAGMA quick_check",
            "COUNT(DISTINCT CASE",
            "PROFILE_SAMPLE_SIZE",
            "sampleStandardDeviation",
            'kind: "date"',
            "getStory",
            "timeSummary",
            "topStates",
            "textContent = quoteForDisplay(value)",
            "instr(lower(CAST(",
        ):
            with self.subTest(behavior=behavior):
                self.assertIn(behavior, worker + app)

    def test_research_audit_checks_are_rendered_with_caveats(self):
        self.assertIn('id="quality-checks"', self.source)
        self.assertIn("not proof that the source is wrong", self.source)
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderQualityChecks(story.qualityChecks)", app)
        self.assertIn("detail.textContent = check.detail", app)
        worker = (ROOT / "db-worker.js").read_text(encoding="utf-8")
        for check in (
            "Date consistency",
            "Detailed dates",
            "Count-field reconciliation",
            "Coordinate bounds",
            "Category coding",
            "Numeric values stored as text",
            "Count fields stored as text",
            "Undocumented classification",
            "Motive interpretation",
        ):
            with self.subTest(check=check):
                self.assertIn(check, worker)


class PagesArtifactTests(unittest.TestCase):
    """Guard the public Pages artifact against repository-wide publishing."""

    def test_pages_workflow_stages_only_explicit_public_archive_assets(self):
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("mkdir -p dist/src/db/temp dist/src/db/store/MSA dist/src/images/.png dist/vendor/sql.js", workflow)
        self.assertEqual(workflow.count("bash scripts/vendor-sqljs.sh"), 2)
        self.assertIn("cp vendor/sql.js/sql-wasm-inline.js vendor/sql.js/LICENSE dist/vendor/sql.js/", workflow)
        for public_path in (
            "index.html", "404.html", "robots.txt", "LICENSE", "app.js", "db-worker.js", "styles.css",
            "src/db/Congress.db", "src/db/temp/mass_shootings.db",
            "src/db/store/MSA/Stanford_MSA_Data_Dictionary (V.5).pdf",
            "src/db/store/Abbreviations.sql", "src/images/.png/Grades.png",
            "vendor/sql.js/sql-wasm-inline.js", "vendor/sql.js/LICENSE",
        ):
            with self.subTest(path=public_path):
                self.assertIn(public_path, workflow)

    def test_pages_artifact_excludes_repository_development_material(self):
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("path: dist", workflow)
        self.assertIn("name: github-pages-${{ github.run_id }}-${{ github.run_attempt }}", workflow)
        self.assertIn("artifact_name: github-pages-${{ github.run_id }}-${{ github.run_attempt }}", workflow)
        for excluded in ("test ! -e dist/.github", "test ! -e dist/tests", "test ! -e dist/README.md"):
            with self.subTest(path=excluded):
                self.assertIn(excluded, workflow)
        self.assertNotIn("path: .", workflow)

if __name__ == "__main__":
    unittest.main(verbosity=2)
