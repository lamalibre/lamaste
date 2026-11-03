# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-03 09:39:38 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `09:39:38` Onboarding is complete  
✅ `09:39:38` test-agent is enrolled  

## Expose the real agent panel

✅ `09:39:38` test-agent granted panel:expose  
✅ `09:39:39` lamaste-agentd is installed on the agent VM  
✅ `09:39:40` lamaste-agent panel --enable exposed the panel  
✅ `09:39:40` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `09:39:41` Panel vhost asks the panel to authorize every request  
✅ `09:39:41` Relay signing key is 0600 and the panel user's  
✅ `09:39:41` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `09:39:41` Admin certificate: /api/status answered by lamaste-agentd  
✅ `09:39:41` Admin certificate: owner-only /api/plugins → 200  
✅ `09:39:41` A client-sent assertion header is replaced by the panel's  
✅ `09:39:42` test-agent's certificate: /api/status → 200  
✅ `09:39:42` test-agent's certificate: owner-only /api/plugins → 403  
✅ `09:39:42` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `09:39:42` Forged admin certificate headers → 401  
✅ `09:39:42` Forged admin headers cannot reach plugin install → 401  
✅ `09:39:42` Forged Authelia identity headers → 401  
✅ `09:39:42` Made-up relay assertion → 401  
✅ `09:39:42` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `09:39:43` Forged admin certificate headers → 401  
✅ `09:39:43` Forged Remote-User → 401  
✅ `09:39:43` Percent-escaped /api path → 401  
✅ `09:39:43` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `09:39:43` Cleaning up test resources...  
