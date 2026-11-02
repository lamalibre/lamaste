# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-02 15:51:46 UTC`


## Pre-flight: check VMs and onboarding

✅ `15:51:46` Onboarding complete  
ℹ️ `15:51:46` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `15:51:46` Agent-side grant created: 8b9a9a39-5181-49df-9039-2d8bb168c073  
✅ `15:51:46` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `15:51:46` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `15:51:47` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `15:51:47` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `15:51:47` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `15:51:47` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `15:51:47` Agent-side grant revoked successfully  
✅ `15:51:47` Revoked grant no longer in list  

## 5. Cleanup

✅ `15:51:47` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

