/**
 * Mail of one scope (packages/core/docs/mail-design.md §3): the relay's
 * transport (`domain` null — Settings) or a domain's override (Domains).
 * Shows the transport, its last check and its sending budget; connects a
 * Google account (Gmail API) or an SMTP server; edits the sender and the
 * daily limit; sends a test; resumes after a provider's refusal; removes.
 *
 * Secrets — an SMTP password, a Google client secret — are typed into
 * {@link SecretTextInput}s and read once when the form submits: never React
 * state, never a mutation's variables (react-query keeps those in its
 * cache), never shown again.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Mail, Pencil, Play, Send, Server, Trash2 } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { ConfirmDialog } from './Dialog.jsx';
import { SecretMaskNote, SecretTextInput, takeSecret } from './SecretTextInput.jsx';
import { useDomains } from './DomainChoice.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { warningLines } from '../lib/branding.js';
import {
  GOOGLE_PAID_DAILY_LIMIT,
  MAIL_DAILY_LIMIT,
  budgetLevel,
  budgetLines,
  googleBody,
  googleForm,
  healthText,
  isLimited,
  mailApi,
  mailQueryKey,
  senderBody,
  senderForm,
  senderText,
  smtpBody,
  smtpForm,
  transportSummary,
} from '../lib/mail.js';

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50';
const PRIMARY =
  'inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50';
const INPUT =
  'w-full rounded-lg border bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none';
const TONES = { ok: 'text-green-400', failing: 'text-red-400', unknown: 'text-zinc-500' };
const BAR = { ok: 'bg-cyan-500', warning: 'bg-yellow-500', full: 'bg-red-500' };

/** How often the transport is read while Google's consent is under way. */
const CONSENT_POLL_MS = 3000;

/**
 * A mutation whose body carries a secret: the body waits in a ref between
 * the submit and the request, never in the mutation's variables (which
 * react-query keeps in its cache), and is dropped once taken or when the
 * form goes. `submit(body)` sends it.
 */
function useSecretMutation(send, options) {
  const outgoing = useRef(null);
  useEffect(
    () => () => {
      outgoing.current = null;
    },
    [],
  );
  const mutation = useMutation({
    mutationFn: () => {
      const body = outgoing.current;
      outgoing.current = null;
      if (body === null) return Promise.reject(new Error('Nothing to send'));
      return send(body);
    },
    ...options,
  });
  const submit = (body) => {
    outgoing.current = body;
    mutation.mutate();
  };
  return [mutation, submit];
}

