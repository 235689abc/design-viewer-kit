import { buildProjectIndexes, hasWriteOps } from './indexes';
import { getViewerPolicy, isPolicyTable } from './policy';
import type { ProjectData } from './useProjectData';

export type GovernanceSeverity = 'violation' | 'warning';

export type GovernanceIssue = {
  id: string;
  severity: GovernanceSeverity;
  rule: string;
  title: string;
  message: string;
  hint: string;
  flowId?: string;
  table?: string;
  flows?: string[];
  writers?: string[];
};

export type GovernanceRuleResult = {
  violations: GovernanceIssue[];
  warnings: GovernanceIssue[];
  all: GovernanceIssue[];
  byRule: Record<string, GovernanceIssue[]>;
};

const OVERSIZED_FLOW_TOUCH_THRESHOLD = 15;
const WRITE_OPS = new Set(['C', 'U', 'D']);

function isMissingText(value: string | undefined): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

function hasBusinessWrite(tableName: string, policy: ReturnType<typeof getViewerPolicy>): boolean {
  return !isPolicyTable(tableName, policy);
}

function normalizeRuleBuckets(items: GovernanceIssue[]): GovernanceRuleResult {
  const byRule: Record<string, GovernanceIssue[]> = {};
  for (const item of items) {
    if (!byRule[item.rule]) {
      byRule[item.rule] = [];
    }
    byRule[item.rule].push(item);
  }
  const violations = items.filter((item) => item.severity === 'violation');
  const warnings = items.filter((item) => item.severity === 'warning');
  return { violations, warnings, all: items, byRule };
}

function joinUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function flowWritesByTable(flow: ProjectData['flows'][number], canonical: (name: string) => string): Map<string, Set<string>> {
  const tableOps = new Map<string, Set<string>>();
  for (const write of flow.writes ?? []) {
    const tableName = canonical(write.table);
    const op = (write.op ?? '').toUpperCase();
    if (!tableName || !op) {
      continue;
    }
    if (!tableOps.has(tableName)) {
      tableOps.set(tableName, new Set<string>());
    }
    tableOps.get(tableName)?.add(op);
  }
  return tableOps;
}

function hasAnyWriteOps(ops: Set<string> | undefined): boolean {
  if (!ops) {
    return false;
  }
  for (const op of ops) {
    if (WRITE_OPS.has(op)) {
      return true;
    }
  }
  return false;
}

