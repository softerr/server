#!/usr/bin/env python3
"""Check media backup verification against real TAR contents."""

import hashlib
import pathlib
import sys
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "lib"))
from verify_media_archive import verify  # noqa: E402


class MediaArchiveTests(unittest.TestCase):
    def test_archive_contains_database_referenced_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary)
            root = base / "media"
            contents = b"example image bytes"
            digest = hashlib.sha256(contents).hexdigest()
            image = root / "images" / digest[:2] / digest
            image.parent.mkdir(parents=True)
            image.write_bytes(contents)
            for kind in ("thumbnails", "audio", "files"):
                (root / kind).mkdir()
            public_contents = b"public document bytes"
            public_digest = hashlib.sha256(public_contents).hexdigest()
            public_file = root / "files" / public_digest[:2] / public_digest
            public_file.parent.mkdir(parents=True)
            public_file.write_bytes(public_contents)
            manifest = base / "manifest"
            manifest.write_text(
                f"images|{digest}|{len(contents)}\nfiles|{public_digest}|{len(public_contents)}\n"
            )
            archive = base / "media.tar"
            with tarfile.open(archive, "w") as tar:
                for kind in ("images", "thumbnails", "audio", "files"):
                    tar.add(root / kind, arcname=kind)

            self.assertEqual(verify(str(archive), str(root), str(manifest)), 2)

            image.write_bytes(b"corrupt image bytes")
            with self.assertRaises(ValueError):
                verify(str(archive), str(root), str(manifest))

            image.unlink()
            with self.assertRaises(ValueError):
                verify(str(archive), str(root), str(manifest))

            image.write_bytes(contents)
            public_file.unlink()
            with self.assertRaises(ValueError):
                verify(str(archive), str(root), str(manifest))
            public_file.write_bytes(public_contents)
            with tarfile.open(archive, "w") as tar:
                for kind in ("thumbnails", "audio", "files"):
                    tar.add(root / kind, arcname=kind)
            with self.assertRaisesRegex(ValueError, "missing database-referenced files"):
                verify(str(archive), str(root), str(manifest))


if __name__ == "__main__":
    unittest.main()
