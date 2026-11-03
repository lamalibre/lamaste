# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-03 09:56:23 UTC`


## Pre-flight

✅ `09:56:24` Onboarding is complete  
✅ `09:56:24` Agent test-agent is enrolled on the host  
✅ `09:56:24` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `09:56:24` The agent VM's lamaste-agent has the apphost command  
ℹ️ `09:56:24` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `09:56:25` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `09:56:48` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `09:56:48` The agent VM reaches it at http://10.13.37.1:4874  
✅ `09:56:49` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T09:56:49.876Z"})  
✅ `09:56:49` …through its own OIDC client  
✅ `09:56:50` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `09:56:50` Test secret B, for the CLI  
✅ `09:56:50` Their digests are known; the secrets never leave the host VM  
✅ `09:56:54` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `09:57:00` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `09:57:11` Hosted on test-agent ()  
✅ `09:57:28` The relay's health of the hosting is up  

## Before anything is configured

✅ `09:57:28` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `09:57:28` It lists the manifest's fields  
✅ `09:57:28` …with their types  
✅ `09:57:28` …read live from the agent half  
✅ `09:57:28` …which the relay synced at 2026-11-03T09:57:28.947Z  
✅ `09:57:28` Not configured: apiKey is missing  
✅ `09:57:28` apiKey: { set: false }  
✅ `09:57:28` The other fields show their defaults (region has none)  
✅ `09:57:28` Revision 0  
✅ `09:57:28` The hosting: test-agent, up  
✅ `09:57:29` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `09:57:29` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `09:57:29` The agent half: schema 1, revision 0, not configured  
✅ `09:57:29` …and it holds no secret  
✅ `09:57:29` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `09:57:29` Four values that do not suit their fields: 400  
✅ `09:57:29` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `09:57:29` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `09:57:29` apiKey in values: Is a secret; send it in secrets  
✅ `09:57:29` retries 987654321: Must be at most 10  
✅ `09:57:29` region: Must be one of the options  
✅ `09:57:29` The answer never repeats e2e-colour-6b1d  
✅ `09:57:29` The answer never repeats e2e-unknown-7f3a  
✅ `09:57:29` The answer never repeats e2e-misplaced-9b2e  
✅ `09:57:29` The answer never repeats 987654321  
✅ `09:57:29` The answer never repeats e2e-region-3f8a  
✅ `09:57:30` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `09:57:30` schedule: Does not match the required format  
✅ `09:57:30` …without repeating the value  
✅ `09:57:30` The agent half was asked once — for the pattern  
✅ `09:57:30` …and never for the values the panel refused  
✅ `09:57:30` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `09:57:30` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `09:57:30` Revision 1, configured, nothing missing  
✅ `09:57:30` The answer says when apiKey was set, and nothing else about it  
✅ `09:57:30` GET: apiKey { set: true, setAt: 2026-11-03T09:57:30.769Z }  
✅ `09:57:31` GET: live, configured, region eu  
✅ `09:57:31` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `09:57:31` …at revision 1, configured, region eu, retries still the default  
✅ `09:57:31` It saw the change (onChange), logged without a value  
✅ `09:57:31` GET /api/plugins: configured  
✅ `09:57:31` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `09:57:31` An update edited at revision 0, now 1: 409  
✅ `09:57:31` …revision_mismatch, with the current revision  
✅ `09:57:32` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `09:57:32` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `09:57:32` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `09:57:32` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `09:57:32` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `09:57:32` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `09:57:32` The agent half saw none of them  
✅ `09:57:33` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `09:57:34` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-03T09:57:26.228Z (7s ago))  
✅ `09:57:34` Its output holds no secret  
✅ `09:57:34` apiKey was set again (2026-11-03T09:57:33.909Z)  
✅ `09:57:34` …in one update with retries 7 and region us (revision 2)  
✅ `09:57:34` The agent half holds secret B  
✅ `09:57:35` plugins configure e2e-apphost-cfg --clear region (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-03T09:57:26.228Z (9s ago))  
✅ `09:57:35` region is unset again, it has no default (revision 3)  
✅ `09:57:36` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `09:57:36` …the refusal points to --secrets-stdin  
✅ `09:57:36` …without repeating the value  
✅ `09:57:37` …and nothing changed  
✅ `09:57:37` plugins settings e2e-apphost-cfg --json  
✅ `09:57:37` …shows apiKey set  
✅ `09:57:37` …and no secret  
✅ `09:57:38` Every process's arguments were sampled throughout (41 samples)…  
✅ `09:57:38` …while lamaste-server configured the plugin (11 lines)  
✅ `09:57:38` No process had a test secret in its arguments — the CLI's curl included  
✅ `09:57:38` …or in its environment  
✅ `09:57:38` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `09:57:38` settings.json: 0600, the account's  
✅ `09:57:38` secrets.json: 0600, the account's  
✅ `09:57:38` secrets.json holds apiKey…  
✅ `09:57:38` …whose value is secret B (by digest)  
✅ `09:57:38` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `09:57:38` …retries recorded with its type: integer 7  
✅ `09:57:38` The secret is in no other file of the data directory, settings.json included  
✅ `09:57:38` …nor in the agent half's config or code  
✅ `09:57:38` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `09:57:38` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `09:57:38` 2.0.0 waits for approval: its agent half changed  
✅ `09:57:38` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `09:57:38` Preview: endpoint becomes required  
✅ `09:57:38` Preview: endpoint added (a string), nothing removed  
✅ `09:57:38` Preview: no secret becomes a plain field  
✅ `09:57:38` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `09:57:46` The update succeeded ()  
✅ `09:57:46` The hosting is up on 2.0.0  
✅ `09:57:46` GET: the fields of 2.0.0  
✅ `09:57:46` It needs configuration again: endpoint is missing  
✅ `09:57:46` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `09:57:46` The secret stays set, as it was  
✅ `09:57:46` GET /api/plugins: needs configuration (endpoint)  
✅ `09:57:46` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `09:57:46` It dropped the retyped value from its store  
✅ `09:57:46` …and kept secret B  
✅ `09:57:47` settings.json on the agent VM: schema 2, no retries  
✅ `09:57:47` endpoint filled in  
✅ `09:57:47` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `09:57:54` Unhosted, the data kept ()  
✅ `09:57:54` settings.json and secrets.json stay in the kept data directory  
✅ `09:57:54` …secret B with them  
✅ `09:57:54` Not hosted: a change is refused (503)  
✅ `09:57:54` …hosting_offline  
✅ `09:58:04` Hosted again ()  
✅ `09:58:17` The hosting is up again  
✅ `09:58:18` Read live: revision 4, configured — the settings came back  
✅ `09:58:18` …the same values, the same secret  
✅ `09:58:18` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `09:58:18` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `09:58:18` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `09:58:18` state.db, dumped, holds none  
✅ `09:58:18` …a dump of 653 lines, plugin_settings in it  
✅ `09:58:18` The host's journal since the spec started holds none (1527 lines)  
✅ `09:58:18` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `09:58:18` The relay's cache (plugin_settings): revision 4, configured  
✅ `09:58:18` …which keeps when apiKey was set, a timestamp  
✅ `09:58:18` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `09:58:19` Auto-approve is on for e2e-apphost-cfg  
✅ `09:58:19` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `09:58:19` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `09:58:19` …retyped secret to string  
✅ `09:58:19` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `09:58:19` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `09:58:19` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `09:58:19` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `09:58:19` Until it is approved, 2.0.0 stays…  
✅ `09:58:19` …and the agent half holds secret B, schema 2  
✅ `09:58:27` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `09:58:27` The hosting is up on 3.0.0  
✅ `09:58:27` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `09:58:27` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `09:58:27` GET settings: apiKey is a plain string field…  
✅ `09:58:27` …without a value  
✅ `09:58:27` …and the plugin needs configuration: apiKey is missing  
✅ `09:58:27` GET /api/plugins: needs configuration (apiKey)  
✅ `09:58:27` The relay's cache: schema 3, no secret, no apiKey value  
✅ `09:58:28` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `09:58:35` Uninstalled with purge ()  
✅ `09:58:35` GET settings: 404, the plugin is gone  
✅ `09:58:36` No plugin_settings row left on the relay  
✅ `09:58:36` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `09:58:36` Cleaning up test resources...  
