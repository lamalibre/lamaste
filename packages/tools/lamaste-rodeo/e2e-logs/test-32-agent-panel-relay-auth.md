# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-11 09:12:48 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `09:12:48` Onboarding is complete  
✅ `09:12:48` test-agent is enrolled  

## Expose the real agent panel

✅ `09:12:49` test-agent granted panel:expose  
✅ `09:12:49` lamaste-agentd is installed on the agent VM  
✅ `09:12:51` lamaste-agent panel --enable exposed the panel  
✅ `09:12:51` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `09:12:51` Panel vhost asks the panel to authorize every request  
✅ `09:12:51` Relay signing key is 0600 and the panel user's  
✅ `09:12:52` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `09:12:52` Admin certificate: /api/status answered by lamaste-agentd  
✅ `09:12:52` Admin certificate: owner-only /api/plugins → 200  
✅ `09:12:52` A client-sent assertion header is replaced by the panel's  
✅ `09:12:52` test-agent's certificate: /api/status → 200  
✅ `09:12:52` test-agent's certificate: owner-only /api/plugins → 403  
✅ `09:12:53` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `09:12:53` Forged admin certificate headers → 401  
✅ `09:12:53` Forged admin headers cannot reach plugin install → 401  
✅ `09:12:53` Forged Authelia identity headers → 401  
✅ `09:12:53` Made-up relay assertion → 401  
✅ `09:12:53` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `09:12:53` Forged admin certificate headers → 401  
✅ `09:12:54` Forged Remote-User → 401  
✅ `09:12:54` Percent-escaped /api path → 401  
✅ `09:12:54` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `09:12:54` Cleaning up test resources...  
