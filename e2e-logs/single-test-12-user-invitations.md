# Lamaste E2E: 12 — User Invitations

> Started at `2026-03-30 13:07:00 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `13:07:00` Invitation creation returned ok: true  
✅ `13:07:00` Invitation username matches  
✅ `13:07:00` Invitation email matches  
✅ `13:07:00` Invitation token is valid 64-char hex  
✅ `13:07:00` Invitation ID is present  
✅ `13:07:00` Invitation createdAt is present  
✅ `13:07:00` Invitation expiresAt is present  

## List invitations

✅ `13:07:00` Invitation appears in GET /api/invitations  
✅ `13:07:00` Token is not exposed in invitation list  
✅ `13:07:00` Invitation status is pending  

## Duplicate invitation

✅ `13:07:00` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `13:07:00` Incomplete invitation data rejected (HTTP 400)  
✅ `13:07:00` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `13:07:00` Public invite details show username  
✅ `13:07:00` Public invite details show email  
✅ `13:07:00` Public invite details show expiresAt  

## Invalid token

✅ `13:07:00` Accept with invalid token returns 404  
✅ `13:07:00` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `13:07:02` Invitation acceptance returned ok: true  
✅ `13:07:02` Accepted username matches  

## Verify invited user exists

✅ `13:07:02` Invited user appears in GET /api/users  
✅ `13:07:02` Invited user email matches  

## Invitation marked as accepted

✅ `13:07:02` Invitation status changed to accepted  

## Used token rejection

✅ `13:07:02` Reusing accepted token returns 410 Gone  
✅ `13:07:02` GET on used token returns 410 Gone  

## Accept with short password

✅ `13:07:02` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `13:07:04` Invited user deletion returned ok: true  
✅ `13:07:04` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

