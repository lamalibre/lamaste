# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-11-10 17:48:35 UTC`


## Pre-flight

✅ `17:48:35` Onboarding is complete  
✅ `17:48:36` Gatekeeper proxy available  
✅ `17:48:36` Gatekeeper service healthy on port 9294  
✅ `17:48:36` Gatekeeper API secret file exists  
✅ `17:48:36` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `17:48:36` Create group three-vm-devs  
✅ `17:48:36` Create group three-vm-ops  
✅ `17:48:37` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `17:48:37` Create user grant (alice → tunnel-001)  
✅ `17:48:37` Create group grant (three-vm-ops → tunnel-002)  
✅ `17:48:37` Alice has access via direct grant  
✅ `17:48:38` Charlie has access via group grant  
✅ `17:48:38` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `17:48:38` Access logging enabled  
✅ `17:48:38` Cache bust  

## 4. Group Cascade Delete

✅ `17:48:38` Cascade deleted 1 grant(s) on group deletion  
✅ `17:48:38` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `17:48:39` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `17:48:39` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

