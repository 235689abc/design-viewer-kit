import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProjectData } from '../app/useProjectData';
import {
  collectFindings,
  groupFindingsBySeverity,
  summarizeFindings,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
} from '../app/findings';
import { useLocale, bi, type Locale } from '../app/i18n';

const SEVERITY_META: Record<
  FindingSeverity,
  { en: string; zh: string; descEn: string; descZh: string }
> = {
  red: { en: 'Blocking', zh: '阻断', descEn: 'Blocking findings that must be handled', descZh: '必须处置的阻断项(资金/数据/安全)' },
  yellow: { en: 'Debt', zh: '欠账', descEn: 'Scheduled quality debt', descZh: '已立案待排期的质量欠账' },
  green: { en: 'Healthy', zh: '达标', descEn: 'Verified healthy evidence', descZh: '达标存照(复核判据用)' },
  info: { en: 'Notes', zh: '说明', descEn: 'Neutral notes', descZh: '中性说明信息' },
};

/**
 * 立案三态徽章(白底黑字单色):
 * confirmed=黑粗边徽「已证实」 / refuted=灰徽「已推翻」 / filed(缺省)=现状不加徽。
 * refuted 的 note 删除线由各发现卡的 noteStyle 处理。
 */
function findingStatusBadge(locale: Locale, status?: FindingStatus) {
  if (status === 'confirmed') {
    return (
      <span className="sev-badge" style={{ border: '2px solid var(--dv-text)' }}>
        {bi(locale, 'Confirmed', '已证实')}
      </span>
    );
  }
  if (status === 'refuted') {
    return <span className="sev-badge sev-badge-info">{bi(locale, 'Refuted', '已推翻')}</span>;
  }
  return null;
}

/** refuted 的 note 加删除线置灰;其余现状 */
function findingNoteStyle(status?: FindingStatus) {
  return status === 'refuted'
    ? { textDecoration: 'line-through', color: 'var(--dv-text-3)' }
    : undefined;
}

const SEVERITY_ORDER: FindingSeverity[] = ['red', 'yellow', 'green', 'info'];

/** 导出报告里每条发现的目标链接路径(与页内 FindingTargets 的 Link to 逐一同源) */
function findingTargetPaths(finding: Finding): string[] {
  const paths: string[] = [];
  if (finding.flowId) {
    paths.push(`/flows/${encodeURIComponent(finding.flowId)}`);
  }
  if (finding.table) {
    paths.push(`/tables/${encodeURIComponent(finding.table)}`);
  }
  if (finding.rule) {
    paths.push(`/governance?rule=${encodeURIComponent(finding.rule)}`);
  }
  return paths;
}

