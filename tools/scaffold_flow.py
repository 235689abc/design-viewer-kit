#!/usr/bin/env python3
"""SAFE MODE flow scaffolder: docs + patch + register + optional backend generated skeleton."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Iterable

# These paths are deliberately configurable. The standalone kit must never
# assume the layout of the project that it is documenting.
ROOT = Path.cwd().resolve()
SCRIPT_DIR = Path(__file__).resolve().parent
FLOWS_SPEC_PATH = ROOT / "docs" / "diagrams" / "flows.json"
DOCS_FLOWS_DIR = ROOT / "docs" / "flows"
OUTPUTS_DIR = ROOT / "outputs" / "scaffold"
BACKEND_SCRIPT = ROOT / "tools" / "scaffold_backend_generated.py"

VALID_OPS = {"C", "R", "U", "D"}
DOC_FILES = ["README.md", "flow.md", "sequence.md", "api.md", "db.md"]


def slug(text: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower()).strip("_")
    return normalized or "new_flow"


def default_flow_dir(flow_id: str) -> str:
    value = slug(flow_id)
    if value.startswith("flow_"):
        value = value[5:]
    return value or "new_flow"


def parse_list(raw: str) -> list[str]:
    if not raw:
        return []
    items = [item.strip() for item in raw.split(",")]
    return [item for item in items if item]


def unique(items: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen = set()
    for item in items:
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def parse_writes(raw: str) -> list[dict[str, str]]:
    writes: list[dict[str, str]] = []
    for item in parse_list(raw):
        if ":" not in item:
            raise ValueError(f"invalid write '{item}', expected table:op")
        table, op = item.split(":", 1)
        table = table.strip()
        op = op.strip().upper()
        if not table:
            raise ValueError(f"invalid write '{item}', table is empty")
        if op not in VALID_OPS:
            raise ValueError(f"invalid op '{op}' in write '{item}', expected one of {sorted(VALID_OPS)}")
        writes.append({"table": table, "op": op})

    dedup: dict[tuple[str, str], dict[str, str]] = {}
    for write in writes:
        dedup[(write["table"], write["op"])] = write
    return list(dedup.values())


def markdown_list(items: list[str], empty_text: str = "- None / 无") -> str:
    if not items:
        return empty_text
    return "\n".join(f"- `{item}`" for item in items)


def markdown_writes(items: list[dict[str, str]], empty_text: str = "- None / 无") -> str:
    if not items:
        return empty_text
    return "\n".join(f"- `{row['table']}` ({row['op']})" for row in items)


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def dump_json(path: Path, data: object):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_if_allowed(path: Path, content: str, force: bool) -> str:
    if path.exists() and not force:
        return "skipped"
    path.write_text(content, encoding="utf-8")
    return "written"


def load_known_services() -> set[str]:
    if not FLOWS_SPEC_PATH.exists():
        return set()
    try:
        spec = json.loads(FLOWS_SPEC_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    return {
        str(svc.get("id", "")).strip()
        for svc in spec.get("services", [])
        if isinstance(svc, dict) and str(svc.get("id", "")).strip()
    }


def markdown_readme(ctx: dict[str, object]) -> str:
    reads = markdown_list(ctx["reads"])
    writes = markdown_writes(ctx["writes"])
    events = markdown_list(ctx["events"])
    return f"""# {ctx['flow_id']} — {ctx['name_en']} / {ctx['name_zh']}

## Overview / 概览
- EN: This document is a SAFE MODE scaffold for implementing `{ctx['flow_id']}`.
- 中文：本文档是 `{ctx['flow_id']}` 的 SAFE MODE 落地脚手架。

## Actors / 触发方
- Primary actor / 主要触发方: `{ctx['actor']}`

## Data Touched / 触达数据
### Reads / 读取
{reads}

### Writes / 写入
{writes}

## Events Appended / 追加事件
{events}

## Idempotency & Retries / 幂等与重试
- idempotency_key / 幂等键: `{ctx['idempotency_key']}`
- Retry strategy / 重试策略: TODO

## Finality / 最终性
- EN: Define settlement/finality guarantees here.
- 中文：在此定义结算/最终性保证。

## Links / 链接
- CRUD Matrix / CRUD 矩阵: `/crud?flow={ctx['flow_id']}`
- Flow Map / 流程图: `/flows/{ctx['flow_id']}`
- Sequence / 时序图: `sequence.md`
- Runtime / 运行态: `/flows/{ctx['flow_id']}` runtime section
"""


def markdown_flow(ctx: dict[str, object]) -> str:
    return f"""# Flow Map / 业务链路地图

## Summary / 摘要
- Flow ID: `{ctx['flow_id']}`
- Owner Service: `{ctx['owner_service']}`

