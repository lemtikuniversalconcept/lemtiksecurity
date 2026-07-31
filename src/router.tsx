import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 60 seconds — no refetch on nav within that window
        staleTime: 60 * 1000,
        // Keep unused query data in cache for 5 minutes
        gcTime: 5 * 60 * 1000,
        // Don't refetch on window focus (stops hammering Supabase when you tab back)
        refetchOnWindowFocus: false,
        // Retry once on failure, not 3 times (faster UX on actual errors)
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preloaded data is valid for 30s — means hovering a nav link prefetches the page data
    defaultPreloadStaleTime: 30 * 1000,
    // Preload routes on link hover for instant navigation feel
    defaultPreload: "intent",
  });

  return router;
};
