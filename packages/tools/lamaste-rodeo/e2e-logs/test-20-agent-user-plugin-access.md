# Lamaste E2E: 20 — Agent-Side User Plugin Access (Three-VM)

> Started at `2026-11-10 17:48:34 UTC`


## Pre-flight: check VMs and onboarding

✅ `17:48:34` Onboarding complete  
ℹ️ `17:48:34` Using agent label: test-agent  

## 1. Create agent-side grant

✅ `17:48:34` Agent-side grant created: d8d1877b-2e38-4898-b944-7ae613f701a7  
✅ `17:48:34` Grant is created unconsumed (used=false): access, kept until revoked  
✅ `17:48:34` Grant target matches: agent:test-agent  

## 2. Verify Authelia access control updated

⏭️ `17:48:35` Authelia not installed — skipping config verification  

## 3. Plugin tunnel validation

✅ `17:48:35` Plugin tunnel without pluginName/agentLabel rejected (400)  
✅ `17:48:35` Plugin tunnel with reserved route 'api' rejected (400)  
✅ `17:48:35` Plugin tunnel with invalid pluginName rejected (400)  

## 4. Revoke agent-side grant

✅ `17:48:35` Agent-side grant revoked successfully  
✅ `17:48:35` Revoked grant no longer in list  

## 5. Cleanup

✅ `17:48:35` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `11` |

