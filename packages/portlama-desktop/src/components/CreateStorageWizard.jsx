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
  Rocket,
  ExternalLink,
  Shield,
  Info,
  Eye,
  EyeOff,
  Database,
  ChevronDown,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Step 1: Credentials — Spaces access key + secret key
// ---------------------------------------------------------------------------

function CredentialsStep({ accessKey, setAccessKey, secretKey, setSecretKey, validated, onValidate, validating, savedCredentials }) {
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded bg-cyan-500/5 border border-cyan-500/20 p-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-cyan-400 font-medium mb-1 text-xs">DigitalOcean Spaces</p>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Storage servers use <strong className="text-zinc-300">S3-compatible object storage</strong> (DigitalOcean Spaces).
              Spaces access keys are separate from your DO API token — create them in the{' '}
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  await open('https://cloud.digitalocean.com/account/api/spaces');
                }}
                className="text-cyan-400 hover:underline"
              >
                DigitalOcean dashboard
              </a>.
            </p>
            <p className="text-zinc-500 text-[10px] mt-1.5">
              Spaces buckets start at ~$5/mo per 250 GB. Credentials are stored in your OS keychain, never in plaintext.
            </p>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">Access Key</label>
        <input
          type="text"
          value={accessKey}
          onChange={(e) => setAccessKey(e.target.value.trim())}
          placeholder={savedCredentials ? 'Credentials saved in keychain' : 'DO00...'}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
        />
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">Secret Key</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showSecret ? 'text' : 'password'}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value.trim())}
              placeholder={savedCredentials ? 'Credentials saved in keychain' : 'Secret key'}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono pr-9"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={onValidate}
            disabled={(!accessKey && !savedCredentials) || (!secretKey && !savedCredentials) || validating}
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

      {validated !== null && (
        <div className="rounded bg-zinc-950 border border-zinc-800 p-3">
          <div className="flex items-center gap-2">
            {validated ? (
              <CheckCircle2 size={14} className="text-green-400" />
            ) : (
              <XCircle size={14} className="text-red-400" />
            )}
            <span className={`text-xs font-medium ${validated ? 'text-green-400' : 'text-red-400'}`}>
              {validated ? 'Credentials are valid' : 'Invalid credentials'}
            </span>
          </div>
          {!validated && (
            <div className="mt-2 pt-2 border-t border-zinc-800">
              <p className="text-xs text-zinc-400 mb-1.5">
                Verify your access key and secret key, or create new ones:
              </p>
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  await open('https://cloud.digitalocean.com/account/api/spaces');
                }}
                className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
              >
                <ExternalLink size={10} />
                Manage Spaces keys on DigitalOcean
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Configuration — Region, label, optional bucket name
// ---------------------------------------------------------------------------

function ConfigurationStep({ regions, selectedRegion, setSelectedRegion, label, setLabel, bucket, setBucket, loading, error }) {
  const [showBucket, setShowBucket] = useState(!!bucket);
  const labelValid = !label || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
  const bucketValid = !bucket || /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
        <span className="text-sm text-zinc-400 ml-2">Loading Spaces regions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4">
        <p className="text-sm text-red-400">Failed to load regions: {error.toString()}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-zinc-400 block mb-1.5">Region</label>
        <p className="text-[10px] text-zinc-500 mb-2">
          Select a Spaces region. Choose one close to your Portlama servers for lower latency.
        </p>
        <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
          {regions?.map((r) => (
            <button
              key={r.slug}
              onClick={() => setSelectedRegion(r.slug)}
              className={`text-left rounded border px-3 py-2 text-xs ${
                selectedRegion === r.slug
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="font-medium">{r.slug}</div>
              <div className="text-zinc-500 text-[10px] mt-0.5">{r.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase())}
          placeholder={`storage-${selectedRegion || 'nyc3'}`}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
        />
        {label && !labelValid && (
          <p className="text-xs text-red-400 mt-1">
            Lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.
          </p>
        )}
      </div>

      <div>
        {!showBucket ? (
          <button
            onClick={() => setShowBucket(true)}
            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
          >
            <ChevronDown size={10} />
            Custom bucket name (optional)
          </button>
        ) : (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Bucket Name <span className="text-zinc-600">(optional — auto-generated if empty)</span>
            </label>
            <input
              type="text"
              value={bucket}
              onChange={(e) => setBucket(e.target.value.toLowerCase())}
              placeholder="portlama-my-storage-a1b2"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
            />
            {bucket && !bucketValid && (
              <p className="text-xs text-red-400 mt-1">
                3-63 characters, lowercase letters, numbers, and hyphens only. Must start and end with alphanumeric.
              </p>
            )}
          </div>
        )}
      </div>

      {selectedRegion && (
        <div className="rounded bg-zinc-950 border border-zinc-800 p-3 text-xs text-zinc-400">
          <p className="font-medium text-zinc-300 mb-1">Storage configuration</p>
          <p>Provider: DigitalOcean Spaces</p>
          <p>Region: {selectedRegion}</p>
          <p>Endpoint: {regions?.find(r => r.slug === selectedRegion)?.endpoint || `https://${selectedRegion}.digitaloceanspaces.com`}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Provisioning Progress
// ---------------------------------------------------------------------------

const STORAGE_PROVISION_STEPS = [
  { key: 'validate_credentials', label: 'Validating credentials', cmd: 'validate-spaces --provider spaces' },
  { key: 'create_bucket', label: 'Creating bucket', cmd: 'create-bucket --region <region>' },
  { key: 'save_registry', label: 'Saving configuration', cmd: 'write ~/.portlama/storage-servers.json' },
];

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <span className="text-cyan-400 font-mono inline-block w-[1ch]">{SPINNER_FRAMES[frame]}</span>;
}

function StorageProvisionStep({ provisioning, provisionError, provisionSuccess, storageServer }) {
  const currentIdx = STORAGE_PROVISION_STEPS.findIndex(s => s.key === provisioning);
  const currentStep = currentIdx >= 0 ? STORAGE_PROVISION_STEPS[currentIdx] : null;

  return (
    <div className="space-y-2">
      {STORAGE_PROVISION_STEPS.map((step, stepIdx) => {
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

      {provisionSuccess && storageServer && (
        <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-400" />
            <p className="text-xs text-green-400 font-medium">Storage server created!</p>
          </div>
          <div className="rounded bg-zinc-950 border border-zinc-800 p-3 text-xs text-zinc-400 space-y-1">
            <p>Bucket: <span className="text-zinc-300 font-mono">{storageServer.bucket}</span></p>
            <p>Region: <span className="text-zinc-300">{storageServer.region}</span></p>
            <p>Endpoint: <span className="text-zinc-300 font-mono">{storageServer.endpoint}</span></p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export default function CreateStorageWizard({ onClose }) {
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [validated, setValidated] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [label, setLabel] = useState('');
  const [bucket, setBucket] = useState('');
  const [provisioning, setProvisioning] = useState(null);
  const [provisionError, setProvisionError] = useState(null);
  const [provisionSuccess, setProvisionSuccess] = useState(false);
  const [storageServer, setStorageServer] = useState(null);
  const [regionsEnabled, setRegionsEnabled] = useState(false);

  // Check for saved credentials on mount
  const { data: savedCredentials } = useQuery({
    queryKey: ['storage-credentials-exists'],
    queryFn: () => invoke('get_storage_credentials'),
    staleTime: Infinity,
  });

  // Validate credentials
  const validateMutation = useMutation({
    mutationFn: async () => {
      await invoke('validate_storage_credentials', {
        accessKey: accessKey || '',
        secretKey: secretKey || '',
      });
      // Store only after validation succeeds
      if (accessKey && secretKey) {
        await invoke('store_storage_credentials', { accessKey, secretKey });
        queryClient.setQueryData(['storage-credentials-exists'], true);
      }
    },
    onSuccess: () => setValidated(true),
    onError: () => setValidated(false),
  });

  // Load Spaces regions
  const regionsQuery = useQuery({
    queryKey: ['spaces-regions'],
    queryFn: async () => {
      const data = await invoke('get_spaces_regions');
      // Auto-select first region (same pattern as CreateServerWizard)
      if (Array.isArray(data) && data.length > 0 && !selectedRegion) {
        setSelectedRegion(data[0].slug);
      }
      return data;
    },
    enabled: regionsEnabled,
    staleTime: Infinity,
  });

  const regions = regionsQuery.data ?? null;
  const regionsLoading = regionsQuery.isLoading && regionsEnabled;
  const regionsError = regionsQuery.error;

  // Listen for storage provision progress events
  useEffect(() => {
    const unlisten = listen('storage-provision-progress', (event) => {
      const { step: s, status } = event.payload;
      if (s && status === 'running') {
        setProvisioning(s);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const startProvision = async () => {
    setProvisioning('validate_credentials');
    setProvisionError(null);
    setProvisionSuccess(false);
    setStorageServer(null);

    try {
      const result = await invoke('provision_storage_server', {
        region: selectedRegion,
        label: label || `storage-${selectedRegion}`,
        bucket: bucket || null,
      });
      setStorageServer(result);
      setProvisionSuccess(true);
      setProvisioning('save_registry');
      queryClient.invalidateQueries({ queryKey: ['storage-servers'] });
    } catch (err) {
      setProvisionError(err.toString());
    }
  };

  const wizardSteps = useMemo(() => [
    { id: 'credentials', icon: Key, label: 'Credentials' },
    { id: 'config', icon: MapPin, label: 'Configuration' },
    { id: 'provision', icon: Rocket, label: 'Create' },
  ], []);

  const currentStepId = wizardSteps[step]?.id;

  const canNext = () => {
    switch (currentStepId) {
      case 'credentials':
        return validated === true;
      case 'config': {
        const l = label || `storage-${selectedRegion}`;
        const labelOk = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l);
        const bucketOk = !bucket || /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);
        return !!selectedRegion && labelOk && bucketOk;
      }
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStepId === 'config') {
      setStep(2);
      startProvision();
      return;
    }
    if (currentStepId === 'credentials') {
      setRegionsEnabled(true);
    }
    setStep(step + 1);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Create Storage Server</h2>
          </div>
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
          {currentStepId === 'credentials' && (
            <CredentialsStep
              accessKey={accessKey}
              setAccessKey={setAccessKey}
              secretKey={secretKey}
              setSecretKey={setSecretKey}
              validated={validated}
              onValidate={() => validateMutation.mutate()}
              validating={validateMutation.isPending}
              savedCredentials={savedCredentials}
            />
          )}
          {currentStepId === 'config' && (
            <ConfigurationStep
              regions={regions}
              selectedRegion={selectedRegion}
              setSelectedRegion={setSelectedRegion}
              label={label}
              setLabel={setLabel}
              bucket={bucket}
              setBucket={setBucket}
              loading={regionsLoading}
              error={regionsError}
            />
          )}
          {currentStepId === 'provision' && (
            <StorageProvisionStep
              provisioning={provisioning}
              provisionError={provisionError}
              provisionSuccess={provisionSuccess}
              storageServer={storageServer}
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
              {currentStepId === 'config' ? 'Create Storage' : 'Next'}
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
