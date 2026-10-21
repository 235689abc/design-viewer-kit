import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellClickedEvent,
  type ColDef,
  type ColumnResizedEvent,
  type GridApi,
  type GridReadyEvent,
  type RowClickedEvent,
  type ValueGetterParams,
} from 'ag-grid-community';
import { useProjectData } from '../app/useProjectData';
import { buildProjectIndexes, getServiceDisplay } from '../app/indexes';
import { schemaOf } from '../app/schemaUtils';
import { loadRuntimeOverlay, type RuntimeFlowMetric } from '../app/runtimeMetrics';
import { getRuntimeBaseUrl, subscribeRuntimeBaseUrl } from '../app/runtimeClient';
import { CrudToolbar } from '../ui/CrudToolbar';

ModuleRegistry.registerModules([AllCommunityModule]);

type CrudRow = {
  flowId: string;
  name: string;
  owner: string;
};

type Density = 'compact' | 'normal' | 'comfortable';

const DENSITY_CONFIG: Record<Density, { rowHeight: number; headerHeight: number }> = {
  compact: { rowHeight: 36, headerHeight: 34 },
  normal: { rowHeight: 44, headerHeight: 40 },
  comfortable: { rowHeight: 54, headerHeight: 48 },
};
const CRUD_WIDTH_STORAGE_KEY = 'design_viewer.crud.column_widths.v2';
const NON_USER_RESIZE_SOURCES = new Set([
  'api',
  'autosizeColumn',
  'autosizeColumns',
  'sizeColumnsToFit',
  'alignedGridChanged',
  'flex',
]);

function normalizedColumnWidth(colId: string, width: number): number {
  if (colId === 'flowId') {
    return Math.min(320, Math.max(160, width));
  }
  if (colId === 'name') {
    return Math.min(440, Math.max(220, width));
  }
  if (colId === 'owner') {
    return Math.min(340, Math.max(180, width));
  }
  return Math.min(240, Math.max(96, width));
}

function renderFlowCell(
  flowId: string,
  showRuntimeHeat: boolean,
  metric: RuntimeFlowMetric | undefined,
) {
  if (!showRuntimeHeat || !metric || metric.heat <= 0) {
    return flowId;
  }
  return (
    <span className="crud-flow-id-cell">
      <span>{flowId}</span>
      <span className="crud-runtime-heat-badge">hot: {metric.heat}</span>
      {metric.failed > 0 && (
        <span className="crud-runtime-failed-dot" title={`failed: ${metric.failed}`}>
          !
        </span>
      )}
    </span>
  );
}

function setColumnsVisible(api: GridApi<CrudRow> | null, colIds: string[], visible: boolean) {
  if (!api || colIds.length === 0) {
    return;
  }

  const anyApi = api as unknown as {
    setColumnsVisible?: (ids: string[], flag: boolean) => void;
    applyColumnState?: (params: {
      state: Array<{ colId: string; hide: boolean }>;
      applyOrder?: boolean;
    }) => void;
  };
  if (typeof anyApi.setColumnsVisible === 'function') {
    anyApi.setColumnsVisible(colIds, visible);
    return;
  }
  if (typeof anyApi.applyColumnState === 'function') {
    anyApi.applyColumnState({
      state: colIds.map((colId) => ({ colId, hide: !visible })),
      applyOrder: false,
    });
  }
}

