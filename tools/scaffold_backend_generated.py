#!/usr/bin/env python3
"""Generate an output-only SAFE MODE Rust/Postgres flow skeleton.

The generated file is a review artifact, not a production handler. By default
it is written below outputs/backend and never edits the documented project.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path.cwd().resolve()
GEN_DIR = ROOT / "outputs" / "backend"


def to_module_name(flow_id: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "_", flow_id.strip().lower()).strip("_")
    if not text:
        return "generated_flow"
    if text[0].isdigit():
        text = f"flow_{text}"
    return text


def parse_csv(raw: str) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen = set()
    for item in raw.split(","):
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def parse_writes(raw: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    seen = set()
    for item in parse_csv(raw):
        if ":" not in item:
            continue
        table, op = item.split(":", 1)
        table = table.strip()
        op = op.strip().upper()
        if not table or not op:
            continue
        key = (table, op)
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def has_write(writes: list[tuple[str, str]], table: str, op: str) -> bool:
    return any(t == table and o == op for t, o in writes)


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def render_flow_file(
    flow_id: str,
    owner_service: str,
    reads: list[str],
    writes: list[tuple[str, str]],
    events_appended: list[str],
    idempotency_key: str,
    doc_path: str,
    event_table: str,
    outbox_table: str,
) -> str:
    writes_comment = "\n".join(f"// - {table}:{op}" for table, op in writes) or "// - none"
    reads_comment = "\n".join(f"// - {table}" for table in reads) or "// - none"
    events_comment = "\n".join(f"// - {ev}" for ev in events_appended) or "// - none"

    must_events = has_write(writes, event_table, "C")
    must_outbox = has_write(writes, outbox_table, "C")
    primary_event_type = events_appended[0] if events_appended else "TODO_EVENT_TYPE"
    business_writes = [
        table for table, _ in writes if table not in {event_table, outbox_table}
    ]
    primary_table = business_writes[0] if business_writes else "unknown.aggregate"
    aggregate_type = primary_table.split(".", 1)[-1]

    events_block = f"""
    // The event table is configurable; review the schema and auth before use.
    // TODO: append the authoritative event and push its id to event_ids.
    // Example:
    // let event_id = sqlx::query_scalar::<_, Uuid>(
    //     "INSERT INTO {event_table} (flow_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, idempotency_key, payload)\n"
    //     "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"
    // )
    // .bind(FLOW_ID)
    // .bind("TODO_EVENT_TYPE")
    // .bind("TODO_AGGREGATE_TYPE")
    // .bind(Uuid::nil())
    // .bind(cmd.correlation_id)
    // .bind(cmd.causation_id)
    // .bind(&cmd.idempotency_key)
    // .bind(&cmd.payload)
    // .fetch_one(&mut *tx)
    // .await?;
    // event_ids.push(event_id);
""".rstrip()
    if must_events:
        events_block = f"""
    // Event-table create is present in the design spec.
    let event_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO {event_table} (flow_id, event_type, aggregate_type, aggregate_id, correlation_id, causation_id, idempotency_key, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"
    )
    .bind(FLOW_ID)
    .bind(PRIMARY_EVENT_TYPE)
    .bind(PRIMARY_AGGREGATE_TYPE)
    .bind(aggregate_id)
    .bind(cmd.correlation_id)
    .bind(cmd.causation_id)
    .bind(&cmd.idempotency_key)
    .bind(&cmd.payload)
    .fetch_one(&mut *tx)
    .await?;
    event_ids.push(event_id);
""".rstrip()

    outbox_block = f"""
    // The outbox table is configurable; review the delivery contract first.
    // TODO: insert outbox row and push returned id to outbox_ids.
""".rstrip()
    if must_outbox:
        outbox_block = f"""
    // Outbox-table create is present in the design spec.
    let outbox_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO {outbox_table} (event_id, topic, partition_key, flow_id, aggregate_id, correlation_id, status, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"
    )
    .bind(event_ids.last().copied().unwrap_or_else(Uuid::nil))
    .bind("{event_table}")
    .bind(aggregate_id.to_string())
    .bind(FLOW_ID)
    .bind(aggregate_id)
    .bind(cmd.correlation_id)
    .bind("PENDING")
    .bind(&cmd.payload)
    .fetch_one(&mut *tx)
    .await?;
    outbox_ids.push(outbox_id);
