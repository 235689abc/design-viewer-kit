import { buildProjectIndexes } from './indexes';
import { getViewerPolicy, isPolicyTable } from './policy';
import type { RuntimeFlowMetric } from './runtimeMetrics';
import type { FlowRecord, ProjectData } from './useProjectData';
import { dl, type DiagramLocale } from './diagramLabels';

export type DeliveryStatus = 'pass' | 'fail' | 'unknown';

export type DeliveryChecklistItem = {
  key: string;
  label: string;
  weight: number;
  status: DeliveryStatus;
  note: string;
};

export type FlowDeliveryChecklist = {
  flowId: string;
  score: number;
  mode: 'design-only' | 'design+runtime';
  achievedWeight: number;
  maxWeight: number;
  items: DeliveryChecklistItem[];
  suggestions: string[];
};

type ChecklistContext = {
  data: ProjectData;
  flow: FlowRecord;
  runtimeMetric?: RuntimeFlowMetric;
  runtimeEnabled: boolean;
  runtimeAvailable: boolean;
  locale?: DiagramLocale;
};

function isMissingText(value: string | undefined): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

function item(
  key: string,
  label: string,
  weight: number,
  status: DeliveryStatus,
  note: string,
): DeliveryChecklistItem {
  return { key, label, weight, status, note };
}

function hasBusinessWrites(
  flow: FlowRecord,
  canonical: (name: string) => string,
  policy: ReturnType<typeof getViewerPolicy>,
): boolean {
  for (const write of flow.writes ?? []) {
    const tableName = canonical(write.table);
    const op = (write.op ?? '').toUpperCase();
    if (!isPolicyTable(tableName, policy) && (op === 'C' || op === 'U' || op === 'D')) {
      return true;
    }
  }
  return false;
}

function hasWrite(flow: FlowRecord, tableName: string, op: string, canonical: (name: string) => string): boolean {
  for (const write of flow.writes ?? []) {
    const table = canonical(write.table);
    if (table === tableName && (write.op ?? '').toUpperCase() === op) {
      return true;
    }
  }
  return false;
}

function scoreFor(items: DeliveryChecklistItem[]): {
  achievedWeight: number;
  maxWeight: number;
  score: number;
} {
  let achievedWeight = 0;
  let maxWeight = 0;
  for (const check of items) {
    if (check.status === 'unknown') {
      continue;
    }
    maxWeight += check.weight;
    if (check.status === 'pass') {
      achievedWeight += check.weight;
    }
  }
  if (maxWeight <= 0) {
    return { achievedWeight, maxWeight, score: 0 };
  }
  return {
    achievedWeight,
    maxWeight,
    score: Math.round((achievedWeight / maxWeight) * 100),
  };
}

function suggestionsFromItems(
  items: DeliveryChecklistItem[],
  policy: ReturnType<typeof getViewerPolicy>,
  locale: DiagramLocale,
): string[] {
  const suggestions: string[] = [];
  for (const check of items) {
    if (check.status !== 'fail') {
      continue;
    }
    switch (check.key) {
      case 'C1_OWNER':
        suggestions.push(
          dl(locale, 'Set owner_service to a valid service id.', '将 owner_service 设置为有效的服务 id。'),
        );
        break;
      case 'C2_IDEMPOTENCY':
        suggestions.push(
          dl(
            locale,
            'Add a stable idempotency_key for this write flow.',
            '为该写流程补充稳定的 idempotency_key。',
          ),
        );
        break;
      case 'C3_AUDIT_EVENTS':
        suggestions.push(
          dl(
            locale,
            `Append ${policy.eventTable}:C in the write transaction.`,
            `在写事务中追加 ${policy.eventTable}:C。`,
          ),
        );
        break;
      case 'C4_OUTBOX':
        suggestions.push(
          dl(
            locale,
            `Insert ${policy.outboxTable}:C in the same transaction.`,
            `在同一事务中写入 ${policy.outboxTable}:C。`,
          ),
        );
        break;
      case 'C5_EVENTS_APPENDED':
        suggestions.push(
          dl(locale, 'Define at least one events_appended entry.', '至少声明一条 events_appended。'),
        );
        break;
      case 'C7_INTRODUCED':
        suggestions.push(
          dl(
            locale,
            'Replace introduced_in TBD with concrete migration/doc path.',
            '把 introduced_in 的 TBD 换成具体的迁移/文档路径。',
          ),
        );
        break;
      case 'C8_DOC_PATH':
        suggestions.push(
          dl(
            locale,
            'Set doc_path to docs/flows/... for traceable design docs.',
            '把 doc_path 设为 docs/flows/... 以便溯源设计文档。',
          ),
        );
        break;
      case 'R1_RECENT':
        suggestions.push(
          dl(
            locale,
            'Verify runtime pipeline and ensure recent executions are visible.',
            '检查运行态链路,确保最近执行记录可见。',
          ),
        );
        break;
      case 'R2_OUTBOX_HEALTH':
        suggestions.push(
          dl(
            locale,
            'Investigate pending/failed deliveries and outbox consumer health.',
            '排查待投递/失败投递与 outbox 消费者健康度。',
          ),
        );
        break;
      case 'R3_PROCESSED':
        suggestions.push(
          dl(
            locale,
            'Confirm consumer processed evidence is being recorded.',
            '确认消费者已处理证据正在被记录。',
          ),
        );
        break;
      default:
        suggestions.push(check.note);
    }
  }
  return Array.from(new Set(suggestions));
}

