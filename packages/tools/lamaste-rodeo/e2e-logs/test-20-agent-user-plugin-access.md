# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-04-30 09:02:31 UTC`


## Pre-flight: check VMs and onboarding

✅ `09:02:31` Onboarding complete  
ℹ️ `09:02:31` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `09:02:31` Agent-side grant created: ab871ba4-3a02-4785-be2c-c367b76bb8ba  
✅ `09:02:31` Grant is auto-consumed (used=true)  
✅ `09:02:31` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `09:02:31` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `09:02:31` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `09:02:31` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `09:02:32` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `09:02:32` Agent-side grant revoked successfully  
✅ `09:02:32` Revoked grant no longer in list  

## 5. Cleanup

✅ `09:02:32` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

