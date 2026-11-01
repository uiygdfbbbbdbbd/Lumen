import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LumenError } from '@lumen/shared';
import { createAppRouter } from './router.js';
import { startThemeEngine } from './lib/theme.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => count < 2 && !(err instanceof LumenError && err.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});
const router = createAppRouter(queryClient);
startThemeEngine();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
