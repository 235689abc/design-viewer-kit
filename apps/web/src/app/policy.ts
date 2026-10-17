import type { ProjectData } from './useProjectData';

export type ViewerPolicy = {
  eventTable: string;
  outboxTable: string;
  processedEventsTable: string;
  allowMultiWriterTables: Set<string>;
  auditSchemas: Set<string>;
};

export function getViewerPolicy(data: ProjectData | null): ViewerPolicy {
  const configured = data?.meta.policy;
  const eventTable = configured?.event_table?.trim() || 'events';
  const outboxTable = configured?.outbox_table?.trim() || 'outbox';
  const processedEventsTable = configured?.processed_events_table?.trim() || 'processed_events';
  const configuredMultiWriterTables = (configured?.allow_multi_writer_tables ?? [])
    .filter((table): table is string => typeof table === 'string')
    .map((table) => table.trim())
    .filter(Boolean);
  const allowMultiWriter = new Set<string>([
    eventTable,
    outboxTable,
    processedEventsTable,
    ...configuredMultiWriterTables,
  ]);

  // Schema-wide exemptions are opt-in. An event table in the public schema
  // must not make every public business table a policy table.
  const auditSchemas = new Set<string>(
    (configured?.audit_schemas ?? [])
      .filter((schema): schema is string => typeof schema === 'string')
      .map((schema) => schema.trim())
      .filter(Boolean),
  );
  return {
    eventTable,
    outboxTable,
    processedEventsTable,
    allowMultiWriterTables: allowMultiWriter,
    auditSchemas,
  };
}

export function isPolicyTable(tableName: string, policy: ViewerPolicy): boolean {
  const schema = tableName.includes('.') ? tableName.split('.', 1)[0] : 'public';
  return policy.allowMultiWriterTables.has(tableName) || policy.auditSchemas.has(schema);
}
