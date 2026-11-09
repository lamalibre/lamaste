# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-09 12:43:33 UTC`


## Pre-flight: check VMs and onboarding

✅ `12:43:33` Onboarding complete  
ℹ️ `12:43:33` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `12:43:33` Agent-side grant created: f892aba2-f428-447c-9e22-1dede790b104  
✅ `12:43:33` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `12:43:33` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `12:43:33` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `12:43:33` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `12:43:33` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `12:43:33` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `12:43:34` Agent-side grant revoked successfully  
✅ `12:43:34` Revoked grant no longer in list  

## 5. Cleanup

✅ `12:43:34` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

