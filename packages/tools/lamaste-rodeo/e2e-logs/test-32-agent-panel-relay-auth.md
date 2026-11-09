# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-09 12:51:33 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `12:51:33` Onboarding is complete  
✅ `12:51:33` test-agent is enrolled  

## Expose the real agent panel

✅ `12:51:33` test-agent granted panel:expose  
✅ `12:51:33` lamaste-agentd is installed on the agent VM  
✅ `12:51:35` lamaste-agent panel --enable exposed the panel  
✅ `12:51:35` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `12:51:35` Panel vhost asks the panel to authorize every request  
✅ `12:51:36` Relay signing key is 0600 and the panel user's  
✅ `12:51:36` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `12:51:36` Admin certificate: /api/status answered by lamaste-agentd  
✅ `12:51:36` Admin certificate: owner-only /api/plugins → 200  
✅ `12:51:36` A client-sent assertion header is replaced by the panel's  
✅ `12:51:36` test-agent's certificate: /api/status → 200  
✅ `12:51:37` test-agent's certificate: owner-only /api/plugins → 403  
✅ `12:51:37` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `12:51:37` Forged admin certificate headers → 401  
✅ `12:51:37` Forged admin headers cannot reach plugin install → 401  
✅ `12:51:37` Forged Authelia identity headers → 401  
✅ `12:51:37` Made-up relay assertion → 401  
✅ `12:51:37` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `12:51:38` Forged admin certificate headers → 401  
✅ `12:51:38` Forged Remote-User → 401  
✅ `12:51:38` Percent-escaped /api path → 401  
✅ `12:51:38` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `12:51:38` Cleaning up test resources...  
