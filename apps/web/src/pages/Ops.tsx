import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectData, type ServiceRecord } from '../app/useProjectData';
import {
  collectFindings,
  summarizeFindings,
  type Finding,
} from '../app/findings';
import { useLocale, bi, type Locale } from '../app/i18n';
import {
  getRuntimeBaseUrl,
  subscribeRuntimeBaseUrl,
} from '../app/runtimeClient';
import type { ServiceOps } from '@design-viewer/schema';
import './Ops.css';

type ServiceRiskCount = { red: number; yellow: number };

/**
 * services[].ops 只读消费,类型单源 @design-viewer/schema;
 * 字段缺失一律显示「未登记」(subtle),不猜、不报错(运行期仍防脏数据)。
 */
function readServiceOps(service: ServiceRecord): ServiceOps {
  const candidate = service.ops;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {};
  }
  return candidate;
}

function opsField(value: string | undefined): string | null {
  const normalized = (value ?? '').trim();
  return normalized === '' ? null : normalized;
}

function serviceName(service: ServiceRecord, locale: Locale): string {
  return locale === 'zh' ? service.name_zh : service.name_en;
}

/** 发现条目的直达目标:flow → 流程详情 / table → 表详情 / rule → 治理页 */
function FindingTargets({ finding }: { finding: Finding }) {
  return (
    <span className="findings-target">
      {finding.flowId && (
        <Link
          className="sev-badge sev-badge-info"
          to={`/flows/${encodeURIComponent(finding.flowId)}`}
        >
          {finding.flowId}
        </Link>
      )}
      {finding.table && (
        <Link
          className="sev-badge sev-badge-info"
          to={`/tables/${encodeURIComponent(finding.table)}`}
        >
          {finding.table}
        </Link>
      )}
      {finding.rule && (
        <Link
          className="sev-badge sev-badge-info"
          to={`/governance?rule=${encodeURIComponent(finding.rule)}`}
        >
          {finding.rule}
        </Link>
      )}
    </span>
  );
}

