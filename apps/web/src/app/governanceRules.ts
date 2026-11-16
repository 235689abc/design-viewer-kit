import { buildProjectIndexes, hasWriteOps } from './indexes';
import { getViewerPolicy, isPolicyTable } from './policy';
import type { ProjectData } from './useProjectData';
import { dl, type DiagramLocale } from './diagramLabels';

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

export function runGovernanceChecks(
  data: ProjectData | null,
  locale: DiagramLocale = 'zh',
): GovernanceRuleResult {
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
      const writerList = Array.from(writers).join(', ');
      issues.push({
        id: `R1:${canonicalTable}`,
        severity: 'violation',
        rule: 'MULTI_WRITER',
        title: dl(locale, 'Multi-writer authoritative table', '多写者权威表'),
        message: dl(
          locale,
          `${canonicalTable} is written by multiple services: ${writerList}`,
          `${canonicalTable} 被多个服务写入:${writerList}`,
        ),
        hint: dl(
          locale,
          'Choose a single owner service or split the table by ownership boundary.',
          '指定唯一归属服务,或按所有权边界拆分该表。',
        ),
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
        const missingList = missing.join(', ');
        issues.push({
          id: `R2:${flow.id}`,
          severity: 'violation',
          rule: 'WRITE_WITHOUT_AUDIT',
          title: dl(locale, 'Write flow missing audit trail', '写流程缺失审计链路'),
          message: dl(
            locale,
            `${flow.id} writes business tables but misses ${missingList}.`,
            `${flow.id} 写业务表但缺少 ${missingList}。`,
          ),
          hint: dl(
            locale,
            `Ensure transactional write includes ${policy.eventTable}:C and ${policy.outboxTable}:C`,
            `确保事务写入包含 ${policy.eventTable}:C 与 ${policy.outboxTable}:C`,
          ),
          flowId: flow.id,
          flows: [flow.id],
        });
      }

      if (isMissingText(flow.idempotency_key)) {
        issues.push({
          id: `R3:${flow.id}`,
          severity: 'warning',
          rule: 'MISSING_IDEMPOTENCY',
          title: dl(locale, 'Write flow missing idempotency key', '写流程缺失幂等键'),
          message: dl(
            locale,
            `${flow.id} writes business tables but idempotency_key is empty/TBD.`,
            `${flow.id} 写业务表但 idempotency_key 为空/TBD。`,
          ),
          hint: dl(
            locale,
            'Define a stable idempotency_key for retries and deduplication.',
            '为重试与去重定义稳定的 idempotency_key。',
          ),
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
        title: dl(locale, 'Flow touch surface too large', '流程触达面过大'),
        message: dl(
          locale,
          `${flow.id} touches ${uniqueTouchedTables.size} tables (threshold ${OVERSIZED_FLOW_TOUCH_THRESHOLD}).`,
          `${flow.id} 触达 ${uniqueTouchedTables.size} 张表(阈值 ${OVERSIZED_FLOW_TOUCH_THRESHOLD})。`,
        ),
        hint: dl(
          locale,
          'Consider splitting this flow into staged flows or bounded sub-flows.',
          '考虑把该流程拆成分阶段流程或边界清晰的子流程。',
        ),
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
        title: dl(locale, 'Planned table already written', '规划中的表已被写入'),
        message: dl(
          locale,
          `${canonicalTable} is marked planned but written by ${writerFlows.length} flow(s).`,
          `${canonicalTable} 标记为 planned,但已有 ${writerFlows.length} 个流程写入。`,
        ),
        hint: dl(
          locale,
          'Align table state with implementation progress or gate writes behind rollout.',
          '让表状态与实施进度对齐,或在发布控制后再放开写入。',
        ),
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
        title: dl(locale, 'Unknown table owner_service', '表 owner_service 未知'),
        message: dl(
          locale,
          `${table.name} has missing or unknown owner_service (${owner || '-'})`,
          `${table.name} 缺失或未知的 owner_service(${owner || '-'})`,
        ),
        hint: dl(
          locale,
          'Set owner_service to a valid service id from services[].',
          '把 owner_service 设置为 services[] 中的有效服务 id。',
        ),
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
      title: dl(locale, 'Alias table leaked into crudEdges', '别名表泄漏进 crudEdges'),
      message: dl(
        locale,
        `crudEdges contains alias table ${edge.table} in flow ${edge.flow_id}`,
        `crudEdges 在流程 ${edge.flow_id} 中包含别名表 ${edge.table}`,
      ),
      hint: dl(
        locale,
        'Regenerate index.json and ensure alias tables are canonicalized in edge export.',
        '重新生成 index.json,并确保边导出时别名表已规范化。',
      ),
      table: edge.table,
      flowId: edge.flow_id,
      flows: [edge.flow_id],
    });
  }

  return normalizeRuleBuckets(issues);
}
