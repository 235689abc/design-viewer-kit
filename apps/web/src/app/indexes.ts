import type {
  CrudEdgeRecord,
  FlowRecord,
  ProjectData,
  ServiceRecord,
  TableRecord,
} from './useProjectData';

const OPS_ORDER = ['C', 'R', 'U', 'D'];

export type ServiceNameRecord = Pick<ServiceRecord, 'name_en' | 'name_zh'>;

export type ProjectIndexes = {
  mapServices: Map<string, ServiceNameRecord>;
  flowById: Map<string, FlowRecord>;
  tableByName: Map<string, TableRecord>;
  edgesByTable: Map<string, CrudEdgeRecord[]>;
  edgesByFlow: Map<string, Map<string, string>>;
  canonicalTableName: (tableName: string) => string;
};

function mergeOps(existing: string, incoming: string): string {
  const opSet = new Set<string>();
  for (const op of `${existing}${incoming}`) {
    const normalized = op.toUpperCase();
    if (OPS_ORDER.includes(normalized)) {
      opSet.add(normalized);
    }
  }
  return OPS_ORDER.filter((op) => opSet.has(op)).join('');
}

export function hasReadOps(ops: string): boolean {
  return ops.includes('R');
}

export function hasWriteOps(ops: string): boolean {
  return ops.includes('C') || ops.includes('U') || ops.includes('D');
}

export function getServiceDisplay(
  ownerService: string,
  serviceMap: Map<string, ServiceNameRecord>,
): string {
  const svc = serviceMap.get(ownerService);
  return svc ? `${svc.name_en} / ${svc.name_zh}` : ownerService || '-';
}

export function buildProjectIndexes(data: ProjectData | null): ProjectIndexes {
  const mapServices = new Map<string, ServiceNameRecord>();
  const flowById = new Map<string, FlowRecord>();
  const tableByName = new Map<string, TableRecord>();
  const edgesByTable = new Map<string, CrudEdgeRecord[]>();
  const edgesByFlow = new Map<string, Map<string, string>>();
  const aliasByName = new Map<string, string>();

  if (!data) {
    return {
      mapServices,
      flowById,
      tableByName,
      edgesByTable,
      edgesByFlow,
      canonicalTableName: (tableName: string) => tableName,
    };
  }

  for (const svc of data.services) {
    mapServices.set(svc.id, { name_en: svc.name_en, name_zh: svc.name_zh });
  }

  for (const flow of data.flows) {
    flowById.set(flow.id, flow);
  }

  for (const table of data.tables) {
    tableByName.set(table.name, table);
    if (table.alias_of) {
      aliasByName.set(table.name, table.alias_of);
    }
  }

  const canonicalTableName = (tableName: string): string => {
    let current = tableName;
    const seen = new Set<string>();
    while (aliasByName.has(current) && !seen.has(current)) {
      seen.add(current);
      current = aliasByName.get(current) ?? current;
    }
    return current;
  };

  for (const edge of data.crudEdges) {
    const table = canonicalTableName(edge.table);
    const normalizedEdge: CrudEdgeRecord = {
      flow_id: edge.flow_id,
      table,
      ops: edge.ops || '',
    };

    if (!edgesByTable.has(table)) {
      edgesByTable.set(table, []);
    }
    edgesByTable.get(table)?.push(normalizedEdge);

    if (!edgesByFlow.has(normalizedEdge.flow_id)) {
      edgesByFlow.set(normalizedEdge.flow_id, new Map());
    }
    const flowEdges = edgesByFlow.get(normalizedEdge.flow_id);
    if (!flowEdges) {
      continue;
    }
    const prevOps = flowEdges.get(table) ?? '';
    flowEdges.set(table, mergeOps(prevOps, normalizedEdge.ops));
  }

  return {
    mapServices,
    flowById,
    tableByName,
    edgesByTable,
    edgesByFlow,
    canonicalTableName,
  };
}
