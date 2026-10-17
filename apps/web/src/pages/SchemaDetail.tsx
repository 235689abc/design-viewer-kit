import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { buildProjectIndexes, getServiceDisplay, hasReadOps, hasWriteOps } from '../app/indexes';
import { schemaDisplayLabel, schemaNodeLabel, schemaOf } from '../app/schemaUtils';
import { type FlowRecord, useProjectData } from '../app/useProjectData';
import {
  MermaidPanZoom,
  type MermaidPanZoomHandle,
  type MermaidPanZoomReadyInfo,
} from '../ui/MermaidPanZoom';

const OPS_ORDER = ['C', 'R', 'U', 'D'];

type SchemaTableStat = {
  tableName: string;
  writeFlowCount: number;
  readFlowCount: number;
};

type FlowTouchSummary = {
  flow: FlowRecord;
  count: number;
  touchTables: string[];
};

function safeMermaidId(prefix: string, raw: string): string {
  const text = raw.trim();
  const encoded = text.length > 0 ? text : 'unknown';
  return `${prefix}_${encoded.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '\\"');
}

function mergeOps(existing: string, incoming: string): string {
  const opSet = new Set<string>();
  for (const op of `${existing}${incoming}`.toUpperCase()) {
    if (OPS_ORDER.includes(op)) {
      opSet.add(op);
    }
  }
  return OPS_ORDER.filter((op) => opSet.has(op)).join('');
}

function buildSchemaMiniGraph(
  schemaName: string,
  tableStats: SchemaTableStat[],
  writeFlowSummaries: FlowTouchSummary[],
  readFlowSummaries: FlowTouchSummary[],
  edgesByTable: Map<string, Array<{ flow_id: string; ops: string }>>,
): string {
  const selectedTables = tableStats.slice(0, 25).map((item) => item.tableName);
  const flowScore = new Map<string, number>();
  for (const item of writeFlowSummaries) {
    flowScore.set(item.flow.id, (flowScore.get(item.flow.id) ?? 0) + item.count * 2);
  }
  for (const item of readFlowSummaries) {
    flowScore.set(item.flow.id, (flowScore.get(item.flow.id) ?? 0) + item.count);
  }
  const selectedFlowIds = Array.from(flowScore.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([flowId]) => flowId);
  const selectedFlowSet = new Set(selectedFlowIds);

  const lines: string[] = [];
  lines.push('graph LR');
  lines.push(`SCH["${escapeMermaidLabel(schemaNodeLabel(schemaName))}"]`);

  for (const tableName of selectedTables) {
    const tableId = safeMermaidId('T', tableName);
    lines.push(`${tableId}["${escapeMermaidLabel(tableName)}"]`);
    lines.push(`SCH --> ${tableId}`);
  }

  for (const flowId of selectedFlowIds) {
    const flowNodeId = safeMermaidId('F', flowId);
    lines.push(`${flowNodeId}["${escapeMermaidLabel(flowId)}"]`);
  }

  for (const tableName of selectedTables) {
    const edges = edgesByTable.get(tableName) ?? [];
    const mergedByFlow = new Map<string, string>();
    for (const edge of edges) {
      const prev = mergedByFlow.get(edge.flow_id) ?? '';
      mergedByFlow.set(edge.flow_id, mergeOps(prev, edge.ops));
    }
    for (const [flowId, ops] of mergedByFlow.entries()) {
      if (!selectedFlowSet.has(flowId)) {
        continue;
      }
      const tableId = safeMermaidId('T', tableName);
      const flowNodeId = safeMermaidId('F', flowId);
      const relation = hasWriteOps(ops) && hasReadOps(ops) ? 'RW' : hasWriteOps(ops) ? 'W' : 'R';
      lines.push(`${tableId} -->|${relation}| ${flowNodeId}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function SchemaDetailPage() {
  const { name } = useParams();
  const schemaName = decodeURIComponent(name ?? '').trim().toLowerCase();
  const { data, loading, error } = useProjectData();
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const [tableKeyword, setTableKeyword] = useState('');
  const miniGraphRef = useRef<MermaidPanZoomHandle | null>(null);
  const miniGraphShellRef = useRef<HTMLDivElement | null>(null);
  const [miniGraphStatus, setMiniGraphStatus] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [isMiniGraphFullscreen, setIsMiniGraphFullscreen] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      setIsMiniGraphFullscreen(document.fullscreenElement === miniGraphShellRef.current);
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
      miniGraphRef.current?.reset();
    });
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isMiniGraphFullscreen]);

  const toggleMiniGraphFullscreen = async () => {
    const host = miniGraphShellRef.current;
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
      console.error('Failed to toggle schema mini graph fullscreen', err);
    }
  };

  if (loading) {
    return (
      <section className="page">
        <h1>Schema Detail / 域详情</h1>
        <p>Loading schema detail... / 正在加载域详情...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Schema Detail / 域详情</h1>
        <p className="error">Failed to load schema detail / 加载域详情失败: {error}</p>
      </section>
    );
  }

  if (!data || !schemaName) {
    return (
      <section className="page">
        <h1>Schema Detail / 域详情</h1>
        <p>Schema not found / 未找到域。</p>
        <p><Link to="/l0">Back to L0 / 返回 L0</Link></p>
      </section>
    );
  }

  const tablesInSchema = data.tables.filter((table) => {
    const canonical = indexes.canonicalTableName(table.name);
    return schemaOf(canonical) === schemaName;
  });

  if (tablesInSchema.length === 0) {
    return (
      <section className="page">
        <h1>Schema Detail / 域详情</h1>
        <p>Schema not found / 未找到域: <code>{schemaName}</code></p>
        <p><Link to="/l0">Back to L0 / 返回 L0</Link></p>
      </section>
    );
  }

  const canonicalTables = new Set<string>();
  for (const table of tablesInSchema) {
    canonicalTables.add(indexes.canonicalTableName(table.name));
  }
  for (const tableName of indexes.edgesByTable.keys()) {
    if (schemaOf(tableName) === schemaName) {
      canonicalTables.add(tableName);
    }
  }

  const tableStats: SchemaTableStat[] = Array.from(canonicalTables)
    .map((tableName) => {
      const edges = indexes.edgesByTable.get(tableName) ?? [];
      const writeFlows = new Set<string>();
      const readFlows = new Set<string>();
      for (const edge of edges) {
        if (hasWriteOps(edge.ops)) {
          writeFlows.add(edge.flow_id);
        }
        if (hasReadOps(edge.ops)) {
          readFlows.add(edge.flow_id);
        }
      }
      return {
        tableName,
        writeFlowCount: writeFlows.size,
        readFlowCount: readFlows.size,
      };
    })
    .sort(
      (a, b) =>
        b.writeFlowCount - a.writeFlowCount ||
        b.readFlowCount - a.readFlowCount ||
        a.tableName.localeCompare(b.tableName),
    );

  const writeFlowSummaries: FlowTouchSummary[] = data.flows
    .map((flow) => {
      const touched = new Set<string>();
      for (const write of flow.writes) {
        const canonicalTable = indexes.canonicalTableName(write.table);
        if (schemaOf(canonicalTable) === schemaName) {
          touched.add(canonicalTable);
        }
      }
      return { flow, count: touched.size, touchTables: Array.from(touched).sort((a, b) => a.localeCompare(b)) };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.flow.id.localeCompare(b.flow.id))
    .slice(0, 10);

  const readFlowSummaries: FlowTouchSummary[] = data.flows
    .map((flow) => {
      const touched = new Set<string>();
      for (const readTable of flow.reads) {
        const canonicalTable = indexes.canonicalTableName(readTable);
        if (schemaOf(canonicalTable) === schemaName) {
          touched.add(canonicalTable);
        }
      }
      return { flow, count: touched.size, touchTables: Array.from(touched).sort((a, b) => a.localeCompare(b)) };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.flow.id.localeCompare(b.flow.id))
    .slice(0, 10);

  const ownerServiceStats = new Map<string, { flowCount: number; tableSet: Set<string> }>();
  for (const item of writeFlowSummaries) {
    const serviceId = item.flow.owner_service || 'unknown';
    if (!ownerServiceStats.has(serviceId)) {
      ownerServiceStats.set(serviceId, { flowCount: 0, tableSet: new Set<string>() });
    }
    const stat = ownerServiceStats.get(serviceId);
    if (!stat) {
      continue;
    }
    stat.flowCount += 1;
    for (const tableName of item.touchTables) {
      stat.tableSet.add(tableName);
    }
  }
  const ownerServices = Array.from(ownerServiceStats.entries())
    .map(([serviceId, stat]) => ({
      serviceId,
      flowCount: stat.flowCount,
      tableCount: stat.tableSet.size,
      display: getServiceDisplay(serviceId, indexes.mapServices),
    }))
    .sort((a, b) => b.flowCount - a.flowCount || a.serviceId.localeCompare(b.serviceId));

  const loweredKeyword = tableKeyword.trim().toLowerCase();
  const filteredTables = tablesInSchema
    .filter((table) => table.name.toLowerCase().includes(loweredKeyword))
    .sort((a, b) => a.name.localeCompare(b.name));

  const miniGraphCode = buildSchemaMiniGraph(
    schemaName,
    tableStats,
    writeFlowSummaries,
    readFlowSummaries,
    indexes.edgesByTable,
  );

  return (
    <section className="page">
      <h1>Schema Detail / 域详情</h1>
      <p className="subtle">
        <code>{schemaDisplayLabel(schemaName)}</code>
        {' '}| tables: {tablesInSchema.length}
        {' '}| write flows: {writeFlowSummaries.length}
        {' '}| read flows: {readFlowSummaries.length}
      </p>
      <p>
        <Link to="/l0">Back to L0 / 返回 L0</Link>
        {' | '}
        <Link to={`/crud?column=${encodeURIComponent(schemaName)}`}>
          Open CRUD filtered / 打开 CRUD 并过滤
        </Link>
      </p>

      <div className="detail-grid">
        <article className="card">
          <h2>Tables in Schema / 该域数据表</h2>
          <div className="table-lens-toolbar">
            <label htmlFor="schema-table-filter">Search / 搜索表名</label>
            <input
              id="schema-table-filter"
              type="text"
              value={tableKeyword}
              placeholder={`${schemaName}.*`}
              onChange={(event) => setTableKeyword(event.target.value)}
            />
            <span className="subtle">visible: {filteredTables.length} / {tablesInSchema.length}</span>
          </div>
          <ul className="inline-list">
            {filteredTables.map((table) => (
              <li key={`schema-table-${table.name}`}>
                <Link to={`/tables/${encodeURIComponent(table.name)}`}>{table.name}</Link>
                {table.alias_of ? ` (alias -> ${table.alias_of})` : ''}
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Owner Services / 写入服务</h2>
          <ul className="inline-list">
            {ownerServices.length === 0 && <li>-</li>}
            {ownerServices.map((service) => (
              <li key={`owner-service-${service.serviceId}`}>
                {service.display} (flows: {service.flowCount}, tables: {service.tableCount})
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Top Write Flows / 写入最多流程</h2>
          <ul className="inline-list">
            {writeFlowSummaries.length === 0 && <li>-</li>}
            {writeFlowSummaries.map((item) => (
              <li key={`schema-write-flow-${item.flow.id}`}>
                <Link to={`/flows/${encodeURIComponent(item.flow.id)}`}>{item.flow.id}</Link>
                {' '}({item.count}) - {item.flow.name_en} / {item.flow.name_zh}
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Top Read Flows / 读取最多流程</h2>
          <ul className="inline-list">
            {readFlowSummaries.length === 0 && <li>-</li>}
            {readFlowSummaries.map((item) => (
              <li key={`schema-read-flow-${item.flow.id}`}>
                <Link to={`/flows/${encodeURIComponent(item.flow.id)}`}>{item.flow.id}</Link>
                {' '}({item.count}) - {item.flow.name_en} / {item.flow.name_zh}
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Schema Mini Graph / 域内影响图</h2>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => miniGraphRef.current?.fit()}>
              Fit / 适配
            </button>
            <button type="button" className="crud-btn" onClick={() => miniGraphRef.current?.reset()}>
              Reset / 重置
            </button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => miniGraphRef.current?.exportSvg(`schema-${schemaName}-impact.svg`)}
            >
              Export SVG / 导出 SVG
            </button>
            <span className="diagram-status">
              {miniGraphStatus === 'rendered' ? 'Rendered ✓' : miniGraphStatus === 'error' ? 'Error' : 'Rendering...'}
            </span>
          </div>
          <div
            className={`diagram-render-shell ${isMiniGraphFullscreen ? 'is-fullscreen-shell' : ''}`}
            ref={miniGraphShellRef}
          >
            <MermaidPanZoom
              ref={miniGraphRef}
              mermaidCode={miniGraphCode}
              height={isMiniGraphFullscreen ? '100vh' : '58vh'}
              onReady={(info) => setMiniGraphStatus(info.status)}
            />
            <button
              type="button"
              className="diagram-fullscreen-btn"
              onClick={() => {
                void toggleMiniGraphFullscreen();
              }}
            >
              {isMiniGraphFullscreen ? 'Exit Fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
