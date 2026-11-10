# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-10 13:14:00 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `13:14:00` Onboarding is complete  
✅ `13:14:01` test-agent is enrolled  

## Expose the real agent panel

✅ `13:14:01` test-agent granted panel:expose  
✅ `13:14:01` lamaste-agentd is installed on the agent VM  
✅ `13:14:03` lamaste-agent panel --enable exposed the panel  
✅ `13:14:03` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `13:14:03` Panel vhost asks the panel to authorize every request  
✅ `13:14:04` Relay signing key is 0600 and the panel user's  
✅ `13:14:04` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `13:14:04` Admin certificate: /api/status answered by lamaste-agentd  
✅ `13:14:04` Admin certificate: owner-only /api/plugins → 200  
✅ `13:14:04` A client-sent assertion header is replaced by the panel's  
✅ `13:14:05` test-agent's certificate: /api/status → 200  
✅ `13:14:05` test-agent's certificate: owner-only /api/plugins → 403  
✅ `13:14:05` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `13:14:05` Forged admin certificate headers → 401  
✅ `13:14:05` Forged admin headers cannot reach plugin install → 401  
✅ `13:14:05` Forged Authelia identity headers → 401  
✅ `13:14:06` Made-up relay assertion → 401  
✅ `13:14:06` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `13:14:06` Forged admin certificate headers → 401  
✅ `13:14:06` Forged Remote-User → 401  
✅ `13:14:06` Percent-escaped /api path → 401  
✅ `13:14:06` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `13:14:06` Cleaning up test resources...  
