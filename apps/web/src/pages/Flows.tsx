import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildFlowDeliveryChecklist } from '../app/deliveryChecklist';
import { buildProjectIndexes, getServiceDisplay } from '../app/indexes';
import { collectFindings, type FindingsSummary } from '../app/findings';
import { useLocale, bi } from '../app/i18n';
import { loadRuntimeOverlay, type RuntimeFlowMetric } from '../app/runtimeMetrics';
import { getRuntimeBaseUrl, subscribeRuntimeBaseUrl } from '../app/runtimeClient';
import { useProjectData } from '../app/useProjectData';

type FlowRow = {
  id: string;
  name: string;
  owner: string;
  score: number;
  mode: 'design-only' | 'design+runtime';
  checklistSummary: string;
  missingIdempotency: boolean;
  missingEvents: boolean;
  findings: FindingsSummary;
};

function isMissingIdempotency(value: string): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

export function FlowsPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [sortBy, setSortBy] = useState<'score_desc' | 'score_asc' | 'id_asc'>('score_desc');
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() => getRuntimeBaseUrl());
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeFlowMetrics, setRuntimeFlowMetrics] = useState<Record<string, RuntimeFlowMetric>>({});
  const activeFilter = searchParams.get('filter')?.trim() ?? '';
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => setRuntimeBaseUrl(value));
  }, []);

  useEffect(() => {
    if (!runtimeBaseUrl) {
      setRuntimeFlowMetrics({});
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
        setRuntimeFlowMetrics(overlay.flowMetrics);
        if (overlay.warnings.length > 0) {
          setRuntimeError(overlay.warnings.join(' | '));
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setRuntimeFlowMetrics({});
        setRuntimeError((err as Error).message || 'Runtime overlay unavailable');
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

  const runtimeAvailable = !!runtimeBaseUrl && !runtimeError;

  const rows = useMemo<FlowRow[]>(() => {
    if (!data) {
      return [];
    }
    const findingsByFlow = new Map<string, FindingsSummary>();
    for (const finding of collectFindings(data, locale)) {
      if (!finding.flowId) {
        continue;
      }
      const current = findingsByFlow.get(finding.flowId) ?? { red: 0, yellow: 0, green: 0, info: 0, total: 0 };
      current[finding.severity] += 1;
      current.total += 1;
      findingsByFlow.set(finding.flowId, current);
    }
    return data.flows.map((flow) => {
      const checklist = buildFlowDeliveryChecklist({
        data,
        flow,
        runtimeMetric: runtimeFlowMetrics[flow.id],
        runtimeEnabled: !!runtimeBaseUrl,
        runtimeAvailable,
        locale,
      });
      return {
        id: flow.id,
        name: locale === 'zh' ? flow.name_zh : flow.name_en,
        owner: getServiceDisplay(flow.owner_service, indexes.mapServices, locale),
        score: checklist.score,
        mode: checklist.mode,
        checklistSummary: `${checklist.achievedWeight}/${checklist.maxWeight}`,
        missingIdempotency: isMissingIdempotency(flow.idempotency_key),
        missingEvents: (flow.events_appended ?? []).length === 0,
        findings: findingsByFlow.get(flow.id) ?? { red: 0, yellow: 0, green: 0, info: 0, total: 0 },
      };
    });
  }, [data, indexes.mapServices, locale, runtimeAvailable, runtimeBaseUrl, runtimeFlowMetrics]);

  const filteredRows = useMemo(() => {
    const loweredKeyword = keyword.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (activeFilter === 'missing-idempotency' && !row.missingIdempotency) {
        return false;
      }
      if (activeFilter === 'missing-events' && !row.missingEvents) {
        return false;
      }
      if (activeFilter === 'low-score' && row.score >= 60) {
        return false;
      }
      if (
        loweredKeyword &&
        !row.id.toLowerCase().includes(loweredKeyword) &&
        !row.name.toLowerCase().includes(loweredKeyword) &&
        !row.owner.toLowerCase().includes(loweredKeyword)
      ) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'score_desc') {
        return b.score - a.score || a.id.localeCompare(b.id);
      }
      if (sortBy === 'score_asc') {
        return a.score - b.score || a.id.localeCompare(b.id);
      }
      return a.id.localeCompare(b.id);
    });

    return list;
  }, [activeFilter, keyword, rows, sortBy]);

  return (
    <section className="page">
      <h1>{bi(locale, 'Flows', '流程')}</h1>

      {loading && <p>{bi(locale, 'Loading flows...', '正在加载流程...')}</p>}
      {error && (
        <p className="error">
          {bi(locale, 'Failed to load flows: ', '加载流程失败:')}{error}
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="table-lens-toolbar">
            <label htmlFor="flow-search">{bi(locale, 'Search flows', '搜索流程')}</label>
            <input
              id="flow-search"
              type="text"
              value={keyword}
              placeholder={bi(locale, 'FLOW-XXX or name', 'FLOW-XXX 或名称')}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <label htmlFor="flow-sort">{bi(locale, 'Sort', '排序')}</label>
            <select
              id="flow-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'score_desc' | 'score_asc' | 'id_asc')}
            >
              <option value="score_desc">{bi(locale, 'Score high → low', '分数 高→低')}</option>
              <option value="score_asc">{bi(locale, 'Score low → high', '分数 低→高')}</option>
              <option value="id_asc">{bi(locale, 'Flow ID A → Z', '流程 ID A→Z')}</option>
            </select>
            {activeFilter && (
              <span className="state-badge state-badge-planned">
                {bi(locale, 'filter', '过滤')}: {activeFilter}
              </span>
            )}
            <span className="subtle">
              {bi(locale, 'visible', '可见')}: {filteredRows.length}/{rows.length}
            </span>
            {activeFilter && (
              <Link to="/flows">{bi(locale, 'Clear Filter', '清除过滤')}</Link>
            )}
          </div>

          {runtimeBaseUrl && runtimeLoading && (
            <p className="subtle">
              {bi(locale, 'Loading runtime overlay...', '正在加载运行态叠加...')}
            </p>
          )}
          {runtimeBaseUrl && runtimeError && (
            <p className="error">
              {bi(locale, 'Runtime overlay warning: ', '运行态叠加警告:')}{runtimeError}
              {' '}
              {bi(locale, '(score automatically degraded to design-only)', '(score 已自动退化为 design-only)')}
            </p>
          )}

          <table className="table-lens-grid">
            <thead>
              <tr>
                <th>{bi(locale, 'Flow ID', '流程 ID')}</th>
                <th>{bi(locale, 'Name', '名称')}</th>
                <th>{bi(locale, 'Owner', '归属服务')}</th>
                <th>{bi(locale, 'Findings', '发现')}</th>
                <th>{bi(locale, 'Delivery Score', '交付评分')}</th>
                <th>{bi(locale, 'Mode', '模式')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/flows/${encodeURIComponent(row.id)}`} className="item-title">
                      {row.id}
                    </Link>
                  </td>
                  <td>{row.name}</td>
                  <td>{row.owner}</td>
                  <td>
                    {row.findings.total === 0 ? (
                      <span className="subtle">-</span>
                    ) : (
                      <>
                        {row.findings.red > 0 && (
                          <span className="sev-badge sev-badge-red" style={{ marginRight: 4 }}>
                            {bi(locale, 'Red', '红')} {row.findings.red}
                          </span>
                        )}
                        {row.findings.yellow > 0 && (
                          <span className="sev-badge sev-badge-yellow" style={{ marginRight: 4 }}>
                            {bi(locale, 'Yellow', '黄')} {row.findings.yellow}
                          </span>
                        )}
                        {row.findings.green > 0 && (
                          <span className="sev-badge sev-badge-green" style={{ marginRight: 4 }}>
                            {bi(locale, 'Green', '绿')} {row.findings.green}
                          </span>
                        )}
                        {row.findings.info > 0 && (
                          <span className="sev-badge sev-badge-info">
                            {bi(locale, 'Info', '注')} {row.findings.info}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <span
                      className={`delivery-score-badge ${
                        row.score < 60 ? 'delivery-score-low' : row.score < 80 ? 'delivery-score-mid' : 'delivery-score-high'
                      }`}
                    >
                      {row.score}
                    </span>
                    <span className="subtle"> ({row.checklistSummary})</span>
                  </td>
                  <td>{row.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
