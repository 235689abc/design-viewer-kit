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
