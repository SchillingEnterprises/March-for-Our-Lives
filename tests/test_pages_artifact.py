"""Guard the public Pages artifact against accidental repository-wide publishing."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PagesArtifactTests(unittest.TestCase):
    def test_pages_workflow_stages_only_explicit_public_archive_assets(self):
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("mkdir -p dist/src/db/temp dist/src/db/store/MSA dist/src/images/.png", workflow)
        for public_path in (
            "index.html",
            "404.html",
            "robots.txt",
            "LICENSE",
            "src/db/Congress.db",
            "src/db/temp/mass_shootings.db",
            "src/db/store/MSA/Stanford_MSA_Data_Dictionary (V.5).pdf",
            "src/db/store/Abbreviations.sql",
            "src/images/.png/Grades.png",
        ):
            with self.subTest(path=public_path):
                self.assertIn(public_path, workflow)

    def test_pages_artifact_excludes_repository_development_material(self):
        workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("path: dist", workflow)
        for excluded in ("test ! -e dist/.github", "test ! -e dist/tests", "test ! -e dist/README.md"):
            with self.subTest(path=excluded):
                self.assertIn(excluded, workflow)
        self.assertNotIn("with:\n          path: .", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