""".rstrip()

    return f'''// AUTO-GENERATED SAFE MODE: Do not edit directly; create a hand-written wrapper or regenerate.

use anyhow::Error;
use serde_json::Value;
use sqlx::{{PgPool, Postgres, Transaction}};
use tracing::info;
use uuid::Uuid;

pub const FLOW_ID: &str = "{flow_id}";
pub const OWNER_SERVICE: &str = "{owner_service}";
pub const DOC_PATH: &str = "{doc_path}";
pub const DEFAULT_IDEMPOTENCY_KEY: &str = "{idempotency_key}";
pub const PRIMARY_EVENT_TYPE: &str = "{primary_event_type}";
pub const PRIMARY_AGGREGATE_TYPE: &str = "{aggregate_type}";

#[derive(Debug, Clone)]
pub struct Command {{
    pub correlation_id: Uuid,
    pub causation_id: Option<Uuid>,
    pub idempotency_key: String,
    pub payload: Value,
}}

#[derive(Debug, Clone)]
pub struct FlowResult {{
    pub event_ids: Vec<Uuid>,
    pub outbox_ids: Vec<Uuid>,
    pub debug: Value,
}}

pub async fn handle(pool: &PgPool, cmd: Command) -> Result<FlowResult, Error> {{
    info!(
        flow_id = FLOW_ID,
        correlation_id = %cmd.correlation_id,
        idempotency_key = %cmd.idempotency_key,
        "handling generated safe-mode flow"
    );

    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;
    let mut event_ids: Vec<Uuid> = Vec::new();
    let mut outbox_ids: Vec<Uuid> = Vec::new();
    let aggregate_id = cmd
        .payload
        .get("aggregate_id")
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| anyhow::anyhow!("aggregate_id is required by the safe-mode contract"))?;

    // Reads from design spec:
{reads_comment}

    // Writes from design spec:
{writes_comment}
    // TODO: apply authoritative writes in this transaction.

{events_block}

{outbox_block}

    tx.commit().await?;

    let debug = serde_json::json!({{
        "flow_id": FLOW_ID,
        "owner_service": OWNER_SERVICE,
        "doc_path": DOC_PATH,
        "events_appended": [
{','.join([f'            "{e}"' for e in events_appended]) if events_appended else '            "TODO_EVENT"'}
        ],
    }});

    Ok(FlowResult {{
        event_ids,
        outbox_ids,
        debug,
    }})
}}

pub fn design_notes() -> &'static str {{
    "This file is auto-generated in SAFE MODE. See the REGISTER.md emitted by scaffold_flow before wiring a route."
}}
'''


def render_mod(modules: list[str]) -> str:
    module_lines = "\n".join(f"pub mod {name};" for name in modules)
    flow_lines = "\n".join(f"        {name}::FLOW_ID," for name in modules)
    if not flow_lines:
        flow_lines = "        // none yet"
    return f'''// AUTO-GENERATED SAFE MODE: Do not edit directly; regenerate via scaffold tools.

{module_lines}

pub fn list_generated_flows() -> Vec<&'static str> {{
    vec![
{flow_lines}
    ]
}}

pub fn register_notes() -> &'static str {{
    "Manual route registration required. Check outputs/scaffold/<flow_id>/REGISTER.md"
}}
'''


def rebuild_generated_mod():
    ensure_dir(GEN_DIR)
    modules = sorted(
        path.stem
        for path in GEN_DIR.glob("*.rs")
        if path.name != "mod.rs"
    )
    (GEN_DIR / "mod.rs").write_text(render_mod(modules), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Generate an output-only SAFE MODE backend flow skeleton")
    parser.add_argument("--root", default=".", help="Project root used for relative paths")
    parser.add_argument("--output-dir", default="", help="Output directory (default: <root>/outputs/backend)")
    parser.add_argument("--flow-id", "--flow_id", dest="flow_id", required=True)
    parser.add_argument("--owner-service", "--owner_service", dest="owner_service", required=True)
    parser.add_argument("--reads", default="")
    parser.add_argument("--writes", default="")
    parser.add_argument("--events-appended", "--events_appended", dest="events_appended", default="")
    parser.add_argument("--idempotency-key", "--idempotency_key", dest="idempotency_key", default="TBD")
    parser.add_argument("--doc-path", "--doc_path", dest="doc_path", default="TBD")
    parser.add_argument("--event-table", default="events")
    parser.add_argument("--outbox-table", default="outbox")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    global ROOT, GEN_DIR
    ROOT = Path(args.root).expanduser().resolve()
    GEN_DIR = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir and Path(args.output_dir).expanduser().is_absolute()
        else ROOT / (args.output_dir or "outputs/backend")
    )

    module_name = to_module_name(args.flow_id)
    target = GEN_DIR / f"{module_name}.rs"
    ensure_dir(GEN_DIR)

    if target.exists() and not args.force:
        print(f"SKIP: {display_path(target)} exists (use --force to overwrite)")
    else:
        content = render_flow_file(
            flow_id=args.flow_id.strip(),
            owner_service=args.owner_service.strip(),
            reads=parse_csv(args.reads),
            writes=parse_writes(args.writes),
            events_appended=parse_csv(args.events_appended),
            idempotency_key=args.idempotency_key.strip() or "TBD",
            doc_path=args.doc_path.strip() or "TBD",
            event_table=args.event_table.strip() or "events",
            outbox_table=args.outbox_table.strip() or "outbox",
        )
        target.write_text(content, encoding="utf-8")
        print(f"OK: generated {display_path(target)}")

    rebuild_generated_mod()
    print(f"OK: updated {display_path(GEN_DIR / 'mod.rs')}")
    print("OK: output-only artifact; no project router/module was modified")


if __name__ == "__main__":
    main()
