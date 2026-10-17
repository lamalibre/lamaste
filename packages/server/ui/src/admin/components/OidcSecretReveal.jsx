import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { initialRevealState, revealHeading, revealReducer } from '../lib/oidcSecrets.js';

/**
 * The secrets of confidential OIDC clients a plugin change created, shown
 * once in a dialog the administrator must acknowledge. They live in this
 * provider's state from the response that carried them until that
 * acknowledgement — never in the query cache, the browser's storage, a URL
 * or a log. Hosts mount the provider above their pages, so a response that
 * arrives after the administrator moved on still reaches the dialog.
 *
 * It also remembers the plugin operations started from this panel (by id,
 * not secret), so their secrets are read as soon as they end; see
 * `operationSecretsAction` in `lib/oidcSecrets.js`.
 */
const OidcSecretRevealContext = createContext(null);

/**
 * @returns {{
 *   reveal: (r: { plugin: string, cause: string, secrets: Array<{ id: string, secret: string }> }) => void,
 *   followOperation: (id: string) => void,
 *   followState: (id: string) => 'followed' | 'reading' | undefined,
 *   claimOperation: (id: string) => boolean,
 *   releaseOperation: (id: string) => void,
 * }}
 * @throws If used outside an OidcSecretRevealProvider.
 */
export function useOidcSecretReveal() {
  const ctx = useContext(OidcSecretRevealContext);
  if (!ctx) throw new Error('useOidcSecretReveal must be used within an OidcSecretRevealProvider');
  return ctx;
}

export function OidcSecretRevealProvider({ children }) {
  const [state, dispatch] = useReducer(revealReducer, initialRevealState);
  // Operation id → 'followed' (started here) | 'reading' (its one read is under way).
  const [follows, setFollows] = useState(() => new Map());
  // The reads under way, checked synchronously: two reads of one operation
  // would hand its secrets to one of them only.
  const claims = useRef(new Set());

  const reveal = useCallback(
    ({ plugin, cause, secrets }) => dispatch({ type: 'reveal', plugin, cause, secrets }),
    [],
  );
  const followOperation = useCallback(
    (id) => setFollows((prev) => new Map(prev).set(id, 'followed')),
    [],
  );
  const claimOperation = useCallback((id) => {
    if (claims.current.has(id)) return false;
    claims.current.add(id);
    setFollows((prev) => new Map(prev).set(id, 'reading'));
    return true;
  }, []);
  const releaseOperation = useCallback((id) => {
    claims.current.delete(id);
    setFollows((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const followState = useCallback((id) => follows.get(id), [follows]);

  const value = useMemo(
    () => ({ reveal, followOperation, followState, claimOperation, releaseOperation }),
    [reveal, followOperation, followState, claimOperation, releaseOperation],
  );

  const current = state.queue[0] ?? null;
  // Reloading or closing the page would lose secrets nobody stored yet.
  useEffect(() => {
    if (!current) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [current]);

  return (
    <OidcSecretRevealContext.Provider value={value}>
      {children}
      {current && (
        <OidcSecretDialog
          key={current.key}
          reveal={current}
          waiting={state.queue.length - 1}
          onAcknowledge={() => dispatch({ type: 'acknowledge', key: current.key })}
        />
      )}
    </OidcSecretRevealContext.Provider>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The dialog: each client id with its secret and a copy button, the
 * warning that it is shown once, and the acknowledgement that closes it —
 * no close button, Escape or click outside.
 */
function OidcSecretDialog({ reveal, waiting, onAcknowledge }) {
  const [stored, setStored] = useState(false);
  const dialogRef = useRef(null);
  const headingId = useId();
  const warningId = useId();
  const one = reveal.secrets.length === 1;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Keep the keyboard inside the dialog: the page behind waits for it.
  const trapFocus = (event) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={warningId}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl focus:outline-none"
      >
        <div className="border-b border-zinc-800 px-6 py-4">
          <h3 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-white">
            <KeyRound size={20} className="text-cyan-400" />
            {one ? 'Client secret' : 'Client secrets'} — shown once
          </h3>
          <p className="mt-1 text-sm text-zinc-400">{revealHeading(reveal)}.</p>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <div
            id={warningId}
            className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-400"
          >
            <p className="font-semibold">
              Store {one ? 'this secret' : 'these secrets'} now — Lamaste never shows{' '}
              {one ? 'it' : 'them'} again.
            </p>
            <p>
              Copy {one ? 'it' : 'each one'} into the application that authenticates with{' '}
              {one ? 'it' : 'them'}, or into your password manager. A secret that was not stored can
              only be replaced:{' '}
              <code className="font-mono text-xs text-amber-300">
                lamaste-server plugins rotate-secret &lt;plugin&gt; &lt;client id&gt;
              </code>
            </p>
          </div>

          {reveal.secrets.map(({ id, secret }) => (
            <SecretRow key={id} clientId={id} secret={secret} />
          ))}

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={stored}
              onChange={(e) => setStored(e.target.checked)}
              className="accent-cyan-500"
            />
            I have stored {one ? 'this secret' : 'these secrets'}
          </label>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500">
              {waiting > 0 && `${waiting} more to show after this`}
            </span>
            <button
              type="button"
              disabled={!stored}
              onClick={onAcknowledge}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One client: its id, its secret, and a copy button. */
function SecretRow({ clientId, secret }) {
  const [copy, setCopy] = useState('idle');
  const secretRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy('copied');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopy('idle'), 2000);
    } catch {
      // No clipboard here: select the secret so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(secretRef.current);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      setCopy('failed');
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 text-sm">
        <span className="shrink-0 text-zinc-500">Client ID</span>
        <span className="select-all break-all font-mono text-zinc-200">{clientId}</span>
      </div>
      <div className="flex items-center gap-2">
        <div
          ref={secretRef}
          className="flex-1 select-all break-all rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-yellow-400"
        >
          {secret}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          title="Copy the secret"
          aria-label={`Copy the secret of ${clientId}`}
          className="shrink-0 rounded bg-zinc-700 p-2 text-zinc-300 hover:bg-zinc-600"
        >
          {copy === 'copied' ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
        </button>
      </div>
      {copy === 'failed' && (
        <p className="mt-1 text-xs text-zinc-500">
          Copying is not available here — the secret is selected; copy it with ⌘C or Ctrl+C.
        </p>
      )}
    </div>
  );
}
