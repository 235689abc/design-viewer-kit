import { orderedSchemas, schemaDisplayLabel, schemaOf } from './schemaUtils';
import type { FlowRecord, ProjectData } from './useProjectData';

const OPS_ORDER = ['C', 'R', 'U', 'D'];

export type FlowImpactOptions = {
  maxTables?: number;
  groupBySchema?: boolean;
  maxTablesPerSchema?: number;
};

export type BuildFlowImpactResult = {
  mermaidCode: string;
  readCollapsed: number;
  writeCollapsed: number;
  error?: string;
};

type GroupedReads = Map<string, string[]>;
type GroupedWrites = Map<string, Array<{ table: string; ops: string }>>;

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

function flowLabel(flow: FlowRecord): string {
  return `${flow.id} | ${flow.name_en} / ${flow.name_zh}`;
}

function groupReads(flow: FlowRecord, aliasMap: Map<string, string>, maxTables: number): {
  grouped: GroupedReads;
  collapsed: number;
} {
  const unique = Array.from(
    new Set(flow.reads.map((table) => canonicalizeTable(table, aliasMap))),
  ).sort((a, b) => a.localeCompare(b));
  const visible = unique.slice(0, maxTables);
  const collapsed = Math.max(0, unique.length - visible.length);

  const grouped = new Map<string, string[]>();
  for (const tableName of visible) {
    const schemaName = schemaOf(tableName);
    if (!grouped.has(schemaName)) {
      grouped.set(schemaName, []);
    }
    grouped.get(schemaName)?.push(tableName);
  }
  return { grouped, collapsed };
}

function groupWrites(flow: FlowRecord, aliasMap: Map<string, string>, maxTables: number): {
  grouped: GroupedWrites;
  collapsed: number;
} {
  const byTable = new Map<string, string>();
  for (const write of flow.writes) {
    const canonical = canonicalizeTable(write.table, aliasMap);
    const prev = byTable.get(canonical) ?? '';
    byTable.set(canonical, mergeOps(prev, write.op));
  }

  const unique = Array.from(byTable.entries())
    .map(([table, ops]) => ({ table, ops: ops || '-' }))
    .sort((a, b) => a.table.localeCompare(b.table));
  const visible = unique.slice(0, maxTables);
  const collapsed = Math.max(0, unique.length - visible.length);

  const grouped = new Map<string, Array<{ table: string; ops: string }>>();
  for (const row of visible) {
    const schemaName = schemaOf(row.table);
    if (!grouped.has(schemaName)) {
      grouped.set(schemaName, []);
    }
    grouped.get(schemaName)?.push(row);
  }
  return { grouped, collapsed };
}

function appendGroupedReadBranch(
  lines: string[],
  groupedReads: GroupedReads,
  maxTablesPerSchema: number,
) {
  const schemas = orderedSchemas(groupedReads.keys());
  if (schemas.length === 0) {
    lines.push('READS --> R_NONE["No reads / 无读取"]');
    lines.push('class R_NONE read;');
    return;
  }

  for (const schemaName of schemas) {
    const schemaNode = safeNodeId('RSCHEMA', schemaName);
    lines.push(`${schemaNode}["${escapeLabel(schemaDisplayLabel(schemaName))}"]`);
    lines.push(`READS --> ${schemaNode}`);
    lines.push(`class ${schemaNode} read;`);

    const tables = groupedReads.get(schemaName) ?? [];
    const visible = tables.slice(0, maxTablesPerSchema);
    const collapsed = Math.max(0, tables.length - visible.length);
    for (const tableName of visible) {
      const tableNode = safeNodeId('RTABLE', `${schemaName}_${tableName}`);
      lines.push(`${tableNode}["${escapeLabel(`${tableName} (R)`)}"]`);
      lines.push(`${schemaNode} --> ${tableNode}`);
      lines.push(`class ${tableNode} read;`);
    }
    if (collapsed > 0) {
      const moreNode = safeNodeId('R_MORE', `${schemaName}_${collapsed}`);
      lines.push(`${moreNode}["+${collapsed} more / 其余${collapsed}"]`);
      lines.push(`${schemaNode} --> ${moreNode}`);
      lines.push(`class ${moreNode} read;`);
    }
  }
}

function appendGroupedWriteBranch(
  lines: string[],
  groupedWrites: GroupedWrites,
  maxTablesPerSchema: number,
) {
  const schemas = orderedSchemas(groupedWrites.keys());
  if (schemas.length === 0) {
    lines.push('WRITES --> W_NONE["No writes / 无写入"]');
    lines.push('class W_NONE write;');
    return;
  }

  for (const schemaName of schemas) {
    const schemaNode = safeNodeId('WSCHEMA', schemaName);
    lines.push(`${schemaNode}["${escapeLabel(schemaDisplayLabel(schemaName))}"]`);
    lines.push(`WRITES --> ${schemaNode}`);
    lines.push(`class ${schemaNode} write;`);

    const tables = groupedWrites.get(schemaName) ?? [];
    const visible = tables.slice(0, maxTablesPerSchema);
    const collapsed = Math.max(0, tables.length - visible.length);
    for (const row of visible) {
      const tableNode = safeNodeId('WTABLE', `${schemaName}_${row.table}`);
      lines.push(`${tableNode}["${escapeLabel(`${row.table} (${row.ops})`)}"]`);
      lines.push(`${schemaNode} --> ${tableNode}`);
      lines.push(`class ${tableNode} write;`);
    }
    if (collapsed > 0) {
      const moreNode = safeNodeId('W_MORE', `${schemaName}_${collapsed}`);
      lines.push(`${moreNode}["+${collapsed} more / 其余${collapsed}"]`);
      lines.push(`${schemaNode} --> ${moreNode}`);
      lines.push(`class ${moreNode} write;`);
    }
  }
}

