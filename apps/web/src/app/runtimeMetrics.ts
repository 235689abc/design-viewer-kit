import { buildProjectIndexes } from './indexes';
import {
  fetchRuntimeEvents,
  fetchRuntimeFlowRecent,
  fetchRuntimeOutbox,
  getRuntimeBaseUrl,
  toRuntimeRecords,
} from './runtimeClient';
import { schemaOf } from './schemaUtils';
import type { ProjectData } from './useProjectData';

export type RuntimeStatusBucket = 'success' | 'pending' | 'failed' | 'unknown';

export type RuntimeFlowMetric = {
  heat: number;
  success: number;
  pending: number;
  failed: number;
  unknown: number;
};

export type RuntimeOverlayResult = {
  runtimeBaseUrl: string | null;
  runtimeEnabled: boolean;
  events: Record<string, unknown>[];
  pendingOutbox: number;
  failedOutbox: number;
  flowMetrics: Record<string, RuntimeFlowMetric>;
  tableHeat: Record<string, number>;
  schemaHeat: Record<string, number>;
  warnings: string[];
};

export type RuntimeFlowRecentResult = {
  rows: Record<string, unknown>[];
  metrics: RuntimeFlowMetric;
  error: string | null;
  runtimeBaseUrl: string | null;
};

const FLOW_ID_KEYS = [
  'flow_id',
  'flowId',
  'flow',
  'flow_name',
  'flowName',
  'workflow',
  'workflow_id',
  'workflowId',
] as const;

const STATUS_KEYS = [
  'status',
  'state',
  'result',
  'outbox_status',
  'outboxStatus',
  'delivery_status',
  'deliveryStatus',
  'processing_status',
] as const;

const COUNT_KEYS = ['count', 'total', 'total_count', 'totalCount', 'size'] as const;

