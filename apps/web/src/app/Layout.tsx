import { useMemo, useState, type FormEvent } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../ui/Sidebar';
import { useProjectData } from './useProjectData';

export function Layout() {
  const navigate = useNavigate();
  const { data, loading, reload } = useProjectData();
  const [globalKeyword, setGlobalKeyword] = useState('');
  const [searchHint, setSearchHint] = useState('');
  const [reloading, setReloading] = useState(false);

  const normalizedFlowIds = useMemo(() => data?.flows ?? [], [data]);
  const normalizedTableNames = useMemo(() => data?.tables ?? [], [data]);

  const onGlobalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = globalKeyword.trim();
    if (!keyword) {
      setSearchHint('');
      return;
    }
    if (!data) {
      setSearchHint('Data not ready / 数据尚未加载完成');
      return;
    }

    const lowerKeyword = keyword.toLowerCase();
    const flowExact = normalizedFlowIds.find(
      (flow) => flow.id.toLowerCase() === lowerKeyword,
    );
    if (flowExact) {
      setSearchHint('');
      navigate(`/flows/${encodeURIComponent(flowExact.id)}`);
      return;
    }

    const tableExact = normalizedTableNames.find(
      (table) => table.name.toLowerCase() === lowerKeyword,
    );
    if (tableExact) {
      setSearchHint('');
      navigate(`/tables/${encodeURIComponent(tableExact.name)}`);
      return;
    }

    const tablePrefixMatches = normalizedTableNames.filter((table) =>
      table.name.toLowerCase().startsWith(lowerKeyword),
    );
    if (tablePrefixMatches.length === 1) {
      setSearchHint('');
      navigate(`/tables/${encodeURIComponent(tablePrefixMatches[0].name)}`);
      return;
    }

    if (tablePrefixMatches.length > 1) {
      setSearchHint(
        `Multiple table matches (${tablePrefixMatches.length}), please refine / 命中多个表，请继续细化`,
      );
      return;
    }

    const flowPrefixMatches = normalizedFlowIds.filter((flow) =>
      flow.id.toLowerCase().startsWith(lowerKeyword),
    );
    if (flowPrefixMatches.length === 1) {
      setSearchHint('');
      navigate(`/flows/${encodeURIComponent(flowPrefixMatches[0].id)}`);
      return;
    }

    if (flowPrefixMatches.length > 1) {
      setSearchHint(
        `Multiple flow matches (${flowPrefixMatches.length}), please refine / 命中多个流程，请继续细化`,
      );
      return;
    }

    setSearchHint(`No match: ${keyword} / 未匹配到目标`);
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
        <div className="topbar-title">Design Viewer / 设计可视化脚手架</div>
        <form className="topbar-search" onSubmit={onGlobalSearch}>
          <input
            type="text"
            value={globalKeyword}
            onChange={(event) => setGlobalKeyword(event.target.value)}
            placeholder="Search flow/table: FLOW-XXX or orders"
            aria-label="Global search flow or table"
          />
          <button type="submit" className="topbar-btn">Go / 跳转</button>
        </form>
        <button
          type="button"
          className="topbar-btn"
          onClick={() => {
            void onReloadData();
          }}
          disabled={loading || reloading}
        >
          {loading || reloading ? 'Reloading... / 重新加载中...' : 'Reload Data / 重新加载数据'}
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
