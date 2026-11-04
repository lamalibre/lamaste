# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-04 13:44:13 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `13:44:13` Onboarding is complete  
✅ `13:44:13` test-agent is enrolled  

## Expose the real agent panel

✅ `13:44:13` test-agent granted panel:expose  
✅ `13:44:14` lamaste-agentd is installed on the agent VM  
✅ `13:44:15` lamaste-agent panel --enable exposed the panel  
✅ `13:44:16` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `13:44:16` Panel vhost asks the panel to authorize every request  
✅ `13:44:16` Relay signing key is 0600 and the panel user's  
✅ `13:44:16` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `13:44:16` Admin certificate: /api/status answered by lamaste-agentd  
✅ `13:44:16` Admin certificate: owner-only /api/plugins → 200  
✅ `13:44:17` A client-sent assertion header is replaced by the panel's  
✅ `13:44:17` test-agent's certificate: /api/status → 200  
✅ `13:44:17` test-agent's certificate: owner-only /api/plugins → 403  
✅ `13:44:17` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `13:44:17` Forged admin certificate headers → 401  
✅ `13:44:17` Forged admin headers cannot reach plugin install → 401  
✅ `13:44:17` Forged Authelia identity headers → 401  
✅ `13:44:18` Made-up relay assertion → 401  
✅ `13:44:18` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `13:44:18` Forged admin certificate headers → 401  
✅ `13:44:18` Forged Remote-User → 401  
✅ `13:44:18` Percent-escaped /api path → 401  
✅ `13:44:18` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `13:44:18` Cleaning up test resources...  
