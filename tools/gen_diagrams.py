from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

ROOT = Path.cwd().resolve()
DEFAULT_SPEC_PATH = ROOT / "docs" / "diagrams" / "flows.json"
DEFAULT_OUT_DIR = ROOT / "docs" / "diagrams" / "generated"
DEFAULT_INDEX_PATH = ROOT / "apps" / "web" / "public" / "data" / "index.json"
MERMAID_BLOCK_RE = re.compile(r"```mermaid\s*\n(.*?)\n```", re.DOTALL)
DEFAULT_HISTORY_KEEP_LIMIT = 50

OP_ORDER = ["C", "R", "U", "D"]
SCHEMA_LABELS = {
    "public": "public / 公共",
    "core": "core / 核心",
    "domain": "domain / 领域",
    "integration": "integration / 集成",
}

@dataclass
class GenConfig:
    project: str
    spec_path: Path
    out_dir: Path
    flows_dir: Path
    index_path: Path
    history_dir: Path
    history_manifest_path: Path
    source_flows_json: str
    source_generated_dir: str
    skip_history: bool
    history_keep_limit: int
    meta_root: Path


def resolve_path(raw: str, base_dir: Path) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def parse_bool(value, default=False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return default


def path_display(path: Path) -> str:
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def path_meta(path: Path, base_dir: Path | None = None) -> str:
    base = (base_dir or ROOT).resolve()
    try:
        return str(path.resolve().relative_to(base))
    except ValueError:
        # Never put an absolute local filesystem path in a portable index.
        return path.name


def load_user_config(config_path: Path | None) -> tuple[dict, Path]:
    if config_path is None:
        return {}, Path.cwd()

    resolved = resolve_path(str(config_path), Path.cwd())
    with resolved.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    if not isinstance(payload, dict):
        raise ValueError(f"config must be a JSON object: {resolved}")

    return payload, resolved.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate diagrams and design-viewer index from flows.json"
    )
    parser.add_argument(
        "--config",
        help="Path to design-viewer config JSON (e.g. design-viewer.config.json)",
    )
    parser.add_argument("--project", help="Project name for index.json meta.project")
    parser.add_argument("--spec", help="Path to flows.json")
    parser.add_argument("--out-generated", help="Output dir for generated markdown diagrams")
    parser.add_argument("--out-index", help="Output path for design-viewer index.json")
    parser.add_argument("--history-dir", help="Output dir for index history snapshots")
    parser.add_argument("--history-manifest", help="Output path for history manifest.json")
    parser.add_argument("--source-flows-json", help="meta.source_flows_json value")
    parser.add_argument("--source-generated-dir", help="meta.source_generated_dir value")
    parser.add_argument("--skip-history", action="store_true", help="Disable history snapshot")
    parser.add_argument(
        "--history-keep-limit",
        type=int,
        help="Max history snapshots retained (default 50)",
    )
    return parser.parse_args()