export function OpsPage() {
  const { data, loading, error } = useProjectData();
  const [locale] = useLocale();
  // 只读判断运行态地址:订阅 Settings 的变更事件,本页不写 localStorage
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState<string | null>(() =>
    getRuntimeBaseUrl(),
  );

  useEffect(() => subscribeRuntimeBaseUrl(setRuntimeBaseUrl), []);

  const findings = useMemo(() => collectFindings(data, locale), [data, locale]);
  const summary = useMemo(() => summarizeFindings(findings), [findings]);
  const riskFindings = useMemo(
    () =>
      findings.filter(
        (finding) => finding.severity === 'red' || finding.severity === 'yellow',
      ),
    [findings],
  );

  /** 服务名下红黄发现数:发现挂 flow → 按该 flow.owner_service 归属;挂 table → 按 table.owner_service 归属 */
  const riskByService = useMemo(() => {
    const counts = new Map<string, ServiceRiskCount>();
    const flowOwnerByFlowId = new Map<string, string>();
    const ownerByTableName = new Map<string, string>();
    for (const flow of data?.flows ?? []) {
      flowOwnerByFlowId.set(flow.id, flow.owner_service);
    }
    for (const table of data?.tables ?? []) {
      ownerByTableName.set(table.name, table.owner_service);
    }
    for (const finding of riskFindings) {
      const owners = new Set<string>();
      if (finding.flowId) {
        const owner = flowOwnerByFlowId.get(finding.flowId);
        if (owner) {
          owners.add(owner);
        }
      }
      if (finding.table) {
        const owner = ownerByTableName.get(finding.table);
        if (owner) {
          owners.add(owner);
        }
      }
      for (const owner of owners) {
        const entry = counts.get(owner) ?? { red: 0, yellow: 0 };
        entry[finding.severity === 'red' ? 'red' : 'yellow'] += 1;
        counts.set(owner, entry);
      }
    }
    return counts;
  }, [data, riskFindings]);

  if (loading) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Ops', '运维面板')}</h1>
        <p className="subtle">{bi(locale, 'Loading…', '加载中…')}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>{bi(locale, 'Ops', '运维面板')}</h1>
        <p className="error">{error}</p>
      </section>
    );
  }

  const services = data?.services ?? [];
  const riskAccent =
    summary.red > 0
      ? 'card-accent-red'
      : summary.yellow > 0
        ? 'card-accent-yellow'
        : 'card-accent-green';
  const notRegistered = bi(locale, 'Not registered', '未登记');

  return (
    <section className="page">
      <h1>{bi(locale, 'Ops', '运维面板')}</h1>
      <p className="subtle">
        {bi(
          locale,
          'Ops view: service runtime registry, blocking/debt risk list, and runtime access.',
          '运维视角:服务运行登记表、红/黄风险清单与运行态接入。',
        )}
      </p>

      <article className="card ops-section">
        <div className="ops-card-head">
          <h2>{bi(locale, 'Service Runtime Table', '服务运行表')}</h2>
          <span className="subtle">
            {bi(locale, 'ops fields from services[].ops', '登记字段读自 services[].ops')}
          </span>
        </div>
        <table className="table-lens-grid">
          <thead>
            <tr>
              <th>{bi(locale, 'Service', '服务')}</th>
              <th>{bi(locale, 'Port', '端口')}</th>
              <th>{bi(locale, 'Health Endpoint', '健康端点')}</th>
              <th>{bi(locale, 'Deploy Notes', '部署说明')}</th>
              <th>{bi(locale, 'Red/Yellow Findings', '红黄发现')}</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => {
              const ops = readServiceOps(service);
              const port = opsField(ops.port);
              const health = opsField(ops.health);
              const deploy = opsField(ops.deploy);
              const risk = riskByService.get(service.id);
              const hasRisk = !!risk && (risk.red > 0 || risk.yellow > 0);
              return (
                <tr key={service.id}>
                  <td>
                    <div>{serviceName(service, locale)}</div>
                    <div className="field-value-mono subtle">{service.id}</div>
                  </td>
                  <td>
                    {port ? (
                      <code>{port}</code>
                    ) : (
                      <span className="subtle">{notRegistered}</span>
                    )}
                  </td>
                  <td>
                    {health ? (
                      <code>{health}</code>
                    ) : (
                      <span className="subtle">{notRegistered}</span>
                    )}
                  </td>
                  <td>
                    {deploy ? (
                      deploy
                    ) : (
                      <span className="subtle">{notRegistered}</span>
                    )}
                  </td>
                  <td>
                    {hasRisk ? (
                      <span className="ops-count-group">
                        {risk.red > 0 && (
                          <span className="sev-badge sev-badge-red">
                            {bi(locale, 'Red', '红')} {risk.red}
                          </span>
                        )}
                        {risk.yellow > 0 && (
                          <span className="sev-badge sev-badge-yellow">
                            {bi(locale, 'Yellow', '黄')} {risk.yellow}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {services.length === 0 && (
          <p className="subtle">
            {bi(locale, 'No services registered.', '未登记任何服务。')}
          </p>
        )}
      </article>

      <article className={`card ops-section ${riskAccent}`}>
        <div className="ops-card-head">
          <h2>
            {bi(
              locale,
              'Risk List (Red = Blocking / Yellow = Debt)',
              '风险清单(红=阻断/黄=欠账)',
            )}
          </h2>
          <span className="ops-count-group">
            <span className="sev-badge sev-badge-red">
              {bi(locale, 'Red', '红')} {summary.red}
            </span>
            <span className="sev-badge sev-badge-yellow">
              {bi(locale, 'Yellow', '黄')} {summary.yellow}
            </span>
          </span>
        </div>
        {riskFindings.length === 0 ? (
          <p className="subtle">
            {bi(locale, 'No blocking or debt findings.', '暂无红/黄风险。')}
          </p>
        ) : (
          <ul className="findings-list">
            {riskFindings.map((finding, index) => (
              <li
                key={`${finding.ref}-${finding.flowId ?? ''}-${finding.table ?? ''}-${index}`}
                className={`findings-item findings-item-${finding.severity}`}
              >
                <span className="findings-ref">{finding.ref}</span>
                <span className="findings-note">
                  {finding.note ||
                    (finding.severity === 'red'
                      ? bi(locale, 'Blocking finding', '阻断项')
                      : bi(locale, 'Quality debt', '质量欠账'))}
                </span>
                <FindingTargets finding={finding} />
              </li>
            ))}
          </ul>
        )}
      </article>

      <article
        className={`card ops-section ${runtimeBaseUrl ? 'card-accent-green' : 'card-accent-yellow'}`}
      >
        <div className="ops-card-head">
          <h2>{bi(locale, 'Runtime Access', '运行态接入')}</h2>
          {runtimeBaseUrl ? (
            <span className="state-badge state-badge-existing">
              {bi(locale, 'Configured', '已配置')}
            </span>
          ) : (
            <span className="state-badge state-badge-planned">
              {bi(locale, 'Not configured', '未配置')}
            </span>
          )}
        </div>
        {runtimeBaseUrl ? (
          <div className="field-list">
            <span className="field-row">
              <span className="field-key">
                {bi(locale, 'Runtime Base URL', '运行态地址')}
              </span>
              <span className="field-value field-value-mono">
                {runtimeBaseUrl}
              </span>
            </span>
            <span className="field-row">
              <span className="field-key">{bi(locale, 'Manage', '管理')}</span>
              <span className="field-value">
                <Link to="/settings">
                  {bi(locale, 'Open Settings to change it', '前往设置修改')}
                </Link>
              </span>
            </span>
          </div>
        ) : (
          <p>
            {bi(
              locale,
              'Runtime base URL is empty — open Settings to fill it in before wiring runtime data.',
              '运行态地址(runtimeBaseUrl)为空:请先前往「设置」填写 Runtime Base URL,再接入运行态数据。',
            )}{' '}
            <Link to="/settings">{bi(locale, 'Open Settings', '前往设置')}</Link>
          </p>
        )}
      </article>
    </section>
  );
}
