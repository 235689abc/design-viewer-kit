import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buildFlowDeliveryChecklist } from '../app/deliveryChecklist';
import { collectFindings, type FindingsSummary } from '../app/findings';
import { useLocale, bi } from '../app/i18n';
import { useProjectData, type FlowRecord } from '../app/useProjectData';
import type { Feature } from '@design-viewer/schema';
import './Features.css';

const EMPTY_SUMMARY: FindingsSummary = { red: 0, yellow: 0, green: 0, info: 0, total: 0 };

/** status 值直显;含 plan/draft/规划/草稿 者套虚线 planned 徽章,其余实线 existing */
function statusBadgeClass(status: string): string {
  return /plan|draft|规划|草稿/i.test(status)
    ? 'state-badge state-badge-planned'
    : 'state-badge state-badge-existing';
}

export function FeaturesPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();

  /** manifest 顶层可选 features[]:特性 → 流程的反向地图(类型单源 @design-viewer/schema) */
  const features = useMemo<Feature[]>(() => data?.features ?? [], [data]);

  const flowIndex = useMemo(() => {
    const map = new Map<string, FlowRecord>();
    for (const flow of data?.flows ?? []) {
      map.set(flow.id, flow);
    }
    return map;
  }, [data]);

  const findingsByFlow = useMemo(() => {
    const map = new Map<string, FindingsSummary>();
    for (const finding of collectFindings(data, locale)) {
      if (!finding.flowId) {
        continue;
      }
      const current = map.get(finding.flowId) ?? { ...EMPTY_SUMMARY };
      current[finding.severity] += 1;
      current.total += 1;
      map.set(finding.flowId, current);
    }
    return map;
  }, [data, locale]);

  const deliveryByFlow = useMemo(() => {
    const map = new Map<string, { score: number; summary: string }>();
    if (!data) {
      return map;
    }
    for (const flow of data.flows) {
      const checklist = buildFlowDeliveryChecklist({
        data,
        flow,
        runtimeEnabled: false,
        runtimeAvailable: false,
        locale,
      });
      map.set(flow.id, {
        score: checklist.score,
        summary: `${checklist.achievedWeight}/${checklist.maxWeight}`,
      });
    }
    return map;
  }, [data, locale]);

  const flows = data?.flows ?? [];
  const referencedFlowIds = useMemo(() => {
    const set = new Set<string>();
    for (const feature of features) {
      for (const flowId of feature.flows ?? []) {
        set.add(flowId);
      }
    }
    return set;
  }, [features]);

  const coveredCount = flows.filter((flow) => referencedFlowIds.has(flow.id)).length;
  const uncoveredFlows = flows.filter((flow) => !referencedFlowIds.has(flow.id));

  return (
    <section className="page">
      <h1>{bi(locale, 'Feature Map', '功能地图')}</h1>

      {loading && <p>{bi(locale, 'Loading features...', '正在加载功能...')}</p>}
      {error && (
        <p className="error">
          {bi(locale, 'Failed to load features: ', '加载功能失败:')}
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="health-strip">
            <div className="stat-block stat-block-info">
              <span className="stat-num">{features.length}</span>
              <span className="stat-label">{bi(locale, 'Features', '特性数')}</span>
            </div>
            <div className="stat-block stat-block-info">
              <span className="stat-num">{coveredCount}</span>
              <span className="stat-label">{bi(locale, 'Covered flows', '被覆盖流程数')}</span>
            </div>
            <Link
              to="/flows"
              className={uncoveredFlows.length > 0 ? 'stat-block stat-block-yellow' : 'stat-block stat-block-green'}
            >
              <span className="stat-num">{uncoveredFlows.length}</span>
              <span className="stat-label">{bi(locale, 'Flows without a feature', '未挂任何特性的流程数')}</span>
            </Link>
          </div>

          {features.length === 0 ? (
            <div className="card">
              <h2>{bi(locale, 'No features declared', '清单未声明 features')}</h2>
              <p>
                {bi(
                  locale,
                  'The manifest does not declare features — add a top-level features[] array to light this page up.',
                  '清单未声明 features——在 manifest 顶层加 features[] 即点亮本页。',
                )}
              </p>
              <pre className="feat-example">{`"features": [
  {
    "id": "FEAT-001",
    "name_en": "Place order",
    "name_zh": "下单",
    "status": "existing",
    "flows": ["FLOW-ORDER-CREATE"],
    "notes": "optional"
  }
]`}</pre>
            </div>
          ) : (
            <ul className="item-list">
              {features.map((feature) => (
                <li key={feature.id} className="item-card">
                  <div className="feat-head">
                    <h2>{locale === 'zh' ? feature.name_zh : feature.name_en}</h2>
                    {feature.status && (
                      <span className={statusBadgeClass(feature.status)}>{feature.status}</span>
                    )}
                    <span className="feat-id subtle">{feature.id}</span>
                  </div>

                  <div className="field-key feat-label">{bi(locale, 'Flows', '关联流程')}</div>
                  {(feature.flows ?? []).length === 0 ? (
                    <p className="subtle">{bi(locale, 'No flows linked.', '未挂流程。')}</p>
                  ) : (
                    <ul className="feat-flow-list">
                      {(feature.flows ?? []).map((flowId) => {
                        const flow = flowIndex.get(flowId);
                        const findings = findingsByFlow.get(flowId) ?? EMPTY_SUMMARY;
                        const delivery = flow ? deliveryByFlow.get(flowId) : undefined;
                        return (
                          <li key={flowId} className="feat-flow-row">
                            <Link to={`/flows/${encodeURIComponent(flowId)}`} className="item-title">
                              {flowId}
                            </Link>
                            {flow ? (
                              <span className="subtle">{locale === 'zh' ? flow.name_zh : flow.name_en}</span>
                            ) : (
                              <span className="state-badge state-badge-planned">
                                {bi(locale, 'not in flows', '未在流程清单')}
                              </span>
                            )}
                            {findings.red > 0 && (
                              <span className="sev-badge sev-badge-red">
                                {bi(locale, 'Red', '红')} {findings.red}
                              </span>
                            )}
                            {findings.yellow > 0 && (
                              <span className="sev-badge sev-badge-yellow">
                                {bi(locale, 'Yellow', '黄')} {findings.yellow}
                              </span>
                            )}
                            {findings.red === 0 && findings.yellow === 0 && <span className="subtle">-</span>}
                            {delivery && (
                              <span
                                title={bi(locale, 'Delivery score (design-only)', '交付评分(仅设计面)')}
                                className={`delivery-score-badge ${
                                  delivery.score < 60
                                    ? 'delivery-score-low'
                                    : delivery.score < 80
                                      ? 'delivery-score-mid'
                                      : 'delivery-score-high'
                                }`}
                              >
                                {delivery.score}
                              </span>
                            )}
                            {delivery && <span className="subtle">({delivery.summary})</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {feature.issues && feature.issues.length > 0 && (
                    <>
                      <div className="field-key feat-label">{bi(locale, 'Issues', '发现')}</div>
                      <ul className="findings-list">
                        {feature.issues.map((issue, index) => (
                          <li
                            key={`${issue.ref}-${index}`}
                            className={`findings-item findings-item-${issue.severity}`}
                          >
                            <span className="findings-ref">{issue.ref}</span>
                            <span className="findings-note">{issue.note ?? ''}</span>
                            <span />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {feature.notes && feature.notes.trim() !== '' && (
                    <>
                      <div className="field-key feat-label">{bi(locale, 'Notes', '备注')}</div>
                      <p className="feat-notes">{feature.notes}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="card feat-reverse">
            <h2>{bi(locale, 'Flows not mapped to any feature', '未被任何特性引用的流程')}</h2>
            {uncoveredFlows.length === 0 ? (
              <p className="subtle">
                {bi(locale, 'None — every flow is mapped to at least one feature.', '无——所有流程均已被特性引用。')}
              </p>
            ) : (
              <ul className="inline-list">
                {uncoveredFlows.map((flow) => (
                  <li key={flow.id}>
                    <Link to={`/flows/${encodeURIComponent(flow.id)}`} className="item-title">
                      {flow.id}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
