import { describe, expect, it } from 'vitest';
import {
  collectFindings,
  groupFindingsBySeverity,
  inferSeverityFromNote,
  summarizeFindings,
} from './findings';
import type { ProjectData } from './useProjectData';

function fixture(): ProjectData {
  return {
    meta: {
      project: 'test-project',
      generated_at: '2026-11-16T00:00:00Z',
      source_flows_json: 'docs/diagrams/flows.json',
      source_generated_dir: 'docs/diagrams/generated',
      policy: {
        event_table: 'tasks.events',
        outbox_table: 'tasks.outbox',
      },
    },
    services: [
      { id: 'orders-api', name_en: 'Orders API', name_zh: '订单 API' },
      { id: 'billing-api', name_en: 'Billing API', name_zh: '计费 API' },
    ],
    tables: [
      {
        name: 'public.orders',
        state: 'existing',
        owner_service: 'orders-api',
        introduced_in: 'v1',
        // notes 兼容路径:无 issues 字段,靠 QC 标记点亮
        notes: 'QC-02 黄 R4:对账 0 值填充待修',
      },
      {
        name: 'public.billing',
        state: 'existing',
        owner_service: 'orders-api',
        introduced_in: 'v1',
        issues: [
          { ref: 'QC-01-R1', severity: 'red', note: '多写者' },
          { ref: 'QC-01-G9', severity: 'green' },
          // 故意非法 severity(运行时应归一为 info),类型层用双重断言模拟脏数据
          { ref: 'QC-01-BAD', severity: 'purple' as unknown as 'red' },
        ],
      },
    ],
    flows: [
      {
        id: 'FLOW-ORDER-CREATE-001',
        name_en: 'Create order',
        name_zh: '创建订单',
        owner_service: 'orders-api',
        doc_path: 'docs/flows/order-create',
        introduced_in: 'v1',
        reads: [],
        writes: [
          { table: 'public.orders', op: 'C' },
          { table: 'tasks.events', op: 'C' },
          { table: 'tasks.outbox', op: 'C' },
        ],
        events_appended: ['OrderCreated'],
        idempotency_key: 'request.idempotency_key',
        issues: [{ ref: 'QC-01-R2', severity: 'yellow', note: '审计事件可能丢失' }],
      },
      {
        id: 'FLOW-DIRTY-WRITE-001',
        name_en: 'Dirty write',
        name_zh: '脏写',
        owner_service: 'billing-api',
        doc_path: '',
        introduced_in: 'TBD',
        reads: [],
        // 写业务表但零事件/outbox → 触发治理规则 WRITE_WITHOUT_AUDIT
        writes: [{ table: 'public.billing', op: 'C' }],
        events_appended: [],
        idempotency_key: '',
      },
    ],
    crudEdges: [
      { flow_id: 'FLOW-ORDER-CREATE-001', table: 'public.orders', ops: 'C' },
      { flow_id: 'FLOW-DIRTY-WRITE-001', table: 'public.billing', ops: 'C' },
    ],
    diagrams: { l0_mermaid: '', flow_mermaid: {} },
  };
}

function statusFixture(): ProjectData {
  return {
    meta: {
      project: 'test-project',
      generated_at: '2026-11-16T00:00:00Z',
      source_flows_json: 'docs/diagrams/flows.json',
      source_generated_dir: 'docs/diagrams/generated',
    },
    services: [{ id: 'orders-api', name_en: 'Orders API', name_zh: '订单 API' }],
    tables: [
      {
        name: 'public.ledger',
        state: 'existing',
        owner_service: 'orders-api',
        introduced_in: 'v1',
        // 迁移后防双计样本:已有 issues 字段,notes 里残留的 QC 标记不再解析
        notes: 'QC-03 红 R9:迁移后残留标记',
        issues: [
          { ref: 'QC-03-R9', severity: 'red', status: 'refuted', note: '复核推翻' },
          { ref: 'QC-03-C1', severity: 'red', status: 'confirmed', note: '复核证实' },
          { ref: 'QC-03-F1', severity: 'red', note: '未复核' },
          // 故意非法 status(运行时应归一为 undefined 按 filed 现状),类型层双重断言模拟脏数据
          { ref: 'QC-03-BAD', severity: 'red', status: 'purple' as unknown as 'filed' },
        ],
      },
      {
        name: 'public.orders',
        state: 'existing',
        owner_service: 'orders-api',
        introduced_in: 'v1',
        // 无 issues 字段:notes QC 标记照常解析(向后兼容)
        notes: 'QC-02 黄 R4:对账 0 值填充待修',
      },
    ],
    flows: [],
    crudEdges: [],
    diagrams: { l0_mermaid: '', flow_mermaid: {} },
  };
}

describe('inferSeverityFromNote', () => {
  it('识别红/黄/绿与默认 info', () => {
    expect(inferSeverityFromNote('QC-01 红 R1:资金路径')).toBe('red');
    expect(inferSeverityFromNote('QC-01 yellow warning')).toBe('yellow');
    expect(inferSeverityFromNote('绿:达标存照')).toBe('green');
    expect(inferSeverityFromNote('普通备注')).toBe('info');
  });
});

