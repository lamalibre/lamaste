# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-10-13 11:51:08 UTC`


## Pre-flight

✅ `11:51:08` Onboarding is complete  
✅ `11:51:09` Gatekeeper proxy available  
✅ `11:51:09` Gatekeeper service healthy on port 9294  
✅ `11:51:09` Gatekeeper API secret file exists  
✅ `11:51:09` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `11:51:09` Create group three-vm-devs  
✅ `11:51:09` Create group three-vm-ops  
✅ `11:51:10` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `11:51:10` Create user grant (alice → tunnel-001)  
✅ `11:51:10` Create group grant (three-vm-ops → tunnel-002)  
✅ `11:51:10` Alice has access via direct grant  
✅ `11:51:10` Charlie has access via group grant  
✅ `11:51:10` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `11:51:11` Access logging enabled  
✅ `11:51:11` Cache bust  

## 4. Group Cascade Delete

✅ `11:51:11` Cascade deleted 1 grant(s) on group deletion  
✅ `11:51:11` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `11:51:11` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `11:51:11` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

