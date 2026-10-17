#!/usr/bin/env python3
"""Read-only manifest validator for the standalone Design Viewer Kit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest must be a JSON object")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a design-viewer flow manifest")
    parser.add_argument("--spec", required=True, help="Path to flows.json")
    args = parser.parse_args()
    path = Path(args.spec).expanduser().resolve()
    data = load(path)

    required_lists = ("services", "tables", "flows")
    for key in required_lists:
        if not isinstance(data.get(key), list):
            raise SystemExit(f"invalid manifest: {key} must be an array")

    service_ids = {str(row.get("id", "")) for row in data["services"] if isinstance(row, dict)}
    table_names = {str(row.get("name", "")) for row in data["tables"] if isinstance(row, dict)}
    aliases = {
        str(row.get("name", "")): str(row.get("alias_of", ""))
        for row in data["tables"]
        if isinstance(row, dict) and row.get("name") and row.get("alias_of")
    }
    valid_table_refs = table_names | {target for target in aliases.values() if target}
    flow_ids = [str(row.get("id", "")) for row in data["flows"] if isinstance(row, dict)]
    errors: list[str] = []
    if "" in service_ids or len(service_ids) != len(data["services"]):
        errors.append("services must have unique non-empty id values")
    if "" in table_names or len(table_names) != len(data["tables"]):
        errors.append("tables must have unique non-empty name values")
    if "" in flow_ids or len(set(flow_ids)) != len(flow_ids):
        errors.append("flows must have unique non-empty id values")

    for flow in data["flows"]:
        if not isinstance(flow, dict):
            errors.append("each flow must be an object")
            continue
        flow_id = flow.get("id", "<missing>")
        owner = str(flow.get("owner_service", ""))
        if owner and owner not in service_ids:
            errors.append(f"{flow_id}: unknown owner_service {owner}")
        for table in flow.get("reads", []) or []:
            if table not in valid_table_refs:
                errors.append(f"{flow_id}: unknown read table {table}")
        for write in flow.get("writes", []) or []:
            if not isinstance(write, dict):
                errors.append(f"{flow_id}: write must be an object")
                continue
            if write.get("table") not in valid_table_refs:
                errors.append(f"{flow_id}: unknown write table {write.get('table')}")
            if str(write.get("op", "")).upper() not in {"C", "R", "U", "D"}:
                errors.append(f"{flow_id}: invalid write op {write.get('op')}")

    if errors:
        raise SystemExit("Manifest validation failed:\n- " + "\n- ".join(errors))

    print(
        json.dumps(
            {
                "ok": True,
                "path": str(path),
                "services": len(data["services"]),
                "tables": len(data["tables"]),
                "flows": len(data["flows"]),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
