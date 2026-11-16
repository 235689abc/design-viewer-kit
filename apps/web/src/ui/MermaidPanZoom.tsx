import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import mermaid from 'mermaid';
import svgPanZoom from 'svg-pan-zoom';
import { useTheme, type Theme } from '../app/theme';

type MermaidStatus = 'idle' | 'rendered' | 'error';

export type MermaidPanZoomReadyInfo = {
  status: MermaidStatus;
  error?: string;
};

export type MermaidPanZoomHandle = {
  fit: () => void;
  reset: () => void;
  exportSvg: (fileName: string) => void;
};

type MermaidPanZoomProps = {
  title?: string;
  mermaidCode: string;
  height?: number | string;
  onReady?: (info: MermaidPanZoomReadyInfo) => void;
};

type PanZoomInstance = {
  fit: () => void;
  center: () => void;
  resetZoom: () => void;
  zoom: (scale: number) => void;
  pan: (point: { x: number; y: number }) => void;
  getSizes?: () => {
    width: number;
    height: number;
    realZoom: number;
    viewBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  resize?: () => void;
  updateBBox?: () => void;
  destroy: () => void;
};

// mermaid 调色与全站 --dv-* token 同源(亮/暗两套);initialize 幂等,可随主题重调
const MERMAID_THEME_VARIABLES: Record<Theme, Record<string, string>> = {
  light: {
    background: '#ffffff',
    primaryColor: '#eef1f5',
    primaryBorderColor: '#bcc5d2',
    primaryTextColor: '#1b2434',
    lineColor: '#8493a8',
    secondaryColor: '#e8eefc',
    secondaryBorderColor: '#1d4ed8',
    tertiaryColor: '#e5f4ea',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#f4f6f9',
    clusterBorder: '#d8dee7',
  },
  dark: {
    background: '#161d29',
    primaryColor: '#1e2735',
    primaryBorderColor: '#3d4a5f',
    primaryTextColor: '#e7ecf4',
    lineColor: '#71809a',
    secondaryColor: '#1c2942',
    secondaryBorderColor: '#8ab0ff',
    tertiaryColor: '#1d3328',
    edgeLabelBackground: '#161d29',
    clusterBkg: '#0f141d',
    clusterBorder: '#2b3648',
  },
};

let renderSeq = 0;

function ensureMermaidInit(theme: Theme) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: MERMAID_THEME_VARIABLES[theme],
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false,
    },
    sequence: {
      useMaxWidth: false,
    },
  });
}

function ensureSvgNamespaces(svgText: string): string {
  let out = svgText;
  if (!/xmlns=/.test(out)) {
    out = out.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/xmlns:xlink=/.test(out)) {
    out = out.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return out;
}

type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type SvgPoint = {
  x: number;
  y: number;
};

function mergeBBox(base: BBox | null, next: DOMRect): BBox {
  if (!base) {
    return {
      minX: next.x,
      minY: next.y,
      maxX: next.x + next.width,
      maxY: next.y + next.height,
    };
  }
  return {
    minX: Math.min(base.minX, next.x),
    minY: Math.min(base.minY, next.y),
    maxX: Math.max(base.maxX, next.x + next.width),
    maxY: Math.max(base.maxY, next.y + next.height),
  };
}

function mergeBBoxByPoints(base: BBox | null, points: SvgPoint[]): BBox | null {
  if (points.length === 0) {
    return base;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return base;
  }

  if (!base) {
    return { minX, minY, maxX, maxY };
  }
  return {
    minX: Math.min(base.minX, minX),
    minY: Math.min(base.minY, minY),
    maxX: Math.max(base.maxX, maxX),
    maxY: Math.max(base.maxY, maxY),
  };
}

function transformPoint(
  svgEl: SVGSVGElement,
  x: number,
  y: number,
  matrix: DOMMatrix | SVGMatrix | null,
): SvgPoint {
  const svgPoint = svgEl.createSVGPoint();
  svgPoint.x = x;
  svgPoint.y = y;
  if (!matrix) {
    return { x, y };
  }
  const transformed = svgPoint.matrixTransform(matrix);
  return { x: transformed.x, y: transformed.y };
}

function safeGetBBox(node: Element, svgEl: SVGSVGElement): BBox | null {
  const graphicsNode = node as unknown as SVGGraphicsElement;
  if (!graphicsNode || typeof graphicsNode.getBBox !== 'function') {
    return null;
  }
  try {
    const box = graphicsNode.getBBox();
    if (
      Number.isFinite(box.x) &&
      Number.isFinite(box.y) &&
      Number.isFinite(box.width) &&
      Number.isFinite(box.height)
    ) {
      const matrix = typeof graphicsNode.getCTM === 'function' ? graphicsNode.getCTM() : null;
      const points = [
        transformPoint(svgEl, box.x, box.y, matrix),
        transformPoint(svgEl, box.x + box.width, box.y, matrix),
        transformPoint(svgEl, box.x, box.y + box.height, matrix),
        transformPoint(svgEl, box.x + box.width, box.y + box.height, matrix),
      ];
      return mergeBBoxByPoints(null, points);
    }
  } catch {
    // Ignore nodes that cannot provide a bbox.
  }
  return null;
}

function normalizeSvgViewBox(svgEl: SVGSVGElement) {
  const candidates = Array.from(
    svgEl.querySelectorAll(
      [
        'g.node',
        'g.edgePath',
        'g.edgeLabel',
        'g.cluster',
        'path.flowchart-link',
        'polygon.arrowheadPath',
      ].join(','),
    ),
  );

  let merged: BBox | null = null;
  for (const node of candidates) {
    const box = safeGetBBox(node, svgEl);
    if (!box) {
      continue;
    }
    merged = mergeBBoxByPoints(merged, [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.minX, y: box.maxY },
      { x: box.maxX, y: box.maxY },
    ]);
  }

  if (!merged) {
    const rootGroup = svgEl.querySelector('g');
    const rootBox = rootGroup ? safeGetBBox(rootGroup, svgEl) : null;
    if (!rootBox) {
      return;
    }
    merged = rootBox;
  }

  const pad = 24;
  const width = Math.max(1, merged.maxX - merged.minX);
  const height = Math.max(1, merged.maxY - merged.minY);
  const vbValue = `${merged.minX - pad} ${merged.minY - pad} ${width + pad * 2} ${height + pad * 2}`;
  svgEl.setAttribute('viewBox', vbValue);
  // svg-pan-zoom init 会移除 viewBox 并按 init 瞬间的几何建立内部状态(之后会陈旧);
  // dataset 里留一份归一化真值,fit 时作为 getBBox 的兜底。
  svgEl.dataset.dvViewBox = vbValue;
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
}

