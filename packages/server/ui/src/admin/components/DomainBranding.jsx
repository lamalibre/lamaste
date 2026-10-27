/**
 * The Branding section of a domain's card (the Domains page): the brand of
 * the domain's auth pages — its fields, its logo and favicon, a preview of
 * the sign-in card — and its removal. The rules are core's
 * (`@lamalibre/lamaste/branding`, through lib/branding.js); a refusal is
 * shown beside its field and never echoes a value.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Save, Trash2, Upload, User, X } from 'lucide-react';
import { AUTH_BRANDING_THEMES } from '@lamalibre/lamaste/branding';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { ConfirmDialog } from './Dialog.jsx';
import { refusalOf } from '../lib/errorMessage.js';
import {
  BRAND_ASSETS,
  BRAND_REACH,
  THEME_LABELS,
  assetProblem,
  assetText,
  base64OfDataUrl,
  brandFormFrom,
  brandRequest,
  explainBrandingRefusal,
  fieldErrorsOf,
  formProblems,
  previewModel,
  warningLines,
} from '../lib/branding.js';

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50';
const INPUT =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none';

const brandKey = (name) => ['domain-branding', name];
const previewKey = (name) => ['domain-branding-preview', name];

/** The base64 of a chosen file (its data URL without the prefix). */
function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read'));
    reader.onload = () => {
      const data = base64OfDataUrl(reader.result);
      if (data === null) reject(new Error('The file could not be read'));
      else resolve(data);
    };
    reader.readAsDataURL(file);
  });
}

function Field({ label, error, children, hint }) {
  return (
    <label className="block text-xs text-zinc-400">
      <span className="mb-1 block">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-zinc-600">{hint}</span>
      ) : null}
    </label>
  );
}

/** A mock of the sign-in card from the form's values and the panel's preview. */
function SignInPreview({ model, previewError }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">Preview of the sign-in card · theme {model.themeNote}</p>
      <div className={`rounded-lg p-5 ${model.page}`}>
        <div
          className={`mx-auto max-w-xs rounded-xl border p-5 shadow ${model.card} ${model.text}`}
        >
          {model.logoUrl ? (
            <img
              src={model.logoUrl}
              alt=""
              className="mx-auto mb-3 max-h-16 max-w-[12rem] object-contain"
            />
          ) : (
            <User
              size={40}
              className="mx-auto mb-3"
              style={{ color: model.accent ?? undefined }}
              aria-hidden="true"
            />
          )}
          <p className="mb-3 text-center text-sm font-semibold">{model.name}</p>
          <div className="space-y-2">
            <div className={`rounded border px-2 py-1 text-xs ${model.input} ${model.muted}`}>
              Username
            </div>
            <div className={`rounded border px-2 py-1 text-xs ${model.input} ${model.muted}`}>
              Password
            </div>
            <div
              className={`rounded px-2 py-1.5 text-center text-xs font-semibold ${model.accent ? '' : 'bg-blue-600 text-white'}`}
              // The accent is the operator's colour: a value, not a class.
              style={
                model.accent
                  ? { backgroundColor: model.accent, color: model.accentText }
                  : undefined
              }
            >
              Sign in
            </div>
          </div>
          <p className={`mt-3 text-center text-[10px] line-through ${model.muted}`}>
            {model.footer}
          </p>
        </div>
      </div>
      <ul className="space-y-0.5 text-xs text-zinc-500">
        <li>
          Browser tab: <span className="text-zinc-300">{model.title}</span>
        </li>
        <li>The “{model.footer}” footer is hidden on a branded domain.</li>
        {model.logoNote && <li>{model.logoNote}</li>}
        {previewError && (
          <li className="text-yellow-400">
            The panel’s rendered texts are unavailable: {previewError}
          </li>
        )}
      </ul>
    </div>
  );
}

