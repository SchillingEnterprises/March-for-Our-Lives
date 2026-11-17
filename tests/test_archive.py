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
        self.language = False
        self.ids = []
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

    def test_all_local_assets_resolve(self):
        missing = []
        for path in self.parser.resources:
            target = (ROOT / path).resolve()
            if not target.exists():
                missing.append(path)
        self.assertEqual(missing, [])

    def test_images_have_alt_text(self):
        self.assertEqual(self.parser.images_without_alt, [])

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
        for phrase in ("not a live data service", "not been independently validated", "provenance"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.source)

    def test_old_notebook_runtime_is_not_loaded(self):
        self.assertNotIn("require.min.js", self.source)
        self.assertNotIn("CodeMirror", self.source)
        self.assertNotIn("jupyter", self.source.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
