import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  runGovernanceChecks,
  type GovernanceIssue,
  type GovernanceSeverity,
} from '../app/governanceRules';
import { useLocale, bi } from '../app/i18n';
import { getViewerPolicy } from '../app/policy';
import { useProjectData } from '../app/useProjectData';

function isConfiguredTable(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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
  const [locale] = useLocale();
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'violation' | 'warning'>('all');
  const preselectedRule = searchParams.get('rule')?.trim() ?? '';
  const result = useMemo(() => runGovernanceChecks(data, locale), [data, locale]);
  const policy = useMemo(() => getViewerPolicy(data), [data]);
  const configuredPolicy = data?.meta.policy;
  // 豁免列表展示「显式配置项」:getViewerPolicy().allowMultiWriterTables 会并入三张
  // 政策表回退名,那是对账判定的有效集,不是这里的配置镜像。
  const multiWriterTables = useMemo(
    () =>
      (configuredPolicy?.allow_multi_writer_tables ?? [])
        .filter((table): table is string => typeof table === 'string')
        .map((table) => table.trim())
        .filter(Boolean),
    [configuredPolicy],
  );
  const auditSchemas = useMemo(() => Array.from(policy.auditSchemas), [policy]);

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
      <h1>{bi(locale, 'Governance', '治理规则')}</h1>
      <p className="subtle">
        {bi(locale, 'Automated policy checks from `/data/index.json`.', '基于 `/data/index.json` 的自动化策略检查。')}
      </p>

      {loading && <p>{bi(locale, 'Loading governance checks...', '正在加载治理规则...')}</p>}
      {error && (
        <p className="error">
          {bi(locale, 'Failed to load data: ', '加载数据失败:')}{error}
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="card-grid">
            <article className="card">
              <h2>{bi(locale, 'Policy', '政策面')}</h2>
              <p className="subtle">
                {bi(
                  locale,
                  'Governance rules are judged against these policy tables.',
                  '治理规则按这些政策表判定。',
                )}
              </p>
              <div className="field-list">
                <span className="field-row">
                  <span className="field-key">event_table</span>
                  <span className="field-value field-value-mono">
                    {isConfiguredTable(configuredPolicy?.event_table) ? (
                      <Link to={`/tables/${encodeURIComponent(policy.eventTable)}`}>
                        {policy.eventTable}
                      </Link>
                    ) : (
                      <span className="subtle">{bi(locale, 'Not configured', '未配置')}</span>
                    )}
                  </span>
                </span>
                <span className="field-row">
                  <span className="field-key">outbox_table</span>
                  <span className="field-value field-value-mono">
                    {isConfiguredTable(configuredPolicy?.outbox_table) ? (
                      <Link to={`/tables/${encodeURIComponent(policy.outboxTable)}`}>
                        {policy.outboxTable}
                      </Link>
                    ) : (
                      <span className="subtle">{bi(locale, 'Not configured', '未配置')}</span>
                    )}
                  </span>
                </span>
                <span className="field-row">
                  <span className="field-key">processed_events_table</span>
                  <span className="field-value field-value-mono">
                    {isConfiguredTable(configuredPolicy?.processed_events_table) ? (
                      <Link to={`/tables/${encodeURIComponent(policy.processedEventsTable)}`}>
                        {policy.processedEventsTable}
                      </Link>
                    ) : (
                      <span className="subtle">{bi(locale, 'Not configured', '未配置')}</span>
                    )}
                  </span>
                </span>
                <span className="field-row">
                  <span className="field-key">audit_schemas</span>
                  <span className="field-value field-value-mono">
                    {auditSchemas.length > 0 ? (
                      <ul className="inline-list">
                        {auditSchemas.map((schema) => (
                          <li key={schema}>{schema}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="subtle">{bi(locale, 'None', '无')}</span>
                    )}
                  </span>
                </span>
                <span className="field-row">
                  <span className="field-key">allow_multi_writer_tables</span>
                  <span className="field-value field-value-mono">
                    {multiWriterTables.length > 0 ? (
                      <ul className="inline-list">
                        {multiWriterTables.map((table) => (
                          <li key={table}>
                            <Link to={`/tables/${encodeURIComponent(table)}`}>{table}</Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="subtle">{bi(locale, 'No exemptions', '无豁免')}</span>
                    )}
                  </span>
                </span>
              </div>
            </article>
            <article className="card">
              <h2>{bi(locale, 'Summary', '总览')}</h2>
              <p>{bi(locale, 'violations', '违例')}: {result.violations.length}</p>
              <p>{bi(locale, 'warnings', '警告')}: {result.warnings.length}</p>
              <p>{bi(locale, 'total', '合计')}: {result.all.length}</p>
              {preselectedRule && (
                <p>
                  {bi(locale, 'rule filter', '规则过滤')}: <code>{preselectedRule}</code>{' '}
                  <Link to="/governance">{bi(locale, 'Clear', '清除')}</Link>
                </p>
              )}
            </article>
            <article className="card">
              <h2>{bi(locale, 'Filter', '过滤')}</h2>
              <div className="table-lens-toolbar">
                <label htmlFor="gov-search">{bi(locale, 'Search', '搜索')}</label>
                <input
                  id="gov-search"
                  type="text"
                  value={keyword}
                  placeholder={bi(locale, 'flow id, table, or rule', '流程 ID/表/规则')}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <label htmlFor="gov-severity">{bi(locale, 'Severity', '严重级别')}</label>
                <select
                  id="gov-severity"
                  value={severityFilter}
                  onChange={(event) =>
                    setSeverityFilter(event.target.value as 'all' | 'violation' | 'warning')
                  }
                >
                  <option value="all">{bi(locale, 'All', '全部')}</option>
                  <option value="violation">{bi(locale, 'Violation', '严重')}</option>
                  <option value="warning">{bi(locale, 'Warning', '警告')}</option>
                </select>
              </div>
              <p className="subtle">{bi(locale, 'visible issues', '可见问题')}: {visibleItems.length}</p>
            </article>
          </div>

          <div className="detail-grid">
            {byRuleVisible.length === 0 && (
              <article className="card">
                <h2>{bi(locale, 'No Results', '无结果')}</h2>
                <p className="subtle">
                  {bi(locale, 'No issues match current filters.', '当前过滤条件下没有匹配问题。')}
                </p>
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
                      <p className="subtle">{bi(locale, 'hint', '提示')}: {issue.hint}</p>
                      <p className="governance-links">
                        {issue.flowId && (
                          <Link to={`/flows/${encodeURIComponent(issue.flowId)}`}>
                            {bi(locale, 'Flow', '流程')}: {issue.flowId}
                          </Link>
                        )}
                        {issue.table && (
                          <Link to={`/tables/${encodeURIComponent(issue.table)}`}>
                            {bi(locale, 'Table', '数据表')}: {issue.table}
                          </Link>
                        )}
                        {(issue.table || issue.flowId) && (
                          <Link
                            to={`/crud?table=${encodeURIComponent(issue.table ?? '')}&flow=${encodeURIComponent(
                              issue.flowId ?? '',
                            )}`}
                          >
                            {bi(locale, 'Open CRUD', '打开 CRUD')}
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
