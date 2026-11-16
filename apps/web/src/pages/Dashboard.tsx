import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildProjectIndexes, hasWriteOps } from '../app/indexes';
import { runGovernanceChecks } from '../app/governanceRules';
import { loadRuntimeOverlay, type RuntimeOverlayResult } from '../app/runtimeMetrics';
import {
  formatRuntimeValue,
  getRuntimeBaseUrl,
  runtimeEventsPath,
  subscribeRuntimeBaseUrl,
} from '../app/runtimeClient';
import { useProjectData } from '../app/useProjectData';
import { collectFindings, summarizeFindings } from '../app/findings';
import { useLocale, bi } from '../app/i18n';

function isMissingText(value: string | undefined): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

function collectRuntimeColumns(records: Record<string, unknown>[]): string[] {
  if (records.length === 0) {
    return [];
  }
  const preferred = ['time', 'timestamp', 'created_at', 'event', 'status', 'table', 'flow_id', 'id'];
  const keySet = new Set<string>();
  for (const row of records.slice(0, 12)) {
    for (const key of Object.keys(row)) {
      keySet.add(key);
    }
  }
  const preferredKeys = preferred.filter((key) => keySet.has(key));
  const extraKeys = Array.from(keySet).filter((key) => !preferred.includes(key));
  return [...preferredKeys, ...extraKeys].slice(0, 8);
}