def build_config(args: argparse.Namespace) -> GenConfig:
    raw_config, config_base_dir = load_user_config(Path(args.config) if args.config else None)

    project = (
        args.project
        or raw_config.get("project")
        or raw_config.get("metaProject")
        or ROOT.name
    )

    if args.spec:
        spec_path = resolve_path(args.spec, Path.cwd())
    elif raw_config.get("spec"):
        spec_path = resolve_path(str(raw_config["spec"]), config_base_dir)
    else:
        spec_path = DEFAULT_SPEC_PATH

    if args.out_generated:
        out_dir = resolve_path(args.out_generated, Path.cwd())
    elif raw_config.get("generatedDir"):
        out_dir = resolve_path(str(raw_config["generatedDir"]), config_base_dir)
    else:
        out_dir = DEFAULT_OUT_DIR

    if args.out_index:
        index_path = resolve_path(args.out_index, Path.cwd())
    elif raw_config.get("indexOut"):
        index_path = resolve_path(str(raw_config["indexOut"]), config_base_dir)
    else:
        index_path = DEFAULT_INDEX_PATH

    if args.history_dir:
        history_dir = resolve_path(args.history_dir, Path.cwd())
    elif raw_config.get("historyDir"):
        history_dir = resolve_path(str(raw_config["historyDir"]), config_base_dir)
    else:
        history_dir = index_path.parent / "history"

    if args.history_manifest:
        history_manifest_path = resolve_path(args.history_manifest, Path.cwd())
    elif raw_config.get("historyManifest"):
        history_manifest_path = resolve_path(
            str(raw_config["historyManifest"]), config_base_dir
        )
    else:
        history_manifest_path = history_dir / "manifest.json"

    meta_root = config_base_dir if args.config else ROOT
    source_flows_json = (
        args.source_flows_json
        or raw_config.get("sourceFlowsJson")
        or path_meta(spec_path, meta_root)
    )
    source_generated_dir = (
        args.source_generated_dir
        or raw_config.get("sourceGeneratedDir")
        or path_meta(out_dir, meta_root)
    )

    skip_history = (
        args.skip_history
        or parse_bool(raw_config.get("skipHistory"), default=False)
        or os.getenv("DESIGN_VIEWER_SKIP_HISTORY") == "1"
    )

    history_keep_limit = args.history_keep_limit
    if history_keep_limit is None:
        cfg_keep = raw_config.get("historyKeepLimit")
        if cfg_keep is None:
            cfg_keep = raw_config.get("history_keep_limit")
        if cfg_keep is None:
            history_keep_limit = DEFAULT_HISTORY_KEEP_LIMIT
        else:
            history_keep_limit = int(cfg_keep)
    history_keep_limit = max(1, int(history_keep_limit))

    return GenConfig(
        project=str(project),
        spec_path=spec_path,
        out_dir=out_dir,
        flows_dir=out_dir / "flows",
        index_path=index_path,
        history_dir=history_dir,
        history_manifest_path=history_manifest_path,
        source_flows_json=str(source_flows_json),
        source_generated_dir=str(source_generated_dir),
        skip_history=skip_history,
        history_keep_limit=history_keep_limit,
        meta_root=meta_root.resolve(),
    )


def stable_generated_at(spec_path: Path) -> str:
    # Keep timestamp stable across repeated regen runs unless flows.json changes.
    return datetime.fromtimestamp(
        spec_path.stat().st_mtime,
        timezone.utc,
    ).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def load_spec(spec_path: Path):
    with spec_path.open("r", encoding="utf-8") as f:
        return json.load(f)