function appendFlatReadBranch(lines: string[], groupedReads: GroupedReads) {
  const tables = Array.from(groupedReads.values())
    .flatMap((rows) => rows)
    .sort((a, b) => a.localeCompare(b));
  if (tables.length === 0) {
    lines.push('READS --> R_NONE["No reads / 无读取"]');
    lines.push('class R_NONE read;');
    return;
  }
  for (const tableName of tables) {
    const tableNode = safeNodeId('RTABLE', tableName);
    lines.push(`${tableNode}["${escapeLabel(`${tableName} (R)`)}"]`);
    lines.push(`READS --> ${tableNode}`);
    lines.push(`class ${tableNode} read;`);
  }
}

function appendFlatWriteBranch(lines: string[], groupedWrites: GroupedWrites) {
  const tables = Array.from(groupedWrites.values())
    .flatMap((rows) => rows)
    .sort((a, b) => a.table.localeCompare(b.table));
  if (tables.length === 0) {
    lines.push('WRITES --> W_NONE["No writes / 无写入"]');
    lines.push('class W_NONE write;');
    return;
  }
  for (const row of tables) {
    const tableNode = safeNodeId('WTABLE', row.table);
    lines.push(`${tableNode}["${escapeLabel(`${row.table} (${row.ops})`)}"]`);
    lines.push(`WRITES --> ${tableNode}`);
    lines.push(`class ${tableNode} write;`);
  }
}

function errorResult(message: string): BuildFlowImpactResult {
  return {
    mermaidCode: `graph TB\nERR["${escapeLabel(message)}"]\n`,
    readCollapsed: 0,
    writeCollapsed: 0,
    error: message,
  };
}

export function buildFlowImpactMermaid(
  data: ProjectData | null,
  flowId: string,
  options: FlowImpactOptions = {},
): BuildFlowImpactResult {
  if (!data) {
    return errorResult('Project data not loaded / 项目数据尚未加载');
  }

  const flow = data.flows.find((item) => item.id === flowId);
  if (!flow) {
    return errorResult(`Flow not found: ${flowId} / 未找到流程`);
  }

  const maxTables = Math.max(1, options.maxTables ?? 25);
  const groupBySchema = options.groupBySchema ?? true;
  const maxTablesPerSchema = Math.max(1, options.maxTablesPerSchema ?? 12);

  const aliasMap = buildAliasMap(data);
  const readPart = groupReads(flow, aliasMap, maxTables);
  const writePart = groupWrites(flow, aliasMap, maxTables);

  const lines: string[] = [];
  lines.push('graph TB');
  lines.push('classDef center fill:#f8fafc,stroke:#64748b,color:#0f172a;');
  lines.push('classDef read fill:#eef3ff,stroke:#3563d9,color:#0f172a;');
  lines.push('classDef write fill:#eaf7ee,stroke:#2f855a,color:#0f172a;');
  lines.push(`FLOW["${escapeLabel(flowLabel(flow))}"]`);
  lines.push('READS["Reads / 读取"]');
  lines.push('WRITES["Writes / 写入"]');
  lines.push('READS --> FLOW');
  lines.push('FLOW --> WRITES');
  lines.push('class FLOW center;');
  lines.push('class READS read;');
  lines.push('class WRITES write;');

  if (groupBySchema) {
    appendGroupedReadBranch(lines, readPart.grouped, maxTablesPerSchema);
    appendGroupedWriteBranch(lines, writePart.grouped, maxTablesPerSchema);
  } else {
    appendFlatReadBranch(lines, readPart.grouped);
    appendFlatWriteBranch(lines, writePart.grouped);
  }

  if (readPart.collapsed > 0) {
    lines.push(`READS --> R_COLLAPSED["+${readPart.collapsed} more reads / 其余${readPart.collapsed}读取"]`);
    lines.push('class R_COLLAPSED read;');
  }
  if (writePart.collapsed > 0) {
    lines.push(`WRITES --> W_COLLAPSED["+${writePart.collapsed} more writes / 其余${writePart.collapsed}写入"]`);
    lines.push('class W_COLLAPSED write;');
  }

  return {
    mermaidCode: `${lines.join('\n')}\n`,
    readCollapsed: readPart.collapsed,
    writeCollapsed: writePart.collapsed,
  };
}
