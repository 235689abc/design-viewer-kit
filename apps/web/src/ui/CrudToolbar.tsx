import { useLocale, bi } from '../app/i18n';

type Density = 'compact' | 'normal' | 'comfortable';

type CrudToolbarProps = {
  fontSize: number;
  density: Density;
  hideEmptyColumns: boolean;
  showRuntimeHeat: boolean;
  runtimeHeatAvailable: boolean;
  flowFilter: string;
  columnFilter: string;
  horizontalIndex: number;
  horizontalMax: number;
  horizontalLabel: string;
  flowCount: number;
  tableCount: number;
  crudEdgeCount: number;
  onFontSizeChange: (value: number) => void;
  onDensityChange: (value: Density) => void;
  onHideEmptyColumnsChange: (value: boolean) => void;
  onShowRuntimeHeatChange: (value: boolean) => void;
  onFlowFilterChange: (value: string) => void;
  onColumnFilterChange: (value: string) => void;
  onHorizontalIndexChange: (value: number) => void;
  onExportCsv: () => void;
};

export function CrudToolbar(props: CrudToolbarProps) {
  const {
    fontSize,
    density,
    hideEmptyColumns,
    showRuntimeHeat,
    runtimeHeatAvailable,
    flowFilter,
    columnFilter,
    horizontalIndex,
    horizontalMax,
    horizontalLabel,
    flowCount,
    tableCount,
    crudEdgeCount,
    onFontSizeChange,
    onDensityChange,
    onHideEmptyColumnsChange,
    onShowRuntimeHeatChange,
    onFlowFilterChange,
    onColumnFilterChange,
    onHorizontalIndexChange,
    onExportCsv,
  } = props;
  const [locale] = useLocale();

  return (
    <div className="crud-toolbar">
      <div className="crud-toolbar-group">
        <label htmlFor="crud-font-size">
          {bi(locale, 'Font', '字体')}: {fontSize}px
        </label>
        <input
          id="crud-font-size"
          type="range"
          min={11}
          max={20}
          value={fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
        />
      </div>

      <div className="crud-toolbar-group">
        <label htmlFor="crud-density">{bi(locale, 'Density', '密度')}</label>
        <select
          id="crud-density"
          value={density}
          onChange={(e) => onDensityChange(e.target.value as Density)}
        >
          <option value="compact">{bi(locale, 'Compact', '紧凑')}</option>
          <option value="normal">{bi(locale, 'Normal', '标准')}</option>
          <option value="comfortable">{bi(locale, 'Comfortable', '舒适')}</option>
        </select>
      </div>

      <div className="crud-toolbar-group">
        <label htmlFor="crud-flow-filter">{bi(locale, 'Flow Filter', '流程筛选')}</label>
        <input
          id="crud-flow-filter"
          type="text"
          value={flowFilter}
          placeholder={bi(locale, 'flow id, name, or owner', '流程 ID/名称/归属')}
          onChange={(e) => onFlowFilterChange(e.target.value)}
        />
      </div>

      <div className="crud-toolbar-group">
        <label htmlFor="crud-column-filter">{bi(locale, 'Column Filter', '列筛选')}</label>
        <input
          id="crud-column-filter"
          type="text"
          value={columnFilter}
          placeholder="orders"
          onChange={(e) => onColumnFilterChange(e.target.value)}
        />
      </div>

      <div className="crud-toolbar-group crud-toolbar-slider-wide">
        <label htmlFor="crud-horizontal-slider">
          {bi(locale, 'Horizontal Pan', '横向滑动')}: {horizontalLabel}
        </label>
        <input
          id="crud-horizontal-slider"
          type="range"
          min={0}
          max={Math.max(horizontalMax, 0)}
          value={Math.min(horizontalIndex, Math.max(horizontalMax, 0))}
          disabled={horizontalMax <= 0}
          onChange={(e) => onHorizontalIndexChange(Number(e.target.value))}
        />
      </div>

      <div className="crud-toolbar-group crud-toolbar-checkbox">
        <label htmlFor="crud-hide-empty">
          <input
            id="crud-hide-empty"
            type="checkbox"
            checked={hideEmptyColumns}
            onChange={(e) => onHideEmptyColumnsChange(e.target.checked)}
          />
          {bi(locale, 'Hide empty columns', '隐藏空列')}
        </label>
      </div>

      <div className="crud-toolbar-group crud-toolbar-checkbox">
        <label htmlFor="crud-show-runtime-heat">
          <input
            id="crud-show-runtime-heat"
            type="checkbox"
            checked={showRuntimeHeat}
            disabled={!runtimeHeatAvailable}
            onChange={(e) => onShowRuntimeHeatChange(e.target.checked)}
          />
          {bi(locale, 'Show runtime heat', '显示运行热度')}
        </label>
      </div>

      <button type="button" className="crud-btn" onClick={onExportCsv}>
        {bi(locale, 'Export CSV', '导出 CSV')}
      </button>

      <div className="crud-toolbar-meta">
        <span>{bi(locale, 'flows', '流程')}: {flowCount}</span>
        <span>{bi(locale, 'tables', '表')}: {tableCount}</span>
        <span>crudEdges: {crudEdgeCount}</span>
      </div>
    </div>
  );
}
