# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-11 09:04:33 UTC`


## Pre-flight: check VMs and onboarding

✅ `09:04:33` Onboarding complete  
ℹ️ `09:04:33` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `09:04:33` Agent-side grant created: 048d6c7f-a530-4556-8d73-d7d510702c90  
✅ `09:04:33` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `09:04:33` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `09:04:33` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `09:04:34` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `09:04:34` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `09:04:34` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `09:04:34` Agent-side grant revoked successfully  
✅ `09:04:34` Revoked grant no longer in list  

## 5. Cleanup

✅ `09:04:34` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

