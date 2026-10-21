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

export type ServiceRecord = {
  id: string;
  name_en: string;
  name_zh: string;
  name?: string;
  system_id?: string;
  owner?: string;
  source_ref?: string;
};

export type DatastoreRecord = {
  id: string;
  name: string;
  engine: string;
  schema?: string;
  state?: string;
  source_ref?: string;
  notes?: string;
};

export type TableColumnRecord = {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string;
  primary_key?: boolean;
  unique?: boolean;
  notes?: string;
};

export type TableForeignKeyRecord = {
  columns: string[];
  references_table: string;
  references_columns: string[];
  name?: string;
  on_delete?: string;
  on_update?: string;
};

export type TableIndexRecord = {
  name: string;
  columns: string[];
  unique?: boolean;
  where?: string;
};

export type TableRecord = {
  name: string;
  state: string;
  owner_service: string;
  introduced_in: string;
  alias_of?: string;
  kind?: string;
  label_en?: string;
  label_zh?: string;
  notes?: string;
  source_ref?: string;
  datastore_id?: string;
  columns?: TableColumnRecord[];
  primary_key?: string[];
  foreign_keys?: TableForeignKeyRecord[];
  indexes?: TableIndexRecord[];
};

export type FlowWriteRecord = {
  table: string;
  op: string;
};

export type FlowRecord = {
  id: string;
  name_en: string;
  name_zh: string;
  owner_service: string;
  doc_path: string;
  introduced_in: string;
  reads: string[];
  writes: FlowWriteRecord[];
  events_appended: string[];
  idempotency_key: string;
  actors?: Array<string | Record<string, unknown>>;
  outbox?: Record<string, unknown>;
  event_table?: string;
  outbox_table?: string;
  finality?: string;
  kind?: string;
  notes?: string;
  source_ref?: string;
  deprecated?: boolean;
  replaced_by?: string;
  aliases?: string[];
};

export type CrudEdgeRecord = {
  flow_id: string;
  table: string;
  ops: string;
};

export type ProjectData = {
  meta: {
    project: string;
    generated_at: string;
    source_flows_json: string;
    source_generated_dir: string;
    schema_version?: string;
    source_revision?: string;
    policy?: {
      event_table?: string;
      outbox_table?: string;
      processed_events_table?: string;
      audit_schemas?: string[];
      allow_multi_writer_tables?: string[];
      runtime_paths?: {
        events?: string;
        outbox?: string;
        flow_recent?: string;
      };
    };
  };
  services: ServiceRecord[];
  datastores?: DatastoreRecord[];
  tables: TableRecord[];
  flows: FlowRecord[];
  crudEdges: CrudEdgeRecord[];
  diagrams: {
    l0_mermaid: string;
    flow_mermaid: Record<string, string>;
    database_mermaid?: string;
  };
};

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
