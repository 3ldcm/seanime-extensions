#!/usr/bin/env python3
"""Validate every */manifest.json against Seanime's own manifest sanity check.

Seanime refuses to install an extension whose manifest violates
`manifestSanityCheck` (internal/extension_repo/utils.go) and answers
"failed sanity check, <reason>" in the UI — e.g. "extension author is too long".

Go measures these strings in BYTES, so a multi-byte character (— … é) counts
for 2 or 3: keep `author` short and ASCII.

Rules enforced (they mirror the Go code, no more, no less):
  - id        present, 3..40 bytes, ^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$
  - name      present, <= 50 bytes
  - author    present, <= 25 bytes
  - version   present, strict semver MAJOR.MINOR.PATCH
  - language  present, one of go | javascript | typescript
  - type      present, one of manga-provider | onlinestream-provider |
              anime-torrent-provider | custom-source | plugin
  - payload   payload or payloadURI present

Usage:  python3 check-manifests.py   (exit code 1 if any manifest is rejected)
"""

import json
import pathlib
import re
import sys

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
EXT_ID = re.compile(r"^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$")
LANGUAGES = {"go", "javascript", "typescript"}
TYPES = {
    "manga-provider",
    "onlinestream-provider",
    "anime-torrent-provider",
    "custom-source",
    "plugin",
}

REQUIRED = ("id", "name", "version", "language", "type", "author")


def byte_len(value: str) -> int:
    return len(value.encode("utf-8"))


def check(path: pathlib.Path) -> list[str]:
    errors: list[str] = []

    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"unreadable manifest: {exc}"]

    missing = [key for key in REQUIRED if not manifest.get(key)]
    if missing:
        errors.append(f"missing required field(s): {', '.join(missing)}")
        return errors

    if not manifest.get("payload") and not manifest.get("payloadURI"):
        errors.append("missing payload and payloadURI")

    ext_id = manifest["id"]
    if not 3 <= byte_len(ext_id) <= 40:
        errors.append(f"id length must be 3..40 bytes (got {byte_len(ext_id)})")
    elif not EXT_ID.match(ext_id):
        errors.append("id must start with a letter and contain only [a-zA-Z0-9-] (alphanumeric at the end)")

    name = manifest["name"]
    if byte_len(name) > 50:
        errors.append(f"extension name is too long: {byte_len(name)} bytes > 50")

    author = manifest["author"]
    if byte_len(author) > 25:
        errors.append(f"extension author is too long: {byte_len(author)} bytes > 25 — {author!r}")

    if not SEMVER.match(manifest["version"]):
        errors.append(f"invalid version (strict MAJOR.MINOR.PATCH expected): {manifest['version']!r}")

    if manifest["language"] not in LANGUAGES:
        errors.append(f"unsupported language: {manifest['language']!r}")

    if manifest["type"] not in TYPES:
        errors.append(f"unsupported extension type: {manifest['type']!r}")

    return errors


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent
    manifests = sorted(root.glob("*/manifest.json"))
    if not manifests:
        print("no */manifest.json found")
        return 1

    failed = 0
    for path in manifests:
        errors = check(path)
        rel = path.relative_to(root)
        if errors:
            failed += 1
            print(f"KO   {rel}")
            for error in errors:
                print(f"       {error}")
        else:
            print(f"ok   {rel}")

    print(f"\n{len(manifests) - failed}/{len(manifests)} manifeste(s) valide(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())