function emptyMetric(): RuntimeFlowMetric {
  return { heat: 0, success: 0, pending: 0, failed: 0, unknown: 0 };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringValue(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function classifyStatus(rawValue: string): RuntimeStatusBucket {
  const status = rawValue.trim().toLowerCase();
  if (!status) {
    return 'unknown';
  }
  if (
    status.includes('fail') ||
    status.includes('error') ||
    status.includes('dead') ||
    status.includes('drop') ||
    status.includes('timeout')
  ) {
    return 'failed';
  }
  if (
    status.includes('pending') ||
    status.includes('queue') ||
    status.includes('wait') ||
    status.includes('processing') ||
    status.includes('retry') ||
    status.includes('inflight')
  ) {
    return 'pending';
  }
  if (
    status.includes('success') ||
    status.includes('sent') ||
    status.includes('done') ||
    status.includes('ok') ||
    status.includes('complete')
  ) {
    return 'success';
  }
  return 'unknown';
}

function metricWithStatus(status: RuntimeStatusBucket): RuntimeFlowMetric {
  const base = emptyMetric();
  base.heat = 1;
  base[status] += 1;
  return base;
}

function mergeMetric(target: RuntimeFlowMetric, add: RuntimeFlowMetric) {
  target.heat += add.heat;
  target.success += add.success;
  target.pending += add.pending;
  target.failed += add.failed;
  target.unknown += add.unknown;
}

function mergeMetricByFlow(
  metrics: Record<string, RuntimeFlowMetric>,
  flowId: string,
  add: RuntimeFlowMetric,
) {
  if (!flowId) {
    return;
  }
  if (!metrics[flowId]) {
    metrics[flowId] = emptyMetric();
  }
  mergeMetric(metrics[flowId], add);
}

function extractRowsWithMetrics(payload: unknown): {
  rows: Record<string, unknown>[];
  countHint: number | null;
} {
  const rows = toRuntimeRecords(payload);
  const record = toRecord(payload);
  let countHint: number | null = null;
  if (record) {
    for (const key of COUNT_KEYS) {
      const maybe = asNumber(record[key]);
      if (maybe !== null) {
        countHint = maybe;
        break;
      }
    }
  }
  return { rows, countHint };
}

export function summarizeRuntimeRows(rows: Record<string, unknown>[]): RuntimeFlowMetric {
  const summary = emptyMetric();
  for (const row of rows) {
    const statusValue = readStringValue(row, STATUS_KEYS);
    const metric = metricWithStatus(classifyStatus(statusValue));
    mergeMetric(summary, metric);
  }
  return summary;
}

export function buildFlowMetricsFromRows(rows: Record<string, unknown>[]): Record<string, RuntimeFlowMetric> {
  const metrics: Record<string, RuntimeFlowMetric> = {};
  for (const row of rows) {
    const flowId = readStringValue(row, FLOW_ID_KEYS);
    if (!flowId) {
      continue;
    }
    const statusValue = readStringValue(row, STATUS_KEYS);
    mergeMetricByFlow(metrics, flowId, metricWithStatus(classifyStatus(statusValue)));
  }
  return metrics;
}

function buildTableAndSchemaHeat(
  data: ProjectData | null,
  flowMetrics: Record<string, RuntimeFlowMetric>,
): {
  tableHeat: Record<string, number>;
  schemaHeat: Record<string, number>;
} {
  const tableHeat: Record<string, number> = {};
  const schemaHeat: Record<string, number> = {};
  if (!data) {
    return { tableHeat, schemaHeat };
  }

  const indexes = buildProjectIndexes(data);
  for (const [flowId, metric] of Object.entries(flowMetrics)) {
    if (metric.heat <= 0) {
      continue;
    }
    const tableOps = indexes.edgesByFlow.get(flowId);
    if (!tableOps) {
      continue;
    }
    for (const tableName of tableOps.keys()) {
      tableHeat[tableName] = (tableHeat[tableName] ?? 0) + metric.heat;
      const schemaName = schemaOf(tableName);
      schemaHeat[schemaName] = (schemaHeat[schemaName] ?? 0) + metric.heat;
    }
  }
  return { tableHeat, schemaHeat };
}

export async function loadRuntimeOverlay(
  data: ProjectData | null,
  options?: {
    eventsLimit?: number;
    outboxLimit?: number;
  },
): Promise<RuntimeOverlayResult> {
  const runtimeBaseUrl = getRuntimeBaseUrl();
  if (!runtimeBaseUrl) {
    return {
      runtimeBaseUrl: null,
      runtimeEnabled: false,
      events: [],
      pendingOutbox: 0,
      failedOutbox: 0,
      flowMetrics: {},
      tableHeat: {},
      schemaHeat: {},
      warnings: [],
    };
  }

  const eventsLimit = options?.eventsLimit ?? 200;
  const outboxLimit = options?.outboxLimit ?? 200;
  const [eventsResult, pendingResult, failedResult] = await Promise.all([
    fetchRuntimeEvents(eventsLimit, data),
    fetchRuntimeOutbox('PENDING', outboxLimit, data),
    fetchRuntimeOutbox('FAILED', outboxLimit, data),
  ]);

  const warnings: string[] = [];
  if (eventsResult.error) {
    warnings.push(`events: ${eventsResult.error}`);
  }
  if (pendingResult.error) {
    warnings.push(`outbox(PENDING): ${pendingResult.error}`);
  }
  if (failedResult.error) {
    warnings.push(`outbox(FAILED): ${failedResult.error}`);
  }

  const eventsRows = extractRowsWithMetrics(eventsResult.data).rows;
  const pendingParsed = extractRowsWithMetrics(pendingResult.data);
  const failedParsed = extractRowsWithMetrics(failedResult.data);
  const pendingCount = pendingParsed.countHint ?? pendingParsed.rows.length;
  const failedCount = failedParsed.countHint ?? failedParsed.rows.length;

  const flowMetrics = buildFlowMetricsFromRows(eventsRows);

  for (const row of pendingParsed.rows) {
    const flowId = readStringValue(row, FLOW_ID_KEYS);
    if (!flowId) {
      continue;
    }
    mergeMetricByFlow(flowMetrics, flowId, { heat: 0, success: 0, pending: 1, failed: 0, unknown: 0 });
  }
  for (const row of failedParsed.rows) {
    const flowId = readStringValue(row, FLOW_ID_KEYS);
    if (!flowId) {
      continue;
    }
    mergeMetricByFlow(flowMetrics, flowId, { heat: 0, success: 0, pending: 0, failed: 1, unknown: 0 });
  }

  const { tableHeat, schemaHeat } = buildTableAndSchemaHeat(data, flowMetrics);

  return {
    runtimeBaseUrl,
    runtimeEnabled: true,
    events: eventsRows,
    pendingOutbox: pendingCount,
    failedOutbox: failedCount,
    flowMetrics,
    tableHeat,
    schemaHeat,
    warnings,
  };
}

export async function loadRuntimeFlowRecent(
  flowId: string,
  limit = 100,
  data?: ProjectData | null,
): Promise<RuntimeFlowRecentResult> {
  const runtimeBaseUrl = getRuntimeBaseUrl();
  if (!runtimeBaseUrl) {
    return {
      rows: [],
      metrics: emptyMetric(),
      error: 'Runtime base URL is not set',
      runtimeBaseUrl: null,
    };
  }

  const result = await fetchRuntimeFlowRecent(flowId, limit, data);
  if (result.error) {
    return {
      rows: [],
      metrics: emptyMetric(),
      error: result.error,
      runtimeBaseUrl,
    };
  }

  const rows = toRuntimeRecords(result.data);
  return {
    rows,
    metrics: summarizeRuntimeRows(rows),
    error: null,
    runtimeBaseUrl,
  };
}
