import type { ProjectData } from './useProjectData';
import { runGovernanceChecks } from './governanceRules';
import type { DiagramLocale } from './diagramLabels';

/**
 * 发现(Findings)聚合器——把三类信号统一成一个模型:
 *   1. issues 字段:manifest 里 flow/table 上人工立案的结构化发现(如 QC-NN 引用);
 *   2. notes 标记:notes 文本中的 QC-NN 字样(向后兼容,老清单零改动即点亮),
 *      严重度按文本启发式推断(红/黄/绿字样);
 *   3. 治理规则:governanceRules 的 violation→red / warning→yellow。
 * 纯函数,不依赖 React,可被任意页面与测试直接消费。
 */

export type FindingSeverity = 'red' | 'yellow' | 'green' | 'info';

export type Finding = {
  ref: string;
  severity: FindingSeverity;
  note: string;
  source: 'issues' | 'notes' | 'governance';
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

  for (const flow of data.flows) {
    const target = { flowId: flow.id };
    pushIssue(flow.issues, target);
    pushNotes(flow.notes, target);
  }

  for (const table of data.tables) {
    const target = { table: table.name };
    pushIssue(table.issues, target);
    pushNotes(table.notes, target);
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
  return findings.sort((a, b) => {
    const bySeverity = severityOrder[a.severity] - severityOrder[b.severity];
    if (bySeverity !== 0) {
      return bySeverity;
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