function inputClass(error) {
  return `${INPUT} ${error ? 'border-red-500' : 'border-zinc-700'}`;
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-zinc-400">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-600">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** The sender's address and name, and — for a transport of its own — the daily limit. */
function SenderFields({ idPrefix, form, setForm, errors, withLimit, limitHint }) {
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  return (
    <>
      <Field
        id={`${idPrefix}-sender`}
        label="Sender address"
        hint="What mails come from. With Google it must be the account or one of its send-as addresses."
        error={errors.senderAddress}
      >
        <input
          id={`${idPrefix}-sender`}
          type="email"
          value={form.senderAddress}
          onChange={set('senderAddress')}
          placeholder="no-reply@notify.example.com"
          className={inputClass(errors.senderAddress)}
        />
      </Field>
      <Field
        id={`${idPrefix}-sender-name`}
        label="Sender name (optional)"
        hint="Empty: the domain’s brand name, else “Lamaste”."
        error={errors.senderName}
      >
        <input
          id={`${idPrefix}-sender-name`}
          type="text"
          value={form.senderName}
          onChange={set('senderName')}
          className={inputClass(errors.senderName)}
        />
      </Field>
      {withLimit && (
        <Field
          id={`${idPrefix}-limit`}
          label="Daily limit of the sending account"
          hint={limitHint}
          error={errors.dailyLimit}
        >
          <input
            id={`${idPrefix}-limit`}
            type="number"
            min={MAIL_DAILY_LIMIT.min}
            max={MAIL_DAILY_LIMIT.max}
            value={form.dailyLimit}
            onChange={set('dailyLimit')}
            placeholder={String(MAIL_DAILY_LIMIT.default)}
            className={inputClass(errors.dailyLimit)}
          />
        </Field>
      )}
    </>
  );
}

const GOOGLE_LIMIT_HINT = `The provider’s per-account limit. Google Workspace allows ${MAIL_DAILY_LIMIT.default} a day during a trial and ${GOOGLE_PAID_DAILY_LIMIT.toLocaleString('en')} once paid — raise it then. Lamaste sends at most 90% of it.`;
const SMTP_LIMIT_HINT =
  'The provider’s per-account limit (empty: the stored one, else 500). Lamaste sends at most 90% of it.';

/**
 * Connect a Google account: the OAuth client's id and secret and the
 * sender, then Google's consent in a new tab, signed in as the sending
 * Workspace user. The transport is stored when Google returns to the
 * primary domain's sign-in host; the parent polls until it changes.
 */
function GoogleForm({ scope, transport, primary, onStarted, onCancel }) {
  const client = useAdminClient();
  const api = mailApi(client, scope);
  const [form, setForm] = useState(() => googleForm(transport));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const secretRef = useRef(null);
  const [start, startWith] = useSecretMutation((body) => api.startGoogle(body), {
    onSuccess: (answer) => onStarted(answer),
    onError: (err) => setFormError(errorMessage(err)),
  });
  const redirect = `https://auth.${primary ?? '<primary domain>'}/mail/google/callback`;

  function submit(e) {
    e.preventDefault();
    setFormError(null);
    const built = googleBody(form, takeSecret(secretRef));
    if (built.errors) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    startWith(built.body);
  }

  const id = `mail-google-${scope ?? 'relay'}`;
  return (
    <form onSubmit={submit} autoComplete="off" noValidate className="space-y-3">
      <p className="text-xs text-zinc-500">
        In a Google Cloud project of your Workspace: enable the Gmail API, make the OAuth consent
        screen <span className="text-zinc-300">Internal</span> with the scopes{' '}
        <code className="text-zinc-300">gmail.send</code>,{' '}
        <code className="text-zinc-300">openid</code> and{' '}
        <code className="text-zinc-300">email</code>, and create an OAuth client of type{' '}
        <span className="text-zinc-300">Web application</span> whose redirect URI is{' '}
        <code className="break-all text-cyan-400">{redirect}</code>. The relay holds the client and
        one user’s grant to send mail — nothing else of the mailbox.
      </p>
      <fieldset disabled={start.isPending} className="space-y-3">
        <Field id={`${id}-client`} label="OAuth client ID" error={errors.clientId}>
          <input
            id={`${id}-client`}
            type="text"
            value={form.clientId}
            onChange={(e) => setForm((prev) => ({ ...prev, clientId: e.target.value }))}
            placeholder="123456789012-abc….apps.googleusercontent.com"
            className={`${inputClass(errors.clientId)} font-mono`}
          />
        </Field>
        <Field id={`${id}-secret`} label="OAuth client secret" error={errors.clientSecret}>
          <SecretTextInput
            id={`${id}-secret`}
            ref={secretRef}
            placeholder="Paste the client secret"
            className={`${inputClass(errors.clientSecret)} font-mono`}
          />
          <SecretMaskNote />
        </Field>
        <SenderFields
          idPrefix={id}
          form={form}
          setForm={setForm}
          errors={errors}
          withLimit
          limitHint={GOOGLE_LIMIT_HINT}
        />
      </fieldset>
      {formError && <p className="text-xs text-red-400">{formError}</p>}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={start.isPending}>
          <ExternalLink size={14} /> {start.isPending ? 'Starting…' : 'Continue to Google'}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Google's consent under way: the link to open, and the wait for the transport to change. */
function ConsentWait({ consent, onDone }) {
  return (
    <div className="space-y-2 rounded-lg border border-cyan-800 bg-cyan-950/30 p-3 text-xs text-zinc-300">
      <p>
        Open Google’s consent and sign in as the account that sends the mail. This page updates when
        Google returns — the link works until {new Date(consent.expiresAt).toLocaleTimeString()}.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={consent.authorizeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={PRIMARY}
        >
          <ExternalLink size={14} /> Open Google’s consent
        </a>
        <button type="button" className={BUTTON} onClick={onDone}>
          Stop waiting
        </button>
      </div>
    </div>
  );
}

/** An SMTP server: host, port, security, optional sign-in, an optional private CA, the sender. */
function SmtpForm({ scope, transport, onSaved, onCancel }) {
  const client = useAdminClient();
  const api = mailApi(client, scope);
  const [form, setForm] = useState(() => smtpForm(transport));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const passwordRef = useRef(null);
  const [save, saveWith] = useSecretMutation((body) => api.setSmtp(body), {
    onSuccess: (answer) => onSaved(answer),
    onError: (err) => setFormError(errorMessage(err)),
  });
  const storedPassword =
    transport?.kind === 'smtp' && transport.hasSecret && Boolean(transport.settings?.username);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    setFormError(null);
    const built = smtpBody(form, takeSecret(passwordRef));
    if (built.errors) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    saveWith(built.body);
  }

  const id = `mail-smtp-${scope ?? 'relay'}`;
  return (
    <form onSubmit={submit} autoComplete="off" noValidate className="space-y-3">
      <p className="text-xs text-zinc-500">
        The server is checked before anything is stored (connection, TLS, sign-in). Many hosts —
        DigitalOcean among them — block outbound SMTP: use the Gmail API there.
      </p>
      <fieldset disabled={save.isPending} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field id={`${id}-host`} label="Host" error={errors.host}>
              <input
                id={`${id}-host`}
                type="text"
                value={form.host}
                onChange={set('host')}
                placeholder="smtp.example.com"
                className={`${inputClass(errors.host)} font-mono`}
              />
            </Field>
          </div>
          <Field id={`${id}-port`} label="Port" error={errors.port}>
            <input
              id={`${id}-port`}
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={set('port')}
              className={inputClass(errors.port)}
            />
          </Field>
        </div>
        <Field id={`${id}-security`} label="Security" error={errors.security}>
          <select
            id={`${id}-security`}
            value={form.security}
            onChange={set('security')}
            className={inputClass(errors.security)}
          >
            <option value="starttls">STARTTLS (usually port 587)</option>
            <option value="tls">TLS from the start (usually port 465)</option>
          </select>
        </Field>
        <Field
          id={`${id}-username`}
          label="Username (optional)"
          hint="Empty: no sign-in."
          error={errors.username}
        >
          <input
            id={`${id}-username`}
            type="text"
            value={form.username}
            onChange={set('username')}
            className={inputClass(errors.username)}
          />
        </Field>
        <Field
          id={`${id}-password`}
          label="Password"
          hint={
            storedPassword
              ? 'Empty: keep the stored one (for the same host and username).'
              : 'Needed with a username.'
          }
          error={errors.password}
        >
          <SecretTextInput
            id={`${id}-password`}
            ref={passwordRef}
            placeholder={storedPassword ? 'New password' : 'Password'}
            className={inputClass(errors.password)}
          />
          <SecretMaskNote />
        </Field>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={form.useCaPem}
            onChange={(e) => setForm((prev) => ({ ...prev, useCaPem: e.target.checked }))}
          />
          Trust a private CA for this server (beside the system’s)
        </label>
        {form.useCaPem && (
          <Field
            id={`${id}-ca`}
            label="CA certificates (PEM)"
            hint="A stored bundle is never shown: paste it with every change."
            error={errors.caPem}
          >
            <textarea
              id={`${id}-ca`}
              rows={5}
              value={form.caPem}
              onChange={set('caPem')}
              placeholder="-----BEGIN CERTIFICATE-----"
              className={`${inputClass(errors.caPem)} font-mono text-xs`}
            />
          </Field>
        )}
        <SenderFields
          idPrefix={id}
          form={form}
          setForm={setForm}
          errors={errors}
          withLimit
          limitHint={SMTP_LIMIT_HINT}
        />
      </fieldset>
      {formError && <p className="text-xs text-red-400">{formError}</p>}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={save.isPending}>
          <Server size={14} /> {save.isPending ? 'Checking…' : 'Check and save'}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The sender (and, with a transport of its own, the daily limit). A
 * domain without an override gets a sender-only one over the relay's
 * transport (`senderOnly`).
 */
function SenderForm({ scope, transport, senderOnly, onSaved, onCancel }) {
  const client = useAdminClient();
  const api = mailApi(client, scope);
  const [form, setForm] = useState(() => senderForm(transport));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => (senderOnly ? api.setSender(body) : api.update(body)),
    onSuccess: (answer) => onSaved(answer),
    onError: (err) => setFormError(errorMessage(err)),
  });

  function submit(e) {
    e.preventDefault();
    setFormError(null);
    const built = senderBody(form, transport, { senderOnly });
    if (built === null) {
      onCancel();
      return;
    }
    if (built.errors) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    save.mutate(built.body);
  }

  const id = `mail-sender-${scope ?? 'relay'}`;
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <fieldset disabled={save.isPending} className="space-y-3">
        <SenderFields
          idPrefix={id}
          form={form}
          setForm={setForm}
          errors={errors}
          withLimit={Boolean(transport?.budget) && !senderOnly}
          limitHint={transport?.kind === 'gmail-api' ? GOOGLE_LIMIT_HINT : SMTP_LIMIT_HINT}
        />
      </fieldset>
      {formError && <p className="text-xs text-red-400">{formError}</p>}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={save.isPending}>
          <CheckCircle2 size={14} /> {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Send a test mail to an address. */
function TestMail({ scope }) {
  const client = useAdminClient();
  const api = mailApi(client, scope);
  const addToast = useToast();
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () => api.test(to.trim()),
    onSuccess: ({ mail }) => {
      if (mail?.status === 'sent') addToast(`Test mail sent to ${to.trim()}`);
      else
        addToast(
          `Test mail not sent: ${mail?.status ?? 'unknown'}${mail?.error ? ` (${mail.error})` : ''}`,
          'error',
        );
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (to.trim() !== '') send.mutate();
      }}
    >
      <input
        type="email"
        aria-label="Send a test mail to"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Send a test to you@example.com"
        className={`${INPUT} border-zinc-700 flex-1`}
      />
      <button type="submit" className={BUTTON} disabled={send.isPending || to.trim() === ''}>
        <Send size={14} /> {send.isPending ? 'Sending…' : 'Send test'}
      </button>
    </form>
  );
}

function Budget({ budget }) {
  const { percent, level } = budgetLevel(budget);
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${BAR[level]}`} style={{ width: `${percent}%` }} />
      </div>
      <ul className="space-y-0.5 text-xs text-zinc-400">
        {budgetLines(budget).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {{ domain: { name: string, primary?: boolean } | null }} props
 */
export function MailSettings({ domain }) {
  const scope = domain?.name ?? null;
  const client = useAdminClient();
  const api = useMemo(() => mailApi(client, scope), [client, scope]);
  const queryClient = useQueryClient();
  const addToast = useToast();
  const { domains } = useDomains();
  const primary = domains.find((d) => d.primary)?.name ?? null;
  const queryKey = useMemo(() => mailQueryKey(scope), [scope]);
  const [mode, setMode] = useState(null);
  const [consent, setConsent] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const query = useQuery({ queryKey, queryFn: () => api.get() });
  const transport = query.data?.transport ?? null;

  // Google's consent under way: read the transport until it shows a newer
  // Google grant, or give up at the consent's expiry.
  useEffect(() => {
    if (!consent) return undefined;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      if (Date.parse(consent.expiresAt) <= Date.now()) {
        setConsent(null);
        addToast('Google’s consent was not completed in time — start again', 'error');
        return;
      }
      try {
        const answer = await api.get();
        if (stopped) return;
        queryClient.setQueryData(queryKey, answer);
        const now = answer?.transport;
        if (now?.kind === 'gmail-api' && now.updatedAt !== consent.before) {
          setConsent(null);
          addToast(`Google connected: sending as ${now.settings?.account ?? 'the account'}`);
          queryClient.invalidateQueries({ queryKey: ['domains'] });
          return;
        }
      } catch {
        // A failed read is tried again at the next tick.
      }
      if (!stopped) timer = setTimeout(tick, CONSENT_POLL_MS);
    };
    timer = setTimeout(tick, CONSENT_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [consent, api, queryKey, queryClient, addToast]);

  const settled = (answer, message) => {
    if (answer?.transport !== undefined)
      queryClient.setQueryData(queryKey, { transport: answer.transport });
    else queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    if (message) addToast(message);
    for (const line of warningLines(answer?.warnings)) addToast(line, 'warning');
    setMode(null);
  };

  const resume = useMutation({
    mutationFn: () => api.resume(),
    onSuccess: (answer) => settled(answer, 'Sending resumed'),
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const clear = useMutation({
    mutationFn: () => api.clear(),
    onSuccess: (answer) => {
      queryClient.setQueryData(queryKey, { transport: null });
      settled(answer, answer?.removed ? 'Mail removed' : 'Nothing to remove');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
    onSettled: () => setConfirmClear(false),
  });

  if (query.isLoading) {
    return (
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
    );
  }
  if (query.isError) {
    return (
      <p className="text-xs text-red-400">
        Failed to read the mail settings: {errorMessage(query.error)}
      </p>
    );
  }

  const health = healthText(transport?.health);
  const limited = isLimited(transport?.budget);
  const own = transport?.kind != null;

  return (
    <div className="space-y-3">
      {transport ? (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-300">{transportSummary(transport)}</p>
          <p className="text-xs text-zinc-400">
            Sender: <span className="font-mono text-zinc-200">{senderText(transport.sender)}</span>
          </p>
          {health && <p className={`text-xs ${TONES[health.tone]}`}>{health.text}</p>}
          {transport.budget && <Budget budget={transport.budget} />}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          {scope === null
            ? 'No mail is set up. Invitations show their link only, nobody can reset a forgotten password, and Authelia writes its mail to a file.'
            : 'This domain sends through the relay’s transport and sender, if the relay has one.'}
        </p>
      )}

      {consent && <ConsentWait consent={consent} onDone={() => setConsent(null)} />}

      {mode === null && !consent && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={() => setMode('google')}>
            <Mail size={14} />{' '}
            {transport?.kind === 'gmail-api' ? 'Connect Google again' : 'Use a Google account'}
          </button>
          <button type="button" className={BUTTON} onClick={() => setMode('smtp')}>
            <Server size={14} />{' '}
            {transport?.kind === 'smtp' ? 'Change the SMTP server' : 'Use an SMTP server'}
          </button>
          {(transport || scope !== null) && (
            <button type="button" className={BUTTON} onClick={() => setMode('sender')}>
              <Pencil size={14} />{' '}
              {transport ? (own ? 'Sender and limit' : 'Sender') : 'Own sender only'}
            </button>
          )}
          {limited && (
            <button
              type="button"
              className={BUTTON}
              disabled={resume.isPending}
              onClick={() => resume.mutate()}
              title="Only once the provider shows the account sending again"
            >
              <Play size={14} /> {resume.isPending ? 'Resuming…' : 'Resume sending'}
            </button>
          )}
          {transport && (
            <button type="button" className={BUTTON} onClick={() => setConfirmClear(true)}>
              <Trash2 size={14} /> Remove
            </button>
          )}
        </div>
      )}

      {mode === 'google' && (
        <GoogleForm
          scope={scope}
          transport={transport}
          primary={primary}
          onStarted={(answer) => {
            setMode(null);
            setConsent({ ...answer, before: transport?.updatedAt ?? null });
          }}
          onCancel={() => setMode(null)}
        />
      )}
      {mode === 'smtp' && (
        <SmtpForm
          scope={scope}
          transport={transport}
          onSaved={(answer) => settled(answer, 'SMTP server checked and saved')}
          onCancel={() => setMode(null)}
        />
      )}
      {mode === 'sender' && (
        <SenderForm
          scope={scope}
          transport={transport}
          senderOnly={scope !== null && !own}
          onSaved={(answer) => settled(answer, 'Sender saved')}
          onCancel={() => setMode(null)}
        />
      )}

      {transport && mode === null && !consent && <TestMail scope={scope} />}

      {confirmClear && (
        <ConfirmDialog
          title={scope === null ? 'Remove the relay’s mail?' : `Remove ${scope}’s mail override?`}
          message={
            scope === null
              ? 'Invitations stop being mailed, password reset stops, and Authelia writes its mail to a file again. A Google grant is revoked.'
              : 'The domain sends through the relay’s transport and sender again. A Google grant of its own is revoked.'
          }
          confirmLabel="Remove"
          destructive
          isPending={clear.isPending}
          onConfirm={() => clear.mutate()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
