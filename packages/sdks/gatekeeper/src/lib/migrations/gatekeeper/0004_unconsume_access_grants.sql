-- Only a local plugin grant is ever consumed (its desktop enrolment). Grants
-- on tunnels, sites and agent-side plugins were created consumed, and the
-- retention sweep deleted them 90 days later: access vanished silently. They
-- are access, kept until revoked.
UPDATE access_grants SET used = 0, used_at = NULL
 WHERE used = 1
   AND NOT (resource_type = 'plugin'
            AND coalesce(json_extract(context, '$.target'), 'local') = 'local');
