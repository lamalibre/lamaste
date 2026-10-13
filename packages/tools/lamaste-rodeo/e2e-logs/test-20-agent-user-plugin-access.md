# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-10-13 11:51:07 UTC`


## Pre-flight: check VMs and onboarding

✅ `11:51:07` Onboarding complete  
ℹ️ `11:51:08` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `11:51:08` Agent-side grant created: 4b4017f6-5ab9-436f-b937-55f92d62f985  
✅ `11:51:08` Grant is auto-consumed (used=true)  
✅ `11:51:08` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `11:51:08` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `11:51:08` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `11:51:08` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `11:51:08` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `11:51:08` Agent-side grant revoked successfully  
✅ `11:51:08` Revoked grant no longer in list  

## 5. Cleanup

✅ `11:51:08` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

