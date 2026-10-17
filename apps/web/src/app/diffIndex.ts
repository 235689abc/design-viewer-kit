import type { CrudEdgeRecord, FlowRecord, ProjectData, TableRecord } from './useProjectData';

type ChangedFlowRecord = {
  id: string;
  changedFields: string[];
};

export type DiffSummary = {
  addedTables: TableRecord[];
  removedTables: TableRecord[];
  addedFlows: FlowRecord[];
  removedFlows: FlowRecord[];
  changedFlows: ChangedFlowRecord[];
  crudEdges: {
    addedPairs: number;
    removedPairs: number;
    changedPairs: number;
    addedOps: number;
    removedOps: number;
  };
};

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeStringArray(items: string[]): string[] {
  return [...(items ?? [])]
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function writesSignature(items: FlowRecord['writes']): string {
  const normalized = (items ?? [])
    .map((write) => `${normalizeText(write.table)}:${normalizeText(write.op).toUpperCase()}`)
    .filter((entry) => entry !== ':')
    .sort((a, b) => a.localeCompare(b));
  return normalized.join('|');
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function countOpsDiff(fromOps: string, toOps: string): { added: number; removed: number } {
  const fromSet = new Set(fromOps.split(''));
  const toSet = new Set(toOps.split(''));
  let added = 0;
  let removed = 0;
  for (const op of toSet) {
    if (!fromSet.has(op)) {
      added += 1;
    }
  }
  for (const op of fromSet) {
    if (!toSet.has(op)) {
      removed += 1;
    }
  }
  return { added, removed };
}

function mapByTable(tables: TableRecord[]): Map<string, TableRecord> {
  return new Map((tables ?? []).map((table) => [table.name, table]));
}

function mapByFlow(flows: FlowRecord[]): Map<string, FlowRecord> {
  return new Map((flows ?? []).map((flow) => [flow.id, flow]));
}

function mapCrudEdges(edges: CrudEdgeRecord[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const edge of edges ?? []) {
    out.set(`${edge.flow_id}::${edge.table}`, edge.ops ?? '');
  }
  return out;
}

function compareFlowFields(before: FlowRecord, after: FlowRecord): string[] {
  const changed: string[] = [];
  if (normalizeText(before.owner_service) !== normalizeText(after.owner_service)) {
    changed.push('owner_service');
  }
  if (normalizeText(before.idempotency_key) !== normalizeText(after.idempotency_key)) {
    changed.push('idempotency_key');
  }
  if (!arraysEqual(normalizeStringArray(before.reads), normalizeStringArray(after.reads))) {
    changed.push('reads');
  }
  if (writesSignature(before.writes) !== writesSignature(after.writes)) {
    changed.push('writes');
  }
  if (
    !arraysEqual(
      normalizeStringArray(before.events_appended),
      normalizeStringArray(after.events_appended),
    )
  ) {
    changed.push('events_appended');
  }
  return changed;
}

export function diffIndexes(before: ProjectData, after: ProjectData): DiffSummary {
  const beforeTables = mapByTable(before.tables ?? []);
  const afterTables = mapByTable(after.tables ?? []);
  const beforeFlows = mapByFlow(before.flows ?? []);
  const afterFlows = mapByFlow(after.flows ?? []);

  const addedTables: TableRecord[] = [];
  const removedTables: TableRecord[] = [];
  for (const [name, table] of afterTables.entries()) {
    if (!beforeTables.has(name)) {
      addedTables.push(table);
    }
  }
  for (const [name, table] of beforeTables.entries()) {
    if (!afterTables.has(name)) {
      removedTables.push(table);
    }
  }
  addedTables.sort((a, b) => a.name.localeCompare(b.name));
  removedTables.sort((a, b) => a.name.localeCompare(b.name));

  const addedFlows: FlowRecord[] = [];
  const removedFlows: FlowRecord[] = [];
  const changedFlows: ChangedFlowRecord[] = [];
  for (const [id, flow] of afterFlows.entries()) {
    if (!beforeFlows.has(id)) {
      addedFlows.push(flow);
      continue;
    }
    const beforeFlow = beforeFlows.get(id);
    if (!beforeFlow) {
      continue;
    }
    const changedFields = compareFlowFields(beforeFlow, flow);
    if (changedFields.length > 0) {
      changedFlows.push({ id, changedFields });
    }
  }
  for (const [id, flow] of beforeFlows.entries()) {
    if (!afterFlows.has(id)) {
      removedFlows.push(flow);
    }
  }
  addedFlows.sort((a, b) => a.id.localeCompare(b.id));
  removedFlows.sort((a, b) => a.id.localeCompare(b.id));
  changedFlows.sort((a, b) => a.id.localeCompare(b.id));

  const beforeEdges = mapCrudEdges(before.crudEdges ?? []);
  const afterEdges = mapCrudEdges(after.crudEdges ?? []);
  let addedPairs = 0;
  let removedPairs = 0;
  let changedPairs = 0;
  let addedOps = 0;
  let removedOps = 0;

  for (const [key, ops] of afterEdges.entries()) {
    if (!beforeEdges.has(key)) {
      addedPairs += 1;
      addedOps += new Set(ops.split('')).size;
      continue;
    }
    const beforeOps = beforeEdges.get(key) ?? '';
    if (beforeOps !== ops) {
      changedPairs += 1;
      const delta = countOpsDiff(beforeOps, ops);
      addedOps += delta.added;
      removedOps += delta.removed;
    }
  }
  for (const [key, ops] of beforeEdges.entries()) {
    if (!afterEdges.has(key)) {
      removedPairs += 1;
      removedOps += new Set(ops.split('')).size;
    }
  }

  return {
    addedTables,
    removedTables,
    addedFlows,
    removedFlows,
    changedFlows,
    crudEdges: {
      addedPairs,
      removedPairs,
      changedPairs,
      addedOps,
      removedOps,
    },
  };
}
