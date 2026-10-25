# Lamaste E2E: 32 — Agent Panel Relay Auth (Three-VM)

> Started at `2026-10-25 17:21:25 UTC`


## Pre-flight: onboarding complete, test-agent enrolled

✅ `17:21:25` Onboarding is complete  
✅ `17:21:25` test-agent is enrolled  

## Expose the real agent panel

✅ `17:21:26` test-agent granted panel:expose  
✅ `17:22:09` lamaste-agentd is installed on the agent VM  
✅ `17:22:11` lamaste-agent panel --enable exposed the panel  
✅ `17:22:11` The panel tunnel reaches lamaste-agentd from the host's loopback  

## The vhost, the signing key, the public key

✅ `17:22:11` Panel vhost asks the panel to authorize every request  
✅ `17:22:11` Relay signing key is 0600 and the panel user's  
✅ `17:22:12` The agent reads the relay's public key  

## Through the vhost: relay assertions

✅ `17:22:12` Admin certificate: /api/status answered by lamaste-agentd  
✅ `17:22:12` Admin certificate: owner-only /api/plugins → 200  
✅ `17:22:12` A client-sent assertion header is replaced by the panel's  
✅ `17:22:12` test-agent's certificate: /api/status → 200  
✅ `17:22:12` test-agent's certificate: owner-only /api/plugins → 403  
✅ `17:22:13` test-agent's certificate claiming admin in headers is still test-agent  

## From the host's loopback: no header is proof

✅ `17:22:13` Forged admin certificate headers → 401  
✅ `17:22:13` Forged admin headers cannot reach plugin install → 401  
✅ `17:22:13` Forged Authelia identity headers → 401  
✅ `17:22:13` Made-up relay assertion → 401  
✅ `17:22:13` Percent-escaped /api path → 401  

## On the agent VM, as an unprivileged user: no header is proof

✅ `17:22:13` Forged admin certificate headers → 401  
✅ `17:22:13` Forged Remote-User → 401  
✅ `17:22:13` Percent-escaped /api path → 401  
✅ `17:22:13` agentd.token is not readable by other users  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `24` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `24` |

ℹ️ `17:22:13` Cleaning up test resources...  
