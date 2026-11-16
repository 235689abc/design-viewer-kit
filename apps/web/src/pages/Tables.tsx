import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildProjectIndexes, getServiceDisplay } from '../app/indexes';
import { collectFindings, type Finding } from '../app/findings';
import { useLocale, bi } from '../app/i18n';
import { useProjectData } from '../app/useProjectData';

function isMissingOwner(ownerService: string): boolean {
  return !ownerService || ownerService.trim() === '';
}

function isMissingIntroduced(introducedIn: string): boolean {
  const normalized = (introducedIn ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'TBD';
}

function worstSeverity(findings: Finding[]): 'red' | 'yellow' | 'green' | null {
  if (findings.some((finding) => finding.severity === 'red')) {
    return 'red';
  }
  if (findings.some((finding) => finding.severity === 'yellow')) {
    return 'yellow';
  }
  if (findings.some((finding) => finding.severity === 'green')) {
    return 'green';
  }
  return null;
}

export function TablesPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const [searchParams] = useSearchParams();
  const [nameFilter, setNameFilter] = useState('');
  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const activeFilter = searchParams.get('filter')?.trim() ?? '';
  const keyword = nameFilter.trim().toLowerCase();

  const findingsByTable = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of collectFindings(data)) {
      if (!finding.table) {
        continue;
      }
      const list = map.get(finding.table) ?? [];
      list.push(finding);
      map.set(finding.table, list);
    }
    return map;
  }, [data]);

  const filteredTables = useMemo(() => {
    const items = data?.tables ?? [];
    return items.filter((table) => {
      if (activeFilter === 'missing-owner' && !isMissingOwner(table.owner_service)) {
        return false;
      }
      if (activeFilter === 'planned' && table.state !== 'planned') {
        return false;
      }
      if (activeFilter === 'missing-introduced' && !isMissingIntroduced(table.introduced_in)) {
        return false;
      }
      if (activeFilter === 'alias' && !table.alias_of) {
        return false;
      }
      if (keyword && !table.name.toLowerCase().includes(keyword)) {
        return false;
      }
      return true;
    });
  }, [activeFilter, data, keyword]);

  return (
    <section className="page">
      <h1>Tables / 数据表</h1>
      <p className="subtle">Table Lens list with governance fields and quick lookup.</p>

      {loading && <p>Loading tables... / 正在加载数据表...</p>}

      {error && (
        <p className="error">
          Failed to load tables / 加载数据表失败: {error}
        </p>
      )}

      {!loading && !error && (
        <div className="table-lens-list">
          <div className="table-lens-toolbar">
            <label htmlFor="table-name-filter">Search / 搜索表名</label>
            <input
              id="table-name-filter"
              type="text"
              value={nameFilter}
              placeholder="orders"
              onChange={(e) => setNameFilter(e.target.value)}
            />
            {activeFilter && <span className="state-badge state-badge-planned">filter: {activeFilter}</span>}
            <span className="subtle">
              visible: {filteredTables.length} / {data?.tables.length ?? 0}
            </span>
            {activeFilter && <Link to="/tables">Clear Filter / 清除过滤</Link>}
          </div>

          <table className="table-lens-grid">
            <thead>
              <tr>
                <th>{bi(locale, 'Name', '表名')}</th>
                <th>{bi(locale, 'State', '状态')}</th>
                <th>{bi(locale, 'Owner', '归属服务')}</th>
                <th>{bi(locale, 'Introduced In', '引入位置')}</th>
                <th>{bi(locale, 'Alias', '别名')}</th>
                <th>{bi(locale, 'Findings', '发现')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTables.map((table) => {
                const tableFindings = findingsByTable.get(table.name) ?? [];
                const worst = worstSeverity(tableFindings);
                return (
                  <tr key={table.name}>
                    <td>
                      <Link to={`/tables/${encodeURIComponent(table.name)}`} className="item-title">
                        {table.name}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`state-badge ${
                          table.state === 'planned' ? 'state-badge-planned' : 'state-badge-existing'
                        }`}
                      >
                        {table.state || '-'}
                      </span>
                    </td>
                    <td>{getServiceDisplay(table.owner_service, indexes.mapServices)}</td>
                    <td><code>{table.introduced_in || '-'}</code></td>
                    <td>{table.alias_of ? `alias -> ${table.alias_of}` : '-'}</td>
                    <td>
                      {worst ? (
                        <span className={`sev-badge sev-badge-${worst}`}>
                          {worst === 'red'
                            ? bi(locale, 'Red', '红')
                            : worst === 'yellow'
                              ? bi(locale, 'Yellow', '黄')
                              : bi(locale, 'Green', '绿')}{' '}
                          {tableFindings.length}
                        </span>
                      ) : (
                        <span className="subtle">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
