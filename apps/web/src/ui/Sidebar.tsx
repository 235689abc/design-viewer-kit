import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useLocale, bi } from '../app/i18n';
import { useProjectData } from '../app/useProjectData';
import { collectFindings, summarizeFindings } from '../app/findings';

type NavItem = {
  to: string;
  en: string;
  zh: string;
  end?: boolean;
  badge?: 'red' | 'yellow';
};

type NavGroup = {
  key: string;
  en: string;
  zh: string;
  items: NavItem[];
};

export function Sidebar() {
  const [locale] = useLocale();
  const { data } = useProjectData();

  const findingsBadge = useMemo(() => {
    const summary = summarizeFindings(collectFindings(data));
    if (summary.red + summary.yellow === 0) {
      return undefined;
    }
    return summary.red > 0 ? 'red' : 'yellow';
  }, [data]);

  const groups: NavGroup[] = [
    {
      key: 'overview',
      en: 'Overview',
      zh: '总览',
      items: [
        { to: '/', en: 'Dashboard', zh: '总览', end: true },
        {
          to: '/findings',
          en: 'Findings',
          zh: '发现',
          badge: findingsBadge,
        },
      ],
    },
    {
      key: 'ledger',
      en: 'Ledger',
      zh: '台账',
      items: [
        { to: '/flows', en: 'Flows', zh: '流程' },
        { to: '/tables', en: 'Tables', zh: '数据表' },
        { to: '/crud', en: 'CRUD Matrix', zh: 'CRUD 矩阵' },
        { to: '/l0', en: 'System Map', zh: '系统地图' },
      ],
    },
    {
      key: 'governance',
      en: 'Governance',
      zh: '治理',
      items: [
        { to: '/governance', en: 'Rules', zh: '治理规则' },
        { to: '/diff', en: 'Diff', zh: '变更' },
      ],
    },
    {
      key: 'settings',
      en: 'Settings',
      zh: '设置',
      items: [{ to: '/settings', en: 'Settings', zh: '设置' }],
    },
  ];

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label={bi(locale, 'Primary Navigation', '主导航')}>
        {groups.map((group) => (
          <div key={group.key} className="nav-group">
            <div className="nav-group-label">{bi(locale, group.en, group.zh)}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? 'sidebar-link is-active' : 'sidebar-link'
                }
              >
                <span>{bi(locale, item.en, item.zh)}</span>
                {item.badge && (
                  <span className={`sev-dot sev-dot-${item.badge}`} style={{ marginLeft: 'auto' }} aria-hidden="true" />
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
