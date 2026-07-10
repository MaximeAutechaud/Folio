import { QueryClient } from '@tanstack/react-query';

// Instance partagée : consommée par le provider React (main.tsx) et par le
// store zustand pour invalider les caches après des mutations hors React Query
// (ex. règles d'alertes système créées lors d'un save de position).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
