import type { CrudEdgeRecord, FlowRecord, ProjectData } from './useProjectData';

const OPS_ORDER = ['C', 'R', 'U', 'D'];

export type TableImpactOptions = {
  maxWriteFlows?: number;
  maxReadFlows?: number;
  focusedFlowId?: string;
};

export type BuildTableImpactResult = {
  mermaidCode: string;
  writeCollapsed: number;
  readCollapsed: number;
  error?: string;
};

type FlowWithOps = {
  flow: FlowRecord;
  ops: string;
};

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

function hasReadOps(ops: string): boolean {
  return ops.includes('R');
}

function hasWriteOps(ops: string): boolean {
  return ops.includes('C') || ops.includes('U') || ops.includes('D');
}

function writeStrength(ops: string): number {
  let score = 0;
  if (ops.includes('C')) score += 8;
  if (ops.includes('U')) score += 4;
  if (ops.includes('D')) score += 2;
  if (ops.includes('R')) score += 1;
  return score;
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

function tableLabel(tableName: string): string {
  return tableName;
}

function flowLabel(flow: FlowRecord, ops: string, focused: boolean): string {
  const star = focused ? '★ ' : '';
  return `${star}${flow.id} | ${flow.name_en} / ${flow.name_zh} (${ops})`;
}

function normalizeEdgesForTable(
  edges: CrudEdgeRecord[],
  tableName: string,
  aliasMap: Map<string, string>,
): Array<{ flow_id: string; ops: string }> {
  const merged = new Map<string, string>();
  const canonicalTarget = canonicalizeTable(tableName, aliasMap);
  for (const edge of edges) {
    if (canonicalizeTable(edge.table, aliasMap) !== canonicalTarget) {
      continue;
    }
    const prev = merged.get(edge.flow_id) ?? '';
    merged.set(edge.flow_id, mergeOps(prev, edge.ops));
  }
  return Array.from(merged.entries()).map(([flow_id, ops]) => ({ flow_id, ops }));
}

function errorResult(message: string): BuildTableImpactResult {
  return {
    mermaidCode: `graph LR\nERR["${escapeLabel(message)}"]\n`,
    writeCollapsed: 0,
    readCollapsed: 0,
    error: message,
  };
}

export function buildTableImpactMermaid(
  data: ProjectData | null,
  tableName: string,
  options: TableImpactOptions = {},
): BuildTableImpactResult {
  if (!data) {
    return errorResult('Project data not loaded / 项目数据尚未加载');
  }

  const maxWriteFlows = Math.max(1, options.maxWriteFlows ?? 15);
  const maxReadFlows = Math.max(1, options.maxReadFlows ?? 15);
  const focusedFlowId = options.focusedFlowId?.trim() ?? '';

  const aliasMap = buildAliasMap(data);
  const canonicalTarget = canonicalizeTable(tableName, aliasMap);
  const tableRecord =
    data.tables.find((table) => table.name === tableName) ??
    data.tables.find((table) => canonicalizeTable(table.name, aliasMap) === canonicalTarget);

  if (!tableRecord && !canonicalTarget) {
    return errorResult(`Table not found: ${tableName} / 未找到数据表`);
  }

  const flowById = new Map<string, FlowRecord>();
  for (const flow of data.flows) {
    flowById.set(flow.id, flow);
  }

  const normalizedEdges = normalizeEdgesForTable(data.crudEdges, canonicalTarget, aliasMap);
  const writeFlows: FlowWithOps[] = [];
  const readFlows: FlowWithOps[] = [];

  for (const item of normalizedEdges) {
    const flow = flowById.get(item.flow_id);
    if (!flow) {
      continue;
    }
    if (hasWriteOps(item.ops)) {
      writeFlows.push({ flow, ops: item.ops });
    }
    if (hasReadOps(item.ops)) {
      readFlows.push({ flow, ops: item.ops });
    }
  }

  writeFlows.sort(
    (a, b) =>
      writeStrength(b.ops) - writeStrength(a.ops) ||
      a.flow.id.localeCompare(b.flow.id),
  );
  readFlows.sort((a, b) => a.flow.id.localeCompare(b.flow.id));

  const visibleWrite = writeFlows.slice(0, maxWriteFlows);
  const visibleRead = readFlows.slice(0, maxReadFlows);
  const writeCollapsed = Math.max(0, writeFlows.length - visibleWrite.length);
  const readCollapsed = Math.max(0, readFlows.length - visibleRead.length);
  const ownerService = tableRecord?.owner_service ?? '';

  const lines: string[] = [];
  lines.push('graph LR');
  lines.push('classDef center fill:#f8fafc,stroke:#64748b,color:#0f172a;');
  lines.push('classDef write fill:#eaf7ee,stroke:#2f855a,color:#0f172a;');
  lines.push('classDef read fill:#eef3ff,stroke:#3563d9,color:#0f172a;');
  lines.push('classDef owner stroke:#b45309,stroke-width:3px,color:#0f172a;');
  lines.push(`TBL["${escapeLabel(tableLabel(canonicalTarget))}"]`);
  lines.push('class TBL center;');

  if (visibleWrite.length === 0) {
    lines.push('W_NONE["No write flows / 无写入流程"] --> TBL');
    lines.push('class W_NONE write;');
  } else {
    for (const row of visibleWrite) {
      const nodeId = safeNodeId('WF', row.flow.id);
      lines.push(
        `${nodeId}["${escapeLabel(flowLabel(row.flow, row.ops, row.flow.id === focusedFlowId))}"] --> TBL`,
      );
      lines.push(`class ${nodeId} write;`);
      if (ownerService && row.flow.owner_service === ownerService) {
        lines.push(`class ${nodeId} owner;`);
      }
    }
    if (writeCollapsed > 0) {
      lines.push(`W_MORE["+${writeCollapsed} more writes / 其余${writeCollapsed}写入"] --> TBL`);
      lines.push('class W_MORE write;');
    }
  }

  if (visibleRead.length === 0) {
    lines.push('TBL --> R_NONE["No read flows / 无读取流程"]');
    lines.push('class R_NONE read;');
  } else {
    for (const row of visibleRead) {
      const nodeId = safeNodeId('RF', row.flow.id);
      lines.push(
        `TBL --> ${nodeId}["${escapeLabel(flowLabel(row.flow, row.ops, row.flow.id === focusedFlowId))}"]`,
      );
      lines.push(`class ${nodeId} read;`);
    }
    if (readCollapsed > 0) {
      lines.push(`TBL --> R_MORE["+${readCollapsed} more reads / 其余${readCollapsed}读取"]`);
      lines.push('class R_MORE read;');
    }
  }

  return {
    mermaidCode: `${lines.join('\n')}\n`,
    writeCollapsed,
    readCollapsed,
  };
}
