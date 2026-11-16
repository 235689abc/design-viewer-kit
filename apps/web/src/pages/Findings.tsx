import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProjectData } from '../app/useProjectData';
import {
  collectFindings,
  groupFindingsBySeverity,
  summarizeFindings,
  type Finding,
  type FindingSeverity,
} from '../app/findings';
import { useLocale, bi } from '../app/i18n';

const SEVERITY_META: Record<
  FindingSeverity,
  { en: string; zh: string; descEn: string; descZh: string }
> = {
  red: { en: 'Blocking', zh: '阻断', descEn: 'Blocking findings that must be handled', descZh: '必须处置的阻断项(资金/数据/安全)' },
  yellow: { en: 'Debt', zh: '欠账', descEn: 'Scheduled quality debt', descZh: '已立案待排期的质量欠账' },
  green: { en: 'Healthy', zh: '达标', descEn: 'Verified healthy evidence', descZh: '达标存照(复核判据用)' },
  info: { en: 'Notes', zh: '说明', descEn: 'Neutral notes', descZh: '中性说明信息' },
};

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

  const severityOrder: FindingSeverity[] = ['red', 'yellow', 'green', 'info'];

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
                  <span className="findings-note">
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