/** CSV 字段转义(RFC 4180):含逗号/引号/换行时整体包引号,内部引号双写 */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 按 severity 分组生成 Markdown 报告文本 */
function buildFindingsMarkdown(
  projectName: string,
  groups: Record<FindingSeverity, Finding[]>,
  locale: Locale,
): string {
  const lines: string[] = [
    `# ${projectName} ${bi(locale, 'Findings Report', '发现报告')}`,
    '',
  ];
  for (const severity of SEVERITY_ORDER) {
    const items = groups[severity];
    const label = bi(locale, SEVERITY_META[severity].en, SEVERITY_META[severity].zh);
    lines.push(`## ${label} (${items.length})`, '');
    if (items.length === 0) {
      lines.push(`- ${bi(locale, '(none)', '(无)')}`, '');
      continue;
    }
    for (const finding of items) {
      lines.push(`- **${finding.ref}** ${finding.note}`.trimEnd());
      const targets = findingTargetPaths(finding);
      if (targets.length > 0) {
        lines.push(`  - ${bi(locale, 'Targets', '目标')}: ${targets.join(' ')}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** 生成 CSV 文本:表头 ref,severity,source,flowId,table,note;全部字段经 csvEscape */
function buildFindingsCsv(findings: Finding[]): string {
  const header = 'ref,severity,source,flowId,table,note';
  const rows = findings.map((finding) =>
    [
      finding.ref,
      finding.severity,
      finding.source,
      finding.flowId ?? '',
      finding.table ?? '',
      finding.note,
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

/** Blob + URL.createObjectURL + a.download 下载(与 MermaidPanZoom 导出同款机械) */
function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function FindingTargets({ finding }: { finding: Finding }) {
  return (
    <span className="findings-target">
      {finding.flowId && (
        <Link className="sev-badge sev-badge-info" to={`/flows/${encodeURIComponent(finding.flowId)}`}>
          {finding.flowId}
        </Link>
      )}
      {finding.table && (
        <Link className="sev-badge sev-badge-info" to={`/tables/${encodeURIComponent(finding.table)}`}>
          {finding.table}
        </Link>
      )}
      {finding.rule && (
        <Link className="sev-badge sev-badge-info" to={`/governance?rule=${encodeURIComponent(finding.rule)}`}>
          {finding.rule}
        </Link>
      )}
    </span>
  );
}

export function FindingsPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();

  const findings = useMemo(() => collectFindings(data, locale), [data, locale]);
  const summary = useMemo(() => summarizeFindings(findings), [findings]);
  const groups = useMemo(() => groupFindingsBySeverity(findings), [findings]);

  const severityOrder = SEVERITY_ORDER;
  const hasFindings = findings.length > 0;

  const handleExportMarkdown = () => {
    if (!data || findings.length === 0) {
      return;
    }
    const content = buildFindingsMarkdown(data.meta.project, groups, locale);
    downloadTextFile(content, `${data.meta.project}-findings.md`, 'text/markdown;charset=utf-8');
  };

  const handleExportCsv = () => {
    if (!data || findings.length === 0) {
      return;
    }
    const content = buildFindingsCsv(findings);
    downloadTextFile(content, `${data.meta.project}-findings.csv`, 'text/csv;charset=utf-8');
  };

  if (loading) {
    return (
      <div className="page">
        <h1>{bi(locale, 'Findings', '发现')}</h1>
        <p className="subtle">{bi(locale, 'Loading…', '加载中…')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1>{bi(locale, 'Findings', '发现')}</h1>
        <p className="error">{error}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{bi(locale, 'Findings', '发现')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Unified findings: manifest issues, QC markers in notes, and governance rules.',
          '三源统一:清单 issues 立案 + notes 里的 QC 标记 + 治理规则判定。',
        )}
      </p>

      <div className="health-strip">
        {severityOrder.map((severity) => (
          <a
            key={severity}
            href={`#findings-${severity}`}
            className={`stat-block stat-block-${severity}`}
          >
            <span className={`stat-num stat-num-${severity}`}>{summary[severity]}</span>
            <span className="stat-label">
              {bi(locale, SEVERITY_META[severity].en, SEVERITY_META[severity].zh)}
              {' · '}
              {bi(locale, SEVERITY_META[severity].descEn, SEVERITY_META[severity].descZh)}
            </span>
          </a>
        ))}
      </div>

      <div
        className="findings-export-row"
        style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className={`topbar-btn${hasFindings ? '' : ' subtle'}`}
          disabled={!hasFindings}
          onClick={handleExportMarkdown}
        >
          {bi(locale, 'Export Markdown', '导出 Markdown')}
        </button>
        <button
          type="button"
          className={`topbar-btn${hasFindings ? '' : ' subtle'}`}
          disabled={!hasFindings}
          onClick={handleExportCsv}
        >
          {bi(locale, 'Export CSV', '导出 CSV')}
        </button>
      </div>

      {findings.length === 0 && (
        <p className="subtle" style={{ marginTop: 16 }}>
          {bi(locale, 'No findings recorded.', '暂无立案发现。')}
        </p>
      )}

      {severityOrder.map((severity) => {
        const items = groups[severity];
        if (items.length === 0) {
          return null;
        }
        return (
          <section key={severity} id={`findings-${severity}`} className="findings-group">
            <div className="findings-group-header">
              <span className={`sev-dot sev-dot-${severity}`} aria-hidden="true" />
              <h2 className="findings-group-title">
                {bi(locale, SEVERITY_META[severity].en, SEVERITY_META[severity].zh)}
              </h2>
              <span className={`sev-badge sev-badge-${severity}`}>{items.length}</span>
            </div>
            <ul className="findings-list">
              {items.map((finding, index) => (
                <li
                  key={`${finding.ref}-${finding.flowId ?? finding.table ?? ''}-${index}`}
                  className={`findings-item findings-item-${severity}`}
                >
                  <span className="findings-ref">{finding.ref}</span>
                  {findingStatusBadge(locale, finding.status)}
                  <span
                    className="findings-note"
                    style={findingNoteStyle(finding.status)}
                  >
                    {finding.note || SEVERITY_META[severity].descZh}
                  </span>
                  <FindingTargets finding={finding} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
