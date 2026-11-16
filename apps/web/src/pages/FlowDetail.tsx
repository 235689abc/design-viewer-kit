import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { buildFlowDeliveryChecklist } from '../app/deliveryChecklist';
import { buildFlowMapMermaid } from '../app/buildFlowMapMermaid';
import { buildFlowImpactMermaid } from '../app/buildFlowImpactMermaid';
import { buildProjectIndexes, getServiceDisplay } from '../app/indexes';
import { collectFindings } from '../app/findings';
import { useLocale, bi } from '../app/i18n';
import {
  formatRuntimeValue,
  getRuntimeBaseUrl,
  runtimeFlowRecentPath,
  subscribeRuntimeBaseUrl,
} from '../app/runtimeClient';
import { loadRuntimeFlowRecent, type RuntimeFlowMetric } from '../app/runtimeMetrics';
import { useProjectData } from '../app/useProjectData';
import {
  MermaidPanZoom,
  type MermaidPanZoomHandle,
  type MermaidPanZoomReadyInfo,
} from '../ui/MermaidPanZoom';

const OPS_ORDER = ['C', 'R', 'U', 'D'];

function mergeOps(existing: string, incoming: string): string {
  const opSet = new Set<string>();
  for (const op of `${existing}${incoming}`) {
    const normalized = op.toUpperCase();
    if (OPS_ORDER.includes(normalized)) {
      opSet.add(normalized);
    }
  }
  return OPS_ORDER.filter((op) => opSet.has(op)).join('');
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

function checklistMark(status: 'pass' | 'fail' | 'unknown'): string {
  if (status === 'pass') {
    return 'PASS';
  }
  if (status === 'fail') {
    return 'FAIL';
  }
  return 'UNKNOWN';
}

export function FlowDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const flowId = decodeURIComponent(id ?? '');
  const diffHint = searchParams.get('diff')?.trim() === '1';
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const flowMapRef = useRef<MermaidPanZoomHandle | null>(null);
  const flowImpactRef = useRef<MermaidPanZoomHandle | null>(null);
  const flowMapCardRef = useRef<HTMLElement | null>(null);
  const flowImpactCardRef = useRef<HTMLElement | null>(null);
  const diagramRef = useRef<MermaidPanZoomHandle | null>(null);
  const diagramAnchorRef = useRef<HTMLElement | null>(null);
  const diagramCardRef = useRef<HTMLElement | null>(null);
  const [flowMapRenderState, setFlowMapRenderState] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [flowImpactRenderState, setFlowImpactRenderState] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [renderState, setRenderState] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [isDiagramFullscreen, setIsDiagramFullscreen] = useState(false);
  const [isFlowMapFullscreen, setIsFlowMapFullscreen] = useState(false);
  const [isFlowImpactFullscreen, setIsFlowImpactFullscreen] = useState(false);
  const [showFlowMapReads, setShowFlowMapReads] = useState(true);
  const [showFlowMapTables, setShowFlowMapTables] = useState(true);
  const [showFlowMapSchemasOnly, setShowFlowMapSchemasOnly] = useState(false);
  const [impactGroupBySchema, setImpactGroupBySchema] = useState(true);
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() => getRuntimeBaseUrl());
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeRows, setRuntimeRows] = useState<Record<string, unknown>[]>([]);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeFlowMetric>({
    heat: 0,
    success: 0,
    pending: 0,
    failed: 0,
    unknown: 0,
  });
  const flowMapResult = useMemo(
    () =>
      buildFlowMapMermaid(data, flowId, {
        showReads: showFlowMapReads,
        showTables: showFlowMapTables,
        schemasOnly: showFlowMapSchemasOnly,
        locale,
      }),
    [data, flowId, locale, showFlowMapReads, showFlowMapSchemasOnly, showFlowMapTables],
  );
  const flowImpactResult = useMemo(
    () =>
      buildFlowImpactMermaid(data, flowId, {
        maxTables: 25,
        groupBySchema: impactGroupBySchema,
        maxTablesPerSchema: 12,
        locale,
      }),
    [data, flowId, impactGroupBySchema, locale],
  );

  useEffect(() => {
    function onFullscreenChange() {
      const fullscreenEl = document.fullscreenElement;
      setIsDiagramFullscreen(fullscreenEl === diagramCardRef.current);
      setIsFlowMapFullscreen(fullscreenEl === flowMapCardRef.current);
      setIsFlowImpactFullscreen(fullscreenEl === flowImpactCardRef.current);
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    rafId = requestAnimationFrame(() => {
      flowMapRef.current?.reset();
    });
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isFlowMapFullscreen]);

  useEffect(() => {
    let rafId = 0;
    rafId = requestAnimationFrame(() => {
      flowImpactRef.current?.reset();
    });
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isFlowImpactFullscreen]);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => setRuntimeBaseUrl(value));
  }, []);

  useEffect(() => {
    if (!runtimeBaseUrl || !flowId) {
      setRuntimeRows([]);
      setRuntimeError(null);
      setRuntimeLoading(false);
      setRuntimeMetrics({
        heat: 0,
        success: 0,
        pending: 0,
        failed: 0,
        unknown: 0,
      });
      return;
    }

    let cancelled = false;
    async function loadRuntimeRecent() {
      setRuntimeLoading(true);
      setRuntimeError(null);
      const result = await loadRuntimeFlowRecent(flowId, 200, data);
      if (cancelled) {
        return;
      }
      if (result.error && result.runtimeBaseUrl) {
        setRuntimeRows([]);
        setRuntimeError(result.error);
        setRuntimeMetrics({
          heat: 0,
          success: 0,
          pending: 0,
          failed: 0,
          unknown: 0,
        });
      } else {
        setRuntimeRows(result.rows);
        setRuntimeMetrics(result.metrics);
      }
      setRuntimeLoading(false);
    }
    void loadRuntimeRecent();
    return () => {
      cancelled = true;
    };
  }, [data, flowId, runtimeBaseUrl]);

  const toggleDiagramFullscreen = async () => {
    const host = diagramCardRef.current;
    if (!host) {
      return;
    }
    try {
      if (document.fullscreenElement === host) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await host.requestFullscreen();
    } catch (err) {
      console.error('Failed to toggle diagram fullscreen', err);
    }
  };

  const toggleFlowMapFullscreen = async () => {
    const host = flowMapCardRef.current;
    if (!host) {
      return;
    }
    try {
      if (document.fullscreenElement === host) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await host.requestFullscreen();
    } catch (err) {
      console.error('Failed to toggle flow map fullscreen', err);
    }
  };

  const toggleFlowImpactFullscreen = async () => {
    const host = flowImpactCardRef.current;
    if (!host) {
      return;
    }
    try {
      if (document.fullscreenElement === host) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await host.requestFullscreen();
    } catch (err) {
      console.error('Failed to toggle flow impact fullscreen', err);
    }
  };

  if (loading) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Flow Detail', '流程详情')}</h1>
        <p>{bi(locale, 'Loading flow detail...', '正在加载流程详情...')}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Flow Detail', '流程详情')}</h1>
        <p className="error">
          {bi(locale, 'Failed to load flow detail: ', '加载流程详情失败:')}{error}
        </p>
      </section>
    );
  }

  const flow = data?.flows.find((item) => item.id === flowId);
  if (!flow || !data) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Flow Detail', '流程详情')}</h1>
        <p>
          {bi(locale, 'Flow not found', '未找到流程')}: <code>{flowId}</code>
        </p>
        <p>
          <Link to="/flows">{bi(locale, 'Back to Flows', '返回流程列表')}</Link>
        </p>
      </section>
    );
  }

  const edges = data.crudEdges.filter((edge) => edge.flow_id === flow.id);
  // 发现(本流程):issues 立案 + notes QC 标记 + 治理规则命中,统一聚合
  const flowFindings = collectFindings(data, locale)
    .filter((finding) => finding.flowId === flow.id);
  const mermaid = data.diagrams.flow_mermaid[flow.id] ?? '';
  const ownerLabel = getServiceDisplay(flow.owner_service, indexes.mapServices, locale);
  const runtimeColumns = collectRuntimeColumns(runtimeRows);
  const relatedReads = Array.from(
    new Set(flow.reads.map((tableName) => indexes.canonicalTableName(tableName))),
  ).sort((a, b) => a.localeCompare(b));

  const writesByTable = new Map<string, string>();
  for (const write of flow.writes) {
    const canonicalTableName = indexes.canonicalTableName(write.table);
    const prev = writesByTable.get(canonicalTableName) ?? '';
    writesByTable.set(canonicalTableName, mergeOps(prev, write.op));
  }
  const relatedWrites = Array.from(writesByTable.entries()).sort(([a], [b]) => a.localeCompare(b));
  const flowImpactFileName = `flow-${flow.id}-impact.svg`;
  const deliveryChecklist = buildFlowDeliveryChecklist({
    data,
    flow,
    runtimeMetric: runtimeMetrics,
    runtimeEnabled: !!runtimeBaseUrl,
    runtimeAvailable: !!runtimeBaseUrl && !runtimeError,
    locale,
  });

  return (
    <section className="page">
      <h1>{bi(locale, 'Flow Detail', '流程详情')}</h1>
      {diffHint && (
        <p className="subtle">
          {bi(
            locale,
            'Diff hint: this flow changed between selected history versions.',
            'Diff 提示：该流程在选定版本之间发生变更。',
          )}
        </p>
      )}
      <p>
        <Link to="/flows">{bi(locale, 'Back to Flows', '返回流程列表')}</Link>
        {' | '}
        <button
          type="button"
          className="inline-link-btn"
          onClick={() => diagramAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {bi(locale, 'Jump to Diagram', '跳到图')}
        </button>
      </p>

      <div className="detail-grid">
        <article className="card">
          <h2>{bi(locale, 'Basic', '基本信息')}</h2>
          <div className="field-list">
            <span className="field-row"><span className="field-key">ID</span><span className="field-value field-value-mono">{flow.id}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Name', '名称')}</span><span className="field-value">{locale === 'zh' ? flow.name_zh : flow.name_en}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Owner', '归属服务')}</span><span className="field-value">{ownerLabel}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Doc Path', '文档路径')}</span><span className="field-value field-value-mono">{flow.doc_path || '-'}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Introduced In', '引入版本')}</span><span className="field-value field-value-mono">{flow.introduced_in || '-'}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Idempotency', '幂等键')}</span><span className="field-value field-value-mono">{flow.idempotency_key || '-'}</span></span>
            {flow.finality && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Finality', '终态语义')}</span><span className="field-value field-value-mono">{flow.finality}</span></span>
            )}
            {flow.actors && flow.actors.length > 0 && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Actors', '触发方')}</span><span className="field-value field-value-mono">{flow.actors.map((actor) => typeof actor === 'string' ? actor : JSON.stringify(actor)).join(', ')}</span></span>
            )}
            {flow.source_ref && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Source Ref', '代码证据')}</span><span className="field-value field-value-mono">{flow.source_ref}</span></span>
            )}
            {flow.deprecated && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Status', '状态')}</span><span className="field-value"><span className="sev-badge sev-badge-yellow">{bi(locale, `deprecated${flow.replaced_by ? ` → ${flow.replaced_by}` : ''}`, `已废弃${flow.replaced_by ? ` → ${flow.replaced_by}` : ''}`)}</span></span></span>
            )}
          </div>
        </article>

        <article className={`card ${flowFindings.some((finding) => finding.severity === 'red') ? 'card-accent-red' : flowFindings.some((finding) => finding.severity === 'yellow') ? 'card-accent-yellow' : 'card-accent-green'}`}>
          <h2>{bi(locale, 'Findings & Evidence', '发现与证据')}</h2>
          {flowFindings.length === 0 && (
            <p className="subtle">{bi(locale, 'No filed findings for this flow.', '该流程暂无立案发现。')}</p>
          )}
          <ul className="findings-list">
            {flowFindings.map((finding, index) => (
              <li
                key={`flow-finding-${finding.ref}-${index}`}
                className={`findings-item findings-item-${finding.severity}`}
                style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
              >
                <span>
                  <span className={`sev-badge sev-badge-${finding.severity}`} style={{ marginRight: 8 }}>{finding.ref}</span>
                  <span className="findings-note">{finding.note}</span>
                </span>
              </li>
            ))}
          </ul>
          {flow.notes && (
            <>
              <h2 style={{ marginTop: 14 }}>{bi(locale, 'Notes', '备注')}</h2>
              <p className="findings-note">{flow.notes}</p>
            </>
          )}
        </article>

        <article className="card">
          <h2>{bi(locale, 'Reads', '读取')}</h2>
          <ul className="inline-list">
            {flow.reads.length > 0 ? flow.reads.map((name) => <li key={name}><code>{name}</code></li>) : <li>-</li>}
          </ul>

          <h2>{bi(locale, 'Writes', '写入')}</h2>
          <ul className="inline-list">
            {flow.writes.length > 0
              ? flow.writes.map((write, idx) => (
                  <li key={`${write.table}-${write.op}-${idx}`}>
                    <code>{write.table}</code>: {write.op}
                  </li>
                ))
              : <li>-</li>}
          </ul>

          <h2>{bi(locale, 'Events', '事件')}</h2>
          <ul className="inline-list">
            {flow.events_appended.length > 0
              ? flow.events_appended.map((eventName) => <li key={eventName}><code>{eventName}</code></li>)
              : <li>-</li>}
          </ul>
        </article>

        <article className="card">
          <h2>{bi(locale, 'CRUD Edges', 'CRUD 边')}</h2>
          <ul className="inline-list">
            {edges.length > 0
              ? edges.map((edge) => (
                  <li key={`${edge.flow_id}-${edge.table}`}>
                    <code>{edge.table}</code>: {edge.ops}
                  </li>
                ))
              : <li>-</li>}
          </ul>
        </article>

        <article className="card">
          <h2>{bi(locale, 'Delivery Checklist', '交付清单')}</h2>
          <p>
            {bi(locale, 'score', '评分')}:{' '}
            <span
              className={`delivery-score-badge ${
                deliveryChecklist.score < 60
                  ? 'delivery-score-low'
                  : deliveryChecklist.score < 80
                    ? 'delivery-score-mid'
                    : 'delivery-score-high'
              }`}
            >
              {deliveryChecklist.score}
            </span>
            {' '}{bi(locale, 'mode', '模式')}: {deliveryChecklist.mode}
            {' '}({deliveryChecklist.achievedWeight}/{deliveryChecklist.maxWeight})
          </p>
          <ul className="delivery-checklist-list">
            {deliveryChecklist.items.map((check) => (
              <li key={`check-${check.key}`} className={`delivery-check-${check.status}`}>
                <span>{checklistMark(check.status)}</span>
                <span>{check.label}</span>
                <span className="subtle">[{check.weight}] {check.note}</span>
              </li>
            ))}
          </ul>
          <p className="subtle">
            {bi(
              locale,
              'Runtime disabled/unavailable will mark runtime evidence as unknown, keeping score design-focused.',
              '运行态关闭或不可用时,运行证据按 unknown 计,评分保持设计期口径。',
            )}
          </p>
          {deliveryChecklist.suggestions.length > 0 && (
            <>
              <h3>{bi(locale, 'Fix Suggestions', '修复建议')}</h3>
              <ul className="inline-list">
                {deliveryChecklist.suggestions.map((tip) => (
                  <li key={`tip-${tip}`}>{tip}</li>
                ))}
              </ul>
            </>
          )}
        </article>

        <article className="card">
          <h2>{bi(locale, 'Runtime Recent', '运行态最近记录')}</h2>
          {!runtimeBaseUrl && (
            <p>
              {bi(locale, 'Set runtime url in', '请先在')}{' '}
              <Link to="/settings">{bi(locale, 'Settings', '设置')}</Link>
              {' '}{bi(locale, 'to enable.', '中填写 Runtime URL。')}
            </p>
          )}
          {runtimeBaseUrl && (
            <>
              <p className="subtle">
                {bi(locale, 'Source', '来源')}: <code>{runtimeBaseUrl}{runtimeFlowRecentPath(flow.id, data)}?limit=200</code>
              </p>
              <p>
                {bi(locale, 'success', '成功')}: {runtimeMetrics.success}
                {' · '}
                {bi(locale, 'pending', '待处理')}: {runtimeMetrics.pending}
                {' · '}
                {bi(locale, 'failed', '失败')}: {runtimeMetrics.failed}
                {' · '}
                {bi(locale, 'heat', '热度')}: {runtimeMetrics.heat}
                {runtimeMetrics.unknown > 0 && (
                  <>
                    {' · '}
                    {bi(locale, 'unknown', '未知')}: {runtimeMetrics.unknown}
                  </>
                )}
              </p>
              {runtimeLoading && (
                <p>{bi(locale, 'Loading runtime records...', '正在加载运行态记录...')}</p>
              )}
              {runtimeError && (
                <p className="error">
                  {bi(locale, 'Runtime error: ', '运行态错误:')}{runtimeError}
                </p>
              )}
              {!runtimeLoading && !runtimeError && runtimeRows.length === 0 && (
                <p className="subtle">
                  {bi(locale, 'No runtime records returned.', '当前没有返回记录。')}
                </p>
              )}
              {!runtimeLoading && !runtimeError && runtimeRows.length > 0 && (
                <div className="runtime-table-wrap">
                  <table className="runtime-table">
                    <thead>
                      <tr>
                        {runtimeColumns.map((column) => (
                          <th key={`runtime-flow-col-${column}`}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {runtimeRows.slice(0, 16).map((row, index) => (
                        <tr key={`runtime-flow-row-${index}`}>
                          {runtimeColumns.map((column) => (
                            <td key={`runtime-flow-cell-${index}-${column}`}>
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

        <article className="card">
          <h2>{bi(locale, 'Related Tables', '相关表')}</h2>
          <p>
            <Link to={`/crud?flow=${encodeURIComponent(flow.id)}`}>
              {bi(locale, 'Highlight in CRUD', '在 CRUD 高亮')}
            </Link>
          </p>

          <h3>{bi(locale, 'Reads', '读取')}</h3>
          <ul className="inline-list">
            {relatedReads.length > 0
              ? relatedReads.map((tableName) => (
                  <li key={`read-${tableName}`}>
                    <Link
                      to={`/tables/${encodeURIComponent(tableName)}?flow=${encodeURIComponent(
                        flow.id,
                      )}`}
                    >
                      {tableName}
                    </Link>
                  </li>
                ))
              : <li>-</li>}
          </ul>

          <h3>{bi(locale, 'Writes', '写入')}</h3>
          <ul className="inline-list">
            {relatedWrites.length > 0
              ? relatedWrites.map(([tableName, ops]) => (
                  <li key={`write-${tableName}`}>
                    <Link
                      to={`/tables/${encodeURIComponent(tableName)}?flow=${encodeURIComponent(
                        flow.id,
                      )}`}
                    >
                      {tableName}
                    </Link>
                    {' '}- {bi(locale, 'ops', '操作')}: {ops || '-'}
                  </li>
                ))
              : <li>-</li>}
          </ul>
        </article>

        <article
          className={`card diagram-card ${isFlowMapFullscreen ? 'is-fullscreen' : ''}`}
          ref={(el) => {
            flowMapCardRef.current = el;
          }}
        >
          <h2>{bi(locale, 'Flow Map', '业务链路地图（L1）')}</h2>
          <p className="subtle">
            {bi(
              locale,
              'Generated from index.json only.',
              '仅基于 index.json 自动生成。',
            )}
          </p>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => flowMapRef.current?.fit()}>
              {bi(locale, 'Fit', '适配')}
            </button>
            <button type="button" className="crud-btn" onClick={() => flowMapRef.current?.reset()}>
              {bi(locale, 'Reset', '重置')}
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => flowMapRef.current?.exportSvg(`flow-${flow.id}-map.svg`)}
            >
              {bi(locale, 'Export SVG', '导出 SVG')}
            </button>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showFlowMapReads}
                onChange={(event) => setShowFlowMapReads(event.target.checked)}
              />
              {bi(locale, 'Show reads', '显示读取')}
            </label>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showFlowMapTables}
                onChange={(event) => setShowFlowMapTables(event.target.checked)}
              />
              {bi(locale, 'Show tables', '显示表明细')}
            </label>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showFlowMapSchemasOnly}
                onChange={(event) => setShowFlowMapSchemasOnly(event.target.checked)}
              />
              {bi(locale, 'Schemas only', '仅显示 schema')}
            </label>
            <span className="diagram-status">
              {flowMapRenderState === 'rendered'
                ? 'Rendered ✓'
                : flowMapRenderState === 'error'
                  ? 'Error'
                  : 'Rendering...'}
            </span>
          </div>
          {flowMapResult.error ? <p className="error">{flowMapResult.error}</p> : null}
          <div className="diagram-render-shell">
            <MermaidPanZoom
              key={`flow-map-${flow.id}-${showFlowMapReads}-${showFlowMapTables}-${showFlowMapSchemasOnly}`}
              ref={flowMapRef}
              mermaidCode={flowMapResult.mermaidCode}
              height={isFlowMapFullscreen ? 'calc(100vh - 260px)' : '58vh'}
              onReady={(info) => setFlowMapRenderState(info.status)}
            />
            <button
              type="button"
              className="diagram-fullscreen-btn"
              onClick={() => {
                void toggleFlowMapFullscreen();
              }}
            >
              {isFlowMapFullscreen
                ? bi(locale, 'Exit Fullscreen', '退出全屏')
                : bi(locale, 'Fullscreen', '全屏')}
            </button>
          </div>
        </article>

        <article
          className={`card diagram-card ${isFlowImpactFullscreen ? 'is-fullscreen' : ''}`}
          ref={(el) => {
            flowImpactCardRef.current = el;
          }}
        >
          <h2>{bi(locale, 'Impact Graph', '影响面图（L2）')}</h2>
          <p className="subtle">
            {bi(
              locale,
              'Flow-centered network of related tables.',
              '以流程为中心的相关表网络。节点过多时会折叠，建议配合 CRUD 过滤深入查看。',
            )}
          </p>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => flowImpactRef.current?.fit()}>
              {bi(locale, 'Fit', '适配')}
            </button>
            <button type="button" className="crud-btn" onClick={() => flowImpactRef.current?.reset()}>
              {bi(locale, 'Reset', '重置')}
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => flowImpactRef.current?.exportSvg(flowImpactFileName)}
            >
              {bi(locale, 'Export SVG', '导出 SVG')}
            </button>
            <Link
              to={`/crud?flow=${encodeURIComponent(flow.id)}`}
              className="crud-btn table-lens-link-btn"
            >
              {bi(locale, 'Open CRUD filtered', '打开 CRUD 过滤')}
            </Link>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={impactGroupBySchema}
                onChange={(event) => setImpactGroupBySchema(event.target.checked)}
              />
              {bi(locale, 'Group by schema', '按 schema 分组')}
            </label>
            <span className="diagram-status">
              {flowImpactRenderState === 'rendered'
                ? 'Rendered ✓'
                : flowImpactRenderState === 'error'
                  ? 'Error'
                  : 'Rendering...'}
            </span>
          </div>
          {(flowImpactResult.readCollapsed > 0 || flowImpactResult.writeCollapsed > 0) && (
            <p className="subtle">
              {bi(
                locale,
                `Collapsed: reads +${flowImpactResult.readCollapsed}, writes +${flowImpactResult.writeCollapsed}`,
                `已折叠：读取 +${flowImpactResult.readCollapsed}，写入 +${flowImpactResult.writeCollapsed}`,
              )}
            </p>
          )}
          {flowImpactResult.error ? <p className="error">{flowImpactResult.error}</p> : null}
          <div className="diagram-render-shell">
            <MermaidPanZoom
              key={`flow-impact-${flow.id}-${impactGroupBySchema}`}
              ref={flowImpactRef}
              mermaidCode={flowImpactResult.mermaidCode}
              height={isFlowImpactFullscreen ? 'calc(100vh - 250px)' : '56vh'}
              onReady={(info) => setFlowImpactRenderState(info.status)}
            />
            <button
              type="button"
              className="diagram-fullscreen-btn"
              onClick={() => {
                void toggleFlowImpactFullscreen();
              }}
            >
              {isFlowImpactFullscreen
                ? bi(locale, 'Exit Fullscreen', '退出全屏')
                : bi(locale, 'Fullscreen', '全屏')}
            </button>
          </div>
        </article>

        <article
          className={`card diagram-card ${isDiagramFullscreen ? 'is-fullscreen' : ''}`}
          ref={(el) => {
            diagramAnchorRef.current = el;
            diagramCardRef.current = el;
          }}
        >
          <h2>{bi(locale, 'Sequence Diagram', '时序图')}</h2>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => diagramRef.current?.fit()}>
              {bi(locale, 'Fit', '适配')}
            </button>
            <button type="button" className="crud-btn" onClick={() => diagramRef.current?.reset()}>
              {bi(locale, 'Reset', '重置')}
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => diagramRef.current?.exportSvg(`flow-${flow.id}-sequence.svg`)}
            >
              {bi(locale, 'Export SVG', '导出 SVG')}
            </button>
            <span className="diagram-status">
              {renderState === 'rendered' ? 'Rendered ✓' : renderState === 'error' ? 'Error' : 'Rendering...'}
            </span>
          </div>
          <div className="diagram-render-shell">
            <MermaidPanZoom
              key={flow.id}
              ref={diagramRef}
              mermaidCode={mermaid}
              height={isDiagramFullscreen ? 'calc(100vh - 210px)' : '68vh'}
              onReady={(info) => setRenderState(info.status)}
            />
            <button
              type="button"
              className="diagram-fullscreen-btn"
              onClick={() => {
                void toggleDiagramFullscreen();
              }}
            >
              {isDiagramFullscreen
                ? bi(locale, 'Exit Fullscreen', '退出全屏')
                : bi(locale, 'Fullscreen', '全屏')}
            </button>
          </div>
        </article>

        <article className="card">
          <h2>{bi(locale, 'Mermaid Source', 'Mermaid 源码预览')}</h2>
          <textarea className="code-preview" readOnly value={mermaid} />
        </article>
      </div>
    </section>
  );
}
