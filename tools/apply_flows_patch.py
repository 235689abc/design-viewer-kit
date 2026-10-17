#!/usr/bin/env python3
"""Apply flow scaffold patch into docs/diagrams/flows.json (idempotent) and regenerate diagrams."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path.cwd().resolve()
FLOWS_SPEC_PATH = ROOT / "docs" / "diagrams" / "flows.json"
INDEX_JSON_PATH = ROOT / "apps" / "web" / "public" / "data" / "index.json"
GEN_CMD = [sys.executable, str(ROOT / "tools" / "gen_diagrams.py")]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, data: Any):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def merge_unique_list(values: list[Any]) -> list[Any]:
    out: list[Any] = []
    seen = set()
    for item in values:
        key = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def merge_row(existing: dict[str, Any], incoming: dict[str, Any], force: bool) -> tuple[dict[str, Any], bool]:
    merged = dict(existing)
    changed = False

    for key, value in incoming.items():
        if key not in merged:
            merged[key] = value
            changed = True
            continue

        current = merged[key]
        if force:
            if current != value:
                merged[key] = value
                changed = True
            continue

        if isinstance(current, list) and isinstance(value, list):
            joined = merge_unique_list(current + value)
            if joined != current:
                merged[key] = joined
                changed = True
            continue

        if isinstance(current, dict) and isinstance(value, dict):
            nested = dict(current)
            nested_changed = False
            for nk, nv in value.items():
                if nk not in nested or is_missing(nested[nk]):
                    nested[nk] = nv
                    nested_changed = True
            if nested_changed:
                merged[key] = nested
                changed = True
            continue

        if is_missing(current) and not is_missing(value):
            merged[key] = value
            changed = True

    return merged, changed


def upsert_by_key(
    items: list[dict[str, Any]],
    incoming_rows: list[dict[str, Any]],
    key_field: str,
    force: bool,
) -> dict[str, int]:
    index = {
        str(row.get(key_field, "")).strip(): idx
        for idx, row in enumerate(items)
        if isinstance(row, dict) and str(row.get(key_field, "")).strip()
    }
    stats = {"added": 0, "updated": 0, "unchanged": 0}

    for row in incoming_rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get(key_field, "")).strip()
        if not key:
            continue
        if key not in index:
            items.append(dict(row))
            index[key] = len(items) - 1
            stats["added"] += 1
            continue

        idx = index[key]
        merged, changed = merge_row(items[idx], row, force=force)
        items[idx] = merged
        if changed:
            stats["updated"] += 1
        else:
            stats["unchanged"] += 1

    return stats


def apply_patch(spec: dict[str, Any], patch: dict[str, Any], force: bool) -> dict[str, int]:
    spec.setdefault("services", [])
    spec.setdefault("tables", [])
    spec.setdefault("flows", [])

    services_add = patch.get("services_add", []) if isinstance(patch.get("services_add", []), list) else []
    tables_add = patch.get("tables_add", []) if isinstance(patch.get("tables_add", []), list) else []
    flows_add = patch.get("flows_add", []) if isinstance(patch.get("flows_add", []), list) else []

    service_stats = upsert_by_key(spec["services"], services_add, "id", force=force)
    table_stats = upsert_by_key(spec["tables"], tables_add, "name", force=force)
    flow_stats = upsert_by_key(spec["flows"], flows_add, "id", force=force)

    return {
        "services_added": service_stats["added"],
        "services_updated": service_stats["updated"],
        "services_unchanged": service_stats["unchanged"],
        "tables_added": table_stats["added"],
        "tables_updated": table_stats["updated"],
        "tables_unchanged": table_stats["unchanged"],
        "flows_added": flow_stats["added"],
        "flows_updated": flow_stats["updated"],
        "flows_unchanged": flow_stats["unchanged"],
    }


def validate_index_json() -> None:
    _ = load_json(INDEX_JSON_PATH)


def main():
    parser = argparse.ArgumentParser(description="Apply a flow manifest patch (dry-run unless --apply)")
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--patch", required=True, help="Path to flows_patch.json")
    parser.add_argument("--spec", default="", help="Flow manifest JSON (default: <root>/docs/diagrams/flows.json)")
    parser.add_argument("--index", default="", help="Viewer index JSON (default: <root>/apps/web/public/data/index.json)")
    parser.add_argument("--generator", default="", help="Generator script (default: <root>/tools/gen_diagrams.py)")
    parser.add_argument("--no-generate", action="store_true", help="Do not regenerate diagrams/index after applying")
    parser.add_argument("--apply", action="store_true", help="Write the patch; without this flag only preview the diff")
    parser.add_argument("--force", action="store_true", help="Allow overriding existing non-empty fields")
    args = parser.parse_args()

    global ROOT, FLOWS_SPEC_PATH, INDEX_JSON_PATH, GEN_CMD
    ROOT = Path(args.root).expanduser().resolve()
    FLOWS_SPEC_PATH = (
        Path(args.spec).expanduser().resolve()
        if args.spec and Path(args.spec).expanduser().is_absolute()
        else ROOT / (args.spec or "docs/diagrams/flows.json")
    )
    INDEX_JSON_PATH = (
        Path(args.index).expanduser().resolve()
        if args.index and Path(args.index).expanduser().is_absolute()
        else ROOT / (args.index or "apps/web/public/data/index.json")
    )
    generator = (
        Path(args.generator).expanduser().resolve()
        if args.generator and Path(args.generator).expanduser().is_absolute()
        else ROOT / (args.generator or "tools/gen_diagrams.py")
    )
    GEN_CMD = [sys.executable, str(generator)]

    patch_path = Path(args.patch).expanduser()
    if not patch_path.is_absolute():
        patch_path = (ROOT / patch_path).resolve()
    if not patch_path.exists():
        raise SystemExit(f"patch file not found: {patch_path}")

    spec = load_json(FLOWS_SPEC_PATH)
    patch = load_json(patch_path)

    summary = apply_patch(spec, patch, force=args.force)
    if not args.apply:
        print("DRY RUN: no files changed; pass --apply to write the manifest")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    dump_json(FLOWS_SPEC_PATH, spec)

    print(f"OK: applied patch {patch_path.relative_to(ROOT)}", flush=True)
    print("Summary:", flush=True)
    for key in sorted(summary):
        print(f"  - {key}: {summary[key]}", flush=True)

    if not args.no_generate:
        print(f"Running generator: {sys.executable} {generator}", flush=True)
        subprocess.run(GEN_CMD, cwd=ROOT, check=True)

        if INDEX_JSON_PATH.exists():
            validate_index_json()
            print(f"OK: validated {INDEX_JSON_PATH.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
