# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-11-02 15:51:47 UTC`


## Pre-flight

✅ `15:51:47` Onboarding is complete  
✅ `15:51:47` Gatekeeper proxy available  
✅ `15:51:48` Gatekeeper service healthy on port 9294  
✅ `15:51:48` Gatekeeper API secret file exists  
✅ `15:51:48` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `15:51:48` Create group three-vm-devs  
✅ `15:51:48` Create group three-vm-ops  
✅ `15:51:48` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `15:51:49` Create user grant (alice → tunnel-001)  
✅ `15:51:49` Create group grant (three-vm-ops → tunnel-002)  
✅ `15:51:49` Alice has access via direct grant  
✅ `15:51:49` Charlie has access via group grant  
✅ `15:51:49` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `15:51:49` Access logging enabled  
✅ `15:51:49` Cache bust  

## 4. Group Cascade Delete

✅ `15:51:50` Cascade deleted 1 grant(s) on group deletion  
✅ `15:51:50` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `15:51:50` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `15:51:50` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

