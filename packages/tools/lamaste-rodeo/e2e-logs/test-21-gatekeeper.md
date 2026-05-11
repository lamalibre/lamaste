# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-04-30 09:02:32 UTC`


## Pre-flight

✅ `09:02:32` Onboarding is complete  
✅ `09:02:32` Gatekeeper proxy available  
✅ `09:02:32` Gatekeeper service healthy on port 9294  
✅ `09:02:32` Gatekeeper API secret file exists  
✅ `09:02:32` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `09:02:32` Create group three-vm-devs  
✅ `09:02:32` Create group three-vm-ops  
✅ `09:03:43` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `09:03:43` Create user grant (alice → tunnel-001)  
✅ `09:03:43` Create group grant (three-vm-ops → tunnel-002)  
✅ `09:03:43` Alice has access via direct grant  
✅ `09:03:43` Charlie has access via group grant  
✅ `09:03:43` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `09:04:19` Access logging enabled  
✅ `09:04:19` Cache bust  

## 4. Group Cascade Delete

✅ `09:04:19` Cascade deleted 1 grant(s) on group deletion  
✅ `09:04:19` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `09:04:19` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `09:06:05` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

