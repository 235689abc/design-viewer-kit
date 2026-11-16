import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { buildTableImpactMermaid } from '../app/buildTableImpactMermaid';
import {
  buildProjectIndexes,
  getServiceDisplay,
  hasReadOps,
  hasWriteOps,
} from '../app/indexes';
import { getRuntimeBaseUrl, subscribeRuntimeBaseUrl } from '../app/runtimeClient';
import { loadRuntimeOverlay } from '../app/runtimeMetrics';
import { collectFindings } from '../app/findings';
import { useLocale, bi } from '../app/i18n';
import { type FlowRecord, useProjectData } from '../app/useProjectData';
import {
  MermaidPanZoom,
  type MermaidPanZoomHandle,
  type MermaidPanZoomReadyInfo,
} from '../ui/MermaidPanZoom';

type RelatedFlowItem = {
  flow: FlowRecord;
  ops: string;
  ownerLabel: string;
  focused: boolean;
};

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

function getRelatedFlowGroups(
  focusedFlowId: string,
  edgesForTable: Array<{ flow_id: string; ops: string }>,
  flowById: Map<string, FlowRecord>,
  serviceMap: Map<string, { name_en: string; name_zh: string }>,
): { writes: RelatedFlowItem[]; reads: RelatedFlowItem[] } {
  const related: RelatedFlowItem[] = [];
  const mergedOpsByFlow = new Map<string, string>();

  for (const edge of edgesForTable) {
    const prevOps = mergedOpsByFlow.get(edge.flow_id) ?? '';
    mergedOpsByFlow.set(edge.flow_id, mergeOps(prevOps, edge.ops));
  }

  for (const [flowId, ops] of mergedOpsByFlow.entries()) {
    const flow = flowById.get(flowId);
    if (!flow) {
      continue;
    }
    related.push({
      flow,
      ops,
      ownerLabel: getServiceDisplay(flow.owner_service, serviceMap),
      focused: focusedFlowId.length > 0 && flow.id === focusedFlowId,
    });
  }

  related.sort((a, b) => a.flow.id.localeCompare(b.flow.id));

  return {
    writes: related.filter((item) => hasWriteOps(item.ops)),
    reads: related.filter((item) => hasReadOps(item.ops)),
  };
}

