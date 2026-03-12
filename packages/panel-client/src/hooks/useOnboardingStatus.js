import { useQuery } from '@tanstack/react-query';

async function fetchOnboardingStatus() {
  const response = await fetch('/api/onboarding/status');
  if (!response.ok) {
    throw new Error(response.statusText);
  }
  return response.json();
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
