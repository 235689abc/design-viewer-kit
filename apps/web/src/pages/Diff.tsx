import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { diffIndexes } from '../app/diffIndex';
import { useLocale, bi } from '../app/i18n';
import type { ProjectData } from '../app/useProjectData';

type HistoryManifestItem = {
  file: string;
  generated_at?: string;
  project?: string;
  counts?: {
    flows?: number;
    tables?: number;
    crudEdges?: number;
    services?: number;
  };
};

type HistoryManifest = {
  items: HistoryManifestItem[];
};

const MANIFEST_URL = '/data/history/manifest.json';

function byNewestFirst(left: HistoryManifestItem, right: HistoryManifestItem): number {
  return right.file.localeCompare(left.file);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

export function DiffPage() {
  const navigate = useNavigate();
  const [locale] = useLocale();
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestItems, setManifestItems] = useState<HistoryManifestItem[]>([]);
  const [leftFile, setLeftFile] = useState('');
  const [rightFile, setRightFile] = useState('');
  const [leftData, setLeftData] = useState<ProjectData | null>(null);
  const [rightData, setRightData] = useState<ProjectData | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadManifest() {
      setManifestLoading(true);
      setManifestError(null);
      try {
        const manifest = await fetchJson<HistoryManifest>(MANIFEST_URL);
        if (cancelled) {
          return;
        }
        const sorted = [...(manifest.items ?? [])]
          .filter((item) => !!item.file)
          .sort(byNewestFirst);
        setManifestItems(sorted);
        if (sorted.length >= 2) {
          setLeftFile(sorted[1].file);
          setRightFile(sorted[0].file);
        } else if (sorted.length === 1) {
          setLeftFile(sorted[0].file);
          setRightFile(sorted[0].file);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setManifestItems([]);
        setManifestError((err as Error).message || 'Failed to load history manifest');
      } finally {
        if (!cancelled) {
          setManifestLoading(false);
        }
      }
    }
    void loadManifest();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!leftFile || !rightFile) {
      setLeftData(null);
      setRightData(null);
      return;
    }
    let cancelled = false;
    async function loadDiffInputs() {
      setDiffLoading(true);
      setDiffError(null);
      try {
        const [left, right] = await Promise.all([
          fetchJson<ProjectData>(`/data/history/${leftFile}`),
          fetchJson<ProjectData>(`/data/history/${rightFile}`),
        ]);
        if (cancelled) {
          return;
        }
        setLeftData(left);
        setRightData(right);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setLeftData(null);
        setRightData(null);
        setDiffError((err as Error).message || 'Failed to load diff files');
      } finally {
        if (!cancelled) {
          setDiffLoading(false);
        }
      }
    }
    void loadDiffInputs();
    return () => {
      cancelled = true;
    };
  }, [leftFile, rightFile]);

  const selectedLeftItem = useMemo(
    () => manifestItems.find((item) => item.file === leftFile) ?? null,
    [leftFile, manifestItems],
  );
  const selectedRightItem = useMemo(
    () => manifestItems.find((item) => item.file === rightFile) ?? null,
    [manifestItems, rightFile],
  );

  const summary = useMemo(() => {
    if (!leftData || !rightData) {
      return null;
    }
    return diffIndexes(leftData, rightData);
  }, [leftData, rightData]);

  return (
    <section className="page">
      <h1>{bi(locale, 'Diff', '变更')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Compare two historical `index.json` snapshots and inspect design changes.',
          '对比两个历史 `index.json` 快照，检查设计变更。',
        )}
      </p>

      {manifestLoading && (
        <p>{bi(locale, 'Loading history manifest...', '正在加载历史清单...')}</p>
      )}
      {manifestError && (
        <p className="error">
          {bi(locale, 'Failed to load history manifest: ', '加载历史清单失败:')}{manifestError}
        </p>
      )}

      {!manifestLoading && !manifestError && manifestItems.length === 0 && (
        <p className="subtle">
          {bi(
            locale,
            'No history snapshots found. Run `scripts/update_design_viewer_data.sh` first.',
            '未找到历史快照，请先运行 `scripts/update_design_viewer_data.sh`。',
          )}
        </p>
      )}

      {manifestItems.length > 0 && (
        <div className="card-grid">
          <article className="card">
            <h2>{bi(locale, 'Pick versions', '选择版本')}</h2>
            <div className="table-lens-toolbar">
              <label htmlFor="diff-left-select">{bi(locale, 'A (baseline)', 'A 基线')}</label>
              <select
                id="diff-left-select"
                value={leftFile}
                onChange={(event) => setLeftFile(event.target.value)}
              >
                {manifestItems.map((item) => (
                  <option key={`left-${item.file}`} value={item.file}>
                    {item.file}
                  </option>
                ))}
              </select>
              <label htmlFor="diff-right-select">{bi(locale, 'B (compare)', 'B 对比')}</label>
              <select
                id="diff-right-select"
                value={rightFile}
                onChange={(event) => setRightFile(event.target.value)}
              >
                {manifestItems.map((item) => (
                  <option key={`right-${item.file}`} value={item.file}>
                    {item.file}
                  </option>
                ))}
              </select>
            </div>
            <p className="subtle">
              A: {selectedLeftItem?.generated_at ?? '-'} · B: {selectedRightItem?.generated_at ?? '-'}
            </p>
          </article>

          {selectedLeftItem && selectedRightItem && (
            <article className="card">
              <h2>{bi(locale, 'Counts Snapshot', '总量快照')}</h2>
              <p>
                {bi(locale, 'A flows/tables/crudEdges', 'A 流程/表/CRUD 边')}:{' '}
                {formatCount(selectedLeftItem.counts?.flows ?? 0)}
                {'/'}
                {formatCount(selectedLeftItem.counts?.tables ?? 0)}
                {'/'}
                {formatCount(selectedLeftItem.counts?.crudEdges ?? 0)}
              </p>
              <p>
                {bi(locale, 'B flows/tables/crudEdges', 'B 流程/表/CRUD 边')}:{' '}
                {formatCount(selectedRightItem.counts?.flows ?? 0)}
                {'/'}
                {formatCount(selectedRightItem.counts?.tables ?? 0)}
                {'/'}
                {formatCount(selectedRightItem.counts?.crudEdges ?? 0)}
              </p>
            </article>
          )}
        </div>
      )}

      {diffLoading && <p>{bi(locale, 'Loading diff files...', '正在加载对比文件...')}</p>}
      {diffError && (
        <p className="error">
          {bi(locale, 'Diff load error: ', '对比加载失败:')}{diffError}
        </p>
      )}

      {!diffLoading && !diffError && summary && (
        <div className="card-grid">
          <article className="card">
            <h2>{bi(locale, 'Summary', '摘要')}</h2>
            <p>{bi(locale, 'addedTables', '新增表')}: {summary.addedTables.length}</p>
            <p>{bi(locale, 'removedTables', '删除表')}: {summary.removedTables.length}</p>
            <p>{bi(locale, 'addedFlows', '新增流程')}: {summary.addedFlows.length}</p>
            <p>{bi(locale, 'removedFlows', '删除流程')}: {summary.removedFlows.length}</p>
            <p>{bi(locale, 'changedFlows', '变更流程')}: {summary.changedFlows.length}</p>
            <p>{bi(locale, 'crudEdges added pairs', 'CRUD 边新增对')}: {summary.crudEdges.addedPairs}</p>
            <p>{bi(locale, 'crudEdges removed pairs', 'CRUD 边删除对')}: {summary.crudEdges.removedPairs}</p>
            <p>{bi(locale, 'crudEdges changed pairs', 'CRUD 边变更对')}: {summary.crudEdges.changedPairs}</p>
            <p>
              {bi(locale, 'crud ops', 'CRUD 操作')} +{summary.crudEdges.addedOps}/-{summary.crudEdges.removedOps}
            </p>
          </article>

          <article className="card">
            <h2>{bi(locale, 'Added Tables', '新增表')}</h2>
            <ul className="inline-list">
              {summary.addedTables.length === 0 && <li>-</li>}
              {summary.addedTables.map((table) => (
                <li key={`diff-added-table-${table.name}`}>
                  <Link to={`/tables/${encodeURIComponent(table.name)}`}>{table.name}</Link>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h2>{bi(locale, 'Removed Tables', '删除表')}</h2>
            <ul className="inline-list">
              {summary.removedTables.length === 0 && <li>-</li>}
              {summary.removedTables.map((table) => (
                <li key={`diff-removed-table-${table.name}`}>
                  <code>{table.name}</code>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h2>{bi(locale, 'Added Flows', '新增流程')}</h2>
            <ul className="inline-list">
              {summary.addedFlows.length === 0 && <li>-</li>}
              {summary.addedFlows.map((flow) => (
                <li key={`diff-added-flow-${flow.id}`}>
                  <Link to={`/flows/${encodeURIComponent(flow.id)}`}>{flow.id}</Link>
                  {' '}({locale === 'zh' ? flow.name_zh : flow.name_en})
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h2>{bi(locale, 'Removed Flows', '删除流程')}</h2>
            <ul className="inline-list">
              {summary.removedFlows.length === 0 && <li>-</li>}
              {summary.removedFlows.map((flow) => (
                <li key={`diff-removed-flow-${flow.id}`}>
                  <code>{flow.id}</code>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h2>{bi(locale, 'Changed Flows', '变更流程')}</h2>
            <ul className="inline-list">
              {summary.changedFlows.length === 0 && <li>-</li>}
              {summary.changedFlows.map((row) => (
                <li key={`diff-changed-flow-${row.id}`}>
                  <button
                    type="button"
                    className="inline-link-btn"
                    onClick={() => navigate(`/flows/${encodeURIComponent(row.id)}?diff=1`)}
                  >
                    {row.id}
                  </button>
                  {' '}{bi(locale, 'fields', '字段')}: {row.changedFields.join(', ')}
                </li>
              ))}
            </ul>
          </article>
        </div>
      )}
    </section>
  );
}
