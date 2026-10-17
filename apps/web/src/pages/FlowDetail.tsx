import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { buildFlowDeliveryChecklist } from '../app/deliveryChecklist';
import { buildFlowMapMermaid } from '../app/buildFlowMapMermaid';
import { buildFlowImpactMermaid } from '../app/buildFlowImpactMermaid';
import { buildProjectIndexes, getServiceDisplay } from '../app/indexes';
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
      }),
    [data, flowId, showFlowMapReads, showFlowMapSchemasOnly, showFlowMapTables],
  );
  const flowImpactResult = useMemo(
    () =>
      buildFlowImpactMermaid(data, flowId, {
        maxTables: 25,
        groupBySchema: impactGroupBySchema,
        maxTablesPerSchema: 12,
      }),
    [data, flowId, impactGroupBySchema],
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
        <h1>Flow Detail / 流程详情</h1>
        <p>Loading flow detail... / 正在加载流程详情...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Flow Detail / 流程详情</h1>
        <p className="error">Failed to load flow detail / 加载流程详情失败: {error}</p>
      </section>
    );
  }

  const flow = data?.flows.find((item) => item.id === flowId);
  if (!flow || !data) {
    return (
      <section className="page">
        <h1>Flow Detail / 流程详情</h1>
        <p>Flow not found / 未找到流程: <code>{flowId}</code></p>
        <p><Link to="/flows">Back to Flows / 返回流程列表</Link></p>
      </section>
    );
  }

  const edges = data.crudEdges.filter((edge) => edge.flow_id === flow.id);
  const mermaid = data.diagrams.flow_mermaid[flow.id] ?? '';
  const ownerLabel = getServiceDisplay(flow.owner_service, indexes.mapServices);
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
  });

  return (
    <section className="page">
      <h1>Flow Detail / 流程详情</h1>
      {diffHint && (
        <p className="subtle">
          Diff hint: this flow changed between selected history versions.
          {' '} / Diff 提示：该流程在选定版本之间发生变更。
        </p>
      )}
      <p>
        <Link to="/flows">Back to Flows / 返回流程列表</Link>
        {' | '}
        <button
          type="button"
          className="inline-link-btn"
          onClick={() => diagramAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          Jump to Diagram / 跳到图
        </button>
      </p>

      <div className="detail-grid">
        <article className="card">
          <h2>Basic / 基本信息</h2>
          <p><strong>ID:</strong> {flow.id}</p>
          <p><strong>Name:</strong> {flow.name_en} / {flow.name_zh}</p>
          <p><strong>Owner:</strong> {ownerLabel}</p>
          <p><strong>Doc Path:</strong> <code>{flow.doc_path || '-'}</code></p>
          <p><strong>Introduced In:</strong> <code>{flow.introduced_in || '-'}</code></p>
          <p><strong>Idempotency:</strong> <code>{flow.idempotency_key || '-'}</code></p>
        </article>

        <article className="card">
          <h2>Reads / 读取</h2>
          <ul className="inline-list">
            {flow.reads.length > 0 ? flow.reads.map((name) => <li key={name}><code>{name}</code></li>) : <li>-</li>}
          </ul>

          <h2>Writes / 写入</h2>
          <ul className="inline-list">
            {flow.writes.length > 0
              ? flow.writes.map((write, idx) => (
                  <li key={`${write.table}-${write.op}-${idx}`}>
                    <code>{write.table}</code>: {write.op}
                  </li>
                ))
              : <li>-</li>}
          </ul>

          <h2>Events / 事件</h2>
          <ul className="inline-list">
            {flow.events_appended.length > 0
              ? flow.events_appended.map((eventName) => <li key={eventName}><code>{eventName}</code></li>)
              : <li>-</li>}
          </ul>
        </article>

        <article className="card">
          <h2>CRUD Edges / CRUD 边</h2>
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
          <h2>Delivery Checklist / 交付清单</h2>
          <p>
            score:{' '}
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
            {' '}mode: {deliveryChecklist.mode}
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
            Runtime disabled/unavailable will mark runtime evidence as unknown, keeping score design-focused.
          </p>
          {deliveryChecklist.suggestions.length > 0 && (
            <>
              <h3>Fix Suggestions / 修复建议</h3>
              <ul className="inline-list">
                {deliveryChecklist.suggestions.map((tip) => (
                  <li key={`tip-${tip}`}>{tip}</li>
                ))}
              </ul>
            </>
          )}
        </article>

        <article className="card">
          <h2>Runtime Recent / 运行态最近记录</h2>
          {!runtimeBaseUrl && (
            <p>
              Set runtime url to enable / 请先在 <Link to="/settings">Settings / 设置</Link> 中填写 Runtime URL。
            </p>
          )}
          {runtimeBaseUrl && (
            <>
              <p className="subtle">
                Source: <code>{runtimeBaseUrl}{runtimeFlowRecentPath(flow.id, data)}?limit=200</code>
              </p>
              <p>
                success: {runtimeMetrics.success}
                {' · '}
                pending: {runtimeMetrics.pending}
                {' · '}
                failed: {runtimeMetrics.failed}
                {' · '}
                heat: {runtimeMetrics.heat}
                {runtimeMetrics.unknown > 0 && (
                  <>
                    {' · '}
                    unknown: {runtimeMetrics.unknown}
                  </>
                )}
              </p>
              {runtimeLoading && <p>Loading runtime records... / 正在加载运行态记录...</p>}
              {runtimeError && <p className="error">Runtime error: {runtimeError}</p>}
              {!runtimeLoading && !runtimeError && runtimeRows.length === 0 && (
                <p className="subtle">No runtime records returned / 当前没有返回记录。</p>
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
          <h2>Related Tables / 相关表</h2>
          <p>
            <Link to={`/crud?flow=${encodeURIComponent(flow.id)}`}>
              Highlight in CRUD / 在 CRUD 高亮
            </Link>
          </p>

          <h3>Reads / 读取</h3>
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

          <h3>Writes / 写入</h3>
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
                    {' '}- ops: {ops || '-'}
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
          <h2>Flow Map / 业务链路地图（L1）</h2>
          <p className="subtle">
            Generated from index.json only. / 仅基于 index.json 自动生成。
          </p>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => flowMapRef.current?.fit()}>
              Fit / 适配
            </button>
            <button type="button" className="crud-btn" onClick={() => flowMapRef.current?.reset()}>
              Reset / 重置
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => flowMapRef.current?.exportSvg(`flow-${flow.id}-map.svg`)}
            >
              Export SVG / 导出 SVG
            </button>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showFlowMapReads}
                onChange={(event) => setShowFlowMapReads(event.target.checked)}
              />
              Show reads / 显示读取
            </label>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showFlowMapTables}
                onChange={(event) => setShowFlowMapTables(event.target.checked)}
              />
              Show tables / 显示表明细
            </label>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showFlowMapSchemasOnly}
                onChange={(event) => setShowFlowMapSchemasOnly(event.target.checked)}
              />
              Schemas only / 仅显示 schema
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
              {isFlowMapFullscreen ? 'Exit Fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
            </button>
          </div>
        </article>

        <article
          className={`card diagram-card ${isFlowImpactFullscreen ? 'is-fullscreen' : ''}`}
          ref={(el) => {
            flowImpactCardRef.current = el;
          }}
        >
          <h2>Impact Graph / 影响面图（L2）</h2>
          <p className="subtle">
            Flow-centered network of related tables.
            {' '}
            节点过多时会折叠，建议配合 CRUD 过滤深入查看。
          </p>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => flowImpactRef.current?.fit()}>
              Fit / 适配
            </button>
            <button type="button" className="crud-btn" onClick={() => flowImpactRef.current?.reset()}>
              Reset / 重置
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => flowImpactRef.current?.exportSvg(flowImpactFileName)}
            >
              Export SVG / 导出 SVG
            </button>
            <Link
              to={`/crud?flow=${encodeURIComponent(flow.id)}`}
              className="crud-btn table-lens-link-btn"
            >
              Open CRUD filtered / 打开 CRUD 过滤
            </Link>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={impactGroupBySchema}
                onChange={(event) => setImpactGroupBySchema(event.target.checked)}
              />
              Group by schema / 按 schema 分组
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
              Collapsed: reads +{flowImpactResult.readCollapsed}, writes +{flowImpactResult.writeCollapsed}
              {' '}
              / 已折叠：读取 +{flowImpactResult.readCollapsed}，写入 +{flowImpactResult.writeCollapsed}
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
              {isFlowImpactFullscreen ? 'Exit Fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
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
          <h2>Sequence Diagram / 时序图</h2>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => diagramRef.current?.fit()}>
              Fit / 适配
            </button>
            <button type="button" className="crud-btn" onClick={() => diagramRef.current?.reset()}>
              Reset / 重置
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => diagramRef.current?.exportSvg(`flow-${flow.id}-sequence.svg`)}
            >
              Export SVG / 导出 SVG
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
              {isDiagramFullscreen ? 'Exit Fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
            </button>
          </div>
        </article>

        <article className="card">
          <h2>Mermaid Source / Mermaid 源码预览</h2>
          <textarea className="code-preview" readOnly value={mermaid} />
        </article>
      </div>
    </section>
  );
}
