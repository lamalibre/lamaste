# Portlama E2E: 12 — User Invitations

> Started at `2026-03-24 08:11:06 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `08:11:06` Invitation creation returned ok: true  
✅ `08:11:06` Invitation username matches  
✅ `08:11:06` Invitation email matches  
✅ `08:11:06` Invitation token is valid 64-char hex  
✅ `08:11:06` Invitation ID is present  
✅ `08:11:06` Invitation createdAt is present  
✅ `08:11:06` Invitation expiresAt is present  

## List invitations

✅ `08:11:06` Invitation appears in GET /api/invitations  
✅ `08:11:06` Token is not exposed in invitation list  
✅ `08:11:06` Invitation status is pending  

## Duplicate invitation

✅ `08:11:06` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `08:11:06` Incomplete invitation data rejected (HTTP 400)  
✅ `08:11:06` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `08:11:06` Public invite details show username  
✅ `08:11:06` Public invite details show email  
✅ `08:11:06` Public invite details show expiresAt  

## Invalid token

✅ `08:11:06` Accept with invalid token returns 404  
✅ `08:11:06` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `08:11:08` Invitation acceptance returned ok: true  
✅ `08:11:08` Accepted username matches  

## Verify invited user exists

✅ `08:11:08` Invited user appears in GET /api/users  
✅ `08:11:08` Invited user email matches  

## Invitation marked as accepted

✅ `08:11:08` Invitation status changed to accepted  

## Used token rejection

✅ `08:11:08` Reusing accepted token returns 410 Gone  
✅ `08:11:08` GET on used token returns 410 Gone  

## Accept with short password

✅ `08:11:08` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `08:11:11` Invited user deletion returned ok: true  
✅ `08:11:11` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

