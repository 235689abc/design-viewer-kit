import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard / 总览', end: true },
  { to: '/crud', label: 'CRUD Matrix / CRUD 矩阵' },
  { to: '/flows', label: 'Flows / 流程' },
  { to: '/tables', label: 'Tables / 数据表' },
  { to: '/database', label: 'Database / 数据库' },
  { to: '/l0', label: 'L0 Map / 系统地图' },
  { to: '/governance', label: 'Governance / 治理' },
  { to: '/diff', label: 'Diff / 变更' },
  { to: '/settings', label: 'Settings / 设置' },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="Primary Navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? 'sidebar-link is-active' : 'sidebar-link'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