function buildChecklist(ctx: ChecklistContext): FlowDeliveryChecklist {
  const { data, flow, runtimeMetric, runtimeEnabled, runtimeAvailable } = ctx;
  const locale = ctx.locale ?? 'zh';
  const indexes = buildProjectIndexes(data);
  const canonical = indexes.canonicalTableName;
  const policy = getViewerPolicy(data);
  const writeFlow = hasBusinessWrites(flow, canonical, policy);

  const checks: DeliveryChecklistItem[] = [];

  checks.push(
    item(
      'C1_OWNER',
      dl(locale, 'Has owner_service', '有 owner_service'),
      5,
      isMissingText(flow.owner_service) ? 'fail' : 'pass',
      isMissingText(flow.owner_service) ? 'owner_service is empty/TBD' : 'owner_service is set',
    ),
  );

  checks.push(
    item(
      'C2_IDEMPOTENCY',
      dl(locale, 'Has idempotency_key', '有幂等键'),
      10,
      writeFlow && isMissingText(flow.idempotency_key) ? 'fail' : 'pass',
      writeFlow
        ? isMissingText(flow.idempotency_key)
          ? 'write flow missing idempotency_key'
          : 'idempotency key provided'
        : 'not required for non-write flow',
    ),
  );

  checks.push(
    item(
      'C3_AUDIT_EVENTS',
      dl(locale, `Writes ${policy.eventTable}:C`, `写 ${policy.eventTable}:C`),
     10,
      writeFlow && !hasWrite(flow, policy.eventTable, 'C', canonical) ? 'fail' : 'pass',
     writeFlow
        ? hasWrite(flow, policy.eventTable, 'C', canonical)
          ? `${policy.eventTable} append present`
          : `missing ${policy.eventTable}:C`
        : 'not required for non-write flow',
    ),
  );

  checks.push(
    item(
      'C4_OUTBOX',
      dl(locale, `Writes ${policy.outboxTable}:C`, `写 ${policy.outboxTable}:C`),
     10,
      writeFlow && !hasWrite(flow, policy.outboxTable, 'C', canonical) ? 'fail' : 'pass',
     writeFlow
        ? hasWrite(flow, policy.outboxTable, 'C', canonical)
         ? 'outbox write present'
          : `missing ${policy.outboxTable}:C`
        : 'not required for non-write flow',
    ),
  );

  checks.push(
    item(
      'C5_EVENTS_APPENDED',
      dl(locale, 'Has events_appended', '有 events_appended'),
      5,
      (flow.events_appended ?? []).length > 0 ? 'pass' : 'fail',
      (flow.events_appended ?? []).length > 0 ? 'events declared' : 'events_appended is empty',
    ),
  );

  checks.push(
    item(
      'C6_RW_DECLARED',
      dl(locale, 'Reads/Writes declared', '读写声明'),
      5,
      Array.isArray(flow.reads) && Array.isArray(flow.writes) ? 'pass' : 'fail',
      Array.isArray(flow.reads) && Array.isArray(flow.writes)
        ? 'reads/writes fields are present'
        : 'reads/writes fields missing',
    ),
  );

  checks.push(
    item(
      'C7_INTRODUCED',
      dl(locale, 'introduced_in not TBD', 'introduced_in 非 TBD'),
      5,
      isMissingText(flow.introduced_in) ? 'fail' : 'pass',
      isMissingText(flow.introduced_in) ? 'introduced_in is empty/TBD' : 'introduced_in is set',
    ),
  );

  const hasDocPath = !isMissingText(flow.doc_path) && flow.doc_path.startsWith('docs/flows');
  checks.push(
    item(
      'C8_DOC_PATH',
      dl(locale, 'doc_path exists', '文档路径存在'),
      5,
      hasDocPath ? 'pass' : 'fail',
      hasDocPath ? 'doc_path follows docs/flows/*' : 'doc_path missing or not under docs/flows',
    ),
  );

  if (!runtimeEnabled) {
    checks.push(
      item('R1_RECENT', dl(locale, 'Runtime recent records', '最近运行记录'), 10, 'unknown', 'runtime disabled'),
      item('R2_OUTBOX_HEALTH', dl(locale, 'Outbox delivery health', 'Outbox 健康度'), 10, 'unknown', 'runtime disabled'),
      item('R3_PROCESSED', dl(locale, 'Processed evidence', '已处理证据'), 10, 'unknown', 'runtime disabled'),
    );
  } else if (!runtimeAvailable || !runtimeMetric) {
    checks.push(
      item('R1_RECENT', dl(locale, 'Runtime recent records', '最近运行记录'), 10, 'unknown', 'runtime unavailable'),
      item('R2_OUTBOX_HEALTH', dl(locale, 'Outbox delivery health', 'Outbox 健康度'), 10, 'unknown', 'runtime unavailable'),
      item('R3_PROCESSED', dl(locale, 'Processed evidence', '已处理证据'), 10, 'unknown', 'runtime unavailable'),
    );
  } else {
    checks.push(
      item(
        'R1_RECENT',
        dl(locale, 'Runtime recent records', '最近运行记录'),
        10,
        runtimeMetric.heat > 0 ? 'pass' : 'fail',
        runtimeMetric.heat > 0 ? `recent heat=${runtimeMetric.heat}` : 'no recent runtime records',
      ),
    );

    const outboxHealthy =
      runtimeMetric.failed === 0 &&
      (runtimeMetric.pending === 0 || runtimeMetric.pending <= runtimeMetric.success + 2);
    checks.push(
      item(
        'R2_OUTBOX_HEALTH',
        dl(locale, 'Outbox delivery health', 'Outbox 健康度'),
        10,
        outboxHealthy ? 'pass' : 'fail',
        outboxHealthy
          ? `pending=${runtimeMetric.pending}, failed=${runtimeMetric.failed}`
          : `pending=${runtimeMetric.pending}, failed=${runtimeMetric.failed}`,
      ),
    );

    checks.push(
      item(
        'R3_PROCESSED',
        dl(locale, 'Processed evidence', '已处理证据'),
        10,
        runtimeMetric.success > 0 ? 'pass' : 'fail',
        runtimeMetric.success > 0 ? `success=${runtimeMetric.success}` : 'no success evidence in runtime records',
      ),
    );
  }

  const scored = scoreFor(checks);
  const mode = runtimeEnabled && runtimeAvailable ? 'design+runtime' : 'design-only';
  return {
    flowId: flow.id,
    score: scored.score,
    mode,
    achievedWeight: scored.achievedWeight,
    maxWeight: scored.maxWeight,
    items: checks,
    suggestions: suggestionsFromItems(checks, policy, locale),
  };
}

export function buildFlowDeliveryChecklist(input: {
  data: ProjectData | null;
  flow: FlowRecord;
  runtimeMetric?: RuntimeFlowMetric;
  runtimeEnabled?: boolean;
  runtimeAvailable?: boolean;
  locale?: DiagramLocale;
}): FlowDeliveryChecklist {
  const { data, flow, runtimeMetric } = input;
  if (!data) {
    return {
      flowId: flow.id,
      score: 0,
      mode: 'design-only',
      achievedWeight: 0,
      maxWeight: 0,
      items: [],
      suggestions: [],
    };
  }
  return buildChecklist({
    data,
    flow,
    runtimeMetric,
    runtimeEnabled: input.runtimeEnabled ?? false,
    runtimeAvailable: input.runtimeAvailable ?? false,
    locale: input.locale,
  });
}