function renderFlowList(
  title: string,
  list: RelatedFlowItem[],
  tableName: string,
) {
  return (
    <article className="card">
      <h2>{title}</h2>
      <ul className="related-flow-list">
        {list.length === 0 && <li className="subtle">-</li>}
        {list.map((item) => (
          <li
            key={`${title}-${item.flow.id}`}
            className={`related-flow-item ${item.focused ? 'related-flow-item-focused' : ''}`}
          >
            <p>
              <Link to={`/flows/${encodeURIComponent(item.flow.id)}`}>{item.flow.id}</Link>
              {' · '}
              <span>{item.flow.name_en} / {item.flow.name_zh}</span>
            </p>
            <p><strong>ops:</strong> {item.ops}</p>
            <p><strong>owner:</strong> {item.ownerLabel}</p>
            <p><strong>introduced:</strong> <code>{item.flow.introduced_in || '-'}</code></p>
            <p>
              <Link
                to={`/crud?table=${encodeURIComponent(tableName)}&flow=${encodeURIComponent(
                  item.flow.id,
                )}`}
              >
                Highlight in CRUD / 在 CRUD 高亮
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function TableDetailPage() {
  const { name } = useParams();
  const [searchParams] = useSearchParams();
  const tableName = decodeURIComponent(name ?? '');
  const focusedFlowId = searchParams.get('flow')?.trim() ?? '';
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const impactRef = useRef<MermaidPanZoomHandle | null>(null);
  const impactCardRef = useRef<HTMLElement | null>(null);
  const [impactRenderState, setImpactRenderState] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [isImpactFullscreen, setIsImpactFullscreen] = useState(false);
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() => getRuntimeBaseUrl());
  const [tableHeat, setTableHeat] = useState(0);
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null);
  const impactResult = useMemo(
    () =>
      buildTableImpactMermaid(data, tableName, {
        maxWriteFlows: 15,
        maxReadFlows: 15,
        focusedFlowId,
      }),
    [data, focusedFlowId, tableName],
  );

  useEffect(() => {
    function onFullscreenChange() {
      setIsImpactFullscreen(document.fullscreenElement === impactCardRef.current);
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
      impactRef.current?.reset();
    });
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isImpactFullscreen]);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => setRuntimeBaseUrl(value));
  }, []);

  const canonicalNameForHeat = useMemo(
    () => indexes.canonicalTableName(tableName),
    [indexes, tableName],
  );

  useEffect(() => {
    if (!runtimeBaseUrl) {
      setTableHeat(0);
      setRuntimeWarning(null);
      return;
    }
    let cancelled = false;
    async function loadTableHeat() {
      try {
        const overlay = await loadRuntimeOverlay(data, { eventsLimit: 200, outboxLimit: 100 });
        if (cancelled) {
          return;
        }
        setTableHeat(overlay.tableHeat[canonicalNameForHeat] ?? 0);
        setRuntimeWarning(overlay.warnings.length > 0 ? overlay.warnings.join(' | ') : null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setTableHeat(0);
        setRuntimeWarning((err as Error).message || 'Runtime overlay unavailable');
      }
    }
    void loadTableHeat();
    return () => {
      cancelled = true;
    };
  }, [canonicalNameForHeat, data, runtimeBaseUrl]);

  const toggleImpactFullscreen = async () => {
    const host = impactCardRef.current;
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
      console.error('Failed to toggle table impact fullscreen', err);
    }
  };

  if (loading) {
    return (
      <section className="page">
        <h1>Table Detail / 表详情</h1>
        <p>Loading table detail... / 正在加载数据表详情...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Table Detail / 表详情</h1>
        <p className="error">Failed to load table detail / 加载数据表详情失败: {error}</p>
      </section>
    );
  }

  const table = indexes.tableByName.get(tableName);
  if (!table || !data) {
    return (
      <section className="page">
        <h1>Table Detail / 表详情</h1>
        <p>Table not found / 未找到数据表: <code>{tableName}</code></p>
        <p><Link to="/tables">Back to Tables / 返回数据表列表</Link></p>
      </section>
    );
  }

  const canonicalName = canonicalNameForHeat;
  const ownerLabel = getServiceDisplay(table.owner_service, indexes.mapServices);
  const edgesForTable = indexes.edgesByTable.get(canonicalName) ?? [];
  const groups = getRelatedFlowGroups(
    focusedFlowId,
    edgesForTable,
    indexes.flowById,
    indexes.mapServices,
  );
  const impactFileName = `table-${canonicalName.replace(/[^A-Za-z0-9_]+/g, '_')}-impact.svg`;
  // 发现(本表):issues 立案 + notes QC 标记 + 治理规则命中,统一聚合
  const tableFindings = collectFindings(data).filter((finding) => finding.table === table.name);
  const crudFocusLink = focusedFlowId
    ? `/crud?table=${encodeURIComponent(canonicalName)}&flow=${encodeURIComponent(focusedFlowId)}`
    : `/crud?table=${encodeURIComponent(canonicalName)}`;

  return (
    <section className="page">
      <h1>Table Detail / 表详情</h1>
      {runtimeBaseUrl && runtimeWarning && (
        <p className="error">
          Runtime overlay warning: {runtimeWarning}
          {' '}（不可用时自动降级 design-only）
        </p>
      )}
      <p><Link to="/tables">Back to Tables / 返回数据表列表</Link></p>

      <div className="detail-grid">
        <article className="card">
          <h2>{bi(locale, 'Governance', '治理信息')}</h2>
          <div className="field-list">
            <span className="field-row"><span className="field-key">{bi(locale, 'Name', '表名')}</span><span className="field-value field-value-mono">{table.name}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'State', '状态')}</span>
              <span className="field-value">
                <span className={`state-badge ${table.state === 'planned' ? 'state-badge-planned' : 'state-badge-existing'}`}>
                  {table.state || '-'}
                </span>
              </span>
            </span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Owner', '归属服务')}</span><span className="field-value">{ownerLabel}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Introduced In', '引入版本')}</span><span className="field-value field-value-mono">{table.introduced_in || '-'}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Alias Of', '别名指向')}</span><span className="field-value field-value-mono">{table.alias_of || '-'}</span></span>
            <span className="field-row"><span className="field-key">{bi(locale, 'Canonical', '规范名')}</span><span className="field-value field-value-mono">{canonicalName}</span></span>
            {table.kind && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Kind', '存储类型')}</span><span className="field-value field-value-mono">{table.kind}</span></span>
            )}
            {table.source_ref && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Source Ref', '代码证据')}</span><span className="field-value field-value-mono">{table.source_ref}</span></span>
            )}
            {runtimeBaseUrl && (
              <span className="field-row"><span className="field-key">{bi(locale, 'Runtime Heat', '运行态热度')}</span><span className="field-value"><span className="schema-runtime-badge">{tableHeat}</span></span></span>
            )}
          </div>
          <div className="table-detail-actions">
            <Link to={crudFocusLink} className="crud-btn table-lens-link-btn">
              {bi(locale, 'Highlight in CRUD', '在 CRUD 高亮')}
            </Link>
            {focusedFlowId && (
              <Link
                to={`/flows/${encodeURIComponent(focusedFlowId)}`}
                className="crud-btn table-lens-link-btn"
              >
                {bi(locale, 'Back to Flow', '返回流程')}
              </Link>
            )}
          </div>
        </article>

        <article className={`card ${tableFindings.some((finding) => finding.severity === 'red') ? 'card-accent-red' : tableFindings.some((finding) => finding.severity === 'yellow') ? 'card-accent-yellow' : 'card-accent-green'}`}>
          <h2>{bi(locale, 'Findings & Evidence', '发现与证据')}</h2>
          {tableFindings.length === 0 && (
            <p className="subtle">{bi(locale, 'No filed findings for this table.', '该表暂无立案发现。')}</p>
          )}
          <ul className="findings-list">
            {tableFindings.map((finding, index) => (
              <li
                key={`table-finding-${finding.ref}-${index}`}
                className={`findings-item findings-item-${finding.severity}`}
                style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
              >
                <span>
                  <span className={`sev-badge sev-badge-${finding.severity}`} style={{ marginRight: 8 }}>{finding.ref}</span>
                  <span className="findings-note">{finding.note}</span>
                </span>
                {finding.flowId && (
                  <span className="findings-target">
                    <Link className="sev-badge sev-badge-info" to={`/flows/${encodeURIComponent(finding.flowId)}`}>
                      {finding.flowId}
                    </Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {table.notes && (
            <>
              <h2 style={{ marginTop: 14 }}>{bi(locale, 'Notes', '备注')}</h2>
              <p className="findings-note">{table.notes}</p>
            </>
          )}
          {table.columns && table.columns.length > 0 && (
            <>
              <h2 style={{ marginTop: 14 }}>{bi(locale, 'Columns', '列摘要')}</h2>
              <ul className="inline-list">
                {table.columns.slice(0, 12).map((column, index) => (
                  <li key={`table-column-${index}`} className="field-value-mono">{JSON.stringify(column)}</li>
                ))}
              </ul>
            </>
          )}
        </article>

        {focusedFlowId && (
          <article className="card">
            <h2>Focused Flow / 当前聚焦流程</h2>
            <p><code>{focusedFlowId}</code></p>
          </article>
        )}

        <article
          className={`card diagram-card ${isImpactFullscreen ? 'is-fullscreen' : ''}`}
          ref={(el) => {
            impactCardRef.current = el;
          }}
        >
          <h2>Impact Graph / 影响面图（L2）</h2>
          <p className="subtle">
            Writes are upstream and reads are downstream.
            {' '}
            节点过多时会折叠，建议配合 CRUD 过滤深入查看。
          </p>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => impactRef.current?.fit()}>
              Fit / 适配
            </button>
            <button type="button" className="crud-btn" onClick={() => impactRef.current?.reset()}>
              Reset / 重置
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => impactRef.current?.exportSvg(impactFileName)}
            >
              Export SVG / 导出 SVG
            </button>
            <Link to={crudFocusLink} className="crud-btn table-lens-link-btn">
              Open CRUD filtered / 打开 CRUD 过滤
            </Link>
            <span className="diagram-status">
              {impactRenderState === 'rendered'
                ? 'Rendered ✓'
                : impactRenderState === 'error'
                  ? 'Error'
                  : 'Rendering...'}
            </span>
          </div>
          {impactResult.error ? <p className="error">{impactResult.error}</p> : null}
          <div className="diagram-render-shell">
            <MermaidPanZoom
              ref={impactRef}
              mermaidCode={impactResult.mermaidCode}
              height={isImpactFullscreen ? 'calc(100vh - 250px)' : '54vh'}
              onReady={(info) => setImpactRenderState(info.status)}
            />
            <button
              type="button"
              className="diagram-fullscreen-btn"
              onClick={() => {
                void toggleImpactFullscreen();
              }}
            >
              {isImpactFullscreen ? 'Exit Fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
            </button>
          </div>
        </article>

        {renderFlowList('Writes to this table / 写入该表', groups.writes, canonicalName)}
        {renderFlowList('Reads from this table / 读取该表', groups.reads, canonicalName)}
      </div>
    </section>
  );
}