describe('collectFindings', () => {
  it('聚合三源:issues 字段 + notes QC 标记 + 治理规则', () => {
    const findings = collectFindings(fixture());

    // issues 字段:3 条(含 1 条非法 severity 归一为 info)
    const issueSourced = findings.filter((finding) => finding.source === 'issues');
    expect(issueSourced.map((finding) => finding.ref)).toEqual(
      expect.arrayContaining(['QC-01-R1', 'QC-01-G9', 'QC-01-BAD', 'QC-01-R2']),
    );
    expect(issueSourced.find((finding) => finding.ref === 'QC-01-BAD')?.severity).toBe('info');
    expect(issueSourced.find((finding) => finding.ref === 'QC-01-R2')?.flowId).toBe(
      'FLOW-ORDER-CREATE-001',
    );

    // notes 兼容:public.orders 的 QC-02 黄
    const notesSourced = findings.filter((finding) => finding.source === 'notes');
    expect(notesSourced).toHaveLength(1);
    expect(notesSourced[0].ref).toContain('QC-02');
    expect(notesSourced[0].severity).toBe('yellow');
    expect(notesSourced[0].table).toBe('public.orders');

    // 治理规则:脏写流触发 WRITE_WITHOUT_AUDIT(violation→red)+ 幂等缺失(warning→yellow)
    const governanceSourced = findings.filter((finding) => finding.source === 'governance');
    expect(
      governanceSourced.some(
        (finding) => finding.rule === 'WRITE_WITHOUT_AUDIT' && finding.severity === 'red',
      ),
    ).toBe(true);
    expect(
      governanceSourced.some(
        (finding) => finding.rule === 'MISSING_IDEMPOTENCY' && finding.severity === 'yellow',
      ),
    ).toBe(true);
  });

  it('排序:红→黄→绿→info', () => {
    const findings = collectFindings(fixture());
    const order = { red: 0, yellow: 1, green: 2, info: 3 };
    for (let i = 1; i < findings.length; i += 1) {
      expect(order[findings[i - 1].severity]).toBeLessThanOrEqual(order[findings[i].severity]);
    }
  });

  it('空数据返回空数组', () => {
    expect(collectFindings(null)).toEqual([]);
  });
});

describe('collectFindings · status 立案三态', () => {
  it('status 透传:confirmed/refuted 原样,缺省与非法值归一为 undefined(按 filed 现状)', () => {
    const findings = collectFindings(statusFixture());
    const byRef = new Map(findings.map((finding) => [finding.ref, finding]));
    expect(byRef.get('QC-03-C1')?.status).toBe('confirmed');
    expect(byRef.get('QC-03-R9')?.status).toBe('refuted');
    expect(byRef.get('QC-03-F1')?.status).toBeUndefined();
    expect(byRef.get('QC-03-BAD')?.status).toBeUndefined();
    // 透传只发生在 issues 源;notes/governance 源不带 status
    expect(byRef.get('QC-02')?.source).toBe('notes');
    expect(byRef.get('QC-02')?.status).toBeUndefined();
  });

  it('notes 去重:已有 issues 字段的表不再解析其 notes 的 QC 标记(防迁移后双计)', () => {
    const findings = collectFindings(statusFixture());
    // public.ledger 有 issues 字段 → 其 notes 的 QC-03 残留标记不产生 notes 源发现
    expect(
      findings.filter((finding) => finding.source === 'notes' && finding.table === 'public.ledger'),
    ).toHaveLength(0);
    // QC-03 只来自 issues 源共 4 条,不与 notes 双计
    expect(findings.filter((finding) => finding.ref.includes('QC-03'))).toHaveLength(4);
    expect(
      findings.filter((finding) => finding.ref.includes('QC-03')).every(
        (finding) => finding.source === 'issues',
      ),
    ).toBe(true);
    // 无 issues 字段的表(public.orders)notes QC 标记照常点亮
    const notesSourced = findings.filter((finding) => finding.source === 'notes');
    expect(notesSourced).toHaveLength(1);
    expect(notesSourced[0].table).toBe('public.orders');
    expect(notesSourced[0].ref).toContain('QC-02');
  });

  it('refuted 沉组尾:同 severity 组内 confirmed 在前、filed 居中、refuted 在尾', () => {
    const findings = collectFindings(statusFixture());
    const redGroup = findings.filter((finding) => finding.severity === 'red');
    expect(redGroup.map((finding) => finding.status ?? 'filed')).toEqual([
      'confirmed', // QC-03-C1
      'filed', // QC-03-BAD(非法归一)
      'filed', // QC-03-F1
      'refuted', // QC-03-R9
    ]);
  });
});

describe('summarizeFindings / groupFindingsBySeverity', () => {
  it('计数与分组一致', () => {
    const findings = collectFindings(fixture());
    const summary = summarizeFindings(findings);
    expect(summary.red).toBeGreaterThanOrEqual(1);
    expect(summary.yellow).toBeGreaterThanOrEqual(2);
    expect(summary.total).toBe(findings.length);

    const groups = groupFindingsBySeverity(findings);
    expect(
      groups.red.length + groups.yellow.length + groups.green.length + groups.info.length,
    ).toBe(findings.length);
  });
});