def ensure_dirs(out_dir: Path, flows_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    flows_dir.mkdir(parents=True, exist_ok=True)

def schema_of(table_name: str) -> str:
    return table_name.split(".", 1)[0] if "." in table_name else "public"

def alias_map(spec):
    amap = {}
    for t in spec.get("tables", []):
        name = t.get("name")
        alias_of = t.get("alias_of")
        if isinstance(name, str) and isinstance(alias_of, str) and alias_of:
            amap[name] = alias_of
    return amap

def canonical_table(name: str, amap: dict) -> str:
    table = name
    seen = set()
    while table in amap and table not in seen:
        seen.add(table)
        table = amap[table]
    return table

def visible_tables(spec):
    return [t["name"] for t in spec.get("tables", []) if not t.get("alias_of")]

def service_index(spec):
    return {s.get("id"): s for s in spec.get("services", []) if s.get("id")}

def table_index(spec):
    return {t.get("name"): t for t in spec.get("tables", []) if t.get("name")}

def dual_text(en: str, zh: str) -> str:
    en = en or "-"
    zh = zh or en
    return f"{en} / {zh}"

def service_name_pair(service_id: str, services: dict):
    svc = services.get(service_id, {})
    base = svc.get("name") or service_id
    en = svc.get("name_en") or base
    zh = svc.get("name_zh") or base
    return en, zh

def flow_name_pair(flow: dict):
    base = flow.get("name") or flow.get("id", "")
    en = flow.get("name_en") or base
    zh = flow.get("name_zh") or base
    return en, zh

def table_name_pair(table_name: str, table_meta: dict):
    meta = table_meta.get(table_name, {})
    en = meta.get("label_en") or table_name
    zh = meta.get("label_zh") or en
    return en, zh

def table_header_label(table_name: str, table_meta: dict) -> str:
    en, zh = table_name_pair(table_name, table_meta)
    if en == zh:
        return en
    return dual_text(en, zh)

def node_label_with_top(top: str, en: str, zh: str) -> str:
    if en == zh and top == en:
        return top
    if en == zh:
        return f"{top}<br/>{en}"
    return f"{top}<br/>{dual_text(en, zh)}"

def mermaid_escape(text: str) -> str:
    return text.replace('"', '\\"')

def database_entity_id(table_name: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]", "_", table_name)
    return "T_" + (normalized or "table")

def database_entity_ids(tables) -> dict[str, str]:
    result = {}
    used = set()
    for table in tables:
        table_name = str(table.get("name", ""))
        base = database_entity_id(table_name)
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        used.add(candidate)
        result[table_name] = candidate
    return result

def database_attribute_id(column_name: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]", "_", column_name)
    if not normalized:
        return "column"
    return "c_" + normalized if normalized[0].isdigit() else normalized

def database_type_name(column_type: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_\[\]]", "_", str(column_type).strip())
    if not normalized:
        return "unknown"
    if normalized[0].isdigit():
        return "type_" + normalized
    return normalized

def database_tables(spec):
    return [
        table
        for table in spec.get("tables", [])
        if isinstance(table, dict)
        and not table.get("alias_of")
        and isinstance(table.get("columns"), list)
        and len(table.get("columns", [])) > 0
    ]

def build_database_mermaid(spec) -> str:
    tables = database_tables(spec)
    table_names = {str(table.get("name", "")) for table in tables}
    entity_ids = database_entity_ids(tables)
    lines = ["erDiagram"]

    for table in tables:
        table_name = str(table.get("name", ""))
        entity_id = entity_ids[table_name]
        primary_key = {
            str(column_name)
            for column_name in table.get("primary_key", [])
            if isinstance(column_name, str)
        }
        foreign_key_columns = {
            str(column_name)
            for foreign_key in table.get("foreign_keys", [])
            if isinstance(foreign_key, dict)
            for column_name in foreign_key.get("columns", [])
            if isinstance(column_name, str)
        }
        single_column_unique_indexes = {
            str(table_index["columns"][0])
            for table_index in table.get("indexes", [])
            if isinstance(table_index, dict)
            and table_index.get("unique") is True
            and isinstance(table_index.get("columns"), list)
            and len(table_index["columns"]) == 1
            and isinstance(table_index["columns"][0], str)
        }
        lines.append(f"  {entity_id} {{")
        for column in table.get("columns", []):
            if not isinstance(column, dict):
                continue
            column_name = str(column.get("name", ""))
            if not column_name:
                continue
            keys = []
            if column.get("primary_key") is True or column_name in primary_key:
                keys.append("PK")
            if column_name in foreign_key_columns:
                keys.append("FK")
            if column.get("unique") is True or column_name in single_column_unique_indexes:
                keys.append("UK")
            key_suffix = f" {','.join(keys)}" if keys else ""
            notes = []
            if column.get("nullable") is False:
                notes.append("NOT NULL")
            if column.get("default") not in (None, ""):
                notes.append(f"DEFAULT {column.get('default')}")
            if column.get("notes"):
                notes.append(str(column.get("notes")))
            comment = f' "{mermaid_escape("; ".join(notes))}"' if notes else ""
            lines.append(
                f"    {database_type_name(str(column.get('type', 'unknown')))} "
                f"{database_attribute_id(column_name)}{key_suffix}{comment}"
            )
        lines.append("  }")

    for table in tables:
        table_name = str(table.get("name", ""))
        columns_by_name = {
            str(column.get("name", "")): column
            for column in table.get("columns", [])
            if isinstance(column, dict) and column.get("name")
        }
        for foreign_key in table.get("foreign_keys", []):
            if not isinstance(foreign_key, dict):
                continue
            referenced_table = str(foreign_key.get("references_table", ""))
            local_columns = [
                str(column_name)
                for column_name in foreign_key.get("columns", [])
                if isinstance(column_name, str)
            ]
            if referenced_table not in table_names or not local_columns:
                continue
            required = all(
                columns_by_name.get(column_name, {}).get("nullable") is False
                for column_name in local_columns
            )
            parent_cardinality = "||" if required else "o|"
            relation_label = str(foreign_key.get("name", "")).strip() or ",".join(local_columns)
            lines.append(
                f"  {entity_ids[referenced_table]} {parent_cardinality}--o{{ "
                f"{entity_ids[table_name]} : \"{mermaid_escape(relation_label)}\""
            )

    return "\n".join(lines) + "\n"

def build_database_schema_doc(spec) -> str:
    tables = database_tables(spec)
    foreign_key_count = sum(
        len(table.get("foreign_keys", []))
        for table in tables
        if isinstance(table.get("foreign_keys", []), list)
    )
    return (
        "# Database Schema / 数据库结构\n\n"
        f"> Tables / 数据表: {len(tables)}; Foreign keys / 外键: {foreign_key_count}.\n\n"
        "```mermaid\n"
        f"{build_database_mermaid(spec)}"
        "```\n"
    )

def validate(spec):
    tnames = [t["name"] for t in spec.get("tables", [])]
    if len(tnames) != len(set(tnames)):
        dup = [x for x in set(tnames) if tnames.count(x) > 1]
        raise ValueError(f"Duplicate table names: {dup}")

    fids = [f["id"] for f in spec.get("flows", [])]
    if len(fids) != len(set(fids)):
        dup = [x for x in set(fids) if fids.count(x) > 1]
        raise ValueError(f"Duplicate flow ids: {dup}")

    service_ids = {
        str(service.get("id", "")).strip()
        for service in spec.get("services", [])
        if isinstance(service, dict)
    }
    table_names = set(tnames)
    aliases = alias_map(spec)
    valid_tables = table_names | set(aliases.values())
    valid_ops = {"C", "R", "U", "D"}
    errors = []
    for flow in spec.get("flows", []):
        flow_id = str(flow.get("id", "")).strip() or "<missing-flow-id>"
        owner = str(flow.get("owner_service", "")).strip()
        if owner and owner not in service_ids:
            errors.append(f"{flow_id}: unknown owner_service {owner}")
        for table in flow.get("reads", []) or []:
            if table not in valid_tables:
                errors.append(f"{flow_id}: unknown read table {table}")
        for write in flow.get("writes", []) or []:
            if not isinstance(write, dict):
                errors.append(f"{flow_id}: write must be an object")
                continue
            table = write.get("table")
            op = str(write.get("op", "")).upper()
            if table not in valid_tables:
                errors.append(f"{flow_id}: unknown write table {table}")
            if op not in valid_ops:
                errors.append(f"{flow_id}: invalid write op {op}")
    if errors:
        raise ValueError("Manifest validation failed:\n- " + "\n- ".join(errors))

def build_crud_matrix(spec):
    tables = visible_tables(spec)
    table_set = set(tables)
    amap = alias_map(spec)
    flows = spec.get("flows", [])
    table_meta = table_index(spec)
    services = service_index(spec)

    cell_ops = defaultdict(set)

    for fl in flows:
        fid = fl["id"]
        for t in fl.get("reads", []):
            tc = canonical_table(t, amap)
            if tc in table_set:
                cell_ops[(fid, tc)].add("R")
        for w in fl.get("writes", []):
            tc = canonical_table(w["table"], amap)
            if tc in table_set:
                cell_ops[(fid, tc)].add(w["op"])

    lines = []
    lines.append("# CRUD Matrix（Flow × Table） / CRUD 矩阵（流程 × 数据表）\n")
    lines.append("> 说明：每个格子是该 Flow 对该表的操作集合：C/R/U/D。")
    lines.append("> Note: each cell shows operations by the flow: C/R/U/D.\n")

    header = ["Flow ID", "Name (EN / 中文)", "Owner (EN / 中文)"] + [table_header_label(t, table_meta) for t in tables]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("|" + "|".join(["---"] * len(header)) + "|")

    for fl in flows:
        fid = fl["id"]
        name_en, name_zh = flow_name_pair(fl)
        owner_service = fl.get("owner_service", "")
        owner_en, owner_zh = service_name_pair(owner_service, services)
        row = [fid, dual_text(name_en, name_zh), dual_text(owner_en, owner_zh)]
        for t in tables:
            ops = cell_ops.get((fid, t), set())
            cell = "".join([op for op in OP_ORDER if op in ops]) if ops else "-"
            row.append(cell)
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines) + "\n"