## L1 Flow Map Notes / L1 流程图说明
- EN: Describe actor -> service -> read/write -> events -> outbox chain.
- 中文：描述触发方 -> 服务 -> 读写 -> 事件 -> outbox 的链路。

```mermaid
graph LR
  ACT[Actor / 触发方] --> SVC[{ctx['owner_service']}]
  SVC --> WR[Writes / 写入]
  SVC --> RD[Reads / 读取]
  SVC --> EV[Events / 事件]
  EV --> OB[{ctx['outbox_table']}]
```

## Cross-schema Concerns / 跨域注意事项
- EN: Document cross-schema writes and consistency strategy.
- 中文：记录跨 schema 写入与一致性策略。
"""


def markdown_sequence(ctx: dict[str, object]) -> str:
    return f"""# Sequence & Transaction Checklist / 时序与事务清单

## Golden Transaction Template / 黄金事务模板
- [ ] BEGIN transaction / 开启事务
- [ ] Validate idempotency key / 校验幂等键
- [ ] Read authoritative rows / 读取权威行
- [ ] Apply business writes / 执行业务写入
- [ ] Append `{ctx['event_table']}` / 追加事件
- [ ] Insert `{ctx['outbox_table']}` / 写入 outbox
- [ ] COMMIT transaction / 提交事务

## Consumer Idempotency Checklist / 消费端幂等清单
- [ ] Gate by processed-events table when the project defines one (`ON CONFLICT DO NOTHING`)
- [ ] Apply side effects once / 副作用只执行一次
- [ ] Record status and retry counters / 记录状态与重试计数

## L0/L1/L2 Alignment / L0/L1/L2 对齐
- [ ] L0 schema ownership reflected in writes
- [ ] L1 flow map reviewed
- [ ] L2 impact graph expected links documented

## Notes / 备注
- Flow: `{ctx['flow_id']}`
- Owner: `{ctx['owner_service']}`
"""


def markdown_api(ctx: dict[str, object]) -> str:
    return f"""# API Placeholder / 接口占位

## Endpoint / 接口
- Method: `POST` (override in the generated contract before implementation)
- Path: `/api/flows/{slug(str(ctx['flow_id']))}` (placeholder only)

## Request / 请求
- `correlation_id`: UUID string
- `idempotency_key`: `{ctx['idempotency_key']}`
- payload: TODO

## Response / 响应
- `status`: accepted|failed
- `flow_id`: `{ctx['flow_id']}`
- `request_id`: string

## Standards / 规范
- Correlation ID required / 必须携带 correlation_id
- Idempotency key required for write flows / 写入流程必须携带幂等键
"""


def markdown_db(ctx: dict[str, object]) -> str:
    table_lines = markdown_list(ctx["tables_to_create"], "- TBD")
    return f"""# Database Notes / 数据库说明

## Tables to Add or Change / 需要新增或修改的表
{table_lines}

## Indexes & Constraints / 索引与约束
- TODO: primary key / 主键
- TODO: unique constraints / 唯一约束
- TODO: query indexes / 查询索引

## introduced_in
- `TBD` (replace with migration path once created)
"""


def migration_stub(ctx: dict[str, object]) -> str:
    tables = ctx["tables_to_create"]
    if not tables:
        return "-- No tables_to_create provided. Add CREATE TABLE statements manually.\n"

    blocks = []
    for table in tables:
        blocks.append(
            f"""CREATE TABLE IF NOT EXISTS {table} (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- TODO: business columns
  status TEXT NOT NULL DEFAULT 'PENDING'
);

-- TODO: indexes for {table}
-- CREATE INDEX IF NOT EXISTS idx_{slug(table)}_created_at ON {table}(created_at);
"""
        )
    return "\n".join(blocks)


def register_md(ctx: dict[str, object]) -> str:
    endpoint = f"/api/flows/{slug(str(ctx['flow_id']))}"
    return f"""# REGISTER {ctx['flow_id']} (SAFE MODE)

## Why Manual Registration / 为什么手工注册
- EN: SAFE MODE avoids auto-editing main router files to prevent merge conflicts.
- 中文：SAFE MODE 不自动修改主路由文件，避免多人协作冲突。

## Generated Backend Module / 已生成后端模块
- `{ctx['backend_rel_dir']}/{ctx['module_name']}.rs` (optional Rust/Postgres review artifact)
- `{ctx['backend_rel_dir']}/mod.rs`

## Suggested Endpoint / 建议路由
- `POST {endpoint}`

## Manual Route Wiring (Pseudo-code) / 手工接线路由（伪代码）
```rust
// in routes.rs or app.rs main router composition
router.route("{endpoint}", post(handler_fn));
```

