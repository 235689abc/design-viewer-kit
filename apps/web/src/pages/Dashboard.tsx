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
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const governance = useMemo(() => runGovernanceChecks(data), [data]);
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
    const flowsMissingEvents = flows.filter((flow) => flow.events_appended.length === 0).length;
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
        flowName: `${flow.name_en} / ${flow.name_zh}`,
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
  }, [data, indexes.edgesByFlow, indexes.edgesByTable]);

  const runtimeRows = runtimeOverlay?.events ?? [];
  const runtimeColumns = useMemo(() => collectRuntimeColumns(runtimeRows), [runtimeRows]);
  const topGovernanceIssues = useMemo(
    () =>
      [...governance.all]
        .sort((a, b) => {
          if (a.severity !== b.severity) {
            return a.severity === 'violation' ? -1 : 1;
          }
          return a.rule.localeCompare(b.rule);
        })
        .slice(0, 5),
    [governance.all],
  );
  const governanceRuleCounts = useMemo(
    () =>
      Object.entries(governance.byRule)
        .map(([rule, items]) => ({ rule, count: items.length }))
        .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)),
    [governance.byRule],
  );

  const actionItems = [
    {
      label: 'Tables missing owner / 表缺少 owner',
      count: metrics.tablesMissingOwner,
      to: '/tables?filter=missing-owner',
    },
    {
      label: 'Tables missing introduced_in / 表缺少 introduced_in',
      count: metrics.tablesMissingIntroduced,
      to: '/tables?filter=missing-introduced',
    },
    {
      label: 'Planned tables / planned 表',
      count: metrics.plannedTables,
      to: '/tables?filter=planned',
    },
    {
      label: 'Flows missing idempotency / 流程缺少幂等键',
      count: metrics.flowsMissingIdempotency,
      to: '/flows?filter=missing-idempotency',
    },
    {
      label: 'Flows missing events / 流程缺少事件',
      count: metrics.flowsMissingEvents,
      to: '/flows?filter=missing-events',
    },
  ];

  return (
    <section className="page">
      <h1>Dashboard / 总览</h1>
      <p className="subtle">Governance cockpit built from `/data/index.json`.</p>

      {loading && <p>Loading project data... / 正在加载项目数据...</p>}
      {error && <p className="error">Failed to load project data / 加载项目数据失败: {error}</p>}

      {data && !error && (
        <>
          <div className="card-grid">
            <article className="card">
              <h2>Project / 项目</h2>
              <p>{data.meta.project}</p>
              <p className="subtle">{data.meta.generated_at}</p>
            </article>
            <article className="card">
              <h2>Counts / 总量</h2>
              <p>flows: {metrics.flowCount}</p>
              <p>tables: {metrics.tableCount}</p>
              <p>crudEdges: {metrics.crudEdgeCount}</p>
              <p>services: {metrics.serviceCount}</p>
            </article>
            <article className="card">
              <h2>Governance Gaps / 治理缺口</h2>
              <p>planned tables: {metrics.plannedTables}</p>
              <p>tables missing owner: {metrics.tablesMissingOwner}</p>
              <p>tables missing introduced_in: {metrics.tablesMissingIntroduced}</p>
              <p>flows missing idempotency_key: {metrics.flowsMissingIdempotency}</p>
              <p>flows missing events_appended: {metrics.flowsMissingEvents}</p>
              <p>alias tables: {metrics.aliasTables}</p>
            </article>
            <article className="card">
              <h2>Runtime Snapshot / 运行态快照</h2>
              {!runtimeBaseUrl && (
                <p>
                  Set runtime url to enable / 请先在 <Link to="/settings">Settings / 设置</Link> 填写 Runtime URL。
                </p>
              )}
              {runtimeBaseUrl && (
                <>
                  <p className="subtle">source: <code>{runtimeBaseUrl}</code></p>
                  <p>recent events: {runtimeRows.length}</p>
                  <p>pending outbox: {runtimeOverlay?.pendingOutbox ?? 0}</p>
                  <p>failed outbox: {runtimeOverlay?.failedOutbox ?? 0}</p>
                </>
              )}
            </article>

            <article className="card">
              <h2>Governance Alerts / 治理报警</h2>
              <p>violations: {governance.violations.length}</p>
              <p>warnings: {governance.warnings.length}</p>
              <p>
                <Link to="/governance">Open Governance Page / 打开治理页</Link>
              </p>
              <ul className="inline-list">
                {governanceRuleCounts.map((row) => (
                  <li key={`dashboard-rule-count-${row.rule}`}>
                    <Link to={`/governance?rule=${encodeURIComponent(row.rule)}`}>
                      {row.rule}
                    </Link>
                    {' '}({row.count})
                  </li>
                ))}
              </ul>
              <h3>Top issues / 重点问题</h3>
              <ul className="inline-list">
                {topGovernanceIssues.length === 0 && <li>-</li>}
                {topGovernanceIssues.map((item) => (
                  <li key={`dashboard-governance-${item.id}`}>
                    <Link to={`/governance?rule=${encodeURIComponent(item.rule)}`}>
                      [{item.severity}] {item.rule}
                    </Link>
                    {item.flowId && (
                      <>
                        {' '}·{' '}
                        <Link to={`/flows/${encodeURIComponent(item.flowId)}`}>{item.flowId}</Link>
                      </>
                    )}
                    {item.table && (
                      <>
                        {' '}·{' '}
                        <Link to={`/tables/${encodeURIComponent(item.table)}`}>{item.table}</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <div className="card-grid">
            <article className="card">
              <h2>Action Items / 治理待办</h2>
              <ul className="action-item-list">
                {actionItems.map((item) => (
                  <li key={item.label} className="action-item">
                    <Link to={item.to}>{item.label}</Link>
                    <span className={item.count > 0 ? 'action-count-danger' : 'action-count-ok'}>
                      {item.count}
                    </span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card">
              <h2>Top Tables by Writes / 写入最频繁表</h2>
              <ul className="inline-list">
                {metrics.topTablesByWriteCount.length === 0 && <li>-</li>}
                {metrics.topTablesByWriteCount.map((row) => (
                  <li key={`top-table-${row.tableName}`}>
                    <Link to={`/tables/${encodeURIComponent(row.tableName)}`}>{row.tableName}</Link>
                    {' '}({row.writeFlowCount})
                  </li>
                ))}
              </ul>
            </article>

            <article className="card">
              <h2>Top Flows by Table Touch / 触达表最多流程</h2>
              <ul className="inline-list">
                {metrics.topFlowsByTableTouch.length === 0 && <li>-</li>}
                {metrics.topFlowsByTableTouch.map((row) => (
                  <li key={`top-flow-${row.flowId}`}>
                    <Link to={`/flows/${encodeURIComponent(row.flowId)}`}>{row.flowId}</Link>
                    {' '}({row.touchedTables}) - {row.flowName}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <article className="card">
            <h2>Runtime Events / 运行态事件</h2>
            {!runtimeBaseUrl && (
              <p>
                Set runtime url to enable / 请先在 <Link to="/settings">Settings / 设置</Link> 填写 Runtime URL。
              </p>
            )}
            {runtimeBaseUrl && (
              <>
                <p className="subtle">Source: <code>{runtimeBaseUrl}{runtimeEventsPath(data)}?limit=200</code></p>
                {runtimeLoading && <p>Loading runtime events... / 正在加载运行态事件...</p>}
                {runtimeError && (
                  <p className="error">
                    Runtime overlay warning: {runtimeError}
                    {' '}（可能是接口不可用或 CORS，请检查 Runtime URL）
                  </p>
                )}
                {!runtimeLoading && runtimeRows.length === 0 && (
                  <p className="subtle">No runtime events returned / 当前没有返回事件。</p>
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
