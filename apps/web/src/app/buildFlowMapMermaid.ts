import { orderedSchemas, schemaDisplayLabel, schemaOf } from './schemaUtils';
import type { FlowRecord, ProjectData } from './useProjectData';

const DEFAULT_MAX_TABLES_PER_SCHEMA = 12;
const EVENT_NODE_LIMIT = 10;
const OPS_ORDER = ['C', 'R', 'U', 'D'];

export type FlowMapOptions = {
  showReads: boolean;
  showTables: boolean;
  schemasOnly: boolean;
  maxTablesPerSchema?: number;
};

export type BuildFlowMapResult = {
  mermaidCode: string;
  error?: string;
};

type GroupedReadTables = Map<string, string[]>;
type GroupedWriteTables = Map<string, Array<{ table: string; ops: string }>>;

function safeNodeId(prefix: string, value: string): string {
  const trimmed = value.trim() || 'unknown';
  return `${prefix}_${trimmed.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, '\\"');
}

function mergeOps(existing: string, incoming: string): string {
  const opSet = new Set<string>();
  for (const op of `${existing}${incoming}`.toUpperCase()) {
    if (OPS_ORDER.includes(op)) {
      opSet.add(op);
    }
  }
  return OPS_ORDER.filter((op) => opSet.has(op)).join('');
}

function canonicalizeTable(tableName: string, aliasMap: Map<string, string>): string {
  let current = tableName;
  const visited = new Set<string>();
  while (aliasMap.has(current) && !visited.has(current)) {
    visited.add(current);
    current = aliasMap.get(current) ?? current;
  }
  return current;
}

function buildAliasMap(data: ProjectData): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const table of data.tables) {
    if (table.alias_of) {
      aliasMap.set(table.name, table.alias_of);
    }
  }
  return aliasMap;
}

function groupReads(flow: FlowRecord, aliasMap: Map<string, string>): GroupedReadTables {
  const bySchema = new Map<string, Set<string>>();
  for (const readTable of flow.reads) {
    const canonical = canonicalizeTable(readTable, aliasMap);
    const schemaName = schemaOf(canonical);
    if (!bySchema.has(schemaName)) {
      bySchema.set(schemaName, new Set<string>());
    }
    bySchema.get(schemaName)?.add(canonical);
  }

  const grouped = new Map<string, string[]>();
  for (const [schemaName, tableSet] of bySchema.entries()) {
    grouped.set(schemaName, Array.from(tableSet).sort((a, b) => a.localeCompare(b)));
  }
  return grouped;
}

function groupWrites(flow: FlowRecord, aliasMap: Map<string, string>): GroupedWriteTables {
  const byTable = new Map<string, string>();
  for (const write of flow.writes) {
    const canonical = canonicalizeTable(write.table, aliasMap);
    const prev = byTable.get(canonical) ?? '';
    byTable.set(canonical, mergeOps(prev, write.op));
  }

  const bySchema = new Map<string, Array<{ table: string; ops: string }>>();
  for (const [tableName, ops] of byTable.entries()) {
    const schemaName = schemaOf(tableName);
    if (!bySchema.has(schemaName)) {
      bySchema.set(schemaName, []);
    }
    bySchema.get(schemaName)?.push({ table: tableName, ops: ops || '-' });
  }

  const grouped = new Map<string, Array<{ table: string; ops: string }>>();
  for (const [schemaName, rows] of bySchema.entries()) {
    grouped.set(
      schemaName,
      rows.sort((a, b) => a.table.localeCompare(b.table)),
    );
  }
  return grouped;
}

function serviceLabel(data: ProjectData, ownerService: string): string {
  const service = data.services.find((item) => item.id === ownerService);
  if (!service) {
    return ownerService || 'unknown';
  }
  return `${ownerService} | ${service.name_en} / ${service.name_zh}`;
}

function flowTitle(flow: FlowRecord): string {
  const en = flow.name_en || flow.id;
  const zh = flow.name_zh || flow.name_en || flow.id;
  return `${flow.id} — ${en} / ${zh}`;
}

function appendReadNodes(
  lines: string[],
  groupedReads: GroupedReadTables,
  options: Required<FlowMapOptions>,
) {
  const schemas = orderedSchemas(groupedReads.keys());
  if (schemas.length === 0) {
    lines.push('READS --> READS_NONE["No reads / 无读取"]');
    return;
  }

  const showTableNodes = options.showTables && !options.schemasOnly;
  for (const schemaName of schemas) {
    const schemaNodeId = safeNodeId('RSCHEMA', schemaName);
    lines.push(`${schemaNodeId}["${escapeLabel(schemaDisplayLabel(schemaName))}"]`);
    lines.push(`READS --> ${schemaNodeId}`);

    if (!showTableNodes) {
      continue;
    }

    const tables = groupedReads.get(schemaName) ?? [];
    const visible = tables.slice(0, options.maxTablesPerSchema);
    const hiddenCount = Math.max(0, tables.length - visible.length);
    for (const tableName of visible) {
      const tableNodeId = safeNodeId('RTABLE', `${schemaName}_${tableName}`);
      lines.push(`${tableNodeId}["${escapeLabel(tableName)}"]`);
      lines.push(`${schemaNodeId} --> ${tableNodeId}`);
    }
    if (hiddenCount > 0) {
      const moreNodeId = safeNodeId('R_MORE', `${schemaName}_${hiddenCount}`);
      lines.push(`${moreNodeId}["+${hiddenCount} more / 其余${hiddenCount}"]`);
      lines.push(`${schemaNodeId} --> ${moreNodeId}`);
    }
  }
}

function appendWriteNodes(
  lines: string[],
  groupedWrites: GroupedWriteTables,
  options: Required<FlowMapOptions>,
) {
  const schemas = orderedSchemas(groupedWrites.keys());
  if (schemas.length === 0) {
    lines.push('WRITES --> WRITES_NONE["No writes / 无写入"]');
    return;
  }

  const showTableNodes = options.showTables && !options.schemasOnly;
  for (const schemaName of schemas) {
    const schemaNodeId = safeNodeId('WSCHEMA', schemaName);
    lines.push(`${schemaNodeId}["${escapeLabel(schemaDisplayLabel(schemaName))}"]`);
    lines.push(`WRITES --> ${schemaNodeId}`);

    if (!showTableNodes) {
      continue;
    }

    const tables = groupedWrites.get(schemaName) ?? [];
    const visible = tables.slice(0, options.maxTablesPerSchema);
    const hiddenCount = Math.max(0, tables.length - visible.length);
    for (const row of visible) {
      const tableNodeId = safeNodeId('WTABLE', `${schemaName}_${row.table}`);
      lines.push(`${tableNodeId}["${escapeLabel(`${row.table} (${row.ops})`)}"]`);
      lines.push(`${schemaNodeId} --> ${tableNodeId}`);
    }
    if (hiddenCount > 0) {
      const moreNodeId = safeNodeId('W_MORE', `${schemaName}_${hiddenCount}`);
      lines.push(`${moreNodeId}["+${hiddenCount} more / 其余${hiddenCount}"]`);
      lines.push(`${schemaNodeId} --> ${moreNodeId}`);
    }
  }
}

function appendEventNodes(lines: string[], flow: FlowRecord) {
  const events = Array.from(
    new Set(
      flow.events_appended
        .map((eventName) => eventName.trim())
        .filter((eventName) => eventName.length > 0),
    ),
  );

  if (events.length === 0) {
    lines.push('EVTS --> EVT_NONE["No events / 无事件"]');
    return;
  }

  if (events.length > EVENT_NODE_LIMIT) {
    lines.push(`EVTS --> EVT_COUNT["${events.length} events / ${events.length}个事件"]`);
    return;
  }

  for (const eventName of events) {
    const eventNodeId = safeNodeId('EVT', eventName);
    lines.push(`${eventNodeId}["${escapeLabel(eventName)}"]`);
    lines.push(`EVTS --> ${eventNodeId}`);
  }
}

function errorResult(message: string): BuildFlowMapResult {
  return {
    mermaidCode: `graph LR\nERR["${escapeLabel(message)}"]\n`,
    error: message,
  };
}

export function buildFlowMapMermaid(
  data: ProjectData | null,
  flowId: string,
  options: FlowMapOptions,
): BuildFlowMapResult {
  if (!data) {
    return errorResult('Project data not loaded / 项目数据尚未加载');
  }

  const flow = data.flows.find((item) => item.id === flowId);
  if (!flow) {
    return errorResult(`Flow not found: ${flowId} / 未找到流程`);
  }

  const mergedOptions: Required<FlowMapOptions> = {
    showReads: options.showReads,
    showTables: options.showTables,
    schemasOnly: options.schemasOnly,
    maxTablesPerSchema: options.maxTablesPerSchema ?? DEFAULT_MAX_TABLES_PER_SCHEMA,
  };

  const aliasMap = buildAliasMap(data);
  const groupedReads = groupReads(flow, aliasMap);
  const groupedWrites = groupWrites(flow, aliasMap);

  const lines: string[] = [];
  lines.push('graph LR');
  lines.push(`FLOW["${escapeLabel(flowTitle(flow))}"]`);
  lines.push('ACT["Actor / 触发方"]');
  lines.push(`SVC["${escapeLabel(serviceLabel(data, flow.owner_service))}"]`);
  lines.push('READS["Reads / 读取"]');
  lines.push('WRITES["Writes / 写入"]');
  lines.push('EVTS["Events / 事件"]');
  lines.push('OUT["outbox / Outbox 投递"]');
  lines.push('BUS["Event Bus / 事件总线"]');
  lines.push('CONS["Consumer / 消费者"]');
  lines.push('SIDE["Read Models & Side Effects / 读模型与副作用"]');
  lines.push('FLOW --> ACT');
  lines.push('ACT --> SVC');
  if (mergedOptions.showReads) {
    lines.push('SVC --> READS');
    appendReadNodes(lines, groupedReads, mergedOptions);
  }
  lines.push('SVC --> WRITES');
  appendWriteNodes(lines, groupedWrites, mergedOptions);
  lines.push('SVC --> EVTS');
  appendEventNodes(lines, flow);
  lines.push('EVTS --> OUT');
  lines.push('OUT --> BUS');
  lines.push('BUS --> CONS');
  lines.push('CONS --> SIDE');

  return { mermaidCode: `${lines.join('\n')}\n` };
}
