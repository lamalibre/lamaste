# Portlama E2E: 12 — User Invitations

> Started at `2026-03-16 17:22:00 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `17:22:00` Invitation creation returned ok: true  
✅ `17:22:00` Invitation username matches  
✅ `17:22:00` Invitation email matches  
✅ `17:22:00` Invitation token is valid 64-char hex  
✅ `17:22:00` Invitation ID is present  
✅ `17:22:00` Invitation createdAt is present  
✅ `17:22:00` Invitation expiresAt is present  

## List invitations

✅ `17:22:00` Invitation appears in GET /api/invitations  
✅ `17:22:00` Token is not exposed in invitation list  
✅ `17:22:00` Invitation status is pending  

## Duplicate invitation

✅ `17:22:00` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `17:22:00` Incomplete invitation data rejected (HTTP 400)  
✅ `17:22:00` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `17:22:00` Public invite details show username  
✅ `17:22:01` Public invite details show email  
✅ `17:22:01` Public invite details show expiresAt  

## Invalid token

✅ `17:22:01` Accept with invalid token returns 404  
✅ `17:22:01` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `17:22:03` Invitation acceptance returned ok: true  
✅ `17:22:03` Accepted username matches  

## Verify invited user exists

✅ `17:22:03` Invited user appears in GET /api/users  
✅ `17:22:03` Invited user email matches  

## Invitation marked as accepted

✅ `17:22:03` Invitation status changed to accepted  

## Used token rejection

✅ `17:22:03` Reusing accepted token returns 410 Gone  
✅ `17:22:03` GET on used token returns 410 Gone  

## Accept with short password

✅ `17:22:03` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `17:22:05` Invited user deletion returned ok: true  
✅ `17:22:05` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

