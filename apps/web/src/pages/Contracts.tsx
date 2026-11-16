import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buildFlowDeliveryChecklist } from '../app/deliveryChecklist';
import { runGovernanceChecks } from '../app/governanceRules';
import { buildProjectIndexes } from '../app/indexes';
import { useLocale, bi } from '../app/i18n';
import { getViewerPolicy, isPolicyTable, type ViewerPolicy } from '../app/policy';
import { useProjectData, type FlowRecord } from '../app/useProjectData';
import './Contracts.css';

const WRITE_OPS = new Set(['C', 'U', 'D']);

/** 空/缺/TBD 一律视为「未声明」(与 governanceRules / deliveryChecklist 同口径) */
function isNotDeclared(value: string | undefined): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

/** 写业务表流程:对非策略表(events/outbox 等)存在 C/U/D 写入 */
function writesBusinessTables(
  flow: FlowRecord,
  canonical: (tableName: string) => string,
  policy: ViewerPolicy,
): boolean {
  for (const write of flow.writes ?? []) {
    const tableName = canonical(write.table);
    const op = (write.op ?? '').toUpperCase();
    if (!isPolicyTable(tableName, policy) && WRITE_OPS.has(op)) {
      return true;
    }
  }
  return false;
}

/** 是否对指定表存在指定写操作(outbox 覆盖率用) */
function hasWriteOf(
  flow: FlowRecord,
  tableName: string,
  op: string,
  canonical: (name: string) => string,
): boolean {
  for (const write of flow.writes ?? []) {
    if (canonical(write.table) === tableName && (write.op ?? '').toUpperCase() === op) {
      return true;
    }
  }
  return false;
}

type ContractRow = {
  id: string;
  name: string;
  actors: string;
  idempotencyDeclared: boolean;
  idempotencyKey: string;
  finalityDeclared: boolean;
  finality: string;
  eventCount: number;
  violations: number;
  warnings: number;
  score: number;
  checklistSummary: string;
};

type ContractStats = {
  total: number;
  idempotencyOk: number;
  eventsOk: number;
  outboxOk: number;
};