export function CrudPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data, loading, error } = useProjectData();

  const [fontSize, setFontSize] = useState(13);
  const [density, setDensity] = useState<Density>('normal');
  const [hideEmptyColumns, setHideEmptyColumns] = useState(false);
  const [showRuntimeHeat, setShowRuntimeHeat] = useState(false);
  const [flowFilter, setFlowFilter] = useState('');
  const [columnFilter, setColumnFilter] = useState('');
  const [horizontalIndex, setHorizontalIndex] = useState(0);
  const [gridApi, setGridApi] = useState<GridApi<CrudRow> | null>(null);
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() => getRuntimeBaseUrl());
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null);
  const [runtimeFlowMetrics, setRuntimeFlowMetrics] = useState<Record<string, RuntimeFlowMetric>>({});
  const skipRowNavigationRef = useRef(false);
  const widthByColIdRef = useRef<Record<string, number>>({});

  const loadSavedWidths = useCallback(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    try {
      const raw = window.localStorage.getItem(CRUD_WIDTH_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed)
          .filter(([, width]) => Number.isFinite(width) && width > 0)
          .map(([colId, width]) => [colId, normalizedColumnWidth(colId, width)]),
      );
    } catch {
      return {};
    }
  }, []);

  const persistWidths = useCallback((widthMap: Record<string, number>) => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(CRUD_WIDTH_STORAGE_KEY, JSON.stringify(widthMap));
    } catch {
      // Ignore storage errors (private mode/quota exceeded/etc).
    }
  }, []);

  const applySavedWidths = useCallback((api: GridApi<CrudRow> | null) => {
    if (!api) {
      return;
    }
    const widthMap = widthByColIdRef.current;
    const states = Object.entries(widthMap)
      .filter(([, width]) => Number.isFinite(width) && width > 0)
      .map(([colId, width]) => ({ colId, width: normalizedColumnWidth(colId, width) }));
    if (states.length === 0) {
      return;
    }
    const anyApi = api as unknown as {
      applyColumnState?: (params: {
        state: Array<{ colId: string; width: number }>;
        applyOrder?: boolean;
      }) => void;
    };
    anyApi.applyColumnState?.({ state: states, applyOrder: false });
  }, []);

  const replaySavedWidths = useCallback(
    (api: GridApi<CrudRow> | null) => {
      if (!api) {
        return;
      }
      applySavedWidths(api);
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => applySavedWidths(api));
      }
    },
    [applySavedWidths],
  );

  useEffect(() => {
    widthByColIdRef.current = loadSavedWidths();
  }, [loadSavedWidths]);

  useEffect(() => {
    return subscribeRuntimeBaseUrl((value) => setRuntimeBaseUrl(value));
  }, []);

  useEffect(() => {
    if (!runtimeBaseUrl) {
      setRuntimeFlowMetrics({});
      setRuntimeWarning(null);
      setRuntimeLoading(false);
      setShowRuntimeHeat(false);
      return;
    }

    let cancelled = false;
    async function loadRuntimeHeat() {
      setRuntimeLoading(true);
      setRuntimeWarning(null);
      try {
        const overlay = await loadRuntimeOverlay(data, { eventsLimit: 200, outboxLimit: 200 });
        if (cancelled) {
          return;
        }
        setRuntimeFlowMetrics(overlay.flowMetrics);
        if (overlay.warnings.length > 0) {
          setRuntimeWarning(overlay.warnings.join(' | '));
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setRuntimeFlowMetrics({});
        setRuntimeWarning((err as Error).message || 'Failed to load runtime overlay');
      } finally {
        if (!cancelled) {
          setRuntimeLoading(false);
        }
      }
    }
    void loadRuntimeHeat();
    return () => {
      cancelled = true;
    };
  }, [data, runtimeBaseUrl]);

  const indexes = useMemo(() => buildProjectIndexes(data), [data]);
  const { mapServices, edgesByFlow, edgesByTable } = indexes;

  const queryColumn = searchParams.get('column')?.trim() ?? '';
  const queryTable = searchParams.get('table')?.trim() ?? '';
  const queryFlow = searchParams.get('flow')?.trim() ?? '';

  useEffect(() => {
    setColumnFilter(queryColumn || queryTable);
    setFlowFilter(queryFlow);
  }, [queryColumn, queryFlow, queryTable]);

  const visibleTables = useMemo(
    () => (data?.tables ?? []).filter((table) => !table.alias_of),
    [data],
  );

  const tableColumnIds = useMemo(
    () => visibleTables.map((table) => table.name),
    [visibleTables],
  );

  const tableColumnIdSet = useMemo(() => new Set(tableColumnIds), [tableColumnIds]);
  const schemaNameSet = useMemo(
    () => new Set(tableColumnIds.map((tableName) => schemaOf(tableName).toLowerCase())),
    [tableColumnIds],
  );

  const tablesWithOps = useMemo(() => {
    const tableSet = new Set<string>();
    for (const tableName of edgesByTable.keys()) {
      tableSet.add(tableName);
    }
    return tableSet;
  }, [edgesByTable]);

  const rowData = useMemo<CrudRow[]>(() => {
    if (!data) {
      return [];
    }

    return data.flows.map((flow) => ({
      flowId: flow.id,
      name: `${flow.name_en} / ${flow.name_zh}`,
      owner: getServiceDisplay(flow.owner_service, mapServices),
    }));
  }, [data, mapServices]);

  const pinnedColumns = useMemo<ColDef<CrudRow>[]>(
    () => [
      {
        colId: 'flowId',
        field: 'flowId',
        headerName: 'Flow ID',
        pinned: 'left',
        width: 210,
        minWidth: 160,
        sortable: true,
        resizable: true,
        wrapText: false,
        headerClass: ['crud-pinned-resize', 'crud-col-divider'],
        cellClass: ['crud-col-divider', 'crud-cell-2line'],
        tooltipField: 'flowId',
        cellRenderer: (params: { value: string }) =>
          renderFlowCell(params.value, showRuntimeHeat, runtimeFlowMetrics[params.value]),
      },
      {
        colId: 'name',
        field: 'name',
        headerName: 'Name (EN / 中文)',
        pinned: 'left',
        width: 340,
        minWidth: 220,
        sortable: true,
        resizable: true,
        wrapText: false,
        headerClass: ['crud-pinned-resize', 'crud-col-divider'],
        cellClass: ['crud-col-divider', 'crud-cell-2line'],
        tooltipField: 'name',
      },
      {
        colId: 'owner',
        field: 'owner',
        headerName: 'Owner (EN / 中文)',
        pinned: 'left',
        width: 260,
        minWidth: 180,
        sortable: true,
        resizable: true,
        wrapText: false,
        headerClass: 'crud-pinned-resize',
        cellClass: 'crud-cell-2line',
        tooltipField: 'owner',
      },
    ],
    [runtimeFlowMetrics, showRuntimeHeat],
  );

  const tableColumns = useMemo<ColDef<CrudRow>[]>(
    () =>
      visibleTables.map((table) => ({
        colId: table.name,
        headerName: table.name,
        minWidth: 96,
        width: 118,
        sortable: false,
        valueGetter: (params: ValueGetterParams<CrudRow>) =>
          edgesByFlow.get(params.data?.flowId ?? '')?.get(table.name) ?? '-',
        getQuickFilterText: () => '',
        tooltipValueGetter: (params) => {
          const flowId = params.data?.flowId ?? '';
          const value = String(params.value ?? '-');
          if (value === '-') {
            return '';
          }
          return `${flowId} -> ${table.name} ops: ${value}`;
        },
        cellClassRules: {
          'crud-cell-empty': (params) => String(params.value ?? '-') === '-',
          'crud-cell-has-r': (params) => String(params.value ?? '').includes('R'),
          'crud-cell-has-c': (params) => String(params.value ?? '').includes('C'),
          'crud-cell-has-u': (params) => String(params.value ?? '').includes('U'),
          'crud-cell-has-d': (params) => String(params.value ?? '').includes('D'),
        },
      })),
    [edgesByFlow, visibleTables],
  );

  const columnDefs = useMemo<ColDef<CrudRow>[]>(() => [...pinnedColumns, ...tableColumns], [
    pinnedColumns,
    tableColumns,
  ]);

  const visibleTableIdSet = useMemo(() => {
    const keyword = columnFilter.trim().toLowerCase();
    const matchBySchema = keyword.length > 0 && schemaNameSet.has(keyword);
    return new Set(
      tableColumnIds.filter((tableName) => {
        if (hideEmptyColumns && !tablesWithOps.has(tableName)) {
          return false;
        }
        if (matchBySchema && schemaOf(tableName).toLowerCase() !== keyword) {
          return false;
        }
        if (!matchBySchema && keyword && !tableName.toLowerCase().includes(keyword)) {
          return false;
        }
        return true;
      }),
    );
  }, [columnFilter, hideEmptyColumns, schemaNameSet, tableColumnIds, tablesWithOps]);

  const visibleScrollableTableColumns = useMemo(
    () => tableColumnIds.filter((id) => visibleTableIdSet.has(id)),
    [tableColumnIds, visibleTableIdSet],
  );

  const horizontalMax = Math.max(0, visibleScrollableTableColumns.length - 1);
  const horizontalLabel = visibleScrollableTableColumns[horizontalIndex] ?? '-';

  useEffect(() => {
    setHorizontalIndex((prev) => Math.min(prev, horizontalMax));
  }, [horizontalMax]);

  useEffect(() => {
    if (!gridApi) {
      return;
    }
    const anyApi = gridApi as unknown as {
      setQuickFilter?: (value: string) => void;
      setGridOption?: (key: string, value: unknown) => void;
    };
    if (typeof anyApi.setQuickFilter === 'function') {
      anyApi.setQuickFilter(flowFilter);
      return;
    }
    if (typeof anyApi.setGridOption === 'function') {
      anyApi.setGridOption('quickFilterText', flowFilter);
    }
  }, [flowFilter, gridApi]);

  useEffect(() => {
    if (!gridApi) {
      return;
    }
    const hidden = tableColumnIds.filter((id) => !visibleTableIdSet.has(id));
    const shown = tableColumnIds.filter((id) => visibleTableIdSet.has(id));
    setColumnsVisible(gridApi, hidden, false);
    setColumnsVisible(gridApi, shown, true);
    replaySavedWidths(gridApi);
  }, [gridApi, replaySavedWidths, tableColumnIds, visibleTableIdSet]);

  useEffect(() => {
    if (!gridApi) {
      return;
    }
    const colId = visibleScrollableTableColumns[horizontalIndex];
    if (!colId) {
      return;
    }
    const anyApi = gridApi as unknown as {
      ensureColumnVisible?: (
        key: string,
        position?: 'auto' | 'start' | 'middle' | 'end',
      ) => void;
    };
    anyApi.ensureColumnVisible?.(colId, 'start');
  }, [gridApi, horizontalIndex, visibleScrollableTableColumns]);

  const onGridReady = useCallback((event: GridReadyEvent<CrudRow>) => {
    setGridApi(event.api);
    replaySavedWidths(event.api);
  }, [replaySavedWidths]);

  const onColumnResized = useCallback(
    (event: ColumnResizedEvent<CrudRow>) => {
      if (!event.finished) {
        return;
      }
      if (event.source && NON_USER_RESIZE_SOURCES.has(event.source)) {
        return;
      }

      const column = event.column;
      if (column) {
        widthByColIdRef.current[column.getColId()] = normalizedColumnWidth(
          column.getColId(),
          column.getActualWidth(),
        );
      } else if (event.columns && event.columns.length > 0) {
        for (const col of event.columns) {
          widthByColIdRef.current[col.getColId()] = normalizedColumnWidth(
            col.getColId(),
            col.getActualWidth(),
          );
        }
      } else {
        return;
      }
      persistWidths(widthByColIdRef.current);
    },
    [persistWidths],
  );

  const onRowClicked = useCallback(
    (event: RowClickedEvent<CrudRow>) => {
      if (skipRowNavigationRef.current) {
        skipRowNavigationRef.current = false;
        return;
      }
      if (!event.data?.flowId) {
        return;
      }
      navigate(`/flows/${encodeURIComponent(event.data.flowId)}`);
    },
    [navigate],
  );

  const onCellClicked = useCallback(
    (event: CellClickedEvent<CrudRow>) => {
      const tableName = event.column.getColId();
      if (!tableColumnIdSet.has(tableName)) {
        return;
      }

      const ops = String(event.value ?? '-');
      if (ops === '-' || !event.data?.flowId) {
        return;
      }

      skipRowNavigationRef.current = true;
      navigate(
        `/tables/${encodeURIComponent(tableName)}?flow=${encodeURIComponent(event.data.flowId)}`,
      );
    },
    [navigate, tableColumnIdSet],
  );

  const onExportCsv = useCallback(() => {
    if (!gridApi) {
      return;
    }
    const anyApi = gridApi as unknown as {
      exportDataAsCsv?: (params: { allColumns: boolean; onlySelected: boolean }) => void;
    };
    anyApi.exportDataAsCsv?.({ allColumns: false, onlySelected: false });
  }, [gridApi]);

  const onHorizontalIndexChange = useCallback((value: number) => {
    setHorizontalIndex(value);
  }, []);

  const densityConfig = DENSITY_CONFIG[density];
  const runtimeHeatAvailable = !!runtimeBaseUrl;

  return (
    <section className="page crud-page">
      <h1>CRUD Matrix / CRUD 矩阵</h1>
      <p className="subtle">Structured Explorer from /data/index.json (no markdown parsing).</p>

      {loading && <p>Loading CRUD matrix... / 正在加载 CRUD 矩阵...</p>}

      {error && <p className="error">Failed to load CRUD matrix / 加载 CRUD 矩阵失败: {error}</p>}
      {!error && runtimeBaseUrl && runtimeWarning && (
        <p className="error">
          Runtime overlay warning: {runtimeWarning}
          {' '}（接口不可用时会自动退回 design-only）
        </p>
      )}
      {!error && runtimeBaseUrl && runtimeLoading && (
        <p className="subtle">Loading runtime heat... / 正在加载运行热度...</p>
      )}
      {!error && !runtimeBaseUrl && (
        <p className="subtle">
          Runtime heat disabled. Set Runtime URL in Settings to enable.
          {' '} / 未配置 Runtime URL，当前为纯设计视图。
        </p>
      )}

      {!loading && !error && data && (
        <>
          <CrudToolbar
            fontSize={fontSize}
            density={density}
            hideEmptyColumns={hideEmptyColumns}
            showRuntimeHeat={showRuntimeHeat}
            runtimeHeatAvailable={runtimeHeatAvailable}
            flowFilter={flowFilter}
            columnFilter={columnFilter}
            horizontalIndex={horizontalIndex}
            horizontalMax={horizontalMax}
            horizontalLabel={horizontalLabel}
            flowCount={data.flows.length}
            tableCount={data.tables.length}
            crudEdgeCount={data.crudEdges.length}
            onFontSizeChange={setFontSize}
            onDensityChange={setDensity}
            onHideEmptyColumnsChange={setHideEmptyColumns}
            onShowRuntimeHeatChange={setShowRuntimeHeat}
            onFlowFilterChange={setFlowFilter}
            onColumnFilterChange={setColumnFilter}
            onHorizontalIndexChange={onHorizontalIndexChange}
            onExportCsv={onExportCsv}
          />

          <div
            className="ag-theme-quartz crud-grid-theme"
            style={
              {
                '--pf-crud-font-size': `${fontSize}px`,
                height: '72vh',
                width: '100%',
              } as CSSProperties
            }
          >
            <AgGridReact<CrudRow>
              theme="legacy"
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={{ sortable: true, resizable: true }}
              rowHeight={densityConfig.rowHeight}
              headerHeight={densityConfig.headerHeight}
              suppressRowTransform={false}
              onGridReady={onGridReady}
              onColumnResized={onColumnResized}
              onRowClicked={onRowClicked}
              onCellClicked={onCellClicked}
              getRowId={(params) => params.data.flowId}
              getRowClass={(params) => {
                if (!showRuntimeHeat) {
                  return '';
                }
                const flowId = params.data?.flowId;
                if (!flowId) {
                  return '';
                }
                const metric = runtimeFlowMetrics[flowId];
                if (!metric || metric.heat <= 0) {
                  return '';
                }
                if (metric.failed > 0) {
                  return 'crud-row-runtime-failed';
                }
                return 'crud-row-runtime-hot';
              }}
              animateRows={false}
            />
          </div>
        </>
      )}
    </section>
  );
}
