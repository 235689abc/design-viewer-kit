import { AppRoutes } from './app/routes';
import { LocaleProvider } from './app/i18n';
import { ThemeProvider } from './app/theme';
import { ProjectDataProvider } from './app/useProjectData';

export default function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <ProjectDataProvider>
          <AppRoutes />
        </ProjectDataProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