export function runGovernanceChecks(data: ProjectData | null): GovernanceRuleResult {
  if (!data) {
    return normalizeRuleBuckets([]);
  }

 const issues: GovernanceIssue[] = [];
 const indexes = buildProjectIndexes(data);
  const policy = getViewerPolicy(data);
  const serviceSet = new Set(data.services.map((svc) => svc.id));
  const aliasTableSet = new Set(
    data.tables.filter((table) => !!table.alias_of).map((table) => table.name),
  );

  // R1. MULTI_WRITER
  for (const table of data.tables) {
    if (table.alias_of) {
      continue;
    }
    const canonicalTable = indexes.canonicalTableName(table.name);
    if (table.state !== 'existing') {
      continue;
    }
    if (policy.allowMultiWriterTables.has(canonicalTable)) {
      continue;
    }
    const edges = indexes.edgesByTable.get(canonicalTable) ?? [];
    const writers = new Set<string>();
    for (const edge of edges) {
      if (!hasWriteOps(edge.ops)) {
        continue;
      }
      const flow = indexes.flowById.get(edge.flow_id);
      if (flow?.owner_service) {
        writers.add(flow.owner_service);
      }
    }
    if (writers.size > 1) {
      issues.push({
        id: `R1:${canonicalTable}`,
        severity: 'violation',
        rule: 'MULTI_WRITER',
        title: 'Multi-writer authoritative table',
        message: `${canonicalTable} is written by multiple services: ${Array.from(writers).join(', ')}`,
        hint: 'Choose a single owner service or split the table by ownership boundary.',
        table: canonicalTable,
        writers: Array.from(writers).sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  // R2, R3, R7 flow-level checks
  for (const flow of data.flows) {
    const writes = flowWritesByTable(flow, indexes.canonicalTableName);
    const writesBusinessTables = Array.from(writes.entries())
      .filter(([tableName, ops]) => hasBusinessWrite(tableName, policy) && hasAnyWriteOps(ops))
      .map(([tableName]) => tableName);
    const uniqueTouchedTables = new Set<string>();
    for (const readTable of flow.reads ?? []) {
      uniqueTouchedTables.add(indexes.canonicalTableName(readTable));
    }
    for (const write of flow.writes ?? []) {
      uniqueTouchedTables.add(indexes.canonicalTableName(write.table));
    }

    if (writesBusinessTables.length > 0) {
      const hasAuditEventsC = (writes.get(policy.eventTable) ?? new Set()).has('C');
      const hasAuditOutboxC = (writes.get(policy.outboxTable) ?? new Set()).has('C');
      const missing: string[] = [];
      if (!hasAuditEventsC) {
        missing.push(`${policy.eventTable}:C`);
      }
      if (!hasAuditOutboxC) {
        missing.push(`${policy.outboxTable}:C`);
      }
      if (missing.length > 0) {
        issues.push({
          id: `R2:${flow.id}`,
          severity: 'violation',
          rule: 'WRITE_WITHOUT_AUDIT',
          title: 'Write flow missing audit trail',
          message: `${flow.id} writes business tables but misses ${missing.join(', ')}.`,
          hint: `Ensure transactional write includes ${policy.eventTable}:C and ${policy.outboxTable}:C`,
          flowId: flow.id,
          flows: [flow.id],
        });
      }

      if (isMissingText(flow.idempotency_key)) {
        issues.push({
          id: `R3:${flow.id}`,
          severity: 'warning',
          rule: 'MISSING_IDEMPOTENCY',
          title: 'Write flow missing idempotency key',
          message: `${flow.id} writes business tables but idempotency_key is empty/TBD.`,
          hint: 'Define a stable idempotency_key for retries and deduplication.',
          flowId: flow.id,
          flows: [flow.id],
        });
      }
    }

    if (uniqueTouchedTables.size > OVERSIZED_FLOW_TOUCH_THRESHOLD) {
      issues.push({
        id: `R7:${flow.id}`,
        severity: 'warning',
        rule: 'OVERSIZED_FLOW_SURFACE',
        title: 'Flow touch surface too large',
        message: `${flow.id} touches ${uniqueTouchedTables.size} tables (threshold ${OVERSIZED_FLOW_TOUCH_THRESHOLD}).`,
        hint: 'Consider splitting this flow into staged flows or bounded sub-flows.',
        flowId: flow.id,
        flows: [flow.id],
      });
    }
  }

  // R4. planned table written
  for (const table of data.tables) {
    if (table.alias_of || table.state !== 'planned') {
      continue;
    }
    const canonicalTable = indexes.canonicalTableName(table.name);
    const edges = indexes.edgesByTable.get(canonicalTable) ?? [];
    const writerFlows = joinUnique(
      edges.filter((edge) => hasWriteOps(edge.ops)).map((edge) => edge.flow_id),
    );
    if (writerFlows.length > 0) {
      issues.push({
        id: `R4:${canonicalTable}`,
        severity: 'warning',
        rule: 'PLANNED_TABLE_WRITTEN',
        title: 'Planned table already written',
        message: `${canonicalTable} is marked planned but written by ${writerFlows.length} flow(s).`,
        hint: 'Align table state with implementation progress or gate writes behind rollout.',
        table: canonicalTable,
        flows: writerFlows,
      });
    }
  }

  // R5. unknown owner_service on table
  for (const table of data.tables) {
    if (table.alias_of) {
      continue;
    }
    const owner = (table.owner_service ?? '').trim();
    if (!owner || !serviceSet.has(owner)) {
      issues.push({
        id: `R5:${table.name}`,
        severity: 'warning',
        rule: 'UNKNOWN_TABLE_OWNER',
        title: 'Unknown table owner_service',
        message: `${table.name} has missing or unknown owner_service (${owner || '-'})`,
        hint: 'Set owner_service to a valid service id from services[].',
        table: table.name,
      });
    }
  }

  // R6. alias leakage in crudEdges
  for (const edge of data.crudEdges) {
    if (!aliasTableSet.has(edge.table)) {
      continue;
    }
    issues.push({
      id: `R6:${edge.flow_id}:${edge.table}`,
      severity: 'warning',
      rule: 'ALIAS_LEAKAGE',
      title: 'Alias table leaked into crudEdges',
      message: `crudEdges contains alias table ${edge.table} in flow ${edge.flow_id}`,
      hint: 'Regenerate index.json and ensure alias tables are canonicalized in edge export.',
      table: edge.table,
      flowId: edge.flow_id,
      flows: [edge.flow_id],
    });
  }

  return normalizeRuleBuckets(issues);
}
