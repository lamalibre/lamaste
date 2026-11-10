# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-11-10 13:05:43 UTC`


## Pre-flight

✅ `13:05:43` Onboarding is complete  
✅ `13:05:43` Gatekeeper proxy available  
✅ `13:05:43` Gatekeeper service healthy on port 9294  
✅ `13:05:43` Gatekeeper API secret file exists  
✅ `13:05:43` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `13:05:44` Create group three-vm-devs  
✅ `13:05:44` Create group three-vm-ops  
✅ `13:05:45` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `13:05:45` Create user grant (alice → tunnel-001)  
✅ `13:05:45` Create group grant (three-vm-ops → tunnel-002)  
✅ `13:05:45` Alice has access via direct grant  
✅ `13:05:45` Charlie has access via group grant  
✅ `13:05:45` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `13:05:46` Access logging enabled  
✅ `13:05:46` Cache bust  

## 4. Group Cascade Delete

✅ `13:05:46` Cascade deleted 1 grant(s) on group deletion  
✅ `13:05:46` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `13:05:46` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `13:05:47` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