def safe_id(name: str) -> str:
    out = []
    for ch in name:
        if ch.isalnum():
            out.append(ch)
        else:
            out.append("_")
    return "N_" + "".join(out)

def build_l0_system_map(spec):
    tables = visible_tables(spec)
    table_set = set(tables)
    amap = alias_map(spec)
    services = service_index(spec)
    table_meta = table_index(spec)
    by_schema = defaultdict(list)
    for t in tables:
        by_schema[schema_of(t)].append(t)

    svc_writes = defaultdict(set)
    for fl in spec.get("flows", []):
        svc = fl.get("owner_service", "unknown")
        for w in fl.get("writes", []):
            tc = canonical_table(w["table"], amap)
            if tc in table_set:
                svc_writes[svc].add(schema_of(tc))

    lines = []
    lines.append("# L0 System Map（自动生成） / L0 系统地图（自动生成）\n")
    lines.append("```mermaid")
    lines.append("graph TB")
    lines.append("")
    lines.append("  %% Services / 服务")
    lines.append('  subgraph S["Services / 服务"]')
    for s in spec.get("services", []):
        sid = s["id"]
        en, zh = service_name_pair(sid, services)
        label = node_label_with_top(sid, en, zh)
        lines.append(f'    {safe_id(sid)}["{mermaid_escape(label)}"]')
    lines.append("  end")
    lines.append("")
    lines.append("  %% Schemas & Tables / 模式与数据表")
    for sch, ts in sorted(by_schema.items()):
        schema_label = SCHEMA_LABELS.get(sch, f"{sch} / {sch}")
        lines.append(f'  subgraph {safe_id("SCHEMA_" + sch)}["{mermaid_escape(schema_label)}"]')
        for t in sorted(ts):
            t_en, t_zh = table_name_pair(t, table_meta)
            t_label = node_label_with_top(t, t_en, t_zh)
            lines.append(f'    {safe_id(t)}["{mermaid_escape(t_label)}"]')
        lines.append("  end")
        lines.append("")
    lines.append("  %% Ownership edges (service writes -> schema) / 所有权边（服务写入 -> schema）")
    for svc in sorted(svc_writes):
        for sch in sorted(svc_writes[svc]):
            lines.append(f"  {safe_id(svc)} --> {safe_id('SCHEMA_' + sch)}")
    lines.append("```")
    lines.append("")
    lines.append("> 中文：这张图只表达“服务写入哪些 schema”，细节请查看 CRUD Matrix 和每条 Flow 的时序图。")
    lines.append("> English: This diagram only shows \"which service writes which schema\". See the CRUD matrix and per-flow sequence diagrams for details.")
    lines.append("")
    return "\n".join(lines)

