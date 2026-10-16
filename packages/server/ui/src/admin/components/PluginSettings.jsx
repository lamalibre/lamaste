import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Undo2,
  WifiOff,
} from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { errorMessage, refusalOf } from '../lib/errorMessage.js';
import { settingsHostingOutage, settingsReadOnlyReason } from '../lib/hostingState.js';
import {
  CREDENTIAL_HINT,
  buildSettingsUpdate,
  canClear,
  changedKeys,
  initialInputs,
  initialSecretActions,
  looksLikeCredential,
  needsValue,
  secretMaskSupported,
  secretState,
  secretStatusText,
  settingsErrorsOf,
  settingsSourceText,
} from '../lib/pluginSettings.js';

const INPUT =
  'w-full rounded bg-zinc-800 border px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-60';

/** How often read-only settings are read again, to open the form once its hosting is up. */
const READ_ONLY_POLL_MS = 10_000;

/**
 * Whether this browser masks a secret's text input (`-webkit-text-security`;
 * every current browser — Firefox since 114). Read once: it does not change.
 */
const SECRET_MASKED = secretMaskSupported(typeof CSS === 'undefined' ? undefined : CSS);

/** A secret's text never leaves its input by the clipboard, as a password input's does not. */
function refuseClipboard(e) {
  e.preventDefault();
}

const SMALL_BUTTON =
  'flex items-center gap-1.5 rounded bg-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50';

function inputClass(error) {
  return `${INPUT} ${error ? 'border-red-500/70' : 'border-zinc-700'}`;
}

/** "3 required settings not set", from the plugin list's settings summary. */
function missingText(summary) {
  const count = summary.missing?.length ?? 0;
  if (count === 0) return 'needs configuration';
  return `${count} required setting${count > 1 ? 's' : ''} not set`;
}

/**
 * "Needs configuration" for a plugin's card, from the plugin list's
 * settings summary (`{ configured, missing, syncedAt }`) — nothing when it
 * is configured or declares no settings.
 */
export function NeedsConfigurationBadge({ summary }) {
  if (!summary || summary.configured !== false) return null;
  const missing = summary.missing ?? [];
  return (
    <span
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400"
      title={
        missing.length > 0
          ? `Required settings not set: ${missing.join(', ')}`
          : 'Required settings are not set'
      }
    >
      <SlidersHorizontal size={11} />
      Needs configuration
    </span>
  );
}

/** The label of a select's empty choice: back to the default, unset, or nothing chosen yet. */
function emptyChoiceLabel(field) {
  if (field.default !== undefined) {
    const option = (field.options ?? []).find((o) => o.value === field.default);
    return `Default (${option ? option.label : field.default})`;
  }
  return needsValue(field) ? 'Choose…' : 'Not set';
}

function FieldRow({ id, field, missing, error, children }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <label htmlFor={id} className="text-zinc-300">
          {field.label}
        </label>
        <span className="font-mono text-zinc-600">{field.key}</span>
        {field.required && (
          <span className={missing ? 'text-yellow-400' : 'text-zinc-500'}>
            {missing ? 'required — not set' : 'required'}
          </span>
        )}
      </div>
      {field.description && <p className="mb-1 text-zinc-500">{field.description}</p>}
      {children}
      {error && <p className="mt-1 text-red-400">{error}</p>}
    </div>
  );
}

/**
 * The form for one revision of a plugin's settings. Non-secret inputs are
 * controlled; a secret is typed into an uncontrolled, masked text input —
 * never a password input, which browsers offer to save in their password
 * managers (`autocomplete="new-password"` only stops autofill) — that is
 * never prefilled, keeps no form history (`autocomplete="off"`, no name),
 * cannot be copied out and whose value never enters React state: the form
 * reads it once when it submits, empties the input, and hands the update to
 * `onSubmit`. Only the fields the administrator changed are sent.
 */
