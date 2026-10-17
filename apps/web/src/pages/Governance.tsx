import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  runGovernanceChecks,
  type GovernanceIssue,
  type GovernanceSeverity,
} from '../app/governanceRules';
import { useProjectData } from '../app/useProjectData';

function issueMatches(issue: GovernanceIssue, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  const haystack = [
    issue.rule,
    issue.title,
    issue.message,
    issue.hint,
    issue.table ?? '',
    issue.flowId ?? '',
    ...(issue.flows ?? []),
    ...(issue.writers ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(keyword);
}

function severityClass(severity: GovernanceSeverity): string {
  return severity === 'violation' ? 'gov-severity-violation' : 'gov-severity-warning';
}

export function GovernancePage() {
  const { data, loading, error } = useProjectData();
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'violation' | 'warning'>('all');
  const preselectedRule = searchParams.get('rule')?.trim() ?? '';
  const result = useMemo(() => runGovernanceChecks(data), [data]);

  const visibleItems = useMemo(() => {
    const lowered = keyword.trim().toLowerCase();
    return result.all.filter((item) => {
      if (preselectedRule && item.rule !== preselectedRule) {
        return false;
      }
      if (severityFilter !== 'all' && item.severity !== severityFilter) {
        return false;
      }
      return issueMatches(item, lowered);
    });
  }, [keyword, preselectedRule, result.all, severityFilter]);

  const byRuleVisible = useMemo(() => {
    const grouped = new Map<string, GovernanceIssue[]>();
    for (const item of visibleItems) {
      if (!grouped.has(item.rule)) {
        grouped.set(item.rule, []);
      }
      grouped.get(item.rule)?.push(item);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleItems]);

  return (
    <section className="page">
      <h1>Governance / 治理规则</h1>
      <p className="subtle">
        Automated policy checks from `/data/index.json`.
      </p>

      {loading && <p>Loading governance checks... / 正在加载治理规则...</p>}
      {error && <p className="error">Failed to load data / 加载数据失败: {error}</p>}

      {!loading && !error && (
        <>
          <div className="card-grid">
            <article className="card">
              <h2>Summary / 总览</h2>
              <p>violations: {result.violations.length}</p>
              <p>warnings: {result.warnings.length}</p>
              <p>total: {result.all.length}</p>
              {preselectedRule && (
                <p>
                  rule filter: <code>{preselectedRule}</code>{' '}
                  <Link to="/governance">Clear / 清除</Link>
                </p>
              )}
            </article>
            <article className="card">
              <h2>Filter / 过滤</h2>
              <div className="table-lens-toolbar">
                <label htmlFor="gov-search">Search / 搜索</label>
                <input
                  id="gov-search"
                  type="text"
                  value={keyword}
                  placeholder="flow id / table / rule"
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <label htmlFor="gov-severity">Severity / 严重级别</label>
                <select
                  id="gov-severity"
                  value={severityFilter}
                  onChange={(event) =>
                    setSeverityFilter(event.target.value as 'all' | 'violation' | 'warning')
                  }
                >
                  <option value="all">All / 全部</option>
                  <option value="violation">Violation / 严重</option>
                  <option value="warning">Warning / 警告</option>
                </select>
              </div>
              <p className="subtle">visible issues: {visibleItems.length}</p>
            </article>
          </div>

          <div className="detail-grid">
            {byRuleVisible.length === 0 && (
              <article className="card">
                <h2>No Results / 无结果</h2>
                <p className="subtle">No issues match current filters.</p>
              </article>
            )}

            {byRuleVisible.map(([rule, issues]) => (
              <article className="card" key={`gov-rule-${rule}`}>
                <h2>{rule} ({issues.length})</h2>
                <ul className="related-flow-list">
                  {issues.map((issue) => (
                    <li key={issue.id} className="related-flow-item">
                      <p>
                        <span className={`gov-severity-badge ${severityClass(issue.severity)}`}>
                          {issue.severity}
                        </span>{' '}
                        <strong>{issue.title}</strong>
                      </p>
                      <p>{issue.message}</p>
                      <p className="subtle">hint: {issue.hint}</p>
                      <p className="governance-links">
                        {issue.flowId && (
                          <Link to={`/flows/${encodeURIComponent(issue.flowId)}`}>
                            Flow / 流程: {issue.flowId}
                          </Link>
                        )}
                        {issue.table && (
                          <Link to={`/tables/${encodeURIComponent(issue.table)}`}>
                            Table / 数据表: {issue.table}
                          </Link>
                        )}
                        {(issue.table || issue.flowId) && (
                          <Link
                            to={`/crud?table=${encodeURIComponent(issue.table ?? '')}&flow=${encodeURIComponent(
                              issue.flowId ?? '',
                            )}`}
                          >
                            Open CRUD / 打开 CRUD
                          </Link>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