export function ContractsPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const governance = useMemo(() => runGovernanceChecks(data, locale), [data, locale]);

  const stats = useMemo<ContractStats>(() => {
    if (!data) {
      return { total: 0, idempotencyOk: 0, eventsOk: 0, outboxOk: 0 };
    }
    const canonical = indexes.canonicalTableName;
    const policy = getViewerPolicy(data);
    const writeFlows = data.flows.filter((flow) => writesBusinessTables(flow, canonical, policy));
    return {
      total: writeFlows.length,
      idempotencyOk: writeFlows.filter((flow) => !isNotDeclared(flow.idempotency_key)).length,
      eventsOk: writeFlows.filter((flow) => (flow.events_appended ?? []).length > 0).length,
      outboxOk: writeFlows.filter((flow) => hasWriteOf(flow, policy.outboxTable, 'C', canonical))
        .length,
    };
  }, [data, indexes]);

  const rows = useMemo<ContractRow[]>(() => {
    if (!data) {
      return [];
    }
    const govByFlow = new Map<string, { violation: number; warning: number }>();
    for (const issue of governance.all) {
      if (!issue.flowId) {
        continue;
      }
      const entry = govByFlow.get(issue.flowId) ?? { violation: 0, warning: 0 };
      if (issue.severity === 'violation') {
        entry.violation += 1;
      } else {
        entry.warning += 1;
      }
      govByFlow.set(issue.flowId, entry);
    }
    return data.flows.map((flow) => {
      const checklist = buildFlowDeliveryChecklist({
        data,
        flow,
        runtimeEnabled: false,
        runtimeAvailable: false,
        locale,
      });
      const gov = govByFlow.get(flow.id) ?? { violation: 0, warning: 0 };
      return {
        id: flow.id,
        name: locale === 'zh' ? flow.name_zh : flow.name_en,
        actors: (flow.actors ?? [])
          .map((actor) => (typeof actor === 'string' ? actor : JSON.stringify(actor)))
          .join(', '),
        idempotencyDeclared: !isNotDeclared(flow.idempotency_key),
        idempotencyKey: (flow.idempotency_key ?? '').trim(),
        finalityDeclared: !isNotDeclared(flow.finality),
        finality: (flow.finality ?? '').trim(),
        eventCount: (flow.events_appended ?? []).length,
        violations: gov.violation,
        warnings: gov.warning,
        score: checklist.score,
        checklistSummary: `${checklist.achievedWeight}/${checklist.maxWeight}`,
      };
    });
  }, [data, governance, locale]);

  const pct = (ok: number): string =>
    stats.total === 0 ? '-' : `${Math.round((ok / stats.total) * 100)}%`;

  const flowDetailPath = (flowId: string): string => `/flows/${encodeURIComponent(flowId)}`;

  return (
    <section className="page">
      <h1>{bi(locale, 'Contracts', '接口契约')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Flows as contracts: idempotency, finality, events, governance hits and delivery score in one board.',
          '把流程当契约盘:幂等键、终态语义、事件声明、治理命中与交付分同板审视。',
        )}
      </p>

      {loading && (
        <p className="subtle">{bi(locale, 'Loading project data…', '正在加载项目数据…')}</p>
      )}
      {error && (
        <p className="error">
          {bi(locale, 'Failed to load project data: ', '加载项目数据失败:')}
          {error}
        </p>
      )}

      {!loading && !error && data && (
        <>
          <div className="health-strip">
            <div className="stat-block">
              <span className="stat-num">{pct(stats.idempotencyOk)}</span>
              <span className="stat-label">
                {bi(locale, 'Idempotency declared', '幂等声明率')}
                {stats.total > 0 && ` · ${stats.idempotencyOk}/${stats.total}`}
              </span>
            </div>
            <div className="stat-block">
              <span className="stat-num">{pct(stats.eventsOk)}</span>
              <span className="stat-label">
                {bi(locale, 'Events declared', '事件声明率')}
                {stats.total > 0 && ` · ${stats.eventsOk}/${stats.total}`}
              </span>
            </div>
            <div className="stat-block">
              <span className="stat-num">{pct(stats.outboxOk)}</span>
              <span className="stat-label">
                {bi(locale, 'Outbox coverage', 'Outbox 覆盖率')}
                {stats.total > 0 && ` · ${stats.outboxOk}/${stats.total}`}
              </span>
            </div>
          </div>
          <p className="subtle">
            {bi(
              locale,
              'Rates are computed over flows that write business tables (C/U/D on non-policy tables); "-" means no such flows.',
              '比率按写业务表的流程统计(对非策略表的 C/U/D 写入);「-」表示无写业务表流程。',
            )}
          </p>

          <div className="contract-grid-wrap">
            <table className="table-lens-grid">
              <thead>
                <tr>
                  <th>{bi(locale, 'Flow ID', '流程 ID')}</th>
                  <th>{bi(locale, 'Name', '名称')}</th>
                  <th>{bi(locale, 'Actors', '触发方')}</th>
                  <th>{bi(locale, 'Idempotency Key', '幂等键')}</th>
                  <th>{bi(locale, 'Finality', '终态语义')}</th>
                  <th>{bi(locale, 'Events', '事件数')}</th>
                  <th>{bi(locale, 'Governance', '治理命中')}</th>
                  <th>{bi(locale, 'Delivery Score', '交付分')}</th>
                  <th>{bi(locale, 'Detail', '详情')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={flowDetailPath(row.id)} className="item-title">
                        {row.id}
                      </Link>
                    </td>
                    <td>{row.name}</td>
                    <td>
                      {row.actors ? (
                        <span className="field-value-mono">{row.actors}</span>
                      ) : (
                        <span className="subtle">-</span>
                      )}
                    </td>
                    <td>
                      {row.idempotencyDeclared ? (
                        <span className="field-value-mono">{row.idempotencyKey}</span>
                      ) : (
                        <span className="sev-badge sev-badge-red">
                          {bi(locale, 'Not declared', '未声明')}
                        </span>
                      )}
                    </td>
                    <td>
                      {row.finalityDeclared ? (
                        <span className="field-value-mono">{row.finality}</span>
                      ) : (
                        <span className="sev-badge sev-badge-yellow">
                          {bi(locale, 'Not declared', '未声明')}
                        </span>
                      )}
                    </td>
                    <td>
                      {row.eventCount === 0 ? (
                        <span className="sev-badge sev-badge-yellow">0</span>
                      ) : (
                        row.eventCount
                      )}
                    </td>
                    <td>
                      {row.violations === 0 && row.warnings === 0 ? (
                        <span className="subtle">-</span>
                      ) : (
                        <span className="contract-badges">
                          {row.violations > 0 && (
                            <span className="sev-badge sev-badge-red">
                              {bi(locale, 'Violations', '违例')} {row.violations}
                            </span>
                          )}
                          {row.warnings > 0 && (
                            <span className="sev-badge sev-badge-yellow">
                              {bi(locale, 'Warnings', '警告')} {row.warnings}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`delivery-score-badge ${
                          row.score < 60
                            ? 'delivery-score-low'
                            : row.score < 80
                              ? 'delivery-score-mid'
                              : 'delivery-score-high'
                        }`}
                      >
                        {row.score}
                      </span>
                      <span className="subtle"> ({row.checklistSummary})</span>
                    </td>
                    <td>
                      <Link to={flowDetailPath(row.id)} className="item-title">
                        {bi(locale, 'Detail', '详情')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className="subtle">{bi(locale, 'No flows in the manifest.', '清单中没有流程。')}</p>
          )}
        </>
      )}
    </section>
  );
}