## Design Entry / 设计入口
- docs: `{ctx['doc_path']}`
- viewer flows: `/flows/{ctx['flow_id']}`
- viewer crud: `/crud?flow={ctx['flow_id']}`
- viewer tables: `/tables`
- viewer l0: `/l0`

## Checklist / 清单
- [ ] Route added manually
- [ ] Auth policy attached
- [ ] Request/response DTO wired
- [ ] Runtime smoke test executed
"""


def build_patch(ctx: dict[str, object], known_services: set[str]) -> dict[str, object]:
    owner_service = str(ctx["owner_service"])
    services_add = []
    if owner_service not in known_services:
        services_add.append(
            {
                "id": owner_service,
                "name_en": str(ctx["service_name_en"]),
                "name_zh": str(ctx["service_name_zh"]),
            }
        )

    tables_add = [
        {
            "name": t,
            "state": "planned",
            "owner_service": owner_service,
            "introduced_in": "TBD",
        }
        for t in ctx["tables_to_create"]
    ]

    flow_entry = {
        "id": str(ctx["flow_id"]),
        "name": str(ctx["name_en"]),
        "name_en": str(ctx["name_en"]),
        "name_zh": str(ctx["name_zh"]),
        "owner_service": owner_service,
        "actors": [str(ctx["actor"])],
        "reads": list(ctx["reads"]),
        "writes": list(ctx["writes"]),
        "events_appended": list(ctx["events"]),
        "outbox": {
            "topic": str(ctx["event_table"]),
            "partition_key": "aggregate_id",
        },
        "event_table": str(ctx["event_table"]),
        "outbox_table": str(ctx["outbox_table"]),
        "finality": "TBD",
        "idempotency_key": str(ctx["idempotency_key"]),
        "doc_path": str(ctx["doc_path"]),
        "introduced_in": "TBD",
    }

    return {
        "services_add": services_add,
        "tables_add": tables_add,
        "flows_add": [flow_entry],
    }


def run_backend_scaffold(ctx: dict[str, object], force: bool):
    cmd = [
        "python3",
        str(BACKEND_SCRIPT),
        "--flow-id",
        str(ctx["flow_id"]),
        "--owner-service",
        str(ctx["owner_service"]),
        "--reads",
        ",".join(ctx["reads"]),
        "--writes",
        ",".join([f"{w['table']}:{w['op']}" for w in ctx["writes"]]),
        "--events-appended",
        ",".join(ctx["events"]),
        "--event-table",
        str(ctx["event_table"]),
        "--outbox-table",
        str(ctx["outbox_table"]),
        "--idempotency-key",
        str(ctx["idempotency_key"]),
        "--doc-path",
        str(ctx["doc_path"]),
        "--root",
        str(ROOT),
        "--output-dir",
        str(OUTPUTS_DIR / slug(str(ctx["flow_id"])) / "backend"),
    ]
    if force:
        cmd.append("--force")
    subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description="SAFE MODE scaffold for new flows")
    parser.add_argument("--root", default=".", help="Project root to receive docs/output (default: current directory)")
    parser.add_argument("--spec", default="", help="Flow manifest JSON, relative to --root when not absolute")
    parser.add_argument("--docs-dir", default="", help="Flow documentation directory (default: <root>/docs/flows)")
    parser.add_argument("--output-dir", default="", help="Scaffold output directory (default: <root>/outputs/scaffold)")
    parser.add_argument("--backend-script", default="", help="Optional backend renderer path")
    parser.add_argument("--flow-id", "--flow_id", dest="flow_id", required=True)
    parser.add_argument("--name-en", "--name_en", dest="name_en", required=True)
    parser.add_argument("--name-zh", "--name_zh", dest="name_zh", required=True)
    parser.add_argument("--owner-service", "--owner_service", dest="owner_service", default="service")
    parser.add_argument("--reads", default="")
    parser.add_argument("--writes", default="")
    parser.add_argument(
        "--events-appended",
        "--events_appended",
        "--events",
        dest="events_appended",
        default="",
    )
    parser.add_argument("--idempotency-key", "--idempotency_key", dest="idempotency_key", default="TBD")
    parser.add_argument("--tables-to-create", "--tables_to_create", dest="tables_to_create", default="")
    parser.add_argument("--doc-dir", "--doc_dir", dest="doc_dir", default="")
    parser.add_argument("--service-name-en", "--service_name_en", dest="service_name_en", default="")
    parser.add_argument("--service-name-zh", "--service_name_zh", dest="service_name_zh", default="")
    parser.add_argument("--actor", default="Client / 客户端")
    parser.add_argument("--event-table", default="events")
    parser.add_argument("--outbox-table", default="outbox")
    parser.add_argument("--backend", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Print planned files without writing them")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    global ROOT, FLOWS_SPEC_PATH, DOCS_FLOWS_DIR, OUTPUTS_DIR, BACKEND_SCRIPT
    ROOT = Path(args.root).expanduser().resolve()
    FLOWS_SPEC_PATH = (
        Path(args.spec).expanduser().resolve()
        if args.spec and Path(args.spec).expanduser().is_absolute()
        else ROOT / (args.spec or "docs/diagrams/flows.json")
    )
    DOCS_FLOWS_DIR = (
        Path(args.docs_dir).expanduser().resolve()
        if args.docs_dir and Path(args.docs_dir).expanduser().is_absolute()
        else ROOT / (args.docs_dir or "docs/flows")
    )
    OUTPUTS_DIR = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir and Path(args.output_dir).expanduser().is_absolute()
        else ROOT / (args.output_dir or "outputs/scaffold")
    )
    requested_backend_script = (
        Path(args.backend_script).expanduser().resolve()
        if args.backend_script and Path(args.backend_script).expanduser().is_absolute()
        else ROOT / (args.backend_script or "tools/scaffold_backend_generated.py")
    )
    # When the kit is invoked with an absolute script path and --root points at
    # another project, use the kit's bundled backend renderer unless the target
    # project provides its own copy.
    BACKEND_SCRIPT = requested_backend_script
    if not BACKEND_SCRIPT.exists() and not args.backend_script:
        BACKEND_SCRIPT = SCRIPT_DIR / "scaffold_backend_generated.py"

    flow_id = args.flow_id.strip()
    if not flow_id:
        raise SystemExit("flow_id must not be empty")

    flow_dir = args.doc_dir.strip() if args.doc_dir else default_flow_dir(flow_id)
    doc_dir = DOCS_FLOWS_DIR / flow_dir
    out_dir = OUTPUTS_DIR / slug(flow_id)

    reads = unique(parse_list(args.reads))
    writes = parse_writes(args.writes)
    events = unique(parse_list(args.events_appended))
    tables_to_create = unique(parse_list(args.tables_to_create))

    context = {
        "flow_id": flow_id,
        "name_en": args.name_en.strip(),
        "name_zh": args.name_zh.strip(),
        "owner_service": args.owner_service.strip(),
        "reads": reads,
        "writes": writes,
        "events": events,
        "idempotency_key": args.idempotency_key.strip() or "TBD",
        "tables_to_create": tables_to_create,
        "flow_dir": flow_dir,
        "doc_path": f"docs/flows/{flow_dir}",
        "service_name_en": args.service_name_en.strip() or args.owner_service.strip(),
        "service_name_zh": args.service_name_zh.strip() or args.owner_service.strip(),
        "actor": args.actor.strip() or "Client / 客户端",
        "event_table": args.event_table.strip() or "events",
        "outbox_table": args.outbox_table.strip() or "outbox",
        "module_name": slug(flow_id),
        "backend_rel_dir": display_path(OUTPUTS_DIR / slug(flow_id) / "backend"),
    }

    if args.dry_run:
        print(f"DRY RUN: docs would be written under {doc_dir}")
        print(f"DRY RUN: scaffold artifacts would be written under {out_dir}")
        if args.backend:
            print(f"DRY RUN: backend artifact would be written under {out_dir / 'backend'}")
        return

    ensure_dir(doc_dir)
    ensure_dir(out_dir)

    file_map = {
        "README.md": markdown_readme(context),
        "flow.md": markdown_flow(context),
        "sequence.md": markdown_sequence(context),
        "api.md": markdown_api(context),
        "db.md": markdown_db(context),
    }

    for name in DOC_FILES:
        status = write_if_allowed(doc_dir / name, file_map[name], force=args.force)
        prefix = "OK" if status == "written" else "SKIP"
        print(f"{prefix}: {display_path(doc_dir / name)}")

    patch = build_patch(context, load_known_services())
    patch_path = out_dir / "flows_patch.json"
    dump_json(patch_path, patch)
    print(f"OK: patch generated at {display_path(patch_path)}")

    migration_path = out_dir / "migration_stub.sql"
    write_if_allowed(migration_path, migration_stub(context), force=args.force)
    print(f"OK: migration stub at {display_path(migration_path)}")

    register_path = out_dir / "REGISTER.md"
    write_if_allowed(register_path, register_md(context), force=args.force)
    print(f"OK: register notes at {display_path(register_path)}")

    if args.backend:
        run_backend_scaffold(context, force=args.force)

    print("Done. Next apply the manifest patch with:")
    print(f"python3 tools/apply_flows_patch.py --root {ROOT} --patch {patch_path}")


if __name__ == "__main__":
    main()
