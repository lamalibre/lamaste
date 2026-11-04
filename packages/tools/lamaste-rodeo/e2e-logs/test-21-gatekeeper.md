# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-11-04 13:36:25 UTC`


## Pre-flight

✅ `13:36:25` Onboarding is complete  
✅ `13:36:25` Gatekeeper proxy available  
✅ `13:36:26` Gatekeeper service healthy on port 9294  
✅ `13:36:26` Gatekeeper API secret file exists  
✅ `13:36:26` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `13:36:26` Create group three-vm-devs  
✅ `13:36:26` Create group three-vm-ops  
✅ `13:36:27` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `13:36:27` Create user grant (alice → tunnel-001)  
✅ `13:36:27` Create group grant (three-vm-ops → tunnel-002)  
✅ `13:36:27` Alice has access via direct grant  
✅ `13:36:27` Charlie has access via group grant  
✅ `13:36:27` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `13:36:28` Access logging enabled  
✅ `13:36:28` Cache bust  

## 4. Group Cascade Delete

✅ `13:36:28` Cascade deleted 1 grant(s) on group deletion  
✅ `13:36:28` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `13:36:28` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `13:36:29` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

