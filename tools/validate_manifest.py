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

    def check_issues(holder: dict, holder_label: str) -> None:
        issues = holder.get("issues")
        if issues is None:
            return
        if not isinstance(issues, list):
            errors.append(f"{holder_label}: issues must be an array")
            return
        for index, issue in enumerate(issues):
            if not isinstance(issue, dict):
                errors.append(f"{holder_label}: issues[{index}] must be an object")
                continue
            ref = issue.get("ref")
            if not isinstance(ref, str) or not ref.strip():
                errors.append(f"{holder_label}: issues[{index}].ref must be a non-empty string")
            if str(issue.get("severity", "")) not in {"red", "yellow", "green", "info"}:
                errors.append(
                    f"{holder_label}: issues[{index}].severity must be red|yellow|green|info"
                )
            # status 立案三态:缺省合法(视为 filed 已立案未复核)
            if issue.get("status") is not None and str(issue.get("status")) not in {
                "filed",
                "confirmed",
                "refuted",
            }:
                errors.append(
                    f"{holder_label}: issues[{index}].status must be filed|confirmed|refuted"
                )

    for table_row in data["tables"]:
        if isinstance(table_row, dict) and table_row.get("name"):
            check_issues(table_row, str(table_row["name"]))

    for service_row in data["services"]:
        if not isinstance(service_row, dict):
            continue
        svc_id = str(service_row.get("id", "") or "<missing>")
        ops = service_row.get("ops")
        if ops is None:
            continue
        if not isinstance(ops, dict):
            errors.append(f"{svc_id}: ops must be an object")
            continue
        for ops_key in ("port", "health", "deploy"):
            if ops_key in ops and not isinstance(ops[ops_key], str):
                errors.append(f"{svc_id}: ops.{ops_key} must be a string")

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
        check_issues(flow, str(flow_id))

    features = data.get("features")
    if features is not None:
        if not isinstance(features, list):
            errors.append("features must be an array")
        else:
            flow_id_set = set(flow_ids)
            feature_ids = [
                str(row.get("id", "")) for row in features if isinstance(row, dict)
            ]
            if "" in feature_ids or len(set(feature_ids)) != len(feature_ids):
                errors.append("features must have unique non-empty id values")
            for feature in features:
                if not isinstance(feature, dict):
                    errors.append("each feature must be an object")
                    continue
                feature_id = str(feature.get("id", "<missing>"))
                for ref in feature.get("flows", []) or []:
                    if ref not in flow_id_set:
                        errors.append(f"{feature_id}: unknown flow ref {ref}")
                check_issues(feature, feature_id)

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
