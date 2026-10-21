import { Navigate, useRoutes } from 'react-router-dom';
import { Layout } from './Layout';
import { DashboardPage } from '../pages/Dashboard';
import { CrudPage } from '../pages/Crud';
import { FlowsPage } from '../pages/Flows';
import { FlowDetailPage } from '../pages/FlowDetail';
import { TablesPage } from '../pages/Tables';
import { TableDetailPage } from '../pages/TableDetail';
import { L0Page } from '../pages/L0';
import { SchemaDetailPage } from '../pages/SchemaDetail';
import { SettingsPage } from '../pages/Settings';
import { DiffPage } from '../pages/Diff';
import { GovernancePage } from '../pages/Governance';
import { DatabasePage } from '../pages/Database';

export function AppRoutes() {
  return useRoutes([
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'crud', element: <CrudPage /> },
        { path: 'flows', element: <FlowsPage /> },
        { path: 'flows/:id', element: <FlowDetailPage /> },
        { path: 'tables', element: <TablesPage /> },
        { path: 'tables/:name', element: <TableDetailPage /> },
        { path: 'database', element: <DatabasePage /> },
        { path: 'l0', element: <L0Page /> },
        { path: 'governance', element: <GovernancePage /> },
        { path: 'schemas/:name', element: <SchemaDetailPage /> },
        { path: 'diff', element: <DiffPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ]);
}