export function DashboardPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const governance = useMemo(() => runGovernanceChecks(data), [data]);
  const findings = useMemo(() => collectFindings(data, locale), [data, locale]);
  const findingsSummary = useMemo(() => summarizeFindings(findings), [findings]);
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() => getRuntimeBaseUrl());
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeOverlay, setRuntimeOverlay] = useState<RuntimeOverlayResult | null>(null);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => setRuntimeBaseUrl(value));
  }, []);

  useEffect(() => {
    if (!runtimeBaseUrl) {
      setRuntimeOverlay(null);
      setRuntimeError(null);
      setRuntimeLoading(false);
      return;
    }

    let cancelled = false;
    async function loadRuntime() {
      setRuntimeLoading(true);
      setRuntimeError(null);
      try {
        const overlay = await loadRuntimeOverlay(data, { eventsLimit: 200, outboxLimit: 200 });
        if (cancelled) {
          return;
        }
        setRuntimeOverlay(overlay);
        if (overlay.warnings.length > 0) {
          setRuntimeError(overlay.warnings.join(' | '));
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setRuntimeOverlay(null);
        setRuntimeError((err as Error).message || 'Runtime overlay load failed');
      } finally {
        if (!cancelled) {
          setRuntimeLoading(false);
        }
      }
    }

    void loadRuntime();
    return () => {
      cancelled = true;
    };
  }, [data, runtimeBaseUrl]);

  const metrics = useMemo(() => {
    const flows = data?.flows ?? [];
    const tables = data?.tables ?? [];
    const services = data?.services ?? [];
    const crudEdges = data?.crudEdges ?? [];

    const plannedTables = tables.filter((table) => table.state === 'planned').length;
    const tablesMissingOwner = tables.filter((table) => isMissingText(table.owner_service)).length;
    const tablesMissingIntroduced = tables.filter((table) => isMissingText(table.introduced_in)).length;
    const flowsMissingIdempotency = flows.filter((flow) => isMissingText(flow.idempotency_key)).length;
    const flowsMissingEvents = flows.filter((flow) => (flow.events_appended ?? []).length === 0).length;
    const aliasTables = tables.filter((table) => !!table.alias_of).length;

    const topTablesByWriteCount = Array.from(indexes.edgesByTable.entries())
      .map(([tableName, edges]) => {
        const writeFlows = new Set<string>();
        for (const edge of edges) {
          if (hasWriteOps(edge.ops)) {
            writeFlows.add(edge.flow_id);
          }
        }
        return { tableName, writeFlowCount: writeFlows.size };
      })
      .filter((row) => row.writeFlowCount > 0)
      .sort((a, b) => b.writeFlowCount - a.writeFlowCount || a.tableName.localeCompare(b.tableName))
      .slice(0, 10);

    const topFlowsByTableTouch = flows
      .map((flow) => ({
        flowId: flow.id,
        flowName: locale === 'zh' ? flow.name_zh : flow.name_en,
        touchedTables: indexes.edgesByFlow.get(flow.id)?.size ?? 0,
      }))
      .sort((a, b) => b.touchedTables - a.touchedTables || a.flowId.localeCompare(b.flowId))
      .slice(0, 10);

    return {
      flowCount: flows.length,
      tableCount: tables.length,
      crudEdgeCount: crudEdges.length,
      serviceCount: services.length,
      plannedTables,
      tablesMissingOwner,
      tablesMissingIntroduced,
      flowsMissingIdempotency,
      flowsMissingEvents,
      aliasTables,
      topTablesByWriteCount,
      topFlowsByTableTouch,
    };
  }, [data, indexes.edgesByFlow, indexes.edgesByTable, locale]);

  const runtimeRows = runtimeOverlay?.events ?? [];
  const runtimeColumns = useMemo(() => collectRuntimeColumns(runtimeRows), [runtimeRows]);
  const topFindings = useMemo(
    () => findings.filter((finding) => finding.severity === 'red' || finding.severity === 'yellow').slice(0, 6),
    [findings],
  );

  const actionItems = [
    {
      key: 'missing-owner',
      count: metrics.tablesMissingOwner,
      to: '/tables?filter=missing-owner',
      en: 'Tables missing owner',
      zh: '表缺少 owner',
    },
    {
      key: 'missing-introduced',
      count: metrics.tablesMissingIntroduced,
      to: '/tables?filter=missing-introduced',
      en: 'Tables missing introduced_in',
      zh: '表缺少 introduced_in',
    },
    {
      key: 'planned',
      count: metrics.plannedTables,
      to: '/tables?filter=planned',
      en: 'Planned tables',
      zh: 'planned 表',
    },
    {
      key: 'missing-idempotency',
      count: metrics.flowsMissingIdempotency,
      to: '/flows?filter=missing-idempotency',
      en: 'Flows missing idempotency key',
      zh: '流程缺少幂等键',
    },
    {
      key: 'missing-events',
      count: metrics.flowsMissingEvents,
      to: '/flows?filter=missing-events',
      en: 'Flows missing events_appended',
      zh: '流程缺少事件声明',
    },
  ];

  return (
    <section className="page">
      <h1>{bi(locale, 'Dashboard', '总览')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Governance cockpit built from the design manifest.',
          '由设计清单驱动的治理驾驶舱。',
        )}
        {data && <span> · {data.meta.generated_at}</span>}
      </p>

      {loading && <p className="subtle">{bi(locale, 'Loading project data…', '正在加载项目数据…')}</p>}
      {error && <p className="error">{bi(locale, 'Failed to load project data: ', '加载项目数据失败:')}{error}</p>}

      {data && !error && (
        <>
          <div className="health-strip">
            <Link to="/findings#findings-red" className="stat-block stat-block-red">
              <span className="stat-num stat-num-red">{findingsSummary.red}</span>
              <span className="stat-label">{bi(locale, 'Blocking findings', '阻断(红)')}</span>
            </Link>
            <Link to="/findings#findings-yellow" className="stat-block stat-block-yellow">
              <span className="stat-num stat-num-yellow">{findingsSummary.yellow}</span>
              <span className="stat-label">{bi(locale, 'Debt findings', '欠账(黄)')}</span>
            </Link>
            <Link to="/findings#findings-green" className="stat-block stat-block-green">
              <span className="stat-num stat-num-green">{findingsSummary.green}</span>
              <span className="stat-label">{bi(locale, 'Healthy evidence', '达标存照(绿)')}</span>
            </Link>
            <div className="stat-block stat-block-info">
              <span className="stat-num stat-num-info">
                {metrics.flowCount}
                <span className="stat-label" style={{ display: 'inline' }}> {bi(locale, 'flows', '流程')}</span>
              </span>
              <span className="stat-label">
                {bi(
                  locale,
                  `${metrics.tableCount} tables · ${metrics.serviceCount} services · ${metrics.crudEdgeCount} edges`,
                  `${metrics.tableCount} 表 · ${metrics.serviceCount} 服务 · ${metrics.crudEdgeCount} 读写边`,
                )}
              </span>
            </div>
          </div>

          <div className="detail-grid-2col">
            <article className="card card-accent-red">
              <h2>{bi(locale, 'Top Findings', '重点发现')}</h2>
              {topFindings.length === 0 && (
                <p className="subtle">{bi(locale, 'No red/yellow findings.', '无红/黄级发现。')}</p>
              )}
              <ul className="findings-list">
                {topFindings.map((finding, index) => (
                  <li
                    key={`dashboard-finding-${finding.ref}-${index}`}
                    className={`findings-item findings-item-${finding.severity}`}
                    style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
                  >
                    <span>
                      <span className={`sev-badge sev-badge-${finding.severity}`} style={{ marginRight: 8 }}>
                        {finding.ref}
                      </span>
                      <span className="findings-note">
                        {finding.note.length > 90 ? `${finding.note.slice(0, 90)}…` : finding.note}
                      </span>
                    </span>
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
                    </span>
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: 10 }}>
                <Link to="/findings">{bi(locale, 'All findings →', '全部发现 →')}</Link>
                {' · '}
                <Link to="/governance">
                  {bi(
                    locale,
                    `Rules (${governance.violations.length} violations / ${governance.warnings.length} warnings)`,
                    `治理规则(${governance.violations.length} 违例 / ${governance.warnings.length} 警告)`,
                  )}
                </Link>
              </p>
            </article>

            <article className="card">
              <h2>{bi(locale, 'Runtime Snapshot', '运行态快照')}</h2>
              {!runtimeBaseUrl && (
                <p>
                  {bi(locale, 'Set runtime url in ', '请先在')}{' '}
                  <Link to="/settings">{bi(locale, 'Settings', '设置')}</Link>
                  {bi(locale, ' to enable.', ' 填写 Runtime URL。')}
                </p>
              )}
              {runtimeBaseUrl && (
                <>
                  <p className="subtle">
                    {bi(locale, 'source', '来源')}: <code>{runtimeBaseUrl}</code>
                  </p>
                  <div className="field-list">
                    <span className="field-row"><span className="field-key">{bi(locale, 'recent events', '近期事件')}</span><span className="field-value">{runtimeRows.length}</span></span>
                    <span className="field-row"><span className="field-key">{bi(locale, 'pending outbox', 'outbox 待发')}</span><span className="field-value">{runtimeOverlay?.pendingOutbox ?? 0}</span></span>
                    <span className="field-row"><span className="field-key">{bi(locale, 'failed outbox', 'outbox 失败')}</span><span className="field-value">{runtimeOverlay?.failedOutbox ?? 0}</span></span>
                  </div>
                </>
              )}
            </article>
          </div>

          <div className="detail-grid-2col">
            <article className="card">
              <h2>{bi(locale, 'Action Items', '治理待办')}</h2>
              <ul className="action-item-list">
                {actionItems.map((item) => (
                  <li key={item.key} className="action-item">
                    <Link to={item.to}>{bi(locale, item.en, item.zh)}</Link>
                    <span className={item.count > 0 ? 'action-count-danger' : 'action-count-ok'}>
                      {item.count}
                    </span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card">
              <h2>{bi(locale, 'Top Tables by Writes', '写入最频繁表')}</h2>
              <ul className="inline-list">
                {metrics.topTablesByWriteCount.length === 0 && <li className="subtle">-</li>}
                {metrics.topTablesByWriteCount.map((row) => (
                  <li key={`top-table-${row.tableName}`}>
                    <Link to={`/tables/${encodeURIComponent(row.tableName)}`}>{row.tableName}</Link>
                    {' '}({row.writeFlowCount})
                  </li>
                ))}
              </ul>
              <h2 style={{ marginTop: 16 }}>{bi(locale, 'Top Flows by Table Touch', '触达表最多流程')}</h2>
              <ul className="inline-list">
                {metrics.topFlowsByTableTouch.length === 0 && <li className="subtle">-</li>}
                {metrics.topFlowsByTableTouch.map((row) => (
                  <li key={`top-flow-${row.flowId}`}>
                    <Link to={`/flows/${encodeURIComponent(row.flowId)}`}>{row.flowId}</Link>
                    {' '}({row.touchedTables}) — {row.flowName}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <article className="card">
            <h2>{bi(locale, 'Runtime Events', '运行态事件')}</h2>
            {!runtimeBaseUrl && (
              <p>
                {bi(locale, 'Set runtime url in ', '请先在')}{' '}
                <Link to="/settings">{bi(locale, 'Settings', '设置')}</Link>
                {bi(locale, ' to enable.', ' 填写 Runtime URL。')}
              </p>
            )}
            {runtimeBaseUrl && (
              <>
                <p className="subtle">
                  {bi(locale, 'Source', '来源')}: <code>{runtimeBaseUrl}{runtimeEventsPath(data)}?limit=200</code>
                </p>
                {runtimeLoading && <p>{bi(locale, 'Loading runtime events…', '正在加载运行态事件…')}</p>}
                {runtimeError && (
                  <p className="error">
                    {bi(locale, 'Runtime overlay warning: ', '运行态告警:')}{runtimeError}
                    {bi(locale, ' (endpoint may be down or CORS blocked)', '(可能是接口不可用或 CORS,请检查 Runtime URL)')}
                  </p>
                )}
                {!runtimeLoading && runtimeRows.length === 0 && (
                  <p className="subtle">{bi(locale, 'No runtime events returned.', '当前没有返回事件。')}</p>
                )}
                {!runtimeLoading && runtimeRows.length > 0 && (
                  <div className="runtime-table-wrap">
                    <table className="runtime-table">
                      <thead>
                        <tr>
                          {runtimeColumns.map((column) => (
                            <th key={`runtime-events-col-${column}`}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {runtimeRows.slice(0, 20).map((row, index) => (
                          <tr key={`runtime-events-row-${index}`}>
                            {runtimeColumns.map((column) => (
                              <td key={`runtime-events-cell-${index}-${column}`}>
                                {formatRuntimeValue(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
}
