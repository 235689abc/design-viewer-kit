declare module 'svg-pan-zoom' {
  export type SvgPanZoomInstance = {
    fit: () => void;
    center: () => void;
    resetZoom: () => void;
    destroy: () => void;
  };

  export type SvgPanZoomOptions = {
    fit?: boolean;
    center?: boolean;
    zoomEnabled?: boolean;
    mouseWheelZoomEnabled?: boolean;
    minZoom?: number;
    maxZoom?: number;
    controlIconsEnabled?: boolean;
    dblClickZoomEnabled?: boolean;
    preventMouseEventsDefault?: boolean;
  };

  export default function svgPanZoom(
    elementOrSelector: SVGElement | string,
    options?: SvgPanZoomOptions,
  ): SvgPanZoomInstance;
}
