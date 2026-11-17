import './Gallery.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLocale, bi } from '../app/i18n';
import { useProjectData } from '../app/useProjectData';
import {
  MermaidPanZoom,
  type MermaidPanZoomHandle,
  type MermaidPanZoomReadyInfo,
} from '../ui/MermaidPanZoom';

/** L0 系统图在 ?d= 里的稳定 id(流程图直接用 flow id,无命名冲突:flow id 均为 FLOW-* 形) */
const L0_ENTRY_ID = 'l0';

type GalleryEntry = {
  /** URL/选中用的图 id:l0 或 flow id */
  id: string;
  kind: 'l0' | 'flow';
  /** 图名(L0 固定名;流程图取 flow 名,按 locale 取一) */
  title: string;
  mermaidCode: string;
};

type GalleryGroup = {
  key: 'system' | 'flows';
  label: string;
  entries: GalleryEntry[];
};

function buildGalleryGroups(input: {
  locale: 'zh' | 'en';
  l0Mermaid: string;
  flowMermaid: Record<string, string>;
  flowNameById: Map<string, string>;
}): GalleryGroup[] {
  const { locale, l0Mermaid, flowMermaid, flowNameById } = input;
  const groups: GalleryGroup[] = [];

  const systemEntries: GalleryEntry[] = [];
  if (l0Mermaid.trim().length > 0) {
    systemEntries.push({
      id: L0_ENTRY_ID,
      kind: 'l0',
      title: bi(locale, 'L0 System Map', 'L0 系统地图'),
      mermaidCode: l0Mermaid,
    });
  }
  groups.push({
    key: 'system',
    label: bi(locale, 'System Diagrams', '系统图'),
    entries: systemEntries,
  });

  const flowEntries: GalleryEntry[] = Object.keys(flowMermaid)
    .filter((flowId) => (flowMermaid[flowId] ?? '').trim().length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((flowId) => ({
      id: flowId,
      kind: 'flow' as const,
      title: flowNameById.get(flowId) ?? flowId,
      mermaidCode: flowMermaid[flowId],
    }));
  groups.push({
    key: 'flows',
    label: bi(locale, 'Flow Sequence Diagrams', '流程时序图'),
    entries: flowEntries,
  });

  return groups;
}

export function GalleryPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewerRef = useRef<MermaidPanZoomHandle | null>(null);
  const [renderState, setRenderState] = useState<MermaidPanZoomReadyInfo['status']>('idle');

  const groups = useMemo<GalleryGroup[]>(() => {
    if (!data) {
      return [];
    }
    const flowNameById = new Map<string, string>();
    for (const flow of data.flows) {
      flowNameById.set(flow.id, locale === 'zh' ? flow.name_zh : flow.name_en);
    }
    return buildGalleryGroups({
      locale,
      l0Mermaid: data.diagrams?.l0_mermaid ?? '',
      flowMermaid: data.diagrams?.flow_mermaid ?? {},
      flowNameById,
    });
  }, [data, locale]);

  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const systemCount = groups[0]?.entries.length ?? 0;
  const flowCount = groups[1]?.entries.length ?? 0;

  const dParam = (searchParams.get('d') ?? '').trim();
  const selected = useMemo<GalleryEntry | null>(() => {
    if (entries.length === 0) {
      return null;
    }
    return entries.find((entry) => entry.id === dParam) ?? entries[0];
  }, [entries, dParam]);

  // ?d= 指到不存在的图:数据就绪后抹掉失效参数回默认首图,URL 不说谎(replace 不进历史)。
  useEffect(() => {
    if (!data || dParam === '') {
      return;
    }
    if (entries.some((entry) => entry.id === dParam)) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('d');
        return next;
      },
      { replace: true },
    );
  }, [data, dParam, entries, setSearchParams]);

  // 换图即重置渲染状态(否则旧图的 Rendered ✓ 会挂在新图渲染中)。
  useEffect(() => {
    setRenderState('idle');
  }, [selected?.id]);

  const selectEntry = useCallback(
    (entryId: string) => {
      if (entryId === selected?.id) {
        return;
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('d', entryId);
        return next;
      });
    },
    [selected?.id, setSearchParams],
  );

  const handleReady = useCallback((info: MermaidPanZoomReadyInfo) => {
    setRenderState(info.status);
  }, []);

  if (loading) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Diagram Gallery', '图库')}</h1>
        <p>{bi(locale, 'Loading diagrams...', '正在加载图库...')}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Diagram Gallery', '图库')}</h1>
        <p className="error">
          {bi(locale, 'Failed to load diagrams: ', '加载图库失败:')}{error}
        </p>
      </section>
    );
  }

  const total = entries.length;

  return (
    <section className="page">
      <h1>{bi(locale, 'Diagram Gallery', '图库')}</h1>
      {total > 0 ? (
        <p className="subtle">
          {bi(
            locale,
            `${total} diagrams in total: ${systemCount} system + ${flowCount} flow sequence. Pick one on the left — only the selected diagram is mounted at a time; the URL carries ?d= for sharing.`,
            `共 ${total} 张图:${systemCount} 张系统图 + ${flowCount} 张流程时序图。左侧选择,右侧同一时刻只渲染选中一张;链接带 ?d= 可直接分享。`,
          )}
        </p>
      ) : (
        <article className="card">
          <h2>{bi(locale, 'No diagrams yet', '暂无图数据')}</h2>
          <p>
            {bi(
              locale,
              'No diagram sources found in this project data (diagrams.l0_mermaid / diagrams.flow_mermaid are empty). Run the generator first (npm run generate, or tools/refresh_viewer.sh), then reload this page.',
              '本数据里没有任何图源码(diagrams.l0_mermaid / diagrams.flow_mermaid 均为空)。请先运行生成器(npm run generate 或 tools/refresh_viewer.sh),再刷新本页。',
            )}
          </p>
        </article>
      )}

      {total > 0 && (
        <div className="gallery-layout">
          <aside className="card gallery-side" aria-label={bi(locale, 'Diagram list', '图列表')}>
            {groups.map((group) => (
              <div key={group.key} className="gallery-group">
                <h2 className="gallery-group-title">
                  {group.label}
                  <span className="gallery-group-count">{group.entries.length}</span>
                </h2>
                {group.entries.length > 0 ? (
                  <ul className="gallery-group-list">
                    {group.entries.map((entry) => {
                      const isActive = selected?.id === entry.id;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className={`gallery-item${isActive ? ' is-active' : ''}`}
                            onClick={() => selectEntry(entry.id)}
                            aria-current={isActive ? 'true' : undefined}
                          >
                            <span className="gallery-item-name">{entry.title}</span>
                            <span className="gallery-item-id">{entry.id}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="gallery-group-empty subtle">
                    {bi(locale, 'None', '暂无')}
                  </p>
                )}
              </div>
            ))}
          </aside>

          <div className="gallery-main">
            {selected ? (
              <>
                <div className="diagram-toolbar">
                  <button type="button" className="crud-btn" onClick={() => viewerRef.current?.fit()}>
                    {bi(locale, 'Fit', '适配')}
                  </button>
                  <button type="button" className="crud-btn" onClick={() => viewerRef.current?.reset()}>
                    {bi(locale, 'Reset', '重置')}
                  </button>
                  <button
                    type="button"
                    className="crud-btn"
                    onClick={() => viewerRef.current?.exportSvg(`gallery-${selected.id}.svg`)}
                  >
                    {bi(locale, 'Export SVG', '导出 SVG')}
                  </button>
                  {selected.kind === 'flow' && (
                    <Link className="gallery-flow-link" to={`/flows/${encodeURIComponent(selected.id)}`}>
                      {bi(locale, 'Flow detail →', '流程详情 →')}
                    </Link>
                  )}
                  <span className="diagram-status">
                    {renderState === 'rendered'
                      ? 'Rendered ✓'
                      : renderState === 'error'
                        ? 'Error'
                        : 'Rendering...'}
                  </span>
                </div>
                <div className="card diagram-render-shell">
                  {/* key=图 id:选中即换、整挂整卸,同一时刻只挂载一张图(mermaid 重,懒渲染铁律) */}
                  <MermaidPanZoom
                    key={selected.id}
                    ref={viewerRef}
                    title={selected.title}
                    mermaidCode={selected.mermaidCode}
                    height="72vh"
                    onReady={handleReady}
                  />
                </div>
              </>
            ) : (
              <p className="subtle">
                {bi(locale, 'Select a diagram to render.', '请选择要查看的图。')}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
