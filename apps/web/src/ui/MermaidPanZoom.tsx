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

let mermaidInitialized = false;
let renderSeq = 0;

function ensureMermaidInit() {
  if (mermaidInitialized) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false,
    },
    sequence: {
      useMaxWidth: false,
    },
  });
  mermaidInitialized = true;
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
  svgEl.setAttribute(
    'viewBox',
    `${merged.minX - pad} ${merged.minY - pad} ${width + pad * 2} ${height + pad * 2}`,
  );
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
}

export const MermaidPanZoom = forwardRef<MermaidPanZoomHandle, MermaidPanZoomProps>(
  function MermaidPanZoom(props, ref) {
    const { title, mermaidCode, height = '70vh', onReady } = props;
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
        panZoomRef.current.destroy();
        panZoomRef.current = null;
      }
    }, []);

    const getCurrentSvgElement = useCallback(() => {
      return containerRef.current?.querySelector('svg') ?? null;
    }, []);

    const fitToViewBox = useCallback(() => {
      if (!panZoomRef.current) {
        return;
      }
      const panZoom = panZoomRef.current;
      panZoom.resize?.();
      panZoom.updateBBox?.();

      const sizes = panZoom.getSizes?.();
      if (!sizes || !sizes.viewBox) {
        panZoom.fit();
        panZoom.center();
        return;
      }

      const viewportWidth = Math.max(1, sizes.width);
      const viewportHeight = Math.max(1, sizes.height);
      const boxWidth = Math.max(1, sizes.viewBox.width);
      const boxHeight = Math.max(1, sizes.viewBox.height);
      const scale = Math.min(viewportWidth / boxWidth, viewportHeight / boxHeight);
      if (!Number.isFinite(scale) || scale <= 0) {
        panZoom.fit();
        panZoom.center();
        return;
      }

      panZoom.zoom(scale);
      panZoom.pan({
        x: (viewportWidth - boxWidth * scale) / 2 - sizes.viewBox.x * scale,
        y: (viewportHeight - boxHeight * scale) / 2 - sizes.viewBox.y * scale,
      });
    }, []);

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
          ensureMermaidInit();
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
    }, [destroyPanZoom, fitToViewBox, mermaidCode, onReady]);

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
