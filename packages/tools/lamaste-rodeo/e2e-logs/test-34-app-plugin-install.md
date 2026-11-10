# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-10 13:16:15 UTC`


## Pre-flight

✅ `13:16:15` Onboarding is complete  
✅ `13:16:16` Agent test-agent is enrolled on the host  
✅ `13:16:16` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:16:16` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:16:16` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `13:16:17` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `13:16:26` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `13:16:26` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:16:28` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T13:16:27.996Z"})  
✅ `13:16:28` …through its own OIDC client  
✅ `13:16:28` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `13:16:28` sqlite3 on the agent VM before: absent  
✅ `13:16:32` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `13:16:32` …an agent-hosted plugin  
✅ `13:16:32` Preview: the agent package Lamaste installs  
✅ `13:16:32` Preview: at the plugin's version  
✅ `13:16:33` Preview: the tarball integrity, pinned from the registry at install  
✅ `13:16:33` Preview: the system package it brings  
✅ `13:16:33` Preview: the service account  
✅ `13:16:33` Preview: the unit  
✅ `13:16:33` Preview: the service entry and its memory limit  
✅ `13:16:33` Its approval is pending  
✅ `13:16:33` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `13:16:33` Hosting an unapproved agent half is refused (409)  
✅ `13:16:33` …hooks_not_approved  
✅ `13:16:33` Approved with the digest the preview showed  
✅ `13:16:33` The relay holds the agent's current host facts  
✅ `13:16:34` Eligibility: test-agent cannot host it yet  
✅ `13:16:34` …the app host helper is not enabled  
✅ `13:16:34` Hosting on it is refused (409)  
✅ `13:16:34` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `13:16:35` The relay signs with key 82e467044ed46a2652dd3ab296c77bfd  
✅ `13:16:36` apphost enable --user root (3,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"82e467044ed46a2652dd3ab296c77bfd","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `13:16:36` …installed the helper, protocol 3  
✅ `13:16:36` …and no sudoers rule: the agent runs as root  
✅ `13:16:36` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `13:16:36` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `13:16:36` apphost status: e2e-agent has that key pinned  
✅ `13:16:36` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `13:16:36` apphost status: the helper is installed  
✅ `13:16:37` …the one this lamaste-agent ships  
✅ `13:16:37` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `13:16:37` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `13:16:37` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `13:17:03` The agent's sync reported the helper to the relay  
✅ `13:17:03` Host facts: Linux, systemd  
✅ `13:17:03` Host facts: helper protocol 3  
✅ `13:17:03` Host facts: the helper's Node.js  
✅ `13:17:03` Host facts: the relay key the helper verifies jobs with  
✅ `13:17:03` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `13:17:04` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `13:17:04` Push-install off: hosting is refused  
✅ `13:17:04` …push_install_refused (Push install is not enabled globally)  
✅ `13:17:05` Push-install on, the agent's window closed: hosting is refused  
✅ `13:17:05` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `13:17:05` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `13:17:06` Hosting on test-agent started (operation a17cdb97-bffd-432b-925d-60f4846a800a)  
✅ `13:18:55` The hosting operation succeeded ()  
✅ `13:18:55` Step: reserve port, secret and capability  
✅ `13:18:55` Step: install the agent half  
✅ `13:18:55` Step: agent install:pre-tunnel  
✅ `13:18:55` Step: grant the tunnel and wait for the agent half  
✅ `13:18:55` Step: agent install:post-tunnel  
✅ `13:18:55` Step: activate  
✅ `13:18:55` The agent half was installed before its first hook ran  
✅ `13:18:55` The hosting is active  
✅ `13:18:55` The relay records agent half 1.0.0 on test-agent  
✅ `13:18:55` Port 21000 assigned from the internal range  
✅ `13:18:55` The push is in the push-install session log  
✅ `13:18:55` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `13:18:55` The agent's sync ran the app-install job (sync.log)  
✅ `13:18:55` …then the pre-tunnel hook job  
✅ `13:18:56` The installed service answered install:pre-tunnel (its journal)  
✅ `13:18:56` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `13:18:56` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `13:18:56` It runs as User=lamaste-app-e2e-apphost  
✅ `13:18:56` …and its process is owned by lamaste-app-e2e-apphost  
✅ `13:18:56` The account is not root  
✅ `13:18:56` …a system account without login shell or home  
✅ `13:18:56` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `13:18:56` current → 1.0.0, the version installed  
✅ `13:18:56` Every file of the code is root's and writable by root only  
✅ `13:18:56` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `13:18:56` …where the agent half keeps its state  
✅ `13:18:56` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `13:18:56` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `13:18:56` …for this plugin and its port  
✅ `13:18:56` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `13:18:56` The agent records the agent half it had installed  
✅ `13:18:56` sqlite3 is installed  
✅ `13:18:56` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `13:18:56` Unit: User=lamaste-app-e2e-apphost  
✅ `13:18:56` Unit: Group=lamaste-app-e2e-apphost  
✅ `13:18:56` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `13:18:56` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `13:18:56` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `13:18:56` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `13:18:56` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `13:18:56` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:18:56` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:18:56` Unit: Restart=always  
✅ `13:18:56` Unit: NoNewPrivileges=yes  
✅ `13:18:56` Unit: ProtectSystem=strict  
✅ `13:18:56` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:18:56` Unit: ProtectHome=yes  
✅ `13:18:56` Unit: PrivateTmp=yes  
✅ `13:18:56` Unit: PrivateDevices=yes  
✅ `13:18:56` Unit: ProtectKernelTunables=yes  
✅ `13:18:56` Unit: ProtectKernelModules=yes  
✅ `13:18:56` Unit: ProtectKernelLogs=yes  
✅ `13:18:56` Unit: ProtectControlGroups=yes  
✅ `13:18:56` Unit: ProtectClock=yes  
✅ `13:18:56` Unit: ProtectHostname=yes  
✅ `13:18:56` Unit: RestrictSUIDSGID=yes  
✅ `13:18:56` Unit: RestrictRealtime=yes  
✅ `13:18:56` Unit: RestrictNamespaces=yes  
✅ `13:18:56` Unit: LockPersonality=yes  
✅ `13:18:56` Unit: SystemCallArchitectures=native  
✅ `13:18:56` Unit: CapabilityBoundingSet=  
✅ `13:18:56` Unit: UMask=0077  
✅ `13:18:56` Unit: LimitCORE=0  
✅ `13:18:56` Unit: MemoryMax=256M  
✅ `13:18:56` Unit: WantedBy=multi-user.target  
✅ `13:18:56` The unit names paths, never the secret  
✅ `13:18:56` systemctl show: ProtectSystem=strict  
✅ `13:18:56` systemctl show: ProtectHome=yes  
✅ `13:18:56` systemctl show: NoNewPrivileges=yes  
✅ `13:18:56` systemctl show: PrivateTmp=yes  
✅ `13:18:56` systemctl show: PrivateDevices=yes  
✅ `13:18:56` systemctl show: RestrictSUIDSGID=yes  
✅ `13:18:56` systemctl show: LockPersonality=yes  
✅ `13:18:56` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:18:56` systemctl show: MemoryMax=268435456  
✅ `13:18:56` systemctl show: CapabilityBoundingSet=  
✅ `13:18:56` systemctl show: UMask=0077  
✅ `13:18:56` systemctl show: Restart=always  
✅ `13:18:56` systemctl show: LimitCORE=0  
✅ `13:18:56` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `13:18:56` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `13:18:56` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `13:18:56` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `13:18:56` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `13:18:56` …its sections: [Unit], [Socket], [Install]  
✅ `13:18:57` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `13:18:57` Socket unit: ListenStream=127.0.0.1:21000  
✅ `13:18:57` Socket unit: Accept=no  
✅ `13:18:57` Socket unit: NoDelay=true  
✅ `13:18:57` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `13:18:57` Socket unit: WantedBy=sockets.target  
✅ `13:18:57` …and no secret in it  
✅ `13:18:57` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `13:18:57` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `13:18:57` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `13:18:57` ss: one listening socket on port 21000  
✅ `13:18:57` …on 127.0.0.1:21000  
✅ `13:18:57` …held by systemd (pid 1)…  
✅ `13:18:57` …and by the agent half (MainPID 36335), the same socket  
✅ `13:18:57` The agent half's descriptor 3 is that listening socket (inode 106474)  
✅ `13:18:57` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `13:18:57` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `13:18:57` …the installed version, 1.0.0  
✅ `13:18:57` …running as lamaste-app-e2e-apphost  
✅ `13:18:57` …which sees the admin as its caller  
✅ `13:18:57` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `13:18:57` The admin page's bundle comes from the agent half  
✅ `13:18:58` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `13:18:58` Sandbox: it writes its data directory  
✅ `13:18:58` Sandbox: no write to etc (EROFS)  
✅ `13:18:58` Sandbox: no write to code (EROFS)  
✅ `13:18:58` Sandbox: no write to appsDir (EROFS)  
✅ `13:18:58` Sandbox: no write to configDir (EROFS)  
✅ `13:18:58` Sandbox: no write to usrLocal (EROFS)  
✅ `13:18:58` Sandbox: no write to root (EACCES)  
✅ `13:18:58` Sandbox: no write to home (EACCES)  
✅ `13:18:58` Sandbox: no write to runLock (EROFS)  
✅ `13:18:58` Sandbox: no write to run (EROFS)  
✅ `13:18:58` Sandbox: no write to varCrash (EROFS)  
✅ `13:18:58` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `13:18:58` Sandbox: it has a /tmp…  
✅ `13:18:58` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `13:18:58` Sandbox: it has a /var/tmp…  
✅ `13:18:58` …of its own: nothing appears in the machine's /var/tmp  
✅ `13:18:58` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `13:18:58` …and nothing appears in the machine's /dev/shm  
✅ `13:18:58` Sandbox: no new privileges, no capabilities  
✅ `13:18:58` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `13:18:58` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `13:18:58` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `13:18:58` The packument of @lamalibre/e2e-apphost-server was read  
✅ `13:18:58` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `13:18:58` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `13:18:58` No package was served to a request the stand-in Feria could not attribute  
✅ `13:18:58` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `13:18:58` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `13:18:58` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `13:18:58` …and nobody else did: the relay pinned it from the packument alone  
✅ `13:18:58` Its token: an agent token, read scope  
✅ `13:18:58` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `13:19:06` The uninstall operation succeeded ()  
✅ `13:19:06` Step: agent uninstall:pre-teardown  
✅ `13:19:06` Step: remove the tunnel  
✅ `13:19:06` Step: agent uninstall:post-teardown  
✅ `13:19:06` Step: remove the agent half  
✅ `13:19:06` Step: revoke the secret and the capability  
✅ `13:19:06` Step: remove the package  
✅ `13:19:06` The agent half went before the secret it runs with  
✅ `13:19:06` The plugin is gone from the relay  
✅ `13:19:06` Uninstalled: no hosting record (no secret)  
✅ `13:19:06` Uninstalled: no internal tunnel  
✅ `13:19:06` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `13:19:07` Audit: plugin.agent-half.removed, purge  
✅ `13:19:07` No unit on the agent VM  
✅ `13:19:07` No socket unit  
✅ `13:19:07` No drop-in directory  
✅ `13:19:07` Nothing listens on port 21000 any more: the socket let go of it  
✅ `13:19:07` No code, config or data directory  
✅ `13:19:07` No lamaste-app-e2e-apphost account or group  
✅ `13:19:07` The agent's record no longer lists it  
✅ `13:19:07` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `13:19:07` Cleaning up test resources...  
