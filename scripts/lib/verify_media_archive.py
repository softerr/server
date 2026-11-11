#!/usr/bin/env python3
"""Check that a media TAR can be read and matches the immutable source files."""

import hashlib
import os
import re
import sys
import tarfile


def verify(archive: str, root: str, manifest: str) -> int:
    expected = {}
    with open(manifest, encoding="utf-8") as source:
        for line in source:
            kind, digest, size = line.rstrip("\n").split("|")
            if kind not in ("images", "audio") or not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError("Invalid media backup manifest")
            path = f"{kind}/{digest[:2]}/{digest}"
            size = int(size)
            if path in expected and expected[path] != size:
                raise ValueError(f"Conflicting media metadata: {path}")
            expected[path] = size

    seen = set()
    with tarfile.open(archive, "r:") as stored:
        for member in stored:
            if member.isdir():
                continue
            if not member.isfile() or not re.fullmatch(
                r"(images|thumbnails|audio)/[a-f0-9]{2}/[a-f0-9]{64}", member.name
            ):
                raise ValueError(f"Invalid media backup entry: {member.name}")
            path = os.path.join(root, member.name)
            if not os.path.isfile(path) or os.path.getsize(path) != member.size:
                raise ValueError(f"Media backup differs from source: {member.name}")
            source_hash = hashlib.sha256()
            archive_hash = hashlib.sha256()
            with open(path, "rb") as source, stored.extractfile(member) as copied:
                while True:
                    source_chunk = source.read(1024 * 1024)
                    copied_chunk = copied.read(1024 * 1024)
                    if not source_chunk and not copied_chunk:
                        break
                    source_hash.update(source_chunk)
                    archive_hash.update(copied_chunk)
            if source_hash.digest() != archive_hash.digest():
                raise ValueError(f"Media backup content mismatch: {member.name}")
            if member.name.split("/")[0] in ("images", "audio"):
                if source_hash.hexdigest() != os.path.basename(member.name):
                    raise ValueError(f"Media file hash mismatch: {member.name}")
            if member.name in expected and member.size != expected[member.name]:
                raise ValueError(f"Media backup size mismatch: {member.name}")
            seen.add(member.name)
    if not expected.keys() <= seen:
        raise ValueError("Media backup is missing database-referenced files")
    return len(seen)


if __name__ == "__main__":
    try:
        count = verify(*sys.argv[1:])
    except (OSError, ValueError, tarfile.TarError) as error:
        raise SystemExit(str(error)) from error
    print(f"Checked {count} media files in archive.")
