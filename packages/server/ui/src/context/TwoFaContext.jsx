import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, TWO_FA_REQUIRED_EVENT } from '../lib/api.js';
import TwoFaVerifyModal from '../components/TwoFaVerifyModal.jsx';

const TwoFaContext = createContext(null);

export function useTwoFa() {
  const ctx = useContext(TwoFaContext);
  if (!ctx) throw new Error('useTwoFa must be used within a TwoFaProvider');
  return ctx;
}

async function fetch2faStatus() {
  try {
    return await apiFetch('/api/settings/2fa');
  } catch {
    return { enabled: false, setupComplete: false };
  }
}

export function TwoFaProvider({ children }) {
  const queryClient = useQueryClient();
  const [is2faRequired, setIs2faRequired] = useState(false);

  const { data } = useQuery({
    queryKey: ['settings-2fa'],
    queryFn: fetch2faStatus,
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

  // Listen for 2fa_required events dispatched by apiFetch
  useEffect(() => {
    function handleTwoFaRequired() {
      setIs2faRequired(true);
    }
    window.addEventListener(TWO_FA_REQUIRED_EVENT, handleTwoFaRequired);
    return () => window.removeEventListener(TWO_FA_REQUIRED_EVENT, handleTwoFaRequired);
  }, []);

  return (
    <TwoFaContext.Provider value={{ is2faEnabled, is2faRequired, require2fa, clearRequirement }}>
      {children}
      {is2faRequired && <TwoFaVerifyModal onVerified={clearRequirement} />}
    </TwoFaContext.Provider>
  );
}
