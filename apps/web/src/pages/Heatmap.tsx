import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProjectData, type TableRecord } from '../app/useProjectData';
import { buildProjectIndexes } from '../app/indexes';
import { useLocale, bi } from '../app/i18n';
import { orderedSchemas, schemaDisplayLabel, schemaOf } from '../app/schemaUtils';
import './Heatmap.css';

/** 单元格灰阶档:多 op 叠加取最深档(D > U > C > R),与 .crud-cell-has-* 同灰阶 */
type CellShade = 'r' | 'c' | 'u' | 'd';

function opsShade(ops: string | undefined): CellShade | null {
  if (!ops) {
    return null;
  }
  if (ops.includes('D')) {
    return 'd';
  }
  if (ops.includes('U')) {
    return 'u';
  }
  if (ops.includes('C')) {
    return 'c';
  }
  if (ops.includes('R')) {
    return 'r';
  }
  return null;
}

type SchemaGroup = {
  schema: string;
  tables: TableRecord[];
};

type HeatColumn = {
  name: string;
  /** 组首列:左侧 2px 分隔线(schema 分组边界) */
  isGroupStart: boolean;
};

export function HeatmapPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();

  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const { edgesByFlow } = indexes;

  /** 列 = 非 alias 主表(crudEdges 表名已由 indexes 的 canonicalTableName 归一到主表),
   *  按 schema 分组(orderedSchemas 优先级排序),组内按表名排序。 */
  const groups = useMemo<SchemaGroup[]>(() => {
    const primaryTables = (data?.tables ?? []).filter((table) => !table.alias_of);
    return orderedSchemas(primaryTables.map((table) => schemaOf(table.name)))
      .map((schema) => ({
        schema,
        tables: primaryTables
          .filter((table) => schemaOf(table.name) === schema)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.tables.length > 0);
  }, [data]);

  const columns = useMemo<HeatColumn[]>(() => {
    const flat: HeatColumn[] = [];
    groups.forEach((group, groupIndex) => {
      group.tables.forEach((table, tableIndex) => {
        flat.push({ name: table.name, isGroupStart: groupIndex > 0 && tableIndex === 0 });
      });
    });
    return flat;
  }, [groups]);

  const columnSet = useMemo(() => new Set(columns.map((column) => column.name)), [columns]);

  /** 行 = 流程,按触达表数(去重后的 canonical 表)降序,平手按 id 字典序 */
  const rows = useMemo(() => {
    return (data?.flows ?? [])
      .map((flow) => ({ flow, touched: edgesByFlow.get(flow.id)?.size ?? 0 }))
      .sort(
        (a, b) => b.touched - a.touched || a.flow.id.localeCompare(b.flow.id),
      );
  }, [data, edgesByFlow]);

  const stats = useMemo(() => {
    let pairs = 0;
    const covered = new Set<string>();
    for (const row of rows) {
      const tableOps = edgesByFlow.get(row.flow.id);
      if (!tableOps) {
        continue;
      }
      for (const [table, ops] of tableOps) {
        if (ops && columnSet.has(table)) {
          pairs += 1;
          covered.add(table);
        }
      }
    }
    const busiest = rows.length > 0 && rows[0].touched > 0 ? rows[0] : null;
    return { pairs, coveredCount: covered.size, totalColumns: columns.length, busiest };
  }, [columns.length, columnSet, edgesByFlow, rows]);

  const legendItems: Array<{ shade: CellShade | null; label: string; op: string }> = [
    { shade: 'r', op: 'R', label: bi(locale, 'Read', '读') },
    { shade: 'c', op: 'C', label: bi(locale, 'Create', '建') },
    { shade: 'u', op: 'U', label: bi(locale, 'Update', '改') },
    { shade: 'd', op: 'D', label: bi(locale, 'Delete', '删') },
    { shade: null, op: '·', label: bi(locale, 'No touch', '无触达') },
  ];

  return (
    <section className="page heatmap-page">
      <h1>{bi(locale, 'CRUD Heatmap Matrix', 'CRUD 热力矩阵')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Flow × table CRUD touch matrix (pure CSS, data from crudEdges).',
          '流程 × 表 的 CRUD 触达热力矩阵(纯 CSS,数据全部来自 crudEdges)。',
        )}
      </p>

      {loading && <p>{bi(locale, 'Loading heatmap...', '正在加载热力矩阵...')}</p>}

      {error && (
        <p className="error">
          {bi(locale, 'Failed to load heatmap: ', '加载热力矩阵失败:')}
          {error}
        </p>
      )}

      {!loading && !error && data && (
        <>
          <div className="heat-stats">
            <div className="stat-block stat-block-info">
              <div className="stat-num">{stats.pairs}</div>
              <div className="stat-label">{bi(locale, 'Touch pairs', '触达对数')}</div>
            </div>
            <div className="stat-block stat-block-info">
              <div className="stat-num">
                {stats.coveredCount} / {stats.totalColumns}
              </div>
              <div className="stat-label">{bi(locale, 'Tables covered', '覆盖表数')}</div>
            </div>
            <div className="stat-block stat-block-info">
              <div className="stat-num">{stats.busiest ? stats.busiest.touched : 0}</div>
              <div className="stat-label">
                {bi(locale, 'Busiest flow: ', '最忙流程:')}
                {stats.busiest ? (
                  <Link to={`/flows/${encodeURIComponent(stats.busiest.flow.id)}`}>
                    {stats.busiest.flow.id}
                  </Link>
                ) : (
                  bi(locale, 'none', '无')
                )}
              </div>
            </div>
          </div>

          <div className="heat-legend">
            <span className="heat-legend-title">{bi(locale, 'Legend:', '图例:')}</span>
            {legendItems.map((item) => (
              <span key={item.op} className="heat-legend-item">
                <span
                  className={
                    item.shade ? `heat-swatch heat-swatch-${item.shade}` : 'heat-swatch heat-swatch-none'
                  }
                  aria-hidden="true"
                />
                {item.op !== '·' ? `${item.op} · ` : ''}
                {item.label}
              </span>
            ))}
          </div>

          {columns.length === 0 || rows.length === 0 ? (
            <p className="subtle">
              {bi(locale, 'No flows or tables to display.', '没有可展示的流程或表。')}
            </p>
          ) : (
            <div className="heat-matrix-scroll">
              <table className="heat-matrix">
                <colgroup>
                  <col className="heat-col-head" />
                  {columns.map((column) => (
                    <col
                      key={column.name}
                      className={column.isGroupStart ? 'heat-col-start' : 'heat-col-cell'}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr className="heat-schema-row">
                    <th className="heat-corner" rowSpan={2} scope="col">
                      {bi(locale, 'Flow × Table', '流程 × 表')}
                    </th>
                    {groups.map((group, groupIndex) => (
                      <th
                        key={group.schema}
                        className={`heat-schema-group${groupIndex > 0 ? ' heat-group-start' : ''}`}
                        colSpan={group.tables.length}
                        scope="colgroup"
                        title={group.schema}
                      >
                        {schemaDisplayLabel(group.schema, locale)}
                        <span className="heat-schema-count"> · {group.tables.length}</span>
                      </th>
                    ))}
                  </tr>
                  <tr className="heat-col-row">
                    {columns.map((column) => (
                      <th
                        key={column.name}
                        scope="col"
                        className={column.isGroupStart ? 'heat-group-start' : undefined}
                      >
                        <Link
                          className="heat-col-link"
                          to={`/tables/${encodeURIComponent(column.name)}`}
                          title={column.name}
                        >
                          <span className="heat-col-name">{column.name}</span>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ flow, touched }) => (
                    <tr key={flow.id}>
                      <th className="heat-row-head" scope="row">
                        <Link
                          className="heat-row-link"
                          to={`/flows/${encodeURIComponent(flow.id)}`}
                          title={`${flow.id} · ${locale === 'zh' ? flow.name_zh : flow.name_en}`}
                        >
                          <span className="heat-row-id">{flow.id}</span>
                          <span className="heat-row-count" title={bi(locale, 'tables touched', '触达表数')}>
                            {touched}
                          </span>
                        </Link>
                      </th>
                      {columns.map((column) => {
                        const ops = edgesByFlow.get(flow.id)?.get(column.name) ?? '';
                        const shade = opsShade(ops);
                        const groupStart = column.isGroupStart ? ' heat-group-start' : '';
                        if (!shade) {
                          return (
                            <td key={column.name} className={`heat-cell heat-cell-empty${groupStart}`} />
                          );
                        }
                        return (
                          <td key={column.name} className={`heat-cell heat-cell-${shade}${groupStart}`}>
                            <Link
                              className="heat-cell-link"
                              to={`/flows/${encodeURIComponent(flow.id)}`}
                              title={`${flow.id} × ${column.name}: ${ops}`}
                              aria-label={`${flow.id} × ${column.name}: ${ops}`}
                            >
                              <span className="heat-cell-ops">{ops}</span>
                            </Link>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
