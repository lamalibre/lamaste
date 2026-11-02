# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-11-02 15:59:21 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `15:59:21` Onboarding is complete  
✅ `15:59:21` test-agent is enrolled  

## Expose the real agent panel

✅ `15:59:22` test-agent granted panel:expose  
✅ `15:59:22` lamaste-agentd is installed on the agent VM  
✅ `15:59:23` lamaste-agent panel --enable exposed the panel  
✅ `15:59:23` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `15:59:24` Panel vhost asks the panel to authorize every request  
✅ `15:59:24` Relay signing key is 0600 and the panel user's  
✅ `15:59:24` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `15:59:24` Admin certificate: /api/status answered by lamaste-agentd  
✅ `15:59:24` Admin certificate: owner-only /api/plugins → 200  
✅ `15:59:24` A client-sent assertion header is replaced by the panel's  
✅ `15:59:24` test-agent's certificate: /api/status → 200  
✅ `15:59:24` test-agent's certificate: owner-only /api/plugins → 403  
✅ `15:59:25` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `15:59:25` Forged admin certificate headers → 401  
✅ `15:59:25` Forged admin headers cannot reach plugin install → 401  
✅ `15:59:25` Forged Authelia identity headers → 401  
✅ `15:59:25` Made-up relay assertion → 401  
✅ `15:59:25` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `15:59:25` Forged admin certificate headers → 401  
✅ `15:59:25` Forged Remote-User → 401  
✅ `15:59:25` Percent-escaped /api path → 401  
✅ `15:59:25` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `15:59:25` Cleaning up test resources...  