export const MermaidPanZoom = forwardRef<MermaidPanZoomHandle, MermaidPanZoomProps>(
  function MermaidPanZoom(props, ref) {
    const { title, mermaidCode, height = '70vh', onReady } = props;
    const [theme] = useTheme();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const panZoomRef = useRef<PanZoomInstance | null>(null);
    const [status, setStatus] = useState<MermaidStatus>('idle');
    const [errorText, setErrorText] = useState('');

    const heightStyle = useMemo(
      () => (typeof height === 'number' ? `${height}px` : height),
      [height],
    );

    const destroyPanZoom = useCallback(() => {
      if (panZoomRef.current) {
        try {
          panZoomRef.current.destroy();
        } catch {
          // svg-pan-zoom 在零尺寸/未布局 SVG 上 destroy 会抛 SVGMatrix 不可逆;
          // 实例随 DOM 卸载一并丢弃即可,不让异常冒泡炸掉 React 树。
        }
        panZoomRef.current = null;
      }
    }, []);

    const getCurrentSvgElement = useCallback(() => {
      return containerRef.current?.querySelector('svg') ?? null;
    }, []);

    const fitToViewBox = useCallback(() => {
      const panZoom = panZoomRef.current;
      if (!panZoom) {
        return;
      }
      try {
        panZoom.resize?.();
        panZoom.updateBBox?.();
        const sizes = panZoom.getSizes?.();
        const svgEl = getCurrentSvgElement();

        // 内容几何真值:现场重算内容包围盒(字体晚到会改变 mermaid 文本度量,
        // init 时存的 dataset viewBox 会失真);dataset 与 pan-zoom sizes 逐级兜底。
        let boxX = 0;
        let boxY = 0;
        let boxWidth = 1;
        let boxHeight = 1;
        let geometryReady = false;
        const inner = svgEl?.querySelector('g') ?? null;
        if (inner) {
          try {
            const box = inner.getBBox();
            if (box.width > 0 && box.height > 0) {
              boxX = box.x;
              boxY = box.y;
              boxWidth = box.width;
              boxHeight = box.height;
              geometryReady = true;
            }
          } catch {
            // getBBox 不可用(未渲染等):走兜底链
          }
        }
        if (!geometryReady) {
          const parts = (svgEl?.dataset.dvViewBox ?? '')
            .split(/[\s,]+/)
            .map(Number);
          if (parts.length === 4 && parts.every(Number.isFinite)) {
            boxX = parts[0];
            boxY = parts[1];
            boxWidth = parts[2];
            boxHeight = parts[3];
            geometryReady = true;
          } else if (sizes?.viewBox) {
            boxX = sizes.viewBox.x;
            boxY = sizes.viewBox.y;
            boxWidth = sizes.viewBox.width;
            boxHeight = sizes.viewBox.height;
            geometryReady = true;
          }
        }
        if (!geometryReady) {
          panZoom.fit();
          panZoom.center();
          return;
        }

        // fit 参照=SVG 自身可视尺寸(容器可能比 svg 宽,用容器尺寸会把内容 fit 出可视区)
        const viewportWidth = Math.max(1, svgEl?.clientWidth || sizes?.width || 1);
        const viewportHeight = Math.max(1, svgEl?.clientHeight || sizes?.height || 1);
        const scale = Math.min(
          viewportWidth / Math.max(1, boxWidth),
          viewportHeight / Math.max(1, boxHeight),
        );
        if (!Number.isFinite(scale) || scale <= 0) {
          panZoom.fit();
          panZoom.center();
          return;
        }

        panZoom.zoom(scale);
        panZoom.pan({
          x: (viewportWidth - boxWidth * scale) / 2 - boxX * scale,
          y: (viewportHeight - boxHeight * scale) / 2 - boxY * scale,
        });
      } catch {
        // 矩阵不可逆等异常:跳过本次 fit,保留静态 SVG
      }
    }, [getCurrentSvgElement]);

    const fit = useCallback(() => {
      fitToViewBox();
    }, [fitToViewBox]);

    const reset = useCallback(() => {
      if (!panZoomRef.current) {
        return;
      }
      panZoomRef.current.resetZoom();
      fitToViewBox();
    }, [fitToViewBox]);

    const exportSvg = useCallback(
      (fileName: string) => {
        const svgEl = getCurrentSvgElement();
        if (!svgEl) {
          return;
        }
        const svgMarkup = ensureSvgNamespaces(svgEl.outerHTML);
        const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      [getCurrentSvgElement],
    );

    useImperativeHandle(
      ref,
      () => ({
        fit,
        reset,
        exportSvg,
      }),
      [exportSvg, fit, reset],
    );

    useEffect(() => {
      let cancelled = false;
      const runId = ++renderSeq;

      async function renderDiagram() {
        const host = containerRef.current;
        if (!host) {
          return;
        }

        destroyPanZoom();
        host.innerHTML = '';
        setStatus('idle');
        setErrorText('');

        const code = mermaidCode.trim();
        if (!code) {
          setStatus('error');
          setErrorText('No diagram source found / 未找到图源码');
          onReady?.({ status: 'error', error: 'No diagram source found' });
          return;
        }

        try {
          ensureMermaidInit(theme);
          const { svg } = await mermaid.render(`design_viewer_${runId}`, code);
          if (cancelled || runId !== renderSeq) {
            return;
          }

          host.innerHTML = ensureSvgNamespaces(svg);
          const svgEl = host.querySelector('svg');
          if (!svgEl) {
            throw new Error('Rendered SVG element not found');
          }
          const panZoomOptions: any = {
            fit: true,
            center: true,
            zoomEnabled: true,
            mouseWheelZoomEnabled: true,
            minZoom: 0.2,
            maxZoom: 20,
            contain: true,
            controlIconsEnabled: false,
            dblClickZoomEnabled: true,
            preventMouseEventsDefault: false,
          };
          panZoomRef.current = svgPanZoom(svgEl, panZoomOptions) as unknown as PanZoomInstance;

          fitToViewBox();

          setStatus('rendered');
          onReady?.({ status: 'rendered' });
        } catch (err) {
          if (cancelled) {
            return;
          }
          const message = (err as Error).message || 'Unknown mermaid render error';
          setStatus('error');
          setErrorText(message);
          onReady?.({ status: 'error', error: message });
        }
      }

      void renderDiagram();

      return () => {
        cancelled = true;
        destroyPanZoom();
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
      };
    }, [destroyPanZoom, fitToViewBox, mermaidCode, onReady, theme]);

    useEffect(() => {
      const host = containerRef.current;
      if (!host) {
        return;
      }

      let rafId = 0;
      let settleTimer = 0;
      const refitAfterResize = () => {
        if (!panZoomRef.current) {
          return;
        }
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        if (settleTimer) {
          window.clearTimeout(settleTimer);
        }
        rafId = requestAnimationFrame(() => {
          if (!panZoomRef.current) {
            return;
          }
          fitToViewBox();
          // Fullscreen transitions can settle after first frame on some browsers.
          settleTimer = window.setTimeout(() => {
            if (!panZoomRef.current) {
              return;
            }
            fitToViewBox();
          }, 120);
        });
      };

      const observer = new ResizeObserver(() => {
        refitAfterResize();
      });
      observer.observe(host);
      document.addEventListener('fullscreenchange', refitAfterResize);

      return () => {
        observer.disconnect();
        document.removeEventListener('fullscreenchange', refitAfterResize);
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        if (settleTimer) {
          window.clearTimeout(settleTimer);
        }
      };
    }, [fitToViewBox]);

    return (
      <div className="mermaid-panzoom">
        {title ? <h3 className="mermaid-panzoom-title">{title}</h3> : null}
        {status === 'error' ? <p className="error">{errorText}</p> : null}
        <div
          ref={containerRef}
          className="mermaid-panzoom-canvas"
          style={{ height: heightStyle }}
        />
      </div>
    );
  },
);
