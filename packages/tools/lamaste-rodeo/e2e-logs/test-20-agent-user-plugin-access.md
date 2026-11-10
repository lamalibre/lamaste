# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-10 13:05:41 UTC`


## Pre-flight: check VMs and onboarding

✅ `13:05:42` Onboarding complete  
ℹ️ `13:05:42` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `13:05:42` Agent-side grant created: b1fcb22c-52ec-45ee-9755-159103f31e78  
✅ `13:05:42` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `13:05:42` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `13:05:42` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `13:05:42` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `13:05:42` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `13:05:42` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `13:05:43` Agent-side grant revoked successfully  
✅ `13:05:43` Revoked grant no longer in list  

## 5. Cleanup

✅ `13:05:43` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

