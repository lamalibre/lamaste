# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-11-03 09:31:33 UTC`


## Pre-flight

✅ `09:31:33` Onboarding is complete  
✅ `09:31:33` Gatekeeper proxy available  
✅ `09:31:33` Gatekeeper service healthy on port 9294  
✅ `09:31:34` Gatekeeper API secret file exists  
✅ `09:31:34` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `09:31:34` Create group three-vm-devs  
✅ `09:31:34` Create group three-vm-ops  
✅ `09:31:34` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `09:31:34` Create user grant (alice → tunnel-001)  
✅ `09:31:34` Create group grant (three-vm-ops → tunnel-002)  
✅ `09:31:35` Alice has access via direct grant  
✅ `09:31:35` Charlie has access via group grant  
✅ `09:31:35` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `09:31:35` Access logging enabled  
✅ `09:31:35` Cache bust  

## 4. Group Cascade Delete

✅ `09:31:35` Cascade deleted 1 grant(s) on group deletion  
✅ `09:31:35` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `09:31:36` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `09:31:36` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