def build_flow_sequence(fl, services, policy=None):
    policy = policy if isinstance(policy, dict) else {}
    writes = ", ".join([f'{w["table"]}:{w["op"]}' for w in fl.get("writes", [])]) or "n/a"
    reads = ", ".join(fl.get("reads", [])) or "n/a"
    evs = ", ".join(fl.get("events_appended", [])) or "n/a"
    name_en, name_zh = flow_name_pair(fl)
    owner_id = fl.get("owner_service", "service")
    owner_en, owner_zh = service_name_pair(owner_id, services)
    lines = []
    lines.append(f"# {fl['id']} — {name_en} / {name_zh}\n")
    lines.append(f"- **Owner**: `{dual_text(owner_en, owner_zh)}`")
    lines.append(f"- **Reads**: {reads} （读取表）")
    lines.append(f"- **Writes**: {writes} （写入操作）")
    lines.append(f"- **Events appended**: {evs} （追加事件）")
    lines.append(f"- **Idempotency**: {fl.get('idempotency_key','-')} （幂等键）")
    lines.append("")
    lines.append("```mermaid")
    lines.append("sequenceDiagram")
    lines.append("  autonumber")
    lines.append(f'  participant A as "{mermaid_escape("Actor<br/>触发方")}"')
    lines.append(f'  participant S as "{mermaid_escape(owner_id + "<br/>" + dual_text(owner_en, owner_zh))}"')
    lines.append(f'  participant DB as "{mermaid_escape("Database<br/>数据库")}"')
    event_table = fl.get("event_table") or policy.get("event_table") or "events"
    outbox_table = fl.get("outbox_table") or policy.get("outbox_table") or "outbox"
    has_events = bool(fl.get("events_appended")) or any(
        write.get("table") == event_table for write in fl.get("writes", []) if isinstance(write, dict)
    )
    outbox_meta = fl.get("outbox")
    has_outbox = bool(outbox_meta) or bool(fl.get("outbox_table")) or any(
        write.get("table") == outbox_table for write in fl.get("writes", []) if isinstance(write, dict)
    )
    if has_events:
        lines.append(f'  participant E as "{mermaid_escape(f"{event_table}<br/>Events / 事件")}"')
    if has_outbox:
        lines.append(f'  participant O as "{mermaid_escape(f"{outbox_table}<br/>Outbox / 投递表")}"')
        lines.append(f'  participant W as "{mermaid_escape("outbox-worker<br/>Publisher / 投递器")}"')
        lines.append(f'  participant B as "{mermaid_escape("EventBus<br/>事件总线")}"')
        lines.append(f'  participant C as "{mermaid_escape("Consumer<br/>消费者")}"')
    lines.append("")
    lines.append("  A->>S: trigger flow / 触发流程")
    lines.append("  S->>DB: BEGIN / 开启事务")
    lines.append(f"  S->>DB: READ {reads} / 读取")
    lines.append(f"  S->>DB: WRITE {writes} / 写入")
    if has_events:
        lines.append(f"  S->>E: APPEND {event_table} {evs} / 追加事件")
    if has_outbox:
        lines.append(f"  S->>O: INSERT {outbox_table}(PENDING) / 写入待投递")
    lines.append("  S->>DB: COMMIT / 提交事务")
    if has_outbox:
        lines.append("")
        lines.append("  W->>O: SELECT PENDING (SKIP LOCKED) / 选择待投递")
        lines.append("  W->>B: publish(message) / 发布消息")
        lines.append("  W->>O: UPDATE status=SENT/FAILED / 更新状态")
        lines.append("")
        lines.append("  B-->>C: deliver message / 投递消息")
        lines.append("  C->>DB: INSERT processed_events (ON CONFLICT DO NOTHING) / 幂等去重")
        lines.append("  C->>DB: UPSERT read models / side effects / 更新读模型与副作用")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)

