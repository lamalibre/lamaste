import { useState } from 'react';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus.js';
import LoadingScreen from '../../components/LoadingScreen.jsx';
import ErrorScreen from '../../components/ErrorScreen.jsx';
import DomainStep from './DomainStep.jsx';
import DnsStep from './DnsStep.jsx';
import ProvisioningStep from './ProvisioningStep.jsx';
import CompleteStep from './CompleteStep.jsx';

const TOTAL_STEPS = 4;

function statusToStep(status) {
  switch (status) {
    case 'FRESH':
      return 1;
    case 'DOMAIN_SET':
      return 2;
    case 'DNS_READY':
    case 'PROVISIONING':
      return 3;
    case 'COMPLETED':
      return 4;
    default:
      return 1;
  }
}

function StepIndicator({ current }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="text-sm text-zinc-400">
        Step {current} of {TOTAL_STEPS}
      </span>
      <div className="flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          const step = i + 1;
          let classes = 'h-2 w-2 rounded-full';
          if (step < current) {
            classes += ' bg-cyan-400';
          } else if (step === current) {
            classes += ' border-2 border-cyan-400 bg-transparent';
          } else {
            classes += ' bg-zinc-600';
          }
          return <div key={step} className={classes} />;
        })}
      </div>
    </div>
  );
}

export default function OnboardingShell() {
  const { status, domain, ip, isLoading, isError, refetch } = useOnboardingStatus();
  const [overrideStep, setOverrideStep] = useState(null);
  const [provisioningResult, setProvisioningResult] = useState(null);

  const derivedStep = statusToStep(status);
  // Override is only valid when navigating backwards; if the server state
  // has advanced past the override, ignore it.
  const currentStep =
    overrideStep !== null && overrideStep < derivedStep ? overrideStep : derivedStep;

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isError) {
    return <ErrorScreen onRetry={refetch} />;
  }

  function handleDomainComplete() {
    refetch();
    setOverrideStep(null);
  }

  function handleDnsComplete() {
    refetch();
    setOverrideStep(null);
  }

  function handleBackToDomain() {
    setOverrideStep(1);
  }

  function handleProvisioningComplete(result) {
    setProvisioningResult(result);
    setOverrideStep(4);
    refetch();
  }

  let stepContent;
  if (currentStep === 1) {
    stepContent = <DomainStep domain={domain} onComplete={handleDomainComplete} />;
  } else if (currentStep === 2) {
    stepContent = (
      <DnsStep domain={domain} ip={ip} onComplete={handleDnsComplete} onBack={handleBackToDomain} />
    );
  } else if (currentStep === 3) {
    stepContent = <ProvisioningStep onComplete={handleProvisioningComplete} />;
  } else if (currentStep === 4) {
    stepContent = <CompleteStep result={provisioningResult} ip={ip} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="mx-4 w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="mb-2 font-mono text-2xl font-bold text-cyan-400">Lamaste</h1>
        <StepIndicator current={currentStep} />
        {stepContent}
      </div>
    </div>
  );
}
