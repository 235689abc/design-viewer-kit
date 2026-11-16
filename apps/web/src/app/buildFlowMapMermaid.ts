import { dl, type DiagramLocale } from './diagramLabels';
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
  locale?: DiagramLocale;
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

function serviceLabel(data: ProjectData, ownerService: string, locale: DiagramLocale): string {
  const service = data.services.find((item) => item.id === ownerService);
  if (!service) {
    return ownerService || 'unknown';
  }
  return `${ownerService} | ${locale === 'zh' ? service.name_zh : service.name_en}`;
}

function flowTitle(flow: FlowRecord, locale: DiagramLocale): string {
  const en = flow.name_en || flow.id;
  const zh = flow.name_zh || flow.name_en || flow.id;
  return `${flow.id} — ${locale === 'zh' ? zh : en}`;
}

function appendReadNodes(
  lines: string[],
  groupedReads: GroupedReadTables,
  options: Required<FlowMapOptions>,
) {
  const schemas = orderedSchemas(groupedReads.keys());
  if (schemas.length === 0) {
    lines.push(`READS --> READS_NONE["${dl(options.locale, 'No reads', '无读取')}"]`);
    return;
  }

  const showTableNodes = options.showTables && !options.schemasOnly;
  for (const schemaName of schemas) {
    const schemaNodeId = safeNodeId('RSCHEMA', schemaName);
    lines.push(`${schemaNodeId}["${escapeLabel(schemaDisplayLabel(schemaName, options.locale))}"]`);
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
      lines.push(
        `${moreNodeId}["${dl(options.locale, `+${hiddenCount} more`, `其余${hiddenCount}`)}"]`,
      );
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
    lines.push(`WRITES --> WRITES_NONE["${dl(options.locale, 'No writes', '无写入')}"]`);
    return;
  }

  const showTableNodes = options.showTables && !options.schemasOnly;
  for (const schemaName of schemas) {
    const schemaNodeId = safeNodeId('WSCHEMA', schemaName);
    lines.push(`${schemaNodeId}["${escapeLabel(schemaDisplayLabel(schemaName, options.locale))}"]`);
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
      lines.push(
        `${moreNodeId}["${dl(options.locale, `+${hiddenCount} more`, `其余${hiddenCount}`)}"]`,
      );
      lines.push(`${schemaNodeId} --> ${moreNodeId}`);
    }
  }
}

function appendEventNodes(lines: string[], flow: FlowRecord, locale: DiagramLocale) {
  const events = Array.from(
    new Set(
      flow.events_appended
        .map((eventName) => eventName.trim())
        .filter((eventName) => eventName.length > 0),
    ),
  );

  if (events.length === 0) {
    lines.push(`EVTS --> EVT_NONE["${dl(locale, 'No events', '无事件')}"]`);
    return;
  }

  if (events.length > EVENT_NODE_LIMIT) {
    lines.push(
      `EVTS --> EVT_COUNT["${dl(locale, `${events.length} events`, `${events.length}个事件`)}"]`,
    );
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
  const locale: DiagramLocale = options.locale ?? 'zh';
  if (!data) {
    return errorResult(dl(locale, 'Project data not loaded', '项目数据尚未加载'));
  }

  const flow = data.flows.find((item) => item.id === flowId);
  if (!flow) {
    return errorResult(dl(locale, `Flow not found: ${flowId}`, `未找到流程:${flowId}`));
  }

  const mergedOptions: Required<FlowMapOptions> = {
    showReads: options.showReads,
    showTables: options.showTables,
    schemasOnly: options.schemasOnly,
    maxTablesPerSchema: options.maxTablesPerSchema ?? DEFAULT_MAX_TABLES_PER_SCHEMA,
    locale,
  };

  const aliasMap = buildAliasMap(data);
  const groupedReads = groupReads(flow, aliasMap);
  const groupedWrites = groupWrites(flow, aliasMap);

  const lines: string[] = [];
  lines.push('graph LR');
  lines.push(`FLOW["${escapeLabel(flowTitle(flow, locale))}"]`);
  lines.push(`ACT["${dl(locale, 'Actor', '触发方')}"]`);
  lines.push(`SVC["${escapeLabel(serviceLabel(data, flow.owner_service, locale))}"]`);
  lines.push(`READS["${dl(locale, 'Reads', '读取')}"]`);
  lines.push(`WRITES["${dl(locale, 'Writes', '写入')}"]`);
  lines.push(`EVTS["${dl(locale, 'Events', '事件')}"]`);
  lines.push(`OUT["${dl(locale, 'outbox', 'Outbox 投递')}"]`);
  lines.push(`BUS["${dl(locale, 'Event Bus', '事件总线')}"]`);
  lines.push(`CONS["${dl(locale, 'Consumer', '消费者')}"]`);
  lines.push(`SIDE["${dl(locale, 'Read Models & Side Effects', '读模型与副作用')}"]`);
  lines.push('FLOW --> ACT');
  lines.push('ACT --> SVC');
  if (mergedOptions.showReads) {
    lines.push('SVC --> READS');
    appendReadNodes(lines, groupedReads, mergedOptions);
  }
  lines.push('SVC --> WRITES');
  appendWriteNodes(lines, groupedWrites, mergedOptions);
  lines.push('SVC --> EVTS');
  appendEventNodes(lines, flow, locale);
  lines.push('EVTS --> OUT');
  lines.push('OUT --> BUS');
  lines.push('BUS --> CONS');
  lines.push('CONS --> SIDE');

  return { mermaidCode: `${lines.join('\n')}\n` };
}
