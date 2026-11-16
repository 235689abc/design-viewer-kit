import type { ProjectData } from './useProjectData';
import { runGovernanceChecks } from './governanceRules';
import type { DiagramLocale } from './diagramLabels';

/**
 * 发现(Findings)聚合器——把三类信号统一成一个模型:
 *   1. issues 字段:manifest 里 flow/table 上人工立案的结构化发现(如 QC-NN 引用),
 *      含立案三态 status:filed=已立案未复核(缺省)/confirmed=已证实/refuted=已推翻;
 *   2. notes 标记:notes 文本中的 QC-NN 字样(向后兼容,老清单零改动即点亮),
 *      严重度按文本启发式推断(红/黄/绿字样);
 *      去重规则:同一 flow/table 已有 issues 字段时不再解析其 notes 的 QC 标记
 *      (防 notes→issues 迁移后双计);
 *   3. 治理规则:governanceRules 的 violation→red / warning→yellow。
 * 排序:严重度红→黄→绿→info;组内 confirmed 在前、refuted 沉组尾。
 * 纯函数,不依赖 React,可被任意页面与测试直接消费。
 */

export type FindingSeverity = 'red' | 'yellow' | 'green' | 'info';

/** 立案三态:filed=已立案未复核(缺省) / confirmed=复核已证实 / refuted=复核已推翻 */
export type FindingStatus = 'filed' | 'confirmed' | 'refuted';

const STATUSES: FindingStatus[] = ['filed', 'confirmed', 'refuted'];

export type Finding = {
  ref: string;
  severity: FindingSeverity;
  note: string;
  source: 'issues' | 'notes' | 'governance';
  status?: FindingStatus;
  flowId?: string;
  table?: string;
  rule?: string;
};

export type FindingsSummary = {
  red: number;
  yellow: number;
  green: number;
  info: number;
  total: number;
};

const SEVERITIES: FindingSeverity[] = ['red', 'yellow', 'green', 'info'];

export const QC_REF_PATTERN = /\bQC-\d+(?:-[A-Za-z0-9]+)*\b/g;

function normalizeSeverity(value: unknown): FindingSeverity {
  return SEVERITIES.includes(value as FindingSeverity)
    ? (value as FindingSeverity)
    : 'info';
}

/** 非法/缺省 status 归一为 undefined(视图层按 filed 现状处理,不加徽) */
function normalizeStatus(value: unknown): FindingStatus | undefined {
  return STATUSES.includes(value as FindingStatus)
    ? (value as FindingStatus)
    : undefined;
}

/** notes 文本启发式:只认显式色词(红/黄/绿 及英文),无色词 → info;不猜 */
export function inferSeverityFromNote(note: string): FindingSeverity {
  if (/红|\bred\b/i.test(note)) {
    return 'red';
  }
  if (/黄|\byellow\b/i.test(note)) {
    return 'yellow';
  }
  if (/绿|\bgreen\b/i.test(note)) {
    return 'green';
  }
  return 'info';
}

export function collectFindings(
  data: ProjectData | null,
  locale: DiagramLocale = 'zh',
): Finding[] {
  if (!data) {
    return [];
  }

  const findings: Finding[] = [];

  const pushIssue = (
    issues: unknown,
    target: { flowId?: string; table?: string },
  ) => {
    if (!Array.isArray(issues)) {
      return;
    }
    for (const raw of issues) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const issue = raw as {
        ref?: unknown;
        severity?: unknown;
        status?: unknown;
        note?: unknown;
      };
      if (typeof issue.ref !== 'string' || issue.ref.trim() === '') {
        continue;
      }
      findings.push({
        ref: issue.ref.trim(),
        severity: normalizeSeverity(issue.severity),
        note: typeof issue.note === 'string' ? issue.note : '',
        source: 'issues',
        status: normalizeStatus(issue.status),
        ...target,
      });
    }
  };

  const pushNotes = (
    notes: unknown,
    target: { flowId?: string; table?: string },
  ) => {
    if (typeof notes !== 'string' || notes.trim() === '') {
      return;
    }
    const refs = notes.match(QC_REF_PATTERN);
    if (!refs || refs.length === 0) {
      return;
    }
    findings.push({
      ref: Array.from(new Set(refs)).join(' '),
      severity: inferSeverityFromNote(notes),
      note: notes.trim(),
      source: 'notes',
      ...target,
    });
  };

  // 去重规则:同一 flow/table 已有 issues 字段(结构化立案)时,
  // 不再解析其 notes 的 QC 标记——防止把 notes 里的标记迁移进 issues 后双计。
  const pushHolder = (
    holder: { issues?: unknown; notes?: unknown },
    target: { flowId?: string; table?: string },
  ) => {
    const hasIssuesField = Array.isArray(holder.issues);
    pushIssue(holder.issues, target);
    if (!hasIssuesField) {
      pushNotes(holder.notes, target);
    }
  };

  for (const flow of data.flows) {
    pushHolder(flow, { flowId: flow.id });
  }

  for (const table of data.tables) {
    pushHolder(table, { table: table.name });
  }

  const governance = runGovernanceChecks(data, locale);
  for (const issue of governance.all) {
    findings.push({
      ref: issue.rule,
      severity: issue.severity === 'violation' ? 'red' : 'yellow',
      note: issue.message,
      source: 'governance',
      flowId: issue.flowId,
      table: issue.table,
      rule: issue.rule,
    });
  }

  const severityOrder: Record<FindingSeverity, number> = {
    red: 0,
    yellow: 1,
    green: 2,
    info: 3,
  };
  // 组内(同 severity)证实状态排序:confirmed 在前,filed 居中,refuted 沉组尾
  const statusOrder: Record<FindingStatus, number> = {
    confirmed: 0,
    filed: 1,
    refuted: 2,
  };
  const statusRank = (finding: Finding): number =>
    finding.status ? statusOrder[finding.status] : statusOrder.filed;
  return findings.sort((a, b) => {
    const bySeverity = severityOrder[a.severity] - severityOrder[b.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byStatus = statusRank(a) - statusRank(b);
    if (byStatus !== 0) {
      return byStatus;
    }
    return a.ref.localeCompare(b.ref);
  });
}

export function summarizeFindings(findings: Finding[]): FindingsSummary {
  const summary: FindingsSummary = { red: 0, yellow: 0, green: 0, info: 0, total: findings.length };
  for (const finding of findings) {
    summary[finding.severity] += 1;
  }
  return summary;
}

export function groupFindingsBySeverity(findings: Finding[]): Record<FindingSeverity, Finding[]> {
  const groups: Record<FindingSeverity, Finding[]> = {
    red: [],
    yellow: [],
    green: [],
    info: [],
  };
  for (const finding of findings) {
    groups[finding.severity].push(finding);
  }
  return groups;
}
