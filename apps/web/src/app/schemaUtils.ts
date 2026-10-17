const PRIORITY_SCHEMAS = ['public', 'core', 'domain', 'integration'] as const;

const SCHEMA_ZH_MAP: Record<string, string> = {
  core: '核心',
  domain: '领域',
  integration: '集成',
  public: '公共',
};

export function schemaOf(tableName: string): string {
  const trimmed = (tableName ?? '').trim();
  if (!trimmed) {
    return 'public';
  }
  if (trimmed.includes('.')) {
    return trimmed.split('.', 1)[0] || 'public';
  }
  return 'public';
}

export function schemaDisplayLabel(schemaName: string): string {
  const normalized = schemaName.trim();
  const zh = SCHEMA_ZH_MAP[normalized];
  return zh ? `${normalized} / ${zh}` : normalized;
}

export function schemaNodeLabel(schemaName: string): string {
  const normalized = schemaName.trim();
  const zh = SCHEMA_ZH_MAP[normalized];
  return zh ? `${normalized}<br/>${zh}` : normalized;
}

export function orderedSchemas(schemaNames: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const name of schemaNames) {
    const normalized = (name ?? '').trim() || 'public';
    unique.add(normalized);
  }

  const base = Array.from(unique);
  const prioritized = PRIORITY_SCHEMAS.filter((schema) => unique.has(schema));
  const others = base
    .filter((schema) => !PRIORITY_SCHEMAS.includes(schema as (typeof PRIORITY_SCHEMAS)[number]))
    .sort((a, b) => a.localeCompare(b));
  return [...prioritized, ...others];
}
