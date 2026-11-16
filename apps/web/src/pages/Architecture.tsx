import './Architecture.css';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buildProjectIndexes, getServiceDisplay, hasWriteOps } from '../app/indexes';
import { useLocale, bi } from '../app/i18n';
import { useProjectData, type ServiceRecord } from '../app/useProjectData';
import type { ServiceOps } from '@design-viewer/schema';

type DepRow = { from: string; to: string; table: string };

/** services[].ops 读数:类型单源 @design-viewer/schema,运行期仍防脏数据(缺省返回 null 容错显示) */
function readServiceOps(service: ServiceRecord): ServiceOps | null {
  const ops = service.ops;
  if (!ops || typeof ops !== 'object') {
    return null;
  }
  return ops;
}

/** system_id 标注为 external* 的服务归「外部系统」卡区,其余为内部服务 */
function isExternalService(service: ServiceRecord): boolean {
  return /^external/i.test((service.system_id ?? '').trim());
}

function isMissingOwner(ownerService: string | undefined): boolean {
  const normalized = (ownerService ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

function ServiceCard(props: {
  service: ServiceRecord;
  locale: 'zh' | 'en';
  tableCount: number;
  flowCount: number;
  deps: DepRow[];
}) {
  const { service, locale, tableCount, flowCount, deps } = props;
  const ops = readServiceOps(service);
  const healthIsUrl = /^https?:\/\//i.test((ops?.health ?? '').trim());

  return (
    <article className="card">
      <h2>
        {locale === 'zh' ? service.name_zh : service.name_en}{' '}
        <span className="arch-svc-id field-value-mono">{service.id}</span>
      </h2>
      <div className="field-list">
        <span className="field-row">
          <span className="field-key">{bi(locale, 'system_id', '系统标识')}</span>
          <span className="field-value field-value-mono">{service.system_id || '-'}</span>
        </span>
        <span className="field-row">
          <span className="field-key">{bi(locale, 'owned tables', '拥有表数')}</span>
          <span className="field-value">{tableCount}</span>
        </span>
        <span className="field-row">
          <span className="field-key">{bi(locale, 'owned flows', '拥有流程数')}</span>
          <span className="field-value">{flowCount}</span>
        </span>
        {ops?.port && (
          <span className="field-row">
            <span className="field-key">{bi(locale, 'port', '端口')}</span>
            <span className="field-value field-value-mono">{ops.port}</span>
          </span>
        )}
        {ops?.health && (
          <span className="field-row">
            <span className="field-key">{bi(locale, 'health', '健康检查')}</span>
            <span className="field-value field-value-mono">
              {healthIsUrl ? (
                <a href={ops.health} target="_blank" rel="noreferrer">{ops.health}</a>
              ) : (
                ops.health
              )}
            </span>
          </span>
        )}
      </div>
      <p className="arch-dep-label">{bi(locale, `writes to other services (${deps.length})`, `依赖边(${deps.length})`)}</p>
      {deps.length === 0 ? (
        <p className="subtle">{bi(locale, 'No cross-service writes.', '无跨服务写。')}</p>
      ) : (
        <ul className="arch-dep-list">
          {deps.map((dep) => (
            <li key={`${dep.from}->${dep.to}->${dep.table}`} className="field-value-mono">
              {dep.from} → {dep.to}{' '}
              <span className="subtle">{bi(locale, `(via table ${dep.table})`, `(经表 ${dep.table})`)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function ArchitecturePage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();

  const model = useMemo(() => {
    if (!data) {
      return null;
    }
    const indexes = buildProjectIndexes(data);

    const tableCountByService = new Map<string, number>();
    for (const table of data.tables) {
      tableCountByService.set(table.owner_service, (tableCountByService.get(table.owner_service) ?? 0) + 1);
    }
    const flowCountByService = new Map<string, number>();
    for (const flow of data.flows) {
      flowCountByService.set(flow.owner_service, (flowCountByService.get(flow.owner_service) ?? 0) + 1);
    }

    // 依赖边 = 本服务流程写了别人拥有的表(crudEdges 写操作 + 表 owner_service 推导;alias 归一后可忽略差异)
    const ownerByTable = new Map<string, string>();
    for (const table of data.tables) {
      ownerByTable.set(indexes.canonicalTableName(table.name), table.owner_service);
    }
    const seen = new Set<string>();
    const depRows: DepRow[] = [];
    for (const edge of data.crudEdges) {
      if (!hasWriteOps(edge.ops)) {
        continue;
      }
      const flow = indexes.flowById.get(edge.flow_id);
      if (!flow) {
        continue;
      }
      const table = indexes.canonicalTableName(edge.table);
      const to = ownerByTable.get(table);
      if (!to || to === flow.owner_service) {
        continue;
      }
      const key = `${flow.owner_service}\u0000${to}\u0000${table}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      depRows.push({ from: flow.owner_service, to, table });
    }
    depRows.sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.table.localeCompare(b.table),
    );
    const depsByService = new Map<string, DepRow[]>();
    for (const row of depRows) {
      const list = depsByService.get(row.from) ?? [];
      list.push(row);
      depsByService.set(row.from, list);
    }

    const internalServices = data.services.filter((service) => !isExternalService(service));
    const externalServices = data.services.filter(isExternalService);
    const ownerlessTables = data.tables.filter((table) => isMissingOwner(table.owner_service));

    return {
      indexes,
      internalServices,
      externalServices,
      tableCountByService,
      flowCountByService,
      depsByService,
      depRows,
      ownerlessTables,
    };
  }, [data]);

  return (
    <section className="page">
      <h1>{bi(locale, 'Architecture', '架构总览')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Service ownership board: tables and flows owned by each service, cross-service write dependencies, and ownerless-table check.',
          '服务权责看板:各服务拥有的表与流程、跨服务写依赖与无主表检查。',
        )}
      </p>

      {loading && <p className="subtle">{bi(locale, 'Loading project data…', '正在加载项目数据…')}</p>}
      {error && (
        <p className="error">{bi(locale, 'Failed to load project data: ', '加载项目数据失败:')}{error}</p>
      )}

      {data && model && (
        <>
          <h2 className="arch-group-title">{bi(locale, 'Services', '内部服务')}</h2>
          <div className="detail-grid-2col">
            {model.internalServices.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                locale={locale}
                tableCount={model.tableCountByService.get(service.id) ?? 0}
                flowCount={model.flowCountByService.get(service.id) ?? 0}
                deps={model.depsByService.get(service.id) ?? []}
              />
            ))}
          </div>

          {model.externalServices.length > 0 && (
            <>
              <h2 className="arch-group-title">{bi(locale, 'External Systems', '外部系统')}</h2>
              <div className="detail-grid-2col">
                {model.externalServices.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    locale={locale}
                    tableCount={model.tableCountByService.get(service.id) ?? 0}
                    flowCount={model.flowCountByService.get(service.id) ?? 0}
                    deps={model.depsByService.get(service.id) ?? []}
                  />
                ))}
              </div>
            </>
          )}

          <article className="card" style={{ marginTop: 'var(--dv-sp-5)' }}>
            <h2>{bi(locale, 'Dependency Summary', '依赖汇总')}</h2>
            {model.depRows.length === 0 ? (
              <p className="subtle">{bi(locale, 'No cross-service write dependencies.', '无跨服务写依赖。')}</p>
            ) : (
              <table className="table-lens-grid">
                <thead>
                  <tr>
                    <th>{bi(locale, 'Depender', '依赖方')}</th>
                    <th>{bi(locale, 'Dependee', '被依赖方')}</th>
                    <th>{bi(locale, 'Via Table', '经由表')}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.depRows.map((row) => (
                    <tr key={`dep-${row.from}-${row.to}-${row.table}`}>
                      <td>
                        {getServiceDisplay(row.from, model.indexes.mapServices, locale)}{' '}
                        <code>{row.from}</code>
                      </td>
                      <td>
                        {getServiceDisplay(row.to, model.indexes.mapServices, locale)}{' '}
                        <code>{row.to}</code>
                      </td>
                      <td>
                        <Link to={`/tables/${encodeURIComponent(row.table)}`} className="item-title">
                          {row.table}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article
            className={`card ${model.ownerlessTables.length > 0 ? 'card-accent-red' : 'card-accent-green'}`}
            style={{ marginTop: 'var(--dv-sp-3)' }}
          >
            <h2>{bi(locale, 'Ownerless Tables Check', '无主表检查')}</h2>
            {model.ownerlessTables.length === 0 ? (
              <p>
                <span className="sev-badge sev-badge-green">
                  {bi(locale, 'All tables have owners', '全部有主')}
                </span>
              </p>
            ) : (
              <>
                <p>
                  <span className="sev-badge sev-badge-red">
                    {bi(
                      locale,
                    `${model.ownerlessTables.length} tables missing owner_service`,
                    `${model.ownerlessTables.length} 张表 owner_service 为空/TBD`,
                    )}
                  </span>
                </p>
                <ul className="inline-list">
                  {model.ownerlessTables.map((table) => (
                    <li key={`ownerless-${table.name}`}>
                      <Link to={`/tables/${encodeURIComponent(table.name)}`} className="item-title">
                        {table.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
}
