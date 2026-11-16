import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProjectData } from '../app/useProjectData';
import { collectFindings, summarizeFindings } from '../app/findings';
import { useLocale, bi } from '../app/i18n';
import './Tour.css';

type RoleLink = { to: string; labelEn: string; labelZh: string };

type RoleRow = {
  key: string;
  roleEn: string;
  roleZh: string;
  links: RoleLink[];
  whyEn: string;
  whyZh: string;
};

/** 按角色进入:角色 → 页面 → 一句话为什么(人话,零黑话) */
const ROLE_ROWS: RoleRow[] = [
  {
    key: 'pm',
    roleEn: 'Product Manager',
    roleZh: '产品经理',
    links: [{ to: '/features', labelEn: 'Feature Map', labelZh: '功能地图' }],
    whyEn: 'See what features the system has and which flows carry them, without reading code.',
    whyZh: '看系统都有哪些功能、各自落在哪些流程上,不用读代码。',
  },
  {
    key: 'architect',
    roleEn: 'Architect',
    roleZh: '架构师',
    links: [
      { to: '/architecture', labelEn: 'Architecture Overview', labelZh: '架构总览' },
      { to: '/l0', labelEn: 'System Map', labelZh: '系统地图' },
    ],
    whyEn: 'Get the big picture first: how services are split and connected.',
    whyZh: '先拿全局图:服务怎么切、怎么连,一眼看全。',
  },
  {
    key: 'ops',
    roleEn: 'Ops Engineer',
    roleZh: '运维师',
    links: [{ to: '/ops', labelEn: 'Ops Panel', labelZh: '运维面板' }],
    whyEn: 'Ports, health checks and deploy entries — the things you touch daily.',
    whyZh: '端口、健康检查、部署入口,日常要用的信息都在这。',
  },
  {
    key: 'chief-engineer',
    roleEn: 'Chief Code Engineer',
    roleZh: '代码总工程师',
    links: [
      { to: '/findings', labelEn: 'Findings', labelZh: '发现' },
      { to: '/crud', labelEn: 'CRUD Matrix', labelZh: 'CRUD 矩阵' },
    ],
    whyEn: 'Clear the red/yellow issue list first, then check who reads and writes each table.',
    whyZh: '先清红黄问题清单,再核对每张表谁在读写。',
  },
  {
    key: 'api-admin',
    roleEn: 'API Contract Admin',
    roleZh: 'API 接口管理员',
    links: [{ to: '/contracts', labelEn: 'Interface Contracts', labelZh: '接口契约' }],
    whyEn: 'Check which events and contracts each flow appends or consumes.',
    whyZh: '查每个流程追加/消费了哪些事件与约定。',
  },
  {
    key: 'data-gov',
    roleEn: 'Data Governance',
    roleZh: '数据治理',
    links: [{ to: '/tables', labelEn: 'Data Tables', labelZh: '数据表' }],
    whyEn: 'Go table by table: owner, status and column design.',
    whyZh: '逐表核对:归属、状态、字段设计。',
  },
  {
    key: 'newcomer',
    roleEn: 'Newcomer',
    roleZh: '新人',
    links: [{ to: '/tour', labelEn: 'This page', labelZh: '本页' }],
    whyEn: 'Start here and build the whole picture in three minutes.',
    whyZh: '从这页开始,三分钟建立整体印象。',
  },
];

