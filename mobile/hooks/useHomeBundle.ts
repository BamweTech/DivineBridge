import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { homeBundleApi } from '@/services/api';

/**
 * Fetches today's verse + prayer in a single CDN-cached request.
 * Falls gracefully if the endpoint is unavailable.
 * Query cache is persisted to AsyncStorage so the Home screen renders
 * instantly from cache on app restart.
 */
export function useHomeBundle() {
  const today = dayjs().format('YYYY-MM-DD');

  const query = useQuery({
    queryKey: ['home-bundle', today],
    queryFn: () => homeBundleApi.get(today),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 2,
  });

  return {
    verse: query.data?.verse ?? null,
    prayer: query.data?.prayer ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
