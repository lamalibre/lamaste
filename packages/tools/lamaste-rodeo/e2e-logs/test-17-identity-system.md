# Lamaste E2E: 17 — Identity System (Three-VM)

> Started at `2026-04-30 09:02:20 UTC`


## Pre-flight: verify onboarding is complete


## 1. Identity API — list users (admin cert)

✅ `09:02:21` GET /api/identity/users returns users array  
✅ `09:02:21` Identity users list contains at least one user (count: 2)  
ℹ️ `09:02:21` First user in list: admin  

## 2. Identity API — single user lookup (admin cert)

✅ `09:02:21` GET /api/identity/users/:username returns correct user  
✅ `09:02:21` Single user has displayname field  
✅ `09:02:21` Single user has groups field  
✅ `09:02:21` GET /api/identity/users/:username returns 404 for non-existent user  

## 3. Identity API — list groups (admin cert)

✅ `09:02:21` GET /api/identity/groups returns groups array  
✅ `09:02:21` Identity groups list contains at least one group (count: 1)  

## 4. Identity API — /self returns 400 on mTLS vhost

✅ `09:02:21` GET /api/identity/self returns 400 on mTLS vhost (no Remote-* headers)  

## 5. nginx header stripping — forged Remote-User rejected

✅ `09:02:21` Forged Remote-User header stripped by nginx (still returns 400)  
✅ `09:02:21` Response confirms identity headers not present despite forged header  

## 6. Capability gating — agent without identity:query gets 403

✅ `09:02:22` Agent cert creation returned ok: true  
✅ `09:02:22` Agent cert has a p12 password  
ℹ️ `09:02:22` Created agent cert: identity-agent (capabilities: [tunnels:read])  
✅ `09:02:22` Extracted PEM cert and key from .p12  
✅ `09:02:22` Agent without identity:query rejected with 403 on /identity/users  
✅ `09:02:23` Agent without identity:query rejected with 403 on /identity/groups  

## 7. Capability gating — grant identity:query, verify access

✅ `09:02:23` Capability update to add identity:query returned ok: true  
ℹ️ `09:02:23` Updated agent capabilities: [tunnels:read, identity:query]  
✅ `09:02:23` Agent with identity:query can access /identity/users  
✅ `09:02:23` Agent with identity:query can access /identity/groups  
✅ `09:02:23` Agent sees the same number of users as admin (count: 2)  

## 8. Password hash exclusion verification

✅ `09:02:23` No user in /identity/users response contains a password field  
✅ `09:02:23` No password hash patterns found in raw /identity/users response  
✅ `09:02:23` Single user endpoint does not contain password field  

## 9. Cleanup

ℹ️ `09:02:23` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `23` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `23` |

ℹ️ `09:02:23` Cleaning up test resources...  
