import { useMemo, useState, type FormEvent } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../ui/Sidebar';
import { useProjectData } from './useProjectData';
import { useLocale, bi } from './i18n';

export function Layout() {
  const navigate = useNavigate();
  const { data, loading, reload } = useProjectData();
  const [locale, setLocale] = useLocale();
  const [globalKeyword, setGlobalKeyword] = useState('');
  const [searchHint, setSearchHint] = useState('');
  const [reloading, setReloading] = useState(false);

  const flows = useMemo(() => data?.flows ?? [], [data]);
  const tables = useMemo(() => data?.tables ?? [], [data]);

  const onGlobalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = globalKeyword.trim();
    if (!keyword) {
      setSearchHint('');
      return;
    }
    if (!data) {
      setSearchHint(bi(locale, 'Data not ready', '数据尚未加载完成'));
      return;
    }

    const lowerKeyword = keyword.toLowerCase();
    const flowExact = flows.find((flow) => flow.id.toLowerCase() === lowerKeyword);
    if (flowExact) {
      setSearchHint('');
      navigate(`/flows/${encodeURIComponent(flowExact.id)}`);
      return;
    }

    const tableExact = tables.find((table) => table.name.toLowerCase() === lowerKeyword);
    if (tableExact) {
      setSearchHint('');
      navigate(`/tables/${encodeURIComponent(tableExact.name)}`);
      return;
    }

    const tablePrefixMatches = tables.filter((table) =>
      table.name.toLowerCase().startsWith(lowerKeyword),
    );
    if (tablePrefixMatches.length === 1) {
      setSearchHint('');
      navigate(`/tables/${encodeURIComponent(tablePrefixMatches[0].name)}`);
      return;
    }

    if (tablePrefixMatches.length > 1) {
      setSearchHint(
        bi(
          locale,
          `Multiple table matches (${tablePrefixMatches.length}), please refine`,
          `命中多个表(${tablePrefixMatches.length}),请继续细化`,
        ),
      );
      return;
    }

    const flowPrefixMatches = flows.filter((flow) =>
      flow.id.toLowerCase().startsWith(lowerKeyword),
    );
    if (flowPrefixMatches.length === 1) {
      setSearchHint('');
      navigate(`/flows/${encodeURIComponent(flowPrefixMatches[0].id)}`);
      return;
    }

    if (flowPrefixMatches.length > 1) {
      setSearchHint(
        bi(
          locale,
          `Multiple flow matches (${flowPrefixMatches.length}), please refine`,
          `命中多个流程(${flowPrefixMatches.length}),请继续细化`,
        ),
      );
      return;
    }

    setSearchHint(bi(locale, `No match: ${keyword}`, `未匹配到目标:${keyword}`));
  };

  const onReloadData = async () => {
    setReloading(true);
    try {
      await reload();
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="topbar-brand" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <span className="brand-name">{bi(locale, 'Scaffold', '脚手架')}</span>
            <span className="brand-sub">Design Viewer Kit</span>
          </span>
        </a>
        {data?.meta?.project && (
          <span className="topbar-project" title={data.meta.project}>
            {data.meta.project}
          </span>
        )}
        <form className="topbar-search" onSubmit={onGlobalSearch}>
          <input
            type="text"
            value={globalKeyword}
            onChange={(event) => setGlobalKeyword(event.target.value)}
            placeholder={bi(locale, 'Search flow / table…', '搜索流程 / 数据表…')}
            aria-label={bi(locale, 'Global search flow or table', '全局搜索流程或数据表')}
          />
          <button type="submit" className="topbar-btn">{bi(locale, 'Go', '跳转')}</button>
        </form>
        <button
          type="button"
          className="topbar-btn"
          aria-pressed={locale === 'zh'}
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          title={bi(locale, 'Switch language', '切换语言')}
        >
          {locale === 'zh' ? 'EN' : '中文'}
        </button>
        <button
          type="button"
          className="topbar-btn"
          onClick={() => {
            void onReloadData();
          }}
          disabled={loading || reloading}
        >
          {loading || reloading
            ? bi(locale, 'Reloading…', '重新加载中…')
            : bi(locale, 'Reload', '重新加载')}
        </button>
      </header>
      {searchHint && <div className="topbar-hint">{searchHint}</div>}
      <div className="app-body">
        <Sidebar />
        <main className="main-content">
          <div className="page-container">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