function AssetRow({ kind, view, domain, disabled }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const inputRef = useRef(null);
  const asset = BRAND_ASSETS[kind];
  const current = view?.[kind] ?? null;
  const onError = (err) => addToast(explainBrandingRefusal(err, kind), 'error');
  const done = (result, what) => {
    addToast(`${asset.label} ${what}`);
    for (const line of warningLines(result?.warnings)) addToast(line, 'warning');
    queryClient.invalidateQueries({ queryKey: brandKey(domain.name) });
    queryClient.invalidateQueries({ queryKey: previewKey(domain.name) });
  };
  const set = useMutation({
    mutationFn: async (file) => {
      const data = await readFileBase64(file);
      const options = { ifRevision: view.revision };
      return kind === 'logo'
        ? client.setDomainBrandingLogo(domain.name, data, options)
        : client.setDomainBrandingFavicon(domain.name, data, options);
    },
    onSuccess: (result) => done(result, result.changed ? 'set' : 'unchanged (the same file)'),
    onError,
  });
  const remove = useMutation({
    mutationFn: () =>
      kind === 'logo'
        ? client.removeDomainBrandingLogo(domain.name)
        : client.removeDomainBrandingFavicon(domain.name),
    onSuccess: (result) => done(result, 'removed'),
    onError,
  });
  const choose = (event) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    const problem = assetProblem(kind, file);
    if (problem) addToast(problem, 'error');
    else set.mutate(file);
  };
  const busy = set.isPending || remove.isPending;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs">
      <div>
        <span className="text-zinc-400">{asset.label}: </span>
        <span className="text-zinc-200">{assetText(current)}</span>
        {current?.sha256 && (
          <span className="ml-2 font-mono text-zinc-600" title={current.sha256}>
            {current.sha256.slice(0, 12)}…
          </span>
        )}
        <span className="block text-zinc-600">{asset.hint}</span>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={asset.accept}
          onChange={choose}
          className="hidden"
          aria-label={`Choose the ${kind}`}
        />
        <button
          type="button"
          className={BUTTON}
          disabled={disabled || busy}
          title={disabled ? 'Save the brand’s name first' : undefined}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={14} /> {set.isPending ? 'Sending…' : current ? 'Replace' : 'Choose'}
        </button>
        {current && (
          <button
            type="button"
            className={BUTTON}
            disabled={disabled || busy}
            onClick={() => remove.mutate()}
          >
            <X size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

/** The form and preview of one domain's brand; `view` is what the panel holds (null for none). */
function BrandEditor({ domain, view }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [form, setForm] = useState(() => brandFormFrom(view));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const exists = view !== null;

  const preview = useQuery({
    queryKey: previewKey(domain.name),
    queryFn: () => client.getDomainBrandingPreview(domain.name),
    enabled: exists,
    retry: false,
  });

  /** The brand as the panel holds it now, into the form (a change was made elsewhere). */
  const reload = async () => {
    const result = await queryClient.fetchQuery({
      queryKey: brandKey(domain.name),
      queryFn: () => client.getDomainBranding(domain.name),
      staleTime: 0,
    });
    setForm(brandFormFrom(result?.branding ?? null));
    setErrors({});
    queryClient.invalidateQueries({ queryKey: previewKey(domain.name) });
  };

  const save = useMutation({
    mutationFn: () => client.updateDomainBranding(domain.name, brandRequest(form, view?.revision)),
    onSuccess: (result) => {
      addToast(
        result.created
          ? `Brand created — auth.${domain.name} now says ${result.branding.name}`
          : result.changed
            ? 'Brand saved'
            : 'Nothing changed',
      );
      for (const line of warningLines(result.warnings)) addToast(line, 'warning');
      setForm(brandFormFrom(result.branding));
      setErrors({});
      setNotice(null);
      queryClient.setQueryData(brandKey(domain.name), { branding: result.branding });
      queryClient.invalidateQueries({ queryKey: previewKey(domain.name) });
    },
    onError: (err) => {
      const { code } = refusalOf(err);
      if (code === 'invalid_branding') {
        // Beside each field; a refusal of the request as a whole as a toast.
        const byField = fieldErrorsOf(err);
        setErrors(byField);
        if (byField._ || Object.keys(byField).length === 0) {
          addToast(explainBrandingRefusal(err), 'error');
        }
        return;
      }
      if (code === 'revision_mismatch') {
        setNotice(explainBrandingRefusal(err));
        reload().catch((e) => addToast(explainBrandingRefusal(e), 'error'));
        return;
      }
      addToast(explainBrandingRefusal(err), 'error');
    },
  });

  const remove = useMutation({
    mutationFn: () => client.removeDomainBranding(domain.name),
    onSuccess: (result) => {
      addToast(`Brand removed — auth.${domain.name} is the stock sign-in page again`);
      for (const line of warningLines(result.warnings)) addToast(line, 'warning');
      setForm(brandFormFrom(null));
      setErrors({});
      setNotice(null);
      queryClient.setQueryData(brandKey(domain.name), { branding: null });
      queryClient.removeQueries({ queryKey: previewKey(domain.name) });
    },
    onError: (err) => addToast(explainBrandingRefusal(err), 'error'),
    onSettled: () => setConfirmRemove(false),
  });

  const update = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };
  const submit = (event) => {
    event.preventDefault();
    const problems = formProblems(form);
    setErrors(problems);
    if (Object.keys(problems).length === 0) save.mutate();
  };
  const accentValid = /^#[0-9a-f]{6}$/i.test(form.accent);
  const model = previewModel(form, preview.data ?? null, view, domain);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">{BRAND_REACH}</p>
      {!exists && (
        <p className="text-xs text-zinc-400">
          No brand — the sign-in is Authelia’s stock page. Give it a name to create one.
        </p>
      )}
      {notice && (
        <p className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <form className="space-y-3" onSubmit={submit}>
          <Field
            label="Name"
            error={errors.name}
            hint="Required. The browser title and the pages’ heading."
          >
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className={INPUT}
              maxLength={64}
              placeholder="Code Lama"
            />
          </Field>
          <Field
            label="Tagline"
            error={errors.tagline}
            hint="Under the name on the invitation and refusal pages."
          >
            <input
              type="text"
              value={form.tagline}
              onChange={(e) => update('tagline', e.target.value)}
              className={INPUT}
              maxLength={160}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Theme" error={errors.theme}>
              <select
                value={form.theme}
                onChange={(e) => update('theme', e.target.value)}
                className={INPUT}
              >
                {AUTH_BRANDING_THEMES.map((theme) => (
                  <option key={theme} value={theme}>
                    {THEME_LABELS[theme] ?? theme}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Accent"
              error={errors.accent}
              hint="#rrggbb, or empty for the theme’s own."
            >
              <div className="flex gap-2">
                <input
                  type="color"
                  value={accentValid ? form.accent.toLowerCase() : '#000000'}
                  onChange={(e) => update('accent', e.target.value)}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5"
                  aria-label="Pick the accent colour"
                />
                <input
                  type="text"
                  value={form.accent}
                  onChange={(e) => update('accent', e.target.value)}
                  className={`${INPUT} font-mono`}
                  placeholder="#1f6feb"
                  maxLength={7}
                />
              </div>
            </Field>
          </div>
          <Field
            label="Support e-mail"
            error={errors.supportEmail}
            hint="The contact on the refusal pages."
          >
            <input
              type="email"
              value={form.supportEmail}
              onChange={(e) => update('supportEmail', e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field
            label="Support URL"
            error={errors.supportUrl}
            hint="https:// only — a Help link on the refusal pages."
          >
            <input
              type="url"
              value={form.supportUrl}
              onChange={(e) => update('supportUrl', e.target.value)}
              className={INPUT}
              maxLength={512}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              <Save size={14} />{' '}
              {save.isPending ? 'Saving…' : exists ? 'Save brand' : 'Create brand'}
            </button>
            {exists && (
              <button
                type="button"
                className={BUTTON}
                disabled={remove.isPending}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 size={14} /> Remove brand
              </button>
            )}
            {exists && (
              <span className="text-xs text-zinc-600">
                revision {view.revision} ·{' '}
                {view.renderedCurrent ? 'rendered' : 'rendering pending (retried every minute)'}
              </span>
            )}
          </div>
        </form>
        <div className="space-y-3">
          <AssetRow kind="logo" view={view} domain={domain} disabled={!exists} />
          <AssetRow kind="favicon" view={view} domain={domain} disabled={!exists} />
          <SignInPreview
            model={model}
            previewError={preview.isError ? explainBrandingRefusal(preview.error) : null}
          />
        </div>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove the brand of ${domain.name}?`}
          message="Its sign-in, invitation page and refusal pages go back to the stock pages. The logo and favicon are deleted."
          confirmLabel="Remove brand"
          destructive
          isPending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}

/** The Branding section of a domain's card. */
export function DomainBranding({ domain }) {
  const client = useAdminClient();
  const branding = useQuery({
    queryKey: brandKey(domain.name),
    queryFn: () => client.getDomainBranding(domain.name),
  });
  if (branding.isLoading) return <p className="text-xs text-zinc-500">Loading the brand…</p>;
  if (branding.isError) {
    return <p className="text-xs text-red-400">{explainBrandingRefusal(branding.error)}</p>;
  }
  return <BrandEditor domain={domain} view={branding.data?.branding ?? null} />;
}
