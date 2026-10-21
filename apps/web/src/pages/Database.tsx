import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildDatabaseMermaid, isDatabaseTable } from '../app/buildDatabaseMermaid';
import { schemaOf } from '../app/schemaUtils';
import { useProjectData } from '../app/useProjectData';
import {
  MermaidPanZoom,
  type MermaidPanZoomHandle,
  type MermaidPanZoomReadyInfo,
} from '../ui/MermaidPanZoom';

function columnFlags(
  columnName: string,
  primaryKey: Set<string>,
  foreignKeyColumns: Set<string>,
  inlinePrimaryKey: boolean,
  inlineUnique: boolean,
): string[] {
  const flags: string[] = [];
  if (inlinePrimaryKey || primaryKey.has(columnName)) {
    flags.push('PK');
  }
  if (foreignKeyColumns.has(columnName)) {
    flags.push('FK');
  }
  if (inlineUnique) {
    flags.push('UK');
  }
  return flags;
}

export function DatabasePage() {
  const { data, loading, error } = useProjectData();
  const [keyword, setKeyword] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [datastoreFilter, setDatastoreFilter] = useState('');
  const diagramRef = useRef<MermaidPanZoomHandle | null>(null);
  const diagramCardRef = useRef<HTMLElement | null>(null);
  const [diagramStatus, setDiagramStatus] = useState<MermaidPanZoomReadyInfo['status']>('idle');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const datastores = data?.datastores ?? [];
  const datastoreById = useMemo(
    () => new Map(datastores.map((datastore) => [datastore.id, datastore])),
    [datastores],
  );
  const databaseTables = useMemo(
    () => (data?.tables ?? []).filter(isDatabaseTable),
    [data],
  );
  const schemas = useMemo(
    () => Array.from(new Set(databaseTables.map((table) => schemaOf(table.name)))).sort(),
    [databaseTables],
  );
  const visibleTables = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return databaseTables.filter((table) => {
      if (schemaFilter && schemaOf(table.name) !== schemaFilter) {
        return false;
      }
      if (datastoreFilter && table.datastore_id !== datastoreFilter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return table.name.toLowerCase().includes(normalizedKeyword)
        || (table.columns ?? []).some((column) => column.name.toLowerCase().includes(normalizedKeyword));
    });
  }, [databaseTables, datastoreFilter, keyword, schemaFilter]);
  const selectedTableNames = useMemo(
    () => new Set(visibleTables.map((table) => table.name)),
    [visibleTables],
  );
  const diagram = useMemo(
    () => buildDatabaseMermaid(data, selectedTableNames),
    [data, selectedTableNames],
  );

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === diagramCardRef.current);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => diagramRef.current?.reset());
    return () => cancelAnimationFrame(frame);
  }, [diagram.mermaidCode, isFullscreen]);

  const toggleFullscreen = async () => {
    const host = diagramCardRef.current;
    if (!host) {
      return;
    }
    if (document.fullscreenElement === host) {
      await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    await host.requestFullscreen();
  };

  if (loading) {
    return <section className="page"><h1>Database / 数据库</h1><p>Loading database model...</p></section>;
  }
  if (error) {
    return (
      <section className="page">
        <h1>Database / 数据库</h1>
        <p className="error">Failed to load database model / 加载数据库模型失败: {error}</p>
      </section>
    );
  }

  return (
    <section className="page database-page">
      <h1>Database / 数据库</h1>
      <p className="subtle">
        Physical schema derived from manifest columns, keys and indexes.
        {' '}只展示 manifest 明确声明的字段、主键、外键和索引，不推断不存在的关系。
      </p>

      <div className="database-metrics" aria-label="Database model metrics">
        <article><strong>{diagram.tableCount}</strong><span>Tables / 表</span></article>
        <article><strong>{diagram.columnCount}</strong><span>Columns / 字段</span></article>
        <article><strong>{diagram.relationCount}</strong><span>Foreign Keys / 外键</span></article>
        <article><strong>{diagram.indexCount}</strong><span>Indexes / 索引</span></article>
      </div>

      <div className="database-toolbar">
        <label>
          Search / 搜索
          <input
            type="text"
            value={keyword}
            placeholder="table or column"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <label>
          Schema / 模式
          <select value={schemaFilter} onChange={(event) => setSchemaFilter(event.target.value)}>
            <option value="">All schemas / 全部</option>
            {schemas.map((schema) => <option key={schema} value={schema}>{schema}</option>)}
          </select>
        </label>
        <label>
          Datastore / 数据库实例
          <select value={datastoreFilter} onChange={(event) => setDatastoreFilter(event.target.value)}>
            <option value="">All datastores / 全部</option>
            {datastores.map((datastore) => (
              <option key={datastore.id} value={datastore.id}>
                {datastore.name} ({datastore.engine})
              </option>
            ))}
          </select>
        </label>
        <span className="subtle">visible: {visibleTables.length} / {databaseTables.length}</span>
      </div>

      {databaseTables.length === 0 && (
        <article className="card">
          <h2>No database schema declared / 尚未声明数据库结构</h2>
          <p>Add table columns and optional datastore metadata to the manifest.</p>
        </article>
      )}

      {databaseTables.length > 0 && visibleTables.length === 0 && (
        <p className="subtle">No tables match the current filters / 当前过滤条件没有匹配的数据表。</p>
      )}

      {visibleTables.length > 0 && (
        <article
          className={`card diagram-card database-diagram-card ${isFullscreen ? 'is-fullscreen' : ''}`}
          ref={(element) => {
            diagramCardRef.current = element;
          }}
        >
          <h2>Entity Relationship Diagram / 实体关系图</h2>
          <div className="diagram-toolbar">
            <button type="button" className="crud-btn" onClick={() => diagramRef.current?.fit()}>Fit / 适配</button>
            <button type="button" className="crud-btn" onClick={() => diagramRef.current?.reset()}>Reset / 重置</button>
            <button
              type="button"
              className="crud-btn"
              onClick={() => diagramRef.current?.exportSvg('database-schema.svg')}
            >
              Export SVG / 导出 SVG
            </button>
            <span className="diagram-status">
              {diagramStatus === 'rendered' ? 'Rendered ✓' : diagramStatus === 'error' ? 'Error' : 'Rendering...'}
            </span>
          </div>
          <div className="diagram-render-shell">
            <MermaidPanZoom
              ref={diagramRef}
              mermaidCode={diagram.mermaidCode}
              height={isFullscreen ? 'calc(100vh - 180px)' : '68vh'}
              onReady={(info) => setDiagramStatus(info.status)}
            />
            <button type="button" className="diagram-fullscreen-btn" onClick={() => void toggleFullscreen()}>
              {isFullscreen ? 'Exit Fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
            </button>
          </div>
        </article>
      )}

      <div className="database-table-grid">
        {visibleTables.map((table) => {
          const primaryKey = new Set(table.primary_key ?? []);
          const foreignKeyColumns = new Set(
            (table.foreign_keys ?? []).flatMap((foreignKey) => foreignKey.columns),
          );
          const datastore = table.datastore_id ? datastoreById.get(table.datastore_id) : undefined;
          return (
            <article className="card database-table-card" key={table.name}>
              <div className="database-table-card-heading">
                <h2><Link to={`/tables/${encodeURIComponent(table.name)}`}>{table.name}</Link></h2>
                <span className="state-badge state-badge-existing">{table.state || 'unknown'}</span>
              </div>
              <p className="subtle">
                {datastore ? `${datastore.name} · ${datastore.engine}` : table.kind || 'database table'}
              </p>
              <div className="database-column-wrap">
                <table className="database-column-table">
                  <thead><tr><th>Column / 字段</th><th>Type / 类型</th><th>Keys</th><th>Null</th></tr></thead>
                  <tbody>
                    {(table.columns ?? []).map((column) => {
                      const flags = columnFlags(
                        column.name,
                        primaryKey,
                        foreignKeyColumns,
                        column.primary_key === true,
                        column.unique === true,
                      );
                      return (
                        <tr key={`${table.name}-${column.name}`}>
                          <td><code>{column.name}</code></td>
                          <td>{column.type}</td>
                          <td>{flags.join(' · ') || '-'}</td>
                          <td>{column.nullable === false ? 'NO' : 'YES'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(table.foreign_keys?.length ?? 0) > 0 && (
                <div className="database-constraint-list">
                  <h3>Foreign Keys / 外键</h3>
                  <ul>
                    {table.foreign_keys?.map((foreignKey, index) => (
                      <li key={`${table.name}-fk-${foreignKey.name || index}`}>
                        <code>{foreignKey.columns.join(', ')}</code>
                        {' → '}
                        <code>{foreignKey.references_table}({foreignKey.references_columns.join(', ')})</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(table.indexes?.length ?? 0) > 0 && (
                <div className="database-constraint-list">
                  <h3>Indexes / 索引</h3>
                  <ul>
                    {table.indexes?.map((index) => (
                      <li key={`${table.name}-index-${index.name}`}>
                        <code>{index.name}</code>: {index.columns.join(', ')}{index.unique ? ' · UNIQUE' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
