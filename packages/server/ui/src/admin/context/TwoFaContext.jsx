import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminClient } from './AdminClientContext.jsx';
import TwoFaVerifyModal from '../components/TwoFaVerifyModal.jsx';

const TwoFaContext = createContext(null);

export const TWO_FA_REQUIRED_EVENT = 'lamaste:2fa-required';

export function useTwoFa() {
  const ctx = useContext(TwoFaContext);
  if (!ctx) throw new Error('useTwoFa must be used within a TwoFaProvider');
  return ctx;
}

export function TwoFaProvider({ children }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [is2faRequired, setIs2faRequired] = useState(false);

  const { data } = useQuery({
    queryKey: ['settings-2fa'],
    queryFn: () => client.get2faStatus(),
    staleTime: 60_000,
    retry: false,
  });

  const is2faEnabled = data?.enabled ?? false;

  const require2fa = useCallback(() => {
    setIs2faRequired(true);
  }, []);

  const clearRequirement = useCallback(() => {
    setIs2faRequired(false);
    queryClient.invalidateQueries();
  }, [queryClient]);

  // Listen for 2fa_required events (dispatched by host-specific error handlers)
  useEffect(() => {
    function handleTwoFaRequired() {
      setIs2faRequired(true);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener(TWO_FA_REQUIRED_EVENT, handleTwoFaRequired);
      return () => window.removeEventListener(TWO_FA_REQUIRED_EVENT, handleTwoFaRequired);
    }
  }, []);

  return (
    <TwoFaContext.Provider value={{ is2faEnabled, is2faRequired, require2fa, clearRequirement }}>
      {children}
      {is2faRequired && <TwoFaVerifyModal onVerified={clearRequirement} />}
    </TwoFaContext.Provider>
  );
}
