import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildProjectIndexes } from '../app/indexes';
import { loadRuntimeOverlay } from '../app/runtimeMetrics';
import { getRuntimeBaseUrl, subscribeRuntimeBaseUrl } from '../app/runtimeClient';
import { orderedSchemas, schemaDisplayLabel, schemaOf } from '../app/schemaUtils';
import { useProjectData } from '../app/useProjectData';
import {
  MermaidPanZoom,
  type MermaidPanZoomHandle,
  type MermaidPanZoomReadyInfo,
} from '../ui/MermaidPanZoom';

const L0_TABLE_LIMIT = 80;

type SchemaStat = {
  schema: string;
  tableCount: number;
  writeServiceCount: number;
  readFlowCount: number;
};

function safeMermaidId(prefix: string, raw: string): string {
  const text = raw.trim();
  const encoded = text.length > 0 ? text : 'unknown';
  return `${prefix}_${encoded.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '\\"');
}

function serviceLabel(
  serviceId: string,
  serviceMap: Map<string, { name_en: string; name_zh: string }>,
): string {
  const service = serviceMap.get(serviceId);
  if (!service) {
    return serviceId;
  }
  return `${serviceId} | ${service.name_en} / ${service.name_zh}`;
}

function buildL0SchemaMermaid(input: {
  showTables: boolean;
  showReadEdges: boolean;
  serviceMap: Map<string, { name_en: string; name_zh: string }>;
  serviceToSchemas: Map<string, Set<string>>;
  serviceToTables: Map<string, Set<string>>;
  tableWriteFlowCount: Map<string, Set<string>>;
  flowReadSchemas: Map<string, Set<string>>;
  schemas: string[];
}) {
  const {
    showTables,
    showReadEdges,
    serviceMap,
    serviceToSchemas,
    serviceToTables,
    tableWriteFlowCount,
    flowReadSchemas,
    schemas,
  } = input;

  const lines: string[] = [];
  const serviceIds = Array.from(serviceToSchemas.keys()).sort((a, b) => a.localeCompare(b));

  lines.push('graph LR');

  for (const serviceId of serviceIds) {
    const nodeId = safeMermaidId('S', serviceId);
    lines.push(`${nodeId}["${escapeMermaidLabel(serviceLabel(serviceId, serviceMap))}"]`);
  }

  for (const schemaName of schemas) {
    const nodeId = safeMermaidId('SCH', schemaName);
    lines.push(`${nodeId}["${escapeMermaidLabel(schemaDisplayLabel(schemaName))}"]`);
  }

  let droppedTableCount = 0;
  let selectedTableSet = new Set<string>();
  if (showTables) {
    const rankedTables = Array.from(tableWriteFlowCount.entries())
      .map(([tableName, flows]) => ({ tableName, flowCount: flows.size }))
      .sort((a, b) => b.flowCount - a.flowCount || a.tableName.localeCompare(b.tableName));
    const selectedTables = rankedTables.slice(0, L0_TABLE_LIMIT).map((item) => item.tableName);
    droppedTableCount = Math.max(0, rankedTables.length - selectedTables.length);
    selectedTableSet = new Set(selectedTables);

    for (const tableName of selectedTables) {
      const tableId = safeMermaidId('T', tableName);
      const schemaId = safeMermaidId('SCH', schemaOf(tableName));
      lines.push(`${tableId}["${escapeMermaidLabel(tableName)}"]`);
      lines.push(`${tableId} --> ${schemaId}`);
    }

    for (const [serviceId, tables] of serviceToTables.entries()) {
      const serviceIdNode = safeMermaidId('S', serviceId);
      for (const tableName of Array.from(tables).sort((a, b) => a.localeCompare(b))) {
        if (!selectedTableSet.has(tableName)) {
          continue;
        }
        lines.push(`${serviceIdNode} --> ${safeMermaidId('T', tableName)}`);
      }
    }
  } else {
    for (const [serviceId, schemaSet] of serviceToSchemas.entries()) {
      const serviceNodeId = safeMermaidId('S', serviceId);
      for (const schemaName of Array.from(schemaSet).sort((a, b) => a.localeCompare(b))) {
        lines.push(`${serviceNodeId} --> ${safeMermaidId('SCH', schemaName)}`);
      }
    }
  }

  if (showReadEdges) {
    const sortedFlowIds = Array.from(flowReadSchemas.keys()).sort((a, b) => a.localeCompare(b));
    for (const flowId of sortedFlowIds) {
      const flowNodeId = safeMermaidId('F', flowId);
      lines.push(`${flowNodeId}["${escapeMermaidLabel(flowId)}"]`);
      const schemaSet = flowReadSchemas.get(flowId) ?? new Set<string>();
      for (const schemaName of Array.from(schemaSet).sort((a, b) => a.localeCompare(b))) {
        lines.push(`${flowNodeId} -. R .-> ${safeMermaidId('SCH', schemaName)}`);
      }
    }
  }

  return {
    mermaidCode: `${lines.join('\n')}\n`,
    droppedTableCount,
  };
}

export function L0Page() {
  const { data, loading, error } = useProjectData();
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const viewerRef = useRef<MermaidPanZoomHandle | null>(null);
  const diagramShellRef = useRef<HTMLDivElement | null>(null);
  const [renderState, setRenderState] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [showTables, setShowTables] = useState(false);
  const [showReadEdges, setShowReadEdges] = useState(false);
  const [isDiagramFullscreen, setIsDiagramFullscreen] = useState(false);
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() => getRuntimeBaseUrl());
  const [schemaHeat, setSchemaHeat] = useState<Record<string, number>>({});
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null);

  useEffect(() => {
    function onFullscreenChange() {
      setIsDiagramFullscreen(document.fullscreenElement === diagramShellRef.current);
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
      viewerRef.current?.reset();
    });
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isDiagramFullscreen]);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => setRuntimeBaseUrl(value));
  }, []);

  useEffect(() => {
    if (!runtimeBaseUrl) {
      setSchemaHeat({});
      setRuntimeWarning(null);
      return;
    }
    let cancelled = false;
    async function loadHeat() {
      try {
        const overlay = await loadRuntimeOverlay(data, { eventsLimit: 200, outboxLimit: 120 });
        if (cancelled) {
          return;
        }
        setSchemaHeat(overlay.schemaHeat);
        setRuntimeWarning(overlay.warnings.length > 0 ? overlay.warnings.join(' | ') : null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setSchemaHeat({});
        setRuntimeWarning((err as Error).message || 'Runtime overlay unavailable');
      }
    }
    void loadHeat();
    return () => {
      cancelled = true;
    };
  }, [data, runtimeBaseUrl]);

  const toggleDiagramFullscreen = async () => {
    const host = diagramShellRef.current;
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
      console.error('Failed to toggle L0 fullscreen', err);
    }
  };

  const computed = useMemo(() => {
    if (!data) {
      return {
        schemaStats: [] as SchemaStat[],
        mermaidCode: '',
        droppedTableCount: 0,
      };
    }

    const schemaTableCount = new Map<string, number>();
    const serviceToSchemas = new Map<string, Set<string>>();
    const serviceToTables = new Map<string, Set<string>>();
    const tableWriteFlowCount = new Map<string, Set<string>>();
    const flowReadSchemas = new Map<string, Set<string>>();

    for (const table of data.tables) {
      const schemaName = schemaOf(table.name);
      schemaTableCount.set(schemaName, (schemaTableCount.get(schemaName) ?? 0) + 1);
    }

    for (const flow of data.flows) {
      const serviceId = flow.owner_service || 'unknown';
      if (!serviceToSchemas.has(serviceId)) {
        serviceToSchemas.set(serviceId, new Set<string>());
      }
      if (!serviceToTables.has(serviceId)) {
        serviceToTables.set(serviceId, new Set<string>());
      }

      for (const write of flow.writes) {
        const canonicalTable = indexes.canonicalTableName(write.table);
        const schemaName = schemaOf(canonicalTable);
        serviceToSchemas.get(serviceId)?.add(schemaName);
        serviceToTables.get(serviceId)?.add(canonicalTable);
        if (!tableWriteFlowCount.has(canonicalTable)) {
          tableWriteFlowCount.set(canonicalTable, new Set<string>());
        }
        tableWriteFlowCount.get(canonicalTable)?.add(flow.id);
      }

      const readSchemaSet = new Set<string>();
      for (const readTable of flow.reads) {
        const canonicalTable = indexes.canonicalTableName(readTable);
        readSchemaSet.add(schemaOf(canonicalTable));
      }
      if (readSchemaSet.size > 0) {
        flowReadSchemas.set(flow.id, readSchemaSet);
      }
    }

    const readFlowCountBySchema = new Map<string, number>();
    for (const schemaSet of flowReadSchemas.values()) {
      for (const schemaName of schemaSet) {
        readFlowCountBySchema.set(schemaName, (readFlowCountBySchema.get(schemaName) ?? 0) + 1);
      }
    }

    const writeServiceCountBySchema = new Map<string, number>();
    for (const schemaSet of serviceToSchemas.values()) {
      for (const schemaName of schemaSet) {
        writeServiceCountBySchema.set(schemaName, (writeServiceCountBySchema.get(schemaName) ?? 0) + 1);
      }
    }

    const schemas = orderedSchemas(schemaTableCount.keys());
    const schemaStats: SchemaStat[] = schemas.map((schemaName) => ({
      schema: schemaName,
      tableCount: schemaTableCount.get(schemaName) ?? 0,
      writeServiceCount: writeServiceCountBySchema.get(schemaName) ?? 0,
      readFlowCount: readFlowCountBySchema.get(schemaName) ?? 0,
    }));

    const { mermaidCode, droppedTableCount } = buildL0SchemaMermaid({
      showTables,
      showReadEdges,
      serviceMap: indexes.mapServices,
      serviceToSchemas,
      serviceToTables,
      tableWriteFlowCount,
      flowReadSchemas,
      schemas,
    });

    return { schemaStats, mermaidCode, droppedTableCount };
  }, [data, indexes, showReadEdges, showTables]);

  if (loading) {
    return (
      <section className="page">
        <h1>L0 Map / 系统地图</h1>
        <p>Loading L0 map... / 正在加载 L0 系统图...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>L0 Map / 系统地图</h1>
        <p className="error">Failed to load L0 map / 加载 L0 系统图失败: {error}</p>
      </section>
    );
  }

  return (
    <section className="page">
      <h1>L0 Map v2 / 系统地图 v2</h1>
      <p className="subtle">Schema-first view. Default graph keeps only service → schema edges.</p>
      {runtimeBaseUrl && runtimeWarning && (
        <p className="error">
          Runtime overlay warning: {runtimeWarning}
          {' '}（当前已自动降级为 design-only）
        </p>
      )}

      <div className="l0-v2-layout">
        <div className="l0-v2-main">
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => viewerRef.current?.fit()}>
              Fit / 适配
            </button>
            <button type="button" className="crud-btn" onClick={() => viewerRef.current?.reset()}>
              Reset / 重置
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => viewerRef.current?.exportSvg('l0-schema-first.svg')}
            >
              Export SVG / 导出 SVG
            </button>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showTables}
                onChange={(event) => setShowTables(event.target.checked)}
              />
              Show tables / 显示表
            </label>
            <label className="l0-toggle">
              <input
                type="checkbox"
                checked={showReadEdges}
                onChange={(event) => setShowReadEdges(event.target.checked)}
              />
              Show read edges / 显示读依赖
            </label>
            <span className="diagram-status">
              {renderState === 'rendered' ? 'Rendered ✓' : renderState === 'error' ? 'Error' : 'Rendering...'}
            </span>
          </div>

          {showTables && computed.droppedTableCount > 0 && (
            <p className="subtle">
              Too many tables in graph. Showing first {L0_TABLE_LIMIT}, hidden {computed.droppedTableCount}.
              / 表过多，当前仅显示前 {L0_TABLE_LIMIT} 张，其余 {computed.droppedTableCount} 张已隐藏。
            </p>
          )}

          <div className="card">
            <div
              className={`diagram-render-shell ${isDiagramFullscreen ? 'is-fullscreen-shell' : ''}`}
              ref={diagramShellRef}
            >
              <MermaidPanZoom
                key={`${showTables}-${showReadEdges}`}
                ref={viewerRef}
                mermaidCode={computed.mermaidCode}
                height={isDiagramFullscreen ? '100vh' : '72vh'}
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
          </div>

          <article className="card">
            <h2>Schema Links / 域链接</h2>
            <ul className="inline-list">
              {computed.schemaStats.map((item) => (
                <li key={`schema-link-inline-${item.schema}`}>
                  <Link to={`/schemas/${encodeURIComponent(item.schema)}`}>
                    {schemaDisplayLabel(item.schema)}
                  </Link>
                  {' '}({item.tableCount})
                  {runtimeBaseUrl && (
                    <span className="schema-runtime-badge">heat {schemaHeat[item.schema] ?? 0}</span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        </div>

        <aside className="card l0-schema-sidebar">
          <h2>Schemas / 域列表</h2>
          <ul className="l0-schema-list">
            {computed.schemaStats.map((item) => (
              <li key={`schema-link-side-${item.schema}`}>
                <Link to={`/schemas/${encodeURIComponent(item.schema)}`}>
                  {schemaDisplayLabel(item.schema)}
                </Link>
                <div className="subtle">
                  tables: {item.tableCount} · writers: {item.writeServiceCount} · reads: {item.readFlowCount}
                </div>
                {runtimeBaseUrl && (
                  <div className="subtle">
                    runtime heat: <strong>{schemaHeat[item.schema] ?? 0}</strong>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