export function TourPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  const findings = useMemo(() => collectFindings(data, locale), [data, locale]);
  const findingsSummary = useMemo(() => summarizeFindings(findings), [findings]);

  const topFlows = useMemo(() => {
    if (!data) {
      return [];
    }
    const touchedTablesByFlow = new Map<string, Set<string>>();
    for (const edge of data.crudEdges) {
      let tables = touchedTablesByFlow.get(edge.flow_id);
      if (!tables) {
        tables = new Set<string>();
        touchedTablesByFlow.set(edge.flow_id, tables);
      }
      tables.add(edge.table);
    }
    return data.flows
      .map((flow) => ({
        flowId: flow.id,
        name: locale === 'zh' ? flow.name_zh : flow.name_en,
        touched: touchedTablesByFlow.get(flow.id)?.size ?? 0,
      }))
      .filter((row) => row.touched > 0)
      .sort((a, b) => b.touched - a.touched || a.flowId.localeCompare(b.flowId))
      .slice(0, 5)
      .map((row) => ({
        ...row,
        red: findings.filter((finding) => finding.flowId === row.flowId && finding.severity === 'red').length,
        yellow: findings.filter((finding) => finding.flowId === row.flowId && finding.severity === 'yellow').length,
      }));
  }, [data, findings, locale]);

  return (
    <section className="page tour-page">
      <h1>{bi(locale, 'Tour', '导览')}</h1>
      <p className="subtle">
        {bi(locale, 'Understand this system in three minutes.', '三分钟看懂这个系统。')}
      </p>

      {loading && (
        <p className="subtle">{bi(locale, 'Loading project data…', '正在加载项目数据…')}</p>
      )}
      {error && (
        <p className="error">
          {bi(locale, 'Failed to load project data: ', '加载项目数据失败:')}
          {error}
        </p>
      )}
      {!loading && !error && !data && (
        <p className="subtle">{bi(locale, 'No project data available.', '暂无项目数据。')}</p>
      )}

      {data && !error && (
        <>
          <article className="card">
            <h2>{bi(locale, 'What is this?', '这是什么')}</h2>
            <p>
              <strong>{data.meta.project}</strong>
              {data.meta.generated_at && (
                <span className="subtle"> · {data.meta.generated_at}</span>
              )}
            </p>
            <p className="subtle">
              {bi(
                locale,
                'A viewer over one design manifest: every page below is generated from the same data.',
                '这是一份设计清单的查看器:下面所有页面都由同一份数据生成。',
              )}
            </p>
            <div className="field-list">
              <span className="field-row">
                <span className="field-key">{bi(locale, 'Services', '服务')}</span>
                <span className="field-value field-value-mono">{data.services.length}</span>
              </span>
              <span className="field-row">
                <span className="field-key">{bi(locale, 'Tables', '数据表')}</span>
                <span className="field-value field-value-mono">{data.tables.length}</span>
              </span>
              <span className="field-row">
                <span className="field-key">{bi(locale, 'Flows', '流程')}</span>
                <span className="field-value field-value-mono">{data.flows.length}</span>
              </span>
              <span className="field-row">
                <span className="field-key">{bi(locale, 'CRUD edges', '读写边')}</span>
                <span className="field-value field-value-mono">{data.crudEdges.length}</span>
              </span>
            </div>
            <div className="health-strip">
              <Link to="/findings#findings-red" className="stat-block stat-block-red">
                <span className="stat-num stat-num-red">{findingsSummary.red}</span>
                <span className="stat-label">{bi(locale, 'Blocking findings', '阻断(红)')}</span>
              </Link>
              <Link to="/findings#findings-yellow" className="stat-block stat-block-yellow">
                <span className="stat-num stat-num-yellow">{findingsSummary.yellow}</span>
                <span className="stat-label">{bi(locale, 'Debt findings', '欠账(黄)')}</span>
              </Link>
              <Link to="/findings#findings-green" className="stat-block stat-block-green">
                <span className="stat-num stat-num-green">{findingsSummary.green}</span>
                <span className="stat-label">{bi(locale, 'Healthy evidence', '达标存照(绿)')}</span>
              </Link>
              <Link to="/findings" className="stat-block stat-block-info">
                <span className="stat-num stat-num-info">{findingsSummary.total}</span>
                <span className="stat-label">{bi(locale, 'All findings', '全部发现')}</span>
              </Link>
            </div>
          </article>

          <article className="card">
            <h2>{bi(locale, 'Main Flows', '主干流程')}</h2>
            <p className="subtle">
              {bi(
                locale,
                'Top 5 flows by tables touched (from CRUD edges).',
                '按读写边触达表数取前 5 的流程。',
              )}
            </p>
            {topFlows.length === 0 && (
              <p className="subtle">
                {bi(
                  locale,
                  'No CRUD edges yet, no main flows to rank.',
                  '暂无读写边数据,排不出主干流程。',
                )}
              </p>
            )}
            {topFlows.length > 0 && (
              <table className="table-lens-grid tour-flow-table">
                <thead>
                  <tr>
                    <th>{bi(locale, 'Flow ID', '流程 ID')}</th>
                    <th>{bi(locale, 'Name', '名称')}</th>
                    <th>{bi(locale, 'Tables touched', '触达表')}</th>
                    <th>{bi(locale, 'Findings', '发现')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topFlows.map((row) => (
                    <tr key={row.flowId}>
                      <td>
                        <Link to={`/flows/${encodeURIComponent(row.flowId)}`} className="item-title">
                          {row.flowId}
                        </Link>
                      </td>
                      <td>{row.name}</td>
                      <td className="field-value-mono">{row.touched}</td>
                      <td>
                        <span className="sev-badge sev-badge-red" style={{ marginRight: 6 }}>
                          {bi(locale, `Red ${row.red}`, `红 ${row.red}`)}
                        </span>
                        <span className="sev-badge sev-badge-yellow">
                          {bi(locale, `Yellow ${row.yellow}`, `黄 ${row.yellow}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article className="card">
            <h2>{bi(locale, 'Where to Start by Role', '按角色进入')}</h2>
            <table className="table-lens-grid tour-role-table">
              <thead>
                <tr>
                  <th>{bi(locale, 'Role', '角色')}</th>
                  <th>{bi(locale, 'Go to', '去哪页')}</th>
                  <th>{bi(locale, 'Why', '一句话为什么')}</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_ROWS.map((row) => (
                  <tr key={row.key}>
                    <td>{bi(locale, row.roleEn, row.roleZh)}</td>
                    <td>
                      {row.links.map((link, index) => (
                        <span key={`${row.key}-${link.to}`}>
                          {index > 0 && ' · '}
                          <Link to={link.to}>{bi(locale, link.labelEn, link.labelZh)}</Link>
                        </span>
                      ))}
                    </td>
                    <td>{bi(locale, row.whyEn, row.whyZh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </>
      )}
    </section>
  );
}
