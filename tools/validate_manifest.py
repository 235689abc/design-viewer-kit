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


def string_list(value: object, label: str, errors: list[str], *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list):
        errors.append(f"{label} must be an array")
        return []
    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{label}[{index}] must be a non-empty string")
            continue
        result.append(item.strip())
    if not allow_empty and not result:
        errors.append(f"{label} must not be empty")
    if len(result) != len(set(result)):
        errors.append(f"{label} must not contain duplicate columns")
    return result


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

    errors: list[str] = []
    datastores = data.get("datastores", [])
    if not isinstance(datastores, list):
        errors.append("datastores must be an array when present")
        datastores = []

    service_ids = {str(row.get("id", "")) for row in data["services"] if isinstance(row, dict)}
    datastore_ids = {str(row.get("id", "")) for row in datastores if isinstance(row, dict)}
    table_names = {str(row.get("name", "")) for row in data["tables"] if isinstance(row, dict)}
    aliases = {
        str(row.get("name", "")): str(row.get("alias_of", ""))
        for row in data["tables"]
        if isinstance(row, dict) and row.get("name") and row.get("alias_of")
    }
    valid_table_refs = table_names | {target for target in aliases.values() if target}
    flow_ids = [str(row.get("id", "")) for row in data["flows"] if isinstance(row, dict)]
    if "" in service_ids or len(service_ids) != len(data["services"]):
        errors.append("services must have unique non-empty id values")
    if "" in datastore_ids or len(datastore_ids) != len(datastores):
        errors.append("datastores must have unique non-empty id values")
    if "" in table_names or len(table_names) != len(data["tables"]):
        errors.append("tables must have unique non-empty name values")
    if "" in flow_ids or len(set(flow_ids)) != len(flow_ids):
        errors.append("flows must have unique non-empty id values")

    for datastore in datastores:
        if not isinstance(datastore, dict):
            errors.append("each datastore must be an object")
            continue
        datastore_id = str(datastore.get("id", "")).strip() or "<missing-datastore-id>"
        if not str(datastore.get("name", "")).strip():
            errors.append(f"{datastore_id}: datastore name must be non-empty")
        if not str(datastore.get("engine", "")).strip():
            errors.append(f"{datastore_id}: datastore engine must be non-empty")

    column_names_by_table: dict[str, set[str]] = {}
    pending_foreign_keys: list[tuple[str, int, list[str], str, list[str]]] = []
    for table in data["tables"]:
        if not isinstance(table, dict):
            errors.append("each table must be an object")
            continue
        table_name = str(table.get("name", "")).strip() or "<missing-table-name>"
        datastore_id = str(table.get("datastore_id", "")).strip()
        if datastore_id and datastore_id not in datastore_ids:
            errors.append(f"{table_name}: unknown datastore_id {datastore_id}")

        columns = table.get("columns", []) or []
        if not isinstance(columns, list):
            errors.append(f"{table_name}: columns must be an array")
            columns = []
        column_names: list[str] = []
        for index, column in enumerate(columns):
            if not isinstance(column, dict):
                errors.append(f"{table_name}: columns[{index}] must be an object")
                continue
            column_name = str(column.get("name", "")).strip()
            column_type = str(column.get("type", "")).strip()
            if not column_name:
                errors.append(f"{table_name}: columns[{index}].name must be non-empty")
            else:
                column_names.append(column_name)
            if not column_type:
                errors.append(f"{table_name}: columns[{index}].type must be non-empty")
            for flag in ("nullable", "primary_key", "unique"):
                if flag in column and not isinstance(column.get(flag), bool):
                    errors.append(f"{table_name}.{column_name or index}: {flag} must be boolean")
        if len(column_names) != len(set(column_names)):
            errors.append(f"{table_name}: columns must have unique names")
        column_names_by_table[table_name] = set(column_names)

        if "primary_key" in table:
            primary_key = string_list(table.get("primary_key"), f"{table_name}.primary_key", errors)
            for column_name in primary_key:
                if column_name not in column_names_by_table[table_name]:
                    errors.append(f"{table_name}: primary_key references unknown column {column_name}")

        foreign_keys = table.get("foreign_keys", []) or []
        if not isinstance(foreign_keys, list):
            errors.append(f"{table_name}: foreign_keys must be an array")
            foreign_keys = []
        foreign_key_names: set[str] = set()
        for index, foreign_key in enumerate(foreign_keys):
            label = f"{table_name}.foreign_keys[{index}]"
            if not isinstance(foreign_key, dict):
                errors.append(f"{label} must be an object")
                continue
            local_columns = string_list(foreign_key.get("columns"), f"{label}.columns", errors)
            references_table = str(foreign_key.get("references_table", "")).strip()
            references_columns = string_list(
                foreign_key.get("references_columns"),
                f"{label}.references_columns",
                errors,
            )
            if not references_table:
                errors.append(f"{label}.references_table must be non-empty")
            if len(local_columns) != len(references_columns):
                errors.append(f"{label}: columns and references_columns must have equal length")
            for column_name in local_columns:
                if column_name not in column_names_by_table[table_name]:
                    errors.append(f"{label}: unknown local column {column_name}")
            constraint_name = str(foreign_key.get("name", "")).strip()
            if constraint_name:
                if constraint_name in foreign_key_names:
                    errors.append(f"{table_name}: duplicate foreign key name {constraint_name}")
                foreign_key_names.add(constraint_name)
            pending_foreign_keys.append(
                (table_name, index, local_columns, references_table, references_columns)
            )

        indexes = table.get("indexes", []) or []
        if not isinstance(indexes, list):
            errors.append(f"{table_name}: indexes must be an array")
            indexes = []
        index_names: set[str] = set()
        for index, table_index in enumerate(indexes):
            label = f"{table_name}.indexes[{index}]"
            if not isinstance(table_index, dict):
                errors.append(f"{label} must be an object")
                continue
            index_name = str(table_index.get("name", "")).strip()
            if not index_name:
                errors.append(f"{label}.name must be non-empty")
            elif index_name in index_names:
                errors.append(f"{table_name}: duplicate index name {index_name}")
            else:
                index_names.add(index_name)
            index_columns = string_list(table_index.get("columns"), f"{label}.columns", errors)
            for column_name in index_columns:
                if column_name not in column_names_by_table[table_name]:
                    errors.append(f"{label}: unknown column {column_name}")
            if "unique" in table_index and not isinstance(table_index.get("unique"), bool):
                errors.append(f"{label}.unique must be boolean")

    for table_name, index, _local_columns, references_table, references_columns in pending_foreign_keys:
        label = f"{table_name}.foreign_keys[{index}]"
        if references_table not in table_names:
            errors.append(f"{label}: unknown references_table {references_table}")
            continue
        referenced_columns = column_names_by_table.get(references_table, set())
        for column_name in references_columns:
            if column_name not in referenced_columns:
                errors.append(f"{label}: unknown referenced column {references_table}.{column_name}")

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
