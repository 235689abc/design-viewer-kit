export type Service = {
  id: string;
  name_en: string;
  name_zh: string;
  name?: string;
  system_id?: string;
  owner?: string;
  source_ref?: string;
};

export type Datastore = {
  id: string;
  name: string;
  engine: string;
  schema?: string;
  state?: string;
  source_ref?: string;
  notes?: string;
};

export type TableColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string;
  primary_key?: boolean;
  unique?: boolean;
  notes?: string;
};

export type TableForeignKey = {
  columns: string[];
  references_table: string;
  references_columns: string[];
  name?: string;
  on_delete?: string;
  on_update?: string;
};

export type TableIndex = {
  name: string;
  columns: string[];
  unique?: boolean;
  where?: string;
};

export type Table = {
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
  columns?: TableColumn[];
  primary_key?: string[];
  foreign_keys?: TableForeignKey[];
  indexes?: TableIndex[];
};

export type FlowWrite = {
  table: string;
  op: string;
};

export type Flow = {
  id: string;
  name_en: string;
  name_zh: string;
  owner_service: string;
  doc_path: string;
  introduced_in: string;
  reads: string[];
  writes: FlowWrite[];
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

export type CrudEdge = {
  flow_id: string;
  table: string;
  ops: string;
};

export type DesignIndex = {
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
  services: Service[];
  datastores?: Datastore[];
  tables: Table[];
  flows: Flow[];
  crudEdges: CrudEdge[];
  diagrams: {
    l0_mermaid: string;
    flow_mermaid: Record<string, string>;
    database_mermaid?: string;
  };
};
