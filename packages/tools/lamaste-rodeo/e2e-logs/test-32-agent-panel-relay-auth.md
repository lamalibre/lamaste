# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-10 17:56:17 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `17:56:17` Onboarding is complete  
✅ `17:56:18` test-agent is enrolled  

## Expose the real agent panel

✅ `17:56:18` test-agent granted panel:expose  
✅ `17:56:18` lamaste-agentd is installed on the agent VM  
✅ `17:56:20` lamaste-agent panel --enable exposed the panel  
✅ `17:56:20` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `17:56:20` Panel vhost asks the panel to authorize every request  
✅ `17:56:21` Relay signing key is 0600 and the panel user's  
✅ `17:56:21` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `17:56:21` Admin certificate: /api/status answered by lamaste-agentd  
✅ `17:56:21` Admin certificate: owner-only /api/plugins → 200  
✅ `17:56:21` A client-sent assertion header is replaced by the panel's  
✅ `17:56:22` test-agent's certificate: /api/status → 200  
✅ `17:56:22` test-agent's certificate: owner-only /api/plugins → 403  
✅ `17:56:22` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `17:56:22` Forged admin certificate headers → 401  
✅ `17:56:22` Forged admin headers cannot reach plugin install → 401  
✅ `17:56:22` Forged Authelia identity headers → 401  
✅ `17:56:22` Made-up relay assertion → 401  
✅ `17:56:22` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `17:56:23` Forged admin certificate headers → 401  
✅ `17:56:23` Forged Remote-User → 401  
✅ `17:56:23` Percent-escaped /api path → 401  
✅ `17:56:23` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `17:56:23` Cleaning up test resources...  
