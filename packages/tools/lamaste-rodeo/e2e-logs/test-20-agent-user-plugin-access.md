# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-04 13:36:24 UTC`


## Pre-flight: check VMs and onboarding

✅ `13:36:24` Onboarding complete  
ℹ️ `13:36:24` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `13:36:24` Agent-side grant created: 4adfa057-ecd2-49e6-91d9-98f07e2037bf  
✅ `13:36:24` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `13:36:24` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `13:36:24` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `13:36:25` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `13:36:25` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `13:36:25` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `13:36:25` Agent-side grant revoked successfully  
✅ `13:36:25` Revoked grant no longer in list  

## 5. Cleanup

✅ `13:36:25` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

