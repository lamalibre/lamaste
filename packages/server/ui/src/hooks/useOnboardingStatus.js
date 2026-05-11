import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api.js';

async function fetchOnboardingStatus() {
  return apiFetch('/api/onboarding/status');
}

export function useOnboardingStatus() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: fetchOnboardingStatus,
    staleTime: 30_000,
    retry: 2,
    refetchOnWindowFocus: true,
  });

  return {
    status: data?.status,
    domain: data?.domain ?? null,
    ip: data?.ip ?? null,
    isLoading,
    isError,
    error,
    refetch,
  };
}
