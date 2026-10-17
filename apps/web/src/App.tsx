import { AppRoutes } from './app/routes';
import { ProjectDataProvider } from './app/useProjectData';

export default function App() {
  return (
    <ProjectDataProvider>
      <AppRoutes />
    </ProjectDataProvider>
  );
}
