import type { ProjectData, TableRecord } from './useProjectData';

export type DatabaseDiagramResult = {
  mermaidCode: string;
  tableCount: number;
  columnCount: number;
  relationCount: number;
  indexCount: number;
};

export function isDatabaseTable(table: TableRecord): boolean {
  if (table.alias_of) {
    return false;
  }
  if (table.datastore_id) {
    return true;
  }
  if ((table.columns?.length ?? 0) > 0) {
    return true;
  }
  const kind = (table.kind ?? '').trim().toLowerCase();
  return /(^|[-_])(postgres|postgresql|mysql|mariadb|sqlite|sql|database|db)([-_]|$)/.test(kind)
    || kind === 'table';
}

function safeId(prefix: string, raw: string): string {
  const normalized = raw.replace(/[^A-Za-z0-9_]/g, '_') || 'unknown';
  return `${prefix}_${normalized}`;
}

function safeColumnId(raw: string): string {
  const normalized = raw.replace(/[^A-Za-z0-9_]/g, '_') || 'column';
  return /^\d/.test(normalized) ? `c_${normalized}` : normalized;
}

function safeType(raw: string): string {
  const normalized = raw.trim().replace(/[^A-Za-z0-9_[\]]/g, '_');
  if (!normalized) {
    return 'unknown';
  }
  return /^\d/.test(normalized) ? `type_${normalized}` : normalized;
}

function escapeLabel(raw: string): string {
  return raw.replace(/"/g, '\\"');
}

function buildEntityIds(tables: TableRecord[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const table of tables) {
    const base = safeId('T', table.name);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    result.set(table.name, candidate);
  }
  return result;
}

export function buildDatabaseMermaid(
  data: ProjectData | null,
  selectedTableNames?: Set<string>,
): DatabaseDiagramResult {
  const tables = (data?.tables ?? []).filter(
    (table) => isDatabaseTable(table) && (!selectedTableNames || selectedTableNames.has(table.name)),
  );
  const tableNames = new Set(tables.map((table) => table.name));
  const entityIds = buildEntityIds(tables);
  const lines = ['erDiagram'];
  let columnCount = 0;
  let relationCount = 0;
  let indexCount = 0;

  for (const table of tables) {
    const primaryKey = new Set(table.primary_key ?? []);
    const foreignKeyColumns = new Set(
      (table.foreign_keys ?? []).flatMap((foreignKey) => foreignKey.columns),
    );
    const singleColumnUniqueIndexes = new Set(
      (table.indexes ?? [])
        .filter((index) => index.unique && index.columns.length === 1)
        .map((index) => index.columns[0]),
    );
    indexCount += table.indexes?.length ?? 0;

    lines.push(`  ${entityIds.get(table.name) ?? safeId('T', table.name)} {`);
    for (const column of table.columns ?? []) {
      columnCount += 1;
      const keys: string[] = [];
      if (column.primary_key || primaryKey.has(column.name)) {
        keys.push('PK');
      }
      if (foreignKeyColumns.has(column.name)) {
        keys.push('FK');
      }
      if (column.unique || singleColumnUniqueIndexes.has(column.name)) {
        keys.push('UK');
      }
      const notes: string[] = [];
      if (column.nullable === false) {
        notes.push('NOT NULL');
      }
      if (column.default !== undefined && column.default !== '') {
        notes.push(`DEFAULT ${column.default}`);
      }
      if (column.notes) {
        notes.push(column.notes);
      }
      const keyText = keys.length > 0 ? ` ${keys.join(',')}` : '';
      const noteText = notes.length > 0 ? ` "${escapeLabel(notes.join('; '))}"` : '';
      lines.push(`    ${safeType(column.type)} ${safeColumnId(column.name)}${keyText}${noteText}`);
    }
    lines.push('  }');
  }

  for (const table of tables) {
    const columnsByName = new Map((table.columns ?? []).map((column) => [column.name, column]));
    for (const foreignKey of table.foreign_keys ?? []) {
      if (!tableNames.has(foreignKey.references_table) || foreignKey.columns.length === 0) {
        continue;
      }
      relationCount += 1;
      const required = foreignKey.columns.every(
        (columnName) => columnsByName.get(columnName)?.nullable === false,
      );
      const parentCardinality = required ? '||' : 'o|';
      const relationLabel = foreignKey.name || foreignKey.columns.join(',');
      lines.push(
        `  ${entityIds.get(foreignKey.references_table)} ${parentCardinality}--o{ `
          + `${entityIds.get(table.name)} : "${escapeLabel(relationLabel)}"`,
      );
    }
  }

  return {
    mermaidCode: `${lines.join('\n')}\n`,
    tableCount: tables.length,
    columnCount,
    relationCount,
    indexCount,
  };
}