function SettingsForm({
  pluginName,
  view,
  readOnly,
  saving,
  errors,
  onEdit,
  onInvalid,
  onSubmit,
  onDiscard,
}) {
  const [inputs, setInputs] = useState(() => initialInputs(view));
  const [badInput, setBadInput] = useState({});
  const [secretActions, setSecretActions] = useState(() => initialSecretActions(view));
  // Whether each secret input holds text — never the text itself.
  const [secretFilled, setSecretFilled] = useState({});
  const secretInputs = useRef(new Map());

  const initial = initialInputs(view);
  const changed = changedKeys(view, { inputs, badInput, secretActions, secretFilled });
  const missing = new Set(view.missing ?? []);

  const setInput = (key, value, bad = false) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setBadInput((prev) => ({ ...prev, [key]: bad }));
    onEdit(key);
  };

  const setSecretAction = (key, action) => {
    const input = secretInputs.current.get(key);
    if (input) input.value = '';
    setSecretFilled((prev) => ({ ...prev, [key]: false }));
    setSecretActions((prev) => ({ ...prev, [key]: action }));
    onEdit(key);
  };

  const secretRef = (key) => (element) => {
    if (element) secretInputs.current.set(key, element);
    else secretInputs.current.delete(key);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly || saving) return;
    const secrets = {};
    for (const field of view.fields) {
      if (field.type !== 'secret') continue;
      secrets[field.key] = {
        action: secretActions[field.key],
        value: secretInputs.current.get(field.key)?.value ?? '',
      };
    }
    const update = buildSettingsUpdate(view, { inputs, badInput, secrets });
    if (!update.ok) {
      onInvalid(update.errors);
      return;
    }
    if (update.changed.length === 0) return;
    // The secrets typed leave with the update, in the request body alone.
    for (const input of secretInputs.current.values()) input.value = '';
    setSecretFilled({});
    onSubmit(update.body);
  };

  const control = (id, field) => {
    const key = field.key;
    const error = errors[key] ?? null;
    switch (field.type) {
      case 'string':
        return (
          <>
            <input
              id={id}
              type="text"
              value={inputs[key]}
              onChange={(e) => setInput(key, e.target.value)}
              placeholder={field.default !== undefined ? `Default: ${field.default}` : undefined}
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={looksLikeCredential(field) ? `${id}-hint` : undefined}
              className={inputClass(error)}
            />
            {looksLikeCredential(field) && (
              <p id={`${id}-hint`} className="mt-1 flex items-start gap-1 text-yellow-400/90">
                <Info size={11} className="mt-0.5 shrink-0" />
                {CREDENTIAL_HINT}
              </p>
            )}
          </>
        );
      case 'integer':
      case 'number':
        return (
          <input
            id={id}
            type="number"
            inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
            step={field.type === 'integer' ? 1 : 'any'}
            min={field.min}
            max={field.max}
            value={inputs[key]}
            onChange={(e) => setInput(key, e.target.value, e.target.validity.badInput)}
            placeholder={field.default !== undefined ? `Default: ${field.default}` : undefined}
            aria-invalid={error ? true : undefined}
            className={`${inputClass(error)} sm:w-48`}
          />
        );
      case 'boolean':
        return (
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <input
              id={id}
              type="checkbox"
              checked={inputs[key] === true}
              onChange={(e) => setInput(key, e.target.checked)}
              className="accent-cyan-500"
            />
            {inputs[key] === null ? 'not set' : inputs[key] ? 'on' : 'off'}
          </span>
        );
      case 'enum':
        return (
          <select
            id={id}
            value={inputs[key]}
            onChange={(e) => setInput(key, e.target.value)}
            aria-invalid={error ? true : undefined}
            className={`${inputClass(error)} sm:w-auto`}
          >
            {(canClear(field) || initial[key] === '' || inputs[key] === '') && (
              <option value="">{emptyChoiceLabel(field)}</option>
            )}
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      case 'secret': {
        const state = secretState(view, key);
        const action = secretActions[key];
        return (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 ${state.set ? 'text-zinc-300' : 'text-zinc-500'}`}
              >
                <KeyRound size={11} />
                {secretStatusText(state)}
              </span>
              {action === 'clear' && <span className="text-yellow-400">cleared when you save</span>}
              {!readOnly && state.set && action === 'keep' && (
                <>
                  <button
                    type="button"
                    onClick={() => setSecretAction(key, 'replace')}
                    className={SMALL_BUTTON}
                  >
                    <RefreshCw size={11} />
                    Replace
                  </button>
                  {canClear(field) && (
                    <button
                      type="button"
                      onClick={() => setSecretAction(key, 'clear')}
                      className={SMALL_BUTTON}
                    >
                      <Eraser size={11} />
                      Clear
                    </button>
                  )}
                </>
              )}
              {!readOnly && state.set && action !== 'keep' && (
                <button
                  type="button"
                  onClick={() => setSecretAction(key, 'keep')}
                  className={SMALL_BUTTON}
                >
                  <Undo2 size={11} />
                  Keep the current one
                </button>
              )}
            </div>
            {!readOnly && action === 'replace' && (
              <>
                <input
                  id={id}
                  ref={secretRef(key)}
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={state.set ? 'New value' : 'Value'}
                  onChange={(e) => {
                    const filled = e.target.value !== '';
                    setSecretFilled((prev) =>
                      prev[key] === filled ? prev : { ...prev, [key]: filled },
                    );
                    onEdit(key);
                  }}
                  onCopy={refuseClipboard}
                  onCut={refuseClipboard}
                  aria-invalid={error ? true : undefined}
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  className={`${inputClass(error)} [-webkit-text-security:disc]`}
                />
                {!SECRET_MASKED && (
                  <p className="text-yellow-400/90">
                    This browser cannot mask the value: it shows as you type it. Use a current
                    browser to keep it out of sight.
                  </p>
                )}
              </>
            )}
          </div>
        );
      }
      default:
        return <span className="text-zinc-500">Cannot be set here ({field.type})</span>;
    }
  };

  return (
    <form onSubmit={handleSubmit} autoComplete="off" noValidate>
      <fieldset disabled={readOnly || saving} className="space-y-3">
        {view.fields.map((field) => {
          const id = `plugin-settings-${pluginName}-${field.key}`;
          return (
            <FieldRow
              key={field.key}
              id={id}
              field={field}
              missing={missing.has(field.key)}
              error={errors[field.key] ?? null}
            >
              {control(id, field)}
            </FieldRow>
          );
        })}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={changed.length === 0 || saving}
              className="flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Save
            </button>
            {changed.length > 0 && (
              <>
                <button type="button" onClick={onDiscard} className={SMALL_BUTTON}>
                  <Undo2 size={11} />
                  Discard changes
                </button>
                <span className="text-zinc-500">
                  {changed.length} change{changed.length > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}

/**
 * A plugin's settings, loaded when the section opens: live from the agent
 * half while its hosting is up — and only then editable — else read-only
 * from the relay's copy, with why, polled until the hosting is up.
 */
function SettingsPanel({ pluginName }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const queryKey = ['plugin-settings', pluginName];
  const query = useQuery({
    queryKey,
    queryFn: () => client.getPluginSettings(pluginName),
    // Not refetched under the administrator's edits — an update against a
    // stale revision is refused (409) and reloads; while read-only, polled
    // until the settings can be changed.
    refetchOnWindowFocus: false,
    refetchInterval: (q) =>
      q.state.data && settingsReadOnlyReason(q.state.data, q.state.dataUpdatedAt) !== null
        ? READ_ONLY_POLL_MS
        : false,
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resets, setResets] = useState(0);
  // The update between the submit and the request. It carries the secrets
  // typed, so it is never the mutation's variables (react-query keeps those
  // in its cache): the request takes it from here once.
  const outgoing = useRef(null);
  useEffect(
    () => () => {
      outgoing.current = null;
    },
    [],
  );

  const reload = () => queryClient.invalidateQueries({ queryKey });
  const resetForm = () => setResets((n) => n + 1);

  const save = useMutation({
    mutationFn: () => {
      const body = outgoing.current;
      outgoing.current = null;
      if (body === null) return Promise.reject(new Error('Nothing to save'));
      return client.updatePluginSettings(pluginName, body);
    },
    onSuccess: (view) => {
      if (view && Array.isArray(view.fields)) queryClient.setQueryData(queryKey, view);
      else reload();
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast('Settings saved');
    },
    onError: (err) => {
      const { code } = refusalOf(err);
      if (code === 'revision_mismatch' || code === 'schema_mismatch') {
        setNotice(
          code === 'revision_mismatch'
            ? 'The settings were changed elsewhere since this form was loaded. It now shows the current values — make your changes again.'
            : 'The agent half runs another version of these settings (an update may be under way). The form was reloaded — try again once the update has finished.',
        );
        resetForm();
        reload();
        return;
      }
      if (code === 'hosting_offline' || code === 'timeout' || code === 'unauthenticated') {
        // Offline now, no answer in time, or an answer that was not the
        // agent half's (something else on the tunnel's port, or an agent
        // half built against an older core) — the change may have been
        // stored: the settings as they are now say which.
        setFormError(errorMessage(err));
        reload();
        return;
      }
      const fieldErrors = settingsErrorsOf(err);
      if (fieldErrors) {
        const known = new Set((query.data?.fields ?? []).map((f) => f.key));
        const onFields = Object.fromEntries(
          Object.entries(fieldErrors).filter(([key]) => known.has(key)),
        );
        const others = Object.entries(fieldErrors).filter(([key]) => !known.has(key));
        setErrors(onFields);
        setFormError(
          others.length > 0
            ? others
                .map(([key, message]) => (key === '_' ? message : `${key}: ${message}`))
                .join('; ')
            : 'Not saved — see the fields above.',
        );
        return;
      }
      setFormError(errorMessage(err));
    },
  });

  const clearError = (key) => {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  if (query.isPending) {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-zinc-500">
        <Loader2 size={12} className="animate-spin" /> Loading settings…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-red-400">
        <AlertCircle size={12} />
        {errorMessage(query.error)}
        <button type="button" onClick={() => query.refetch()} className={SMALL_BUTTON}>
          <RefreshCw size={11} />
          Retry
        </button>
      </div>
    );
  }

  const view = query.data;
  const now = query.dataUpdatedAt;
  const readOnlyReason = settingsReadOnlyReason(view, now);
  const offline = settingsHostingOutage(view.hosting) !== null;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-zinc-600">{settingsSourceText(view, now)}</p>
      {readOnlyReason && (
        <div
          className={`flex items-start gap-1.5 rounded border p-2 ${offline ? 'border-red-500/30 text-red-400' : 'border-zinc-700 text-zinc-400'}`}
        >
          {offline ? (
            <WifiOff size={12} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={12} className="mt-0.5 shrink-0" />
          )}
          <span>
            {readOnlyReason}.{' '}
            <span className="text-zinc-500">
              Read-only for now: changes go to its agent half, which has to be reachable.
            </span>
          </span>
        </div>
      )}
      {notice && (
        <p className="flex items-start gap-1.5 text-yellow-400">
          <RotateCcw size={12} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      )}
      <SettingsForm
        key={`${view.revision}:${resets}`}
        pluginName={pluginName}
        view={view}
        readOnly={readOnlyReason !== null}
        saving={save.isPending}
        errors={errors}
        onEdit={clearError}
        onInvalid={(fieldErrors) => {
          setErrors(fieldErrors);
          setFormError('Not saved — see the fields above.');
        }}
        onSubmit={(body) => {
          setErrors({});
          setFormError(null);
          setNotice(null);
          outgoing.current = body;
          save.mutate();
        }}
        onDiscard={() => {
          setErrors({});
          setFormError(null);
          resetForm();
        }}
      />
      {formError && (
        <p className="flex items-start gap-1.5 text-red-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {formError}
        </p>
      )}
    </div>
  );
}

/**
 * The Settings section of a plugin's card — for a plugin whose manifest
 * declares settings (the plugin list's `settings` summary). Collapsed, it
 * shows whether the plugin is configured; opened, the form, generated from
 * the fields: text, number, checkbox and choice inputs, and secrets as
 * masked inputs with when they were set, Replace and — for an optional
 * one — Clear.
 */
export default function PluginSettings({ plugin }) {
  const [open, setOpen] = useState(false);
  const summary = plugin.settings;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-zinc-300 font-medium">Settings</span>
        {summary.configured ? (
          <span className="inline-flex items-center gap-1 text-green-400">
            <Check size={11} /> configured
          </span>
        ) : (
          <span className="text-yellow-400">{missingText(summary)}</span>
        )}
      </button>
      {open && <SettingsPanel pluginName={plugin.name} />}
    </div>
  );
}
