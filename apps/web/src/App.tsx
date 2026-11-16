import { AppRoutes } from './app/routes';
import { LocaleProvider } from './app/i18n';
import { ProjectDataProvider } from './app/useProjectData';

export default function App() {
  return (
    <LocaleProvider>
      <ProjectDataProvider>
        <AppRoutes />
      </ProjectDataProvider>
    </LocaleProvider>
  );
}