def write_file(path: Path, content: str):
    path.write_text(content, encoding="utf-8")

def extract_mermaid_block(markdown_path: Path) -> str:
    if not markdown_path.exists():
        return ""
    content = markdown_path.read_text(encoding="utf-8")
    match = MERMAID_BLOCK_RE.search(content)
    if not match:
        return ""
    return match.group(1).strip("\n") + "\n"

def normalize_ops(ops_set: set) -> str:
    ordered = [op for op in OP_ORDER if op in ops_set]
    extras = sorted([op for op in ops_set if op not in OP_ORDER])
    return "".join(ordered + extras)

def build_crud_edges(spec):
    amap = alias_map(spec)
    tables = visible_tables(spec)
    table_set = set(tables)
    flows = spec.get("flows", [])
    edge_ops = defaultdict(set)

    for fl in flows:
        fid = fl.get("id", "")
        for t in fl.get("reads", []):
            tc = canonical_table(t, amap)
            if tc in table_set:
                edge_ops[(fid, tc)].add("R")
        for w in fl.get("writes", []):
            raw_table = w.get("table")
            raw_op = w.get("op", "")
            if not isinstance(raw_table, str) or not raw_table:
                continue
            op = str(raw_op).upper()
            tc = canonical_table(raw_table, amap)
            if tc in table_set and op:
                edge_ops[(fid, tc)].add(op)

    flow_index = {fl.get("id"): idx for idx, fl in enumerate(flows)}
    table_index_map = {t: idx for idx, t in enumerate(tables)}
    sorted_keys = sorted(
        edge_ops.keys(),
        key=lambda item: (
            flow_index.get(item[0], 10**9),
            table_index_map.get(item[1], 10**9),
            item[0],
            item[1],
        ),
    )

    edges = []
    for fid, table in sorted_keys:
        edges.append({
            "flow_id": fid,
            "table": table,
            "ops": normalize_ops(edge_ops[(fid, table)]),
        })
    return edges

