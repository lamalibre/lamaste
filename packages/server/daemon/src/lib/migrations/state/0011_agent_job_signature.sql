-- App jobs are signed by the relay (4.3, slice 3).

-- The agent's root helper runs an app job (`app-install`, `app-activate`,
-- `app-remove`) only when the relay signed it, with the key the agent's
-- operator pinned: JSON {envelope, sig} (core `app-job-signature.ts`),
-- made with the relay's signing key when the job is created and listed with
-- it in agent-config. NULL for hook jobs, which the helper never sees.
ALTER TABLE agent_jobs ADD COLUMN signature TEXT;

-- An app job left pending from before has no signature, and no agent would
-- run it: it is cancelled rather than listed.
UPDATE agent_jobs
SET status = 'cancelled', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'pending' AND kind != 'hook';
