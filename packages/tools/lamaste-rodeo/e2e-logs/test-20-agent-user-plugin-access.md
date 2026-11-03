# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-03 09:31:32 UTC`


## Pre-flight: check VMs and onboarding

✅ `09:31:32` Onboarding complete  
ℹ️ `09:31:32` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `09:31:32` Agent-side grant created: 5778a89f-de09-475a-b49a-53525ef9734f  
✅ `09:31:32` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `09:31:32` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `09:31:33` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `09:31:33` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `09:31:33` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `09:31:33` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `09:31:33` Agent-side grant revoked successfully  
✅ `09:31:33` Revoked grant no longer in list  

## 5. Cleanup

✅ `09:31:33` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