def export_index_json(spec, generated_dir: Path, out_path: Path, cfg: GenConfig):
    services_map = service_index(spec)
    services_out = []
    for svc in spec.get("services", []):
        sid = svc.get("id", "")
        en, zh = service_name_pair(sid, services_map)
        row = dict(svc)
        row.update({
            "id": sid,
            "name_en": en,
            "name_zh": zh,
        })
        services_out.append(row)

    tables_out = []
    for tbl in spec.get("tables", []):
        # Keep the original manifest fields so downstream viewers can inspect
        # labels, kind, notes, columns, and source metadata instead of losing
        # them during the CRUD projection.
        row = dict(tbl)
        row.update({
            "name": tbl.get("name", ""),
            "state": tbl.get("state", ""),
            "owner_service": tbl.get("owner_service", ""),
            "introduced_in": tbl.get("introduced_in", ""),
        })
        tables_out.append(row)

    flows_out = []
    flow_mermaid = {}
    for fl in spec.get("flows", []):
        fid = fl.get("id", "")
        name_en, name_zh = flow_name_pair(fl)
        reads = [t for t in fl.get("reads", []) if isinstance(t, str)]

        writes = []
        for w in fl.get("writes", []):
            table = w.get("table")
            op = w.get("op", "")
            if not isinstance(table, str) or not table:
                continue
            writes.append({
                "table": table,
                "op": str(op).upper(),
            })

        events = [ev for ev in fl.get("events_appended", []) if isinstance(ev, str)]
        flow_row = dict(fl)
        flow_row.update({
            "id": fid,
            "name_en": name_en,
            "name_zh": name_zh,
            "owner_service": fl.get("owner_service", ""),
            "doc_path": fl.get("doc_path", ""),
            "introduced_in": fl.get("introduced_in", ""),
            "reads": reads,
            "writes": writes,
            "events_appended": events,
            "idempotency_key": fl.get("idempotency_key", ""),
            "deprecated": bool(fl.get("deprecated", False)),
            "replaced_by": fl.get("replaced_by", ""),
            "aliases": [alias for alias in fl.get("aliases", []) if isinstance(alias, str)],
        })
        flows_out.append(flow_row)

        flow_md = generated_dir / "flows" / f"{fid.lower()}.md"
        flow_mermaid[fid] = extract_mermaid_block(flow_md)

    l0_mermaid = extract_mermaid_block(generated_dir / "l0_system_map.md")
    if l0_mermaid and not l0_mermaid.lstrip().startswith("graph TB"):
        lines = [ln for ln in l0_mermaid.splitlines() if ln.strip()]
        if lines and lines[0].startswith("flowchart TB"):
            lines[0] = "graph TB"
            l0_mermaid = "\n".join(lines) + "\n"

    source_meta = spec.get("meta", {}) if isinstance(spec.get("meta", {}), dict) else {}
    export = {
        "meta": {
            "project": cfg.project,
            "generated_at": stable_generated_at(cfg.spec_path),
            "source_flows_json": cfg.source_flows_json,
            "source_generated_dir": cfg.source_generated_dir,
            "schema_version": source_meta.get("schema_version", "design-viewer.index/v1"),
            "source_revision": source_meta.get("source_revision", ""),
        },
        "services": services_out,
        "datastores": [dict(row) for row in spec.get("datastores", []) if isinstance(row, dict)],
        "tables": tables_out,
        "flows": flows_out,
        "crudEdges": build_crud_edges(spec),
        "diagrams": {
            "l0_mermaid": l0_mermaid,
            "flow_mermaid": flow_mermaid,
            "database_mermaid": build_database_mermaid(spec),
        },
    }
    for key in ("policy", "systems", "source_repositories"):
        if key in source_meta:
            export["meta"][key] = source_meta[key]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(export, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

def snapshot_index_history(
    index_path: Path,
    history_dir: Path,
    manifest_path: Path,
    keep: int = DEFAULT_HISTORY_KEEP_LIMIT,
):
    if not index_path.exists():
        raise FileNotFoundError(f"index path not found: {index_path}")

    payload_text = index_path.read_text(encoding="utf-8")
    payload = json.loads(payload_text)
    meta = payload.get("meta", {}) if isinstance(payload, dict) else {}

    history_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base_name = f"index-{stamp}.json"
    snapshot_path = history_dir / base_name
    suffix = 1
    while snapshot_path.exists():
        snapshot_path = history_dir / f"index-{stamp}-{suffix:02d}.json"
        suffix += 1
    snapshot_path.write_text(payload_text, encoding="utf-8")

    manifest = {"items": []}
    if manifest_path.exists():
        try:
            parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
                manifest = parsed
        except json.JSONDecodeError:
            manifest = {"items": []}

    counts = {
        "flows": len(payload.get("flows", [])) if isinstance(payload, dict) else 0,
        "tables": len(payload.get("tables", [])) if isinstance(payload, dict) else 0,
        "crudEdges": len(payload.get("crudEdges", [])) if isinstance(payload, dict) else 0,
        "services": len(payload.get("services", [])) if isinstance(payload, dict) else 0,
    }
    item = {
        "file": snapshot_path.name,
        "generated_at": meta.get("generated_at") if isinstance(meta, dict) else None,
        "project": meta.get("project") if isinstance(meta, dict) else None,
        "counts": counts,
    }

    items = [x for x in manifest.get("items", []) if isinstance(x, dict) and x.get("file")]
    items.append(item)
    items = items[-keep:]

    keep_files = {x["file"] for x in items}
    for file_path in history_dir.glob("index-*.json"):
        if file_path.name not in keep_files:
            file_path.unlink(missing_ok=True)

    manifest_path.write_text(
        json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return item, len(items)

def main():
    args = parse_args()
    cfg = build_config(args)

    ensure_dirs(cfg.out_dir, cfg.flows_dir)
    spec = load_spec(cfg.spec_path)
    validate(spec)

    index = []
    index.append("# Diagrams (generated) / 图表（自动生成）\n")
    index.append(
        f"> ⚠️ 请编辑 `{cfg.source_flows_json}`，然后运行 `python3 tools/gen_diagrams.py` 重新生成。"
    )
    index.append(
        f"> ⚠️ Edit `{cfg.source_flows_json}`, then run `python3 tools/gen_diagrams.py` to regenerate.\n"
    )
    index.append("- L0 System Map / L0 系统地图: `l0_system_map.md`")
    index.append("- Database Schema / 数据库结构: `database_schema.md`")
    index.append("- L2 CRUD Matrix / L2 CRUD 矩阵: `crud_matrix.md`")
    index.append("- Flow sequences / 流程时序图: `flows/`")
    write_file(cfg.out_dir / "README.md", "\n".join(index) + "\n")

    write_file(cfg.out_dir / "l0_system_map.md", build_l0_system_map(spec))
    write_file(cfg.out_dir / "database_schema.md", build_database_schema_doc(spec))
    write_file(cfg.out_dir / "crud_matrix.md", build_crud_matrix(spec))
    services = service_index(spec)

    policy = spec.get("meta", {}).get("policy", {}) if isinstance(spec.get("meta", {}), dict) else {}
    for fl in spec.get("flows", []):
        fname = f"{fl['id'].lower()}.md"
        write_file(cfg.flows_dir / fname, build_flow_sequence(fl, services, policy))

    export_index_json(spec, cfg.out_dir, cfg.index_path, cfg)
    snapshot_item = None
    history_count = 0
    if cfg.skip_history:
        print("OK. Skipped history snapshot")
    else:
        snapshot_item, history_count = snapshot_index_history(
            cfg.index_path,
            cfg.history_dir,
            cfg.history_manifest_path,
            keep=cfg.history_keep_limit,
        )

    print(f"OK. Generated {path_display(cfg.out_dir)}")
    print(f"OK. Exported {path_display(cfg.index_path)}")
    if snapshot_item:
        print(
            "OK. Snapshot "
            f"{path_display(cfg.history_dir / snapshot_item['file'])} "
            f"(history items: {history_count})"
        )

if __name__ == "__main__":
    main()
