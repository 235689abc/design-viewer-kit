import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  CrudEdge,
  DesignIndex,
  Flow,
  FlowWrite,
  Service,
  Table,
} from '@design-viewer/schema';

// 类型单源:以 packages/schema 为准,此处仅保留历史别名供既有引用方零迁移。
export type ServiceRecord = Service;
export type TableRecord = Table;
export type FlowRecord = Flow;
export type FlowWriteRecord = FlowWrite;
export type CrudEdgeRecord = CrudEdge;
export type ProjectData = DesignIndex;

type UseProjectDataResult = {
  data: ProjectData | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const DEFAULT_DATA_URL = '/data/index.json';
const ProjectDataContext = createContext<UseProjectDataResult | null>(null);

function getDataUrl(): string {
  const envValue = (import.meta.env.VITE_DV_DATA_URL ?? '').trim();
  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('data')?.trim();
    if (fromQuery) {
      return fromQuery;
    }
  }
  return envValue || DEFAULT_DATA_URL;
}

async function fetchProjectData(signal?: AbortSignal): Promise<ProjectData> {
  const response = await fetch(getDataUrl(), { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as ProjectData;
}

export function ProjectDataProvider(props: { children: ReactNode }) {
  const { children } = props;
  const [data, setData] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const loadSeq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchProjectData(signal);
      if (loadSeq === loadSeqRef.current) {
        setData(json);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      if (loadSeq === loadSeqRef.current) {
        setError((err as Error).message || 'Unknown error');
      }
    } finally {
      if (loadSeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const value = useMemo<UseProjectDataResult>(
    () => ({ data, loading, error, reload }),
    [data, error, loading, reload],
  );

  return (
    <ProjectDataContext.Provider value={value}>
      {children}
    </ProjectDataContext.Provider>
  );
}

export function useProjectData(): UseProjectDataResult {
  const ctx = useContext(ProjectDataContext);
  if (!ctx) {
    throw new Error('useProjectData must be used within ProjectDataProvider');
  }
  return ctx;
}
