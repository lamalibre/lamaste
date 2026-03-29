import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronLeft,
  Key,
  MapPin,
  HardDrive,
  Tag,
  Rocket,
  ExternalLink,
  Shield,
  AlertTriangle,
  Info,
  BookOpen,
  Globe,
  Plus,
} from 'lucide-react';

const DOCS_BASE = 'https://lamalibre.github.io/portlama';

const DISCLAIMER_KEY = 'portlama-cloud-disclaimer-dismissed';

// ---------------------------------------------------------------------------
// Step 0: Overview — risks, security measures, documentation links
// ---------------------------------------------------------------------------

function OverviewStep({ dismissed, setDismissed }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded bg-amber-500/5 border border-amber-500/20 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-400 font-medium mb-1">Before you continue</p>
            <p className="text-zinc-400 leading-relaxed">
              This wizard will create a <strong className="text-zinc-300">DigitalOcean droplet (starting at $4/month)</strong> billed
              to your account. The API token you provide grants Portlama permission to create, read, and delete
              droplets and SSH keys in your account.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded bg-zinc-950 border border-zinc-800 p-3">
        <div className="flex items-start gap-2">
          <Shield size={14} className="text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-cyan-400 font-medium mb-1.5">Security measures</p>
            <ul className="text-zinc-400 space-y-1 leading-relaxed">
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>Tokens with dangerous scopes (<code className="text-zinc-300">database:delete</code>, <code className="text-zinc-300">kubernetes:create</code>, etc.) are <strong className="text-zinc-300">rejected</strong></span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>Only 5 resource groups are required — the minimum for provisioning</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>Your token is stored in the <strong className="text-zinc-300">OS credential store</strong> (Keychain / libsecret), never in plaintext</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>SSH keys are <strong className="text-zinc-300">temporary</strong> — generated for installation, then securely deleted</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>Only droplets tagged <code className="text-zinc-300">portlama:managed</code> can be destroyed by the app</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded bg-cyan-500/5 border border-cyan-500/20 p-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-cyan-400 font-medium mb-1">Strongly recommended</p>
            <p className="text-zinc-400 leading-relaxed">
              If you have other infrastructure on DigitalOcean, <strong className="text-zinc-300">create a dedicated
              DO team</strong> for Portlama. API tokens are account-wide — a separate team is the only way to
              fully isolate Portlama from your other resources.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded bg-zinc-950 border border-zinc-800 p-3">
        <div className="flex items-start gap-2">
          <BookOpen size={14} className="text-zinc-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-zinc-300 font-medium mb-1.5">Documentation</p>
            <div className="space-y-1">
              {[
                { label: 'Cloud Provisioning Guide', path: '/02-guides/cloud-provisioning' },
                { label: 'Security Model', path: '/01-concepts/security-model' },
                { label: 'Desktop App Setup', path: '/02-guides/desktop-app-setup' },
                { label: 'Certificate Management', path: '/02-guides/certificate-management' },
              ].map(({ label, path }) => (
                <a
                  key={path}
                  href="#"
                  onClick={async (e) => {
                    e.preventDefault();
                    await open(`${DOCS_BASE}${path}`);
                  }}
                  className="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <ExternalLink size={9} />
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={dismissed}
          onChange={(e) => setDismissed(e.target.checked)}
          className="rounded border-zinc-600 bg-zinc-800 text-cyan-400 focus:ring-cyan-400 w-3.5 h-3.5"
        />
        <span className="text-zinc-500">Do not show this again</span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Provider & Token
// ---------------------------------------------------------------------------

function ProviderStep({ token, setToken, validation, onValidate, validating, savedToken }) {
  const requiredScopes = [
    'droplet:create',
    'droplet:read',
    'droplet:delete',
    'ssh_key:create',
    'ssh_key:read',
    'ssh_key:delete',
    'tag:create',
    'tag:read',
    'regions:read',
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-zinc-400 block mb-1">Provider</label>
        <div className="bg-zinc-800 rounded px-3 py-2 text-sm text-white flex items-center gap-2">
          <span>DigitalOcean</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400">
            Active
          </span>
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">API Token</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={savedToken ? 'Token saved in keychain' : 'dop_v1_...'}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
          />
          <button
            onClick={onValidate}
            disabled={(!token.trim() && !savedToken) || validating}
            className="text-xs px-3 py-2 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
          >
            {validating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Shield size={12} />
            )}
            Validate
          </button>
        </div>
      </div>

      {validation && (
        <div className="rounded bg-zinc-950 border border-zinc-800 p-3">
          <div className="flex items-center gap-2 mb-2">
            {validation.valid ? (
              <CheckCircle2 size={14} className="text-green-400" />
            ) : (
              <XCircle size={14} className="text-red-400" />
            )}
            <span className={`text-xs font-medium ${validation.valid ? 'text-green-400' : 'text-red-400'}`}>
              {validation.valid ? 'Token is valid' : 'Token rejected'}
            </span>
            {validation.email && (
              <span className="text-xs text-zinc-500 ml-auto">{validation.email}</span>
            )}
          </div>

          {validation.missingScopes?.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-red-400 mb-1">Missing required scopes:</p>
              <div className="flex flex-wrap gap-1">
                {validation.missingScopes.map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-mono">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {validation.excessScopes?.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-amber-400 mb-1">Dangerous excess scopes detected:</p>
              <div className="flex flex-wrap gap-1">
                {validation.excessScopes.map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!validation.valid && (
            <div className="mt-2 pt-2 border-t border-zinc-800">
              <p className="text-xs text-zinc-400 mb-1">
                Create a scoped token with only these permissions:
              </p>
              <div className="flex flex-wrap gap-1 mb-2">
                {requiredScopes.map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                    {s}
                  </span>
                ))}
              </div>
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  await open('https://cloud.digitalocean.com/account/api/tokens/new');
                }}
                className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
              >
                <ExternalLink size={10} />
                Create token on DigitalOcean
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Region Selection
// ---------------------------------------------------------------------------

function RegionStep({ regions, selectedRegion, setSelectedRegion, loading, error }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
        <span className="text-sm text-zinc-400 ml-2">Probing region latency...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4">
        <p className="text-sm text-red-400">Failed to load regions: {error.toString()}</p>
        <p className="text-xs text-zinc-500 mt-1">Check your API token and network connection.</p>
      </div>
    );
  }

  if (!regions?.length) {
    return (
      <p className="text-sm text-zinc-400 py-4">No regions available. Check your API token.</p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">
        Select a region. Sorted by latency — the closest region is highlighted.
      </p>
      <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
        {regions.map((r, idx) => (
          <button
            key={r.slug}
            onClick={() => setSelectedRegion(r.slug)}
            className={`text-left rounded border px-3 py-2 text-xs ${
              selectedRegion === r.slug
                ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                : idx === 0 && !selectedRegion
                  ? 'border-cyan-400/30 bg-zinc-900 text-zinc-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.slug}</span>
              <span className="text-zinc-500">{r.latencyMs}ms</span>
            </div>
            <div className="text-zinc-500 text-[10px] mt-0.5">{r.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Droplet Size
// ---------------------------------------------------------------------------

const DEFAULT_SIZE_SLUG = 's-1vcpu-512mb-10gb';

function formatMemory(mb) {
  return mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`;
}

function SizeStep({ sizes, selectedSize, setSelectedSize, loading, error }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
        <span className="text-sm text-zinc-400 ml-2">Loading available sizes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4">
        <p className="text-sm text-red-400">Failed to load sizes: {error.toString()}</p>
      </div>
    );
  }

  if (!sizes?.length) {
    return (
      <p className="text-sm text-zinc-400 py-4">No sizes available for this region.</p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">
        Select a droplet size. The minimum size is sufficient for most Portlama deployments.
      </p>
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {sizes.map((s) => {
          const isDefault = s.slug === DEFAULT_SIZE_SLUG;
          const isSelected = selectedSize === s.slug;
          return (
            <button
              key={s.slug}
              onClick={() => setSelectedSize(s.slug)}
              className={`w-full text-left rounded border px-3 py-2.5 text-xs ${
                isSelected
                  ? 'border-cyan-400 bg-cyan-400/10'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={isSelected ? 'text-cyan-400 font-medium' : 'text-zinc-300 font-medium'}>
                    {formatMemory(s.memory)}
                  </span>
                  {isDefault && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400 uppercase tracking-wide">
                      Recommended
                    </span>
                  )}
                </div>
                <span className={isSelected ? 'text-cyan-400 font-medium' : 'text-zinc-300 font-medium'}>
                  ${s.priceMonthly}/mo
                </span>
              </div>
              <div className="text-zinc-500 mt-0.5">
                {s.vcpus} vCPU · {s.disk} GB SSD
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Domain (conditional — only when hasDnsAccess is true)
// ---------------------------------------------------------------------------

function DomainStep({
  domains,
  loading,
  error,
  selectedDomain,
  setSelectedDomain,
  subdomain,
  setSubdomain,
  onCreateDomain,
  creating,
  createError,
  newDomainName,
  setNewDomainName,
  showCreate,
  setShowCreate,
  existingRecords,
  recordsLoading,
  overrideDns,
  setOverrideDns,
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
        <span className="text-sm text-zinc-400 ml-2">Loading domains...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/5 p-3">
        <p className="text-xs text-red-400">Failed to load domains: {error.toString()}</p>
      </div>
    );
  }

  const fqdnPreview = selectedDomain
    ? subdomain ? `${subdomain}.${selectedDomain}` : selectedDomain
    : null;
  const wildcardPreview = fqdnPreview
    ? `*.${fqdnPreview}`
    : null;

  const domainNameValid = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(newDomainName);
  const subdomainValid = !subdomain || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Select a DigitalOcean-managed domain. DNS records will be created automatically.
      </p>

      {domains?.length > 0 && (
        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
          {domains.map((d) => (
            <button
              key={d.name}
              onClick={() => setSelectedDomain(d.name)}
              className={`text-left rounded border px-3 py-2 text-xs ${
                selectedDomain === d.name
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <span className="font-medium font-mono">{d.name}</span>
            </button>
          ))}
        </div>
      )}

      {!showCreate ? (
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
        >
          <Plus size={10} />
          Add a domain
        </button>
      ) : (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value.toLowerCase())}
              placeholder="example.com"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
            />
            <button
              onClick={onCreateDomain}
              disabled={!domainNameValid || creating}
              className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-50 flex items-center gap-1"
            >
              {creating ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              Create
            </button>
          </div>
          {newDomainName && !domainNameValid && (
            <p className="text-xs text-red-400">Enter a valid domain name.</p>
          )}
          {createError && (
            <p className="text-xs text-red-400">Failed to create domain: {createError.toString()}</p>
          )}
          <div className="rounded bg-amber-500/5 border border-amber-500/20 p-2">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={10} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[10px] text-amber-400 leading-relaxed">
                You must point your domain&apos;s nameservers to DigitalOcean
                (<code className="text-amber-300">ns1.digitalocean.com</code>,{' '}
                <code className="text-amber-300">ns2.digitalocean.com</code>,{' '}
                <code className="text-amber-300">ns3.digitalocean.com</code>)
                for DNS records to resolve.
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedDomain && (
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Subdomain prefix <span className="text-zinc-600">(optional)</span></label>
          <input
            type="text"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
            placeholder="panel"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
          />
          {subdomain && !subdomainValid && (
            <p className="text-xs text-red-400 mt-1">Lowercase letters, numbers, and hyphens only.</p>
          )}
        </div>
      )}

      {fqdnPreview && (() => {
        // Determine which existing A records conflict with the ones we need
        const aName = subdomain || '@';
        const wildcardName = subdomain ? `*.${subdomain}` : '*';
        const existingA = existingRecords?.filter((r) => r.type === 'A');
        const conflictA = existingA?.find((r) => r.name === aName);
        const conflictWildcard = existingA?.find((r) => r.name === wildcardName);
        const hasConflicts = !!conflictA || !!conflictWildcard;

        return (
          <div className="space-y-2">
            <div className="rounded bg-zinc-950 border border-zinc-800 p-3 text-xs space-y-1">
              <p className="text-zinc-300 font-medium">DNS records to create</p>
              <p className="text-zinc-400 font-mono">
                A &rarr; {fqdnPreview}
                {conflictA && (
                  <span className="text-amber-400 ml-2">(exists: {conflictA.data})</span>
                )}
              </p>
              <p className="text-zinc-400 font-mono">
                A &rarr; {wildcardPreview}
                {conflictWildcard && (
                  <span className="text-amber-400 ml-2">(exists: {conflictWildcard.data})</span>
                )}
              </p>
              {recordsLoading && (
                <p className="text-zinc-500 flex items-center gap-1 mt-1">
                  <Loader2 size={10} className="animate-spin" /> Checking existing records...
                </p>
              )}
            </div>

            {hasConflicts && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-400 leading-relaxed">
                    Existing A records found. Override them with the new server&apos;s IP during provisioning?
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideDns}
                    onChange={(e) => setOverrideDns(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-900 text-cyan-400 focus:ring-cyan-400"
                  />
                  <span className="text-xs text-zinc-300">Override existing records</span>
                </label>
              </div>
            )}
          </div>
        );
      })()}

      <div className="rounded bg-cyan-500/5 border border-cyan-500/20 p-2">
        <div className="flex items-start gap-1.5">
          <Info size={10} className="text-cyan-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            DNS records are <strong className="text-zinc-300">not auto-removed</strong> when the server is destroyed.
            You must remove them manually in the DigitalOcean DNS console.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4/5: Server Label
// ---------------------------------------------------------------------------

function LabelStep({ label, setLabel, domain, setDomain, email, setEmail, region, sizeData, hasDnsAccess, selectedDoDomain, doSubdomain }) {
  const labelValid = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(label);
  const domainValid = !domain || /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain);
  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const sizeDisplay = sizeData
    ? `${formatMemory(sizeData.memory)} / ${sizeData.vcpus} vCPU / ${sizeData.disk} GB SSD ($${sizeData.priceMonthly}/mo)`
    : 'Loading...';

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-zinc-400 block mb-1">Server Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase())}
          placeholder={`portlama-${region || 'nyc1'}`}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
        />
        {label && !labelValid && (
          <p className="text-xs text-red-400 mt-1">
            Lowercase letters, numbers, and hyphens only. Must start with a letter or number.
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-300 font-medium mb-2">Onboarding</p>
        {hasDnsAccess && selectedDoDomain ? (
          <div className="space-y-2">
            <div className="rounded bg-zinc-950 border border-zinc-800 p-2 text-xs">
              <p className="text-zinc-400">
                Domain: <span className="text-cyan-400 font-mono">{doSubdomain ? `${doSubdomain}.${selectedDoDomain}` : selectedDoDomain}</span>
              </p>
              <p className="text-zinc-500 text-[10px] mt-0.5">DNS records will be created automatically during provisioning.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Email <span className="text-zinc-600">(for Let&apos;s Encrypt)</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
              />
              {email && !emailValid && (
                <p className="text-xs text-red-400 mt-1">Enter a valid email address.</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="text-[10px] text-zinc-500 mb-2">
              Optional — you can configure these later through the admin panel.
            </p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value.toLowerCase())}
                  placeholder="example.com"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
                />
                {domain && !domainValid && (
                  <p className="text-xs text-red-400 mt-1">Enter a valid domain name.</p>
                )}
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Email <span className="text-zinc-600">(for Let&apos;s Encrypt)</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
                />
                {email && !emailValid && (
                  <p className="text-xs text-red-400 mt-1">Enter a valid email address.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="rounded bg-zinc-950 border border-zinc-800 p-3 text-xs text-zinc-400">
        <p className="font-medium text-zinc-300 mb-1">Server configuration</p>
        <p>Size: {sizeDisplay}</p>
        <p>Image: Ubuntu 24.04 LTS</p>
        <p>Region: {region}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Provisioning Progress
// ---------------------------------------------------------------------------

function buildProvisionSteps(hasDns) {
  const steps = [
    { key: 'validate_token', label: 'Validating token', cmd: 'validate-token --provider digitalocean' },
    { key: 'generate_ssh_key', label: 'Generating SSH key', cmd: 'ssh-keygen -t ed25519' },
    { key: 'upload_ssh_key', label: 'Uploading SSH key', cmd: 'upload-key --provider digitalocean' },
    { key: 'create_droplet', label: 'Creating droplet', cmd: 'create-droplet --image ubuntu-24-04-x64' },
    { key: 'wait_droplet', label: 'Waiting for boot', cmd: 'poll-droplet --wait-for active' },
  ];
  if (hasDns) {
    steps.push({ key: 'setup_dns', label: 'Setting up DNS records', cmd: 'create-a-record --type A,*.A' });
  }
  steps.push(
    { key: 'wait_ssh', label: 'Connecting via SSH', cmd: 'ssh root@host echo ok' },
    { key: 'install_portlama', label: 'Installing Portlama', cmd: 'npx @lamalibre/create-portlama --yes' },
    { key: 'retrieve_credentials', label: 'Retrieving credentials', cmd: 'scp root@host:/etc/portlama/pki/client.p12' },
    { key: 'enroll_admin', label: 'Enrolling admin certificate', cmd: 'security import -x admin.p12' },
    { key: 'save_registry', label: 'Saving configuration', cmd: 'write ~/.portlama/servers.json' },
    { key: 'cleanup', label: 'Cleaning up', cmd: 'delete-key --provider digitalocean' },
  );
  return steps;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <span className="text-cyan-400 font-mono inline-block w-[1ch]">{SPINNER_FRAMES[frame]}</span>;
}

function ProvisionStep({ provisioning, provisionError, provisionSuccess, steps }) {
  const currentIdx = steps.findIndex(s => s.key === provisioning);
  const currentStep = currentIdx >= 0 ? steps[currentIdx] : null;

  return (
    <div className="space-y-2">
      {steps.map((step, stepIdx) => {
        const isPast = provisionSuccess || (currentIdx >= 0 && currentIdx > stepIdx);
        const isCurrent = provisioning === step.key && !provisionSuccess;

        return (
          <div key={step.key} className="flex items-center gap-2 text-xs">
            {isCurrent && provisionError ? (
              <XCircle size={12} className="text-red-400" />
            ) : isCurrent ? (
              <Loader2 size={12} className="animate-spin text-cyan-400" />
            ) : isPast ? (
              <CheckCircle2 size={12} className="text-green-400" />
            ) : (
              <div className="w-3 h-3 rounded-full border border-zinc-700" />
            )}
            <span className={
              isCurrent && provisionError
                ? 'text-red-400'
                : isCurrent
                  ? 'text-cyan-400'
                  : isPast
                    ? 'text-zinc-400'
                    : 'text-zinc-600'
            }>
              {step.label}
            </span>
          </div>
        );
      })}

      {/* Running command display */}
      {currentStep && !provisionError && !provisionSuccess && (
        <div className="mt-3 rounded bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-xs flex items-center gap-2">
          <BrailleSpinner />
          <span className="text-zinc-500">$</span>
          <span className="text-zinc-300">{currentStep.cmd}</span>
        </div>
      )}

      {provisionError && (
        <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{provisionError}</p>
        </div>
      )}

      {provisionSuccess && (
        <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-400" />
            <p className="text-xs text-green-400 font-medium">Server created successfully!</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export default function CreateServerWizard({ onClose }) {
  const queryClient = useQueryClient();

  // Show the overview disclaimer as a separate screen before the wizard tabs
  const overviewDismissed = localStorage.getItem(DISCLAIMER_KEY) === 'true';
  const [showOverview, setShowOverview] = useState(!overviewDismissed);

  const [step, setStep] = useState(0);
  const [dismissChecked, setDismissChecked] = useState(false);
  const [token, setToken] = useState('');
  const [validation, setValidation] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedSize, setSelectedSize] = useState(DEFAULT_SIZE_SLUG);
  const [label, setLabel] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [provisioning, setProvisioning] = useState(null);
  const [provisionError, setProvisionError] = useState(null);
  const [provisionSuccess, setProvisionSuccess] = useState(false);
  const [regionsEnabled, setRegionsEnabled] = useState(false);
  const [sizesEnabled, setSizesEnabled] = useState(false);

  // DNS management state (opt-in when token has domain:* scopes)
  const [hasDnsAccess, setHasDnsAccess] = useState(false);
  const [domainsEnabled, setDomainsEnabled] = useState(false);
  const [selectedDoDomain, setSelectedDoDomain] = useState('');
  const [doSubdomain, setDoSubdomain] = useState('');
  const [newDomainName, setNewDomainName] = useState('');
  const [showCreateDomain, setShowCreateDomain] = useState(false);
  const [overrideDns, setOverrideDns] = useState(false);

  // Check for saved token on mount
  const { data: savedToken } = useQuery({
    queryKey: ['cloud-token-exists', 'digitalocean'],
    queryFn: async () => {
      const t = await invoke('get_cloud_token', { provider: 'digitalocean' });
      return !!t;
    },
    staleTime: Infinity,
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const tokenToUse = token.trim();
      if (tokenToUse) {
        // Save token first
        await invoke('store_cloud_token', { provider: 'digitalocean', token: tokenToUse });
        queryClient.setQueryData(['cloud-token-exists', 'digitalocean'], true);
      }
      // Empty string tells the Rust command to retrieve the saved token
      return invoke('validate_cloud_token', {
        provider: 'digitalocean',
        token: tokenToUse,
      });
    },
    onSuccess: (result) => {
      setValidation(result);
      setHasDnsAccess(result.hasDnsAccess ?? false);
    },
    onError: (err) =>
      setValidation({ valid: false, email: '', missingScopes: [], excessScopes: [], hasDnsAccess: false, error: err.toString() }),
  });

  // Region loading via useQuery, triggered when stepping to region step
  const regionsQuery = useQuery({
    queryKey: ['cloud-regions', 'digitalocean'],
    queryFn: async () => {
      const data = await invoke('get_cloud_regions', { provider: 'digitalocean' });
      // Auto-select closest region (first in list, sorted by latency)
      if (Array.isArray(data) && data.length > 0 && !selectedRegion) {
        setSelectedRegion(data[0].slug);
      }
      return data;
    },
    enabled: regionsEnabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const regions = regionsQuery.data ?? null;
  const regionsLoading = regionsQuery.isLoading && regionsEnabled;
  const regionsError = regionsQuery.error;

  // Size loading via useQuery, triggered when stepping to size step
  const sizesQuery = useQuery({
    queryKey: ['cloud-sizes', 'digitalocean', selectedRegion],
    queryFn: () => invoke('get_cloud_sizes', { provider: 'digitalocean', region: selectedRegion }),
    enabled: sizesEnabled && !!selectedRegion,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const sizes = sizesQuery.data ?? null;
  const sizesLoading = sizesQuery.isLoading && sizesEnabled;
  const sizesError = sizesQuery.error;

  // Domain loading (opt-in — only when token has DNS scopes)
  const domainsQuery = useQuery({
    queryKey: ['cloud-domains', 'digitalocean'],
    queryFn: () => invoke('get_cloud_domains', { provider: 'digitalocean' }),
    enabled: domainsEnabled && hasDnsAccess,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const doDomains = domainsQuery.data ?? null;
  const domainsLoading = domainsQuery.isLoading && domainsEnabled;
  const domainsError = domainsQuery.error;

  const createDomainMutation = useMutation({
    mutationFn: async () => {
      return invoke('create_cloud_domain', { provider: 'digitalocean', name: newDomainName });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['cloud-domains', 'digitalocean'], (old) =>
        [...(old || []), result],
      );
      setSelectedDoDomain(result.name);
      setNewDomainName('');
      setShowCreateDomain(false);
    },
  });

  // Fetch existing DNS records when a domain is selected (to detect conflicts)
  const domainRecordsQuery = useQuery({
    queryKey: ['cloud-domain-records', 'digitalocean', selectedDoDomain],
    queryFn: () => invoke('get_cloud_domain_records', { provider: 'digitalocean', domain: selectedDoDomain }),
    enabled: !!selectedDoDomain && hasDnsAccess,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  const domainRecords = domainRecordsQuery.data ?? null;
  const domainRecordsLoading = domainRecordsQuery.isLoading && !!selectedDoDomain;

  // Find the selected size's data for the summary
  const selectedSizeData = sizes?.find((s) => s.slug === selectedSize) ?? null;


  // Listen for provision progress events from the Rust backend
  useEffect(() => {
    const unlisten = listen('provision-progress', (event) => {
      const { step: s, status } = event.payload;
      if (s && status === 'running') {
        setProvisioning(s);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const startProvision = async () => {
    setProvisioning('validate_token');
    setProvisionError(null);
    setProvisionSuccess(false);

    try {
      await invoke('provision_server', {
        provider: 'digitalocean',
        region: selectedRegion,
        label: label || `portlama-${selectedRegion}`,
        size: selectedSize,
        domain: domain || null,
        email: email || null,
        doDomain: selectedDoDomain || null,
        doSubdomain: doSubdomain || null,
        overrideDns: overrideDns || null,
      });
      setProvisionSuccess(true);
      setProvisioning('cleanup');
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    } catch (err) {
      setProvisionError(err.toString());
    }
  };

  // Build the step sequence. The Domain step is conditionally included.
  // Each entry: { id, icon, label, key }
  const wizardSteps = useMemo(() => {
    const steps = [
      { id: 'token', icon: Key, label: 'Token' },
      { id: 'region', icon: MapPin, label: 'Region' },
      { id: 'size', icon: HardDrive, label: 'Size' },
    ];
    if (hasDnsAccess) {
      steps.push({ id: 'domain', icon: Globe, label: 'Domain' });
    }
    steps.push({ id: 'label', icon: Tag, label: 'Label' });
    steps.push({ id: 'provision', icon: Rocket, label: 'Create' });
    return steps;
  }, [hasDnsAccess]);
  const currentStepId = wizardSteps[step]?.id;
  const provisionStepIndex = wizardSteps.findIndex((s) => s.id === 'provision');
  const provisionSteps = useMemo(() => buildProvisionSteps(!!selectedDoDomain), [selectedDoDomain]);

  const canNext = () => {
    switch (currentStepId) {
      case 'token':
        return validation?.valid === true;
      case 'region':
        return !!selectedRegion;
      case 'size':
        return !!selectedSize;
      case 'domain': {
        const subOk = !doSubdomain || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(doSubdomain);
        return !!selectedDoDomain && subOk;
      }
      case 'label': {
        const l = label || `portlama-${selectedRegion}`;
        const labelOk = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(l);
        if (hasDnsAccess && selectedDoDomain) {
          // When using DO DNS, email is required for Let's Encrypt
          const emailOk = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
          return labelOk && emailOk;
        }
        const domainOk = !domain || /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain);
        const emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const pairOk = !domain || !!email;
        return labelOk && domainOk && emailOk && pairOk;
      }
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStepId === 'label') {
      setStep(provisionStepIndex);
      startProvision();
      return;
    }
    if (currentStepId === 'token') {
      setRegionsEnabled(true);
    }
    if (currentStepId === 'region') {
      setSizesEnabled(true);
    }
    if (currentStepId === 'size' && hasDnsAccess) {
      setDomainsEnabled(true);
    }
    setStep(step + 1);
  };

  // Overview is shown as a separate screen, not in the tab bar
  if (showOverview) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-xl">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-bold text-white">Create Server</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
            <OverviewStep dismissed={dismissChecked} setDismissed={setDismissChecked} />
          </div>
          <div className="flex justify-end px-5 py-3 border-t border-zinc-800">
            <button
              onClick={() => {
                if (dismissChecked) {
                  localStorage.setItem(DISCLAIMER_KEY, 'true');
                }
                setShowOverview(false);
              }}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-cyan-400 text-zinc-950 font-medium hover:bg-cyan-300"
            >
              I understand <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-bold text-white">Create Server</h2>
          <button
            onClick={onClose}
            disabled={provisioning && !provisionSuccess && !provisionError}
            className="text-zinc-500 hover:text-white disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-zinc-800">
          {wizardSteps.map((ws, i) => {
            const Icon = ws.icon;
            return (
              <div key={ws.id} className="flex items-center gap-1">
                <div
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                    i === step
                      ? 'bg-cyan-400/10 text-cyan-400'
                      : i < step
                        ? 'text-green-400'
                        : 'text-zinc-600'
                  }`}
                >
                  <Icon size={10} />
                  {ws.label}
                </div>
                {i < wizardSteps.length - 1 && (
                  <ChevronRight size={12} className="text-zinc-700" />
                )}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-5 py-4 min-h-[240px] max-h-[420px] overflow-y-auto">
          {currentStepId === 'token' && (
            <ProviderStep
              token={token}
              setToken={setToken}
              validation={validation}
              onValidate={() => validateMutation.mutate()}
              validating={validateMutation.isPending}
              savedToken={savedToken}
            />
          )}
          {currentStepId === 'region' && (
            <RegionStep
              regions={regions}
              selectedRegion={selectedRegion}
              setSelectedRegion={setSelectedRegion}
              loading={regionsLoading}
              error={regionsError}
            />
          )}
          {currentStepId === 'size' && (
            <SizeStep
              sizes={sizes}
              selectedSize={selectedSize}
              setSelectedSize={setSelectedSize}
              loading={sizesLoading}
              error={sizesError}
            />
          )}
          {currentStepId === 'domain' && (
            <DomainStep
              domains={doDomains}
              loading={domainsLoading}
              error={domainsError}
              selectedDomain={selectedDoDomain}
              setSelectedDomain={setSelectedDoDomain}
              subdomain={doSubdomain}
              setSubdomain={setDoSubdomain}
              onCreateDomain={() => createDomainMutation.mutate()}
              creating={createDomainMutation.isPending}
              createError={createDomainMutation.error}
              newDomainName={newDomainName}
              setNewDomainName={setNewDomainName}
              showCreate={showCreateDomain}
              setShowCreate={setShowCreateDomain}
              existingRecords={domainRecords}
              recordsLoading={domainRecordsLoading}
              overrideDns={overrideDns}
              setOverrideDns={setOverrideDns}
            />
          )}
          {currentStepId === 'label' && (
            <LabelStep
              label={label}
              setLabel={setLabel}
              domain={domain}
              setDomain={setDomain}
              email={email}
              setEmail={setEmail}
              region={selectedRegion}
              sizeData={selectedSizeData}
              hasDnsAccess={hasDnsAccess}
              selectedDoDomain={selectedDoDomain}
              doSubdomain={doSubdomain}
            />
          )}
          {currentStepId === 'provision' && (
            <ProvisionStep
              provisioning={provisioning}
              provisionError={provisionError}
              provisionSuccess={provisionSuccess}
              steps={provisionSteps}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
          <button
            onClick={() => step > 0 && currentStepId !== 'provision' && setStep(step - 1)}
            disabled={step <= 0 || currentStepId === 'provision'}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 flex items-center gap-1"
          >
            <ChevronLeft size={12} />
            Back
          </button>

          {currentStepId !== 'provision' ? (
            <button
              onClick={handleNext}
              disabled={!canNext()}
              className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-30 flex items-center gap-1"
            >
              {currentStepId === 'label' ? 'Create Server' : 'Next'}
              <ChevronRight size={12} />
            </button>
          ) : provisionSuccess ? (
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded bg-green-400/10 text-green-400 hover:bg-green-400/20 flex items-center gap-1"
            >
              <CheckCircle2 size={12} />
              Done
            </button>
          ) : provisionError ? (
            <button
              onClick={() => startProvision()}
              className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
