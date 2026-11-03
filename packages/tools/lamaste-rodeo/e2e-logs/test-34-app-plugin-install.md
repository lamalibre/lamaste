# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-03 09:41:48 UTC`


## Pre-flight

✅ `09:41:48` Onboarding is complete  
✅ `09:41:49` Agent test-agent is enrolled on the host  
✅ `09:41:49` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `09:41:49` The agent VM's lamaste-agent has the apphost command  
ℹ️ `09:41:49` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `09:41:49` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `09:41:58` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `09:41:58` The agent VM reaches it at http://10.13.37.1:4874  
✅ `09:41:59` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T09:41:59.881Z"})  
✅ `09:41:59` …through its own OIDC client  
✅ `09:41:59` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `09:42:00` sqlite3 on the agent VM before: absent  
✅ `09:42:04` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `09:42:04` …an agent-hosted plugin  
✅ `09:42:04` Preview: the agent package Lamaste installs  
✅ `09:42:04` Preview: at the plugin's version  
✅ `09:42:04` Preview: the tarball integrity, pinned from the registry at install  
✅ `09:42:04` Preview: the system package it brings  
✅ `09:42:04` Preview: the service account  
✅ `09:42:04` Preview: the unit  
✅ `09:42:04` Preview: the service entry and its memory limit  
✅ `09:42:04` Its approval is pending  
✅ `09:42:04` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `09:42:04` Hosting an unapproved agent half is refused (409)  
✅ `09:42:04` …hooks_not_approved  
✅ `09:42:05` Approved with the digest the preview showed  
✅ `09:42:05` The relay holds the agent's current host facts  
✅ `09:42:05` Eligibility: test-agent cannot host it yet  
✅ `09:42:05` …the app host helper is not enabled  
✅ `09:42:05` Hosting on it is refused (409)  
✅ `09:42:05` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `09:42:05` The relay signs with key 530dc1ec96c7d4dfa4e9dc4974dfb26e  
✅ `09:42:05` apphost enable --user root (2,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"530dc1ec96c7d4dfa4e9dc4974dfb26e","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `09:42:05` …installed the helper, protocol 2  
✅ `09:42:05` …and no sudoers rule: the agent runs as root  
✅ `09:42:05` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `09:42:06` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `09:42:06` apphost status: e2e-agent has that key pinned  
✅ `09:42:06` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `09:42:06` apphost status: the helper is installed  
✅ `09:42:06` …the one this lamaste-agent ships  
✅ `09:42:06` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `09:42:06` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `09:42:06` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `09:42:33` The agent's sync reported the helper to the relay  
✅ `09:42:33` Host facts: Linux, systemd  
✅ `09:42:33` Host facts: helper protocol 2  
✅ `09:42:33` Host facts: the helper's Node.js  
✅ `09:42:33` Host facts: the relay key the helper verifies jobs with  
✅ `09:42:33` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `09:42:33` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `09:42:34` Push-install off: hosting is refused  
✅ `09:42:34` …push_install_refused (Push install is not enabled globally)  
✅ `09:42:34` Push-install on, the agent's window closed: hosting is refused  
✅ `09:42:34` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `09:42:35` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `09:42:35` Hosting on test-agent started (operation 3c166d49-e094-405a-b01b-a94eab967bc3)  
✅ `09:44:27` The hosting operation succeeded ()  
✅ `09:44:27` Step: reserve port, secret and capability  
✅ `09:44:27` Step: install the agent half  
✅ `09:44:27` Step: agent install:pre-tunnel  
✅ `09:44:27` Step: grant the tunnel and wait for the agent half  
✅ `09:44:27` Step: agent install:post-tunnel  
✅ `09:44:27` Step: activate  
✅ `09:44:27` The agent half was installed before its first hook ran  
✅ `09:44:27` The hosting is active  
✅ `09:44:27` The relay records agent half 1.0.0 on test-agent  
✅ `09:44:27` Port 21000 assigned from the internal range  
✅ `09:44:27` The push is in the push-install session log  
✅ `09:44:27` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `09:44:27` The agent's sync ran the app-install job (sync.log)  
✅ `09:44:27` …then the pre-tunnel hook job  
✅ `09:44:27` The installed service answered install:pre-tunnel (its journal)  
✅ `09:44:27` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `09:44:28` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `09:44:28` It runs as User=lamaste-app-e2e-apphost  
✅ `09:44:28` …and its process is owned by lamaste-app-e2e-apphost  
✅ `09:44:28` The account is not root  
✅ `09:44:28` …a system account without login shell or home  
✅ `09:44:28` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `09:44:28` current → 1.0.0, the version installed  
✅ `09:44:28` Every file of the code is root's and writable by root only  
✅ `09:44:28` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `09:44:28` …where the agent half keeps its state  
✅ `09:44:28` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `09:44:28` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `09:44:28` …for this plugin and its port  
✅ `09:44:28` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `09:44:28` The agent records the agent half it had installed  
✅ `09:44:28` sqlite3 is installed  
✅ `09:44:28` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `09:44:28` Unit: User=lamaste-app-e2e-apphost  
✅ `09:44:28` Unit: Group=lamaste-app-e2e-apphost  
✅ `09:44:28` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `09:44:28` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `09:44:28` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `09:44:28` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `09:44:28` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `09:44:28` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:44:28` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:44:28` Unit: Restart=always  
✅ `09:44:28` Unit: NoNewPrivileges=yes  
✅ `09:44:28` Unit: ProtectSystem=strict  
✅ `09:44:28` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:44:28` Unit: ProtectHome=yes  
✅ `09:44:28` Unit: PrivateTmp=yes  
✅ `09:44:28` Unit: PrivateDevices=yes  
✅ `09:44:28` Unit: ProtectKernelTunables=yes  
✅ `09:44:28` Unit: ProtectKernelModules=yes  
✅ `09:44:28` Unit: ProtectKernelLogs=yes  
✅ `09:44:28` Unit: ProtectControlGroups=yes  
✅ `09:44:28` Unit: ProtectClock=yes  
✅ `09:44:28` Unit: ProtectHostname=yes  
✅ `09:44:28` Unit: RestrictSUIDSGID=yes  
✅ `09:44:28` Unit: RestrictRealtime=yes  
✅ `09:44:28` Unit: RestrictNamespaces=yes  
✅ `09:44:28` Unit: LockPersonality=yes  
✅ `09:44:28` Unit: SystemCallArchitectures=native  
✅ `09:44:28` Unit: CapabilityBoundingSet=  
✅ `09:44:28` Unit: UMask=0077  
✅ `09:44:28` Unit: LimitCORE=0  
✅ `09:44:28` Unit: MemoryMax=256M  
✅ `09:44:28` Unit: WantedBy=multi-user.target  
✅ `09:44:28` The unit names paths, never the secret  
✅ `09:44:28` systemctl show: ProtectSystem=strict  
✅ `09:44:28` systemctl show: ProtectHome=yes  
✅ `09:44:28` systemctl show: NoNewPrivileges=yes  
✅ `09:44:28` systemctl show: PrivateTmp=yes  
✅ `09:44:28` systemctl show: PrivateDevices=yes  
✅ `09:44:28` systemctl show: RestrictSUIDSGID=yes  
✅ `09:44:28` systemctl show: LockPersonality=yes  
✅ `09:44:28` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `09:44:28` systemctl show: MemoryMax=268435456  
✅ `09:44:28` systemctl show: CapabilityBoundingSet=  
✅ `09:44:28` systemctl show: UMask=0077  
✅ `09:44:28` systemctl show: Restart=always  
✅ `09:44:28` systemctl show: LimitCORE=0  
✅ `09:44:28` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `09:44:28` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `09:44:28` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `09:44:28` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `09:44:28` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `09:44:28` …its sections: [Unit], [Socket], [Install]  
✅ `09:44:28` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `09:44:28` Socket unit: ListenStream=127.0.0.1:21000  
✅ `09:44:28` Socket unit: Accept=no  
✅ `09:44:28` Socket unit: NoDelay=true  
✅ `09:44:28` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `09:44:28` Socket unit: WantedBy=sockets.target  
✅ `09:44:28` …and no secret in it  
✅ `09:44:28` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `09:44:28` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `09:44:28` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `09:44:28` ss: one listening socket on port 21000  
✅ `09:44:28` …on 127.0.0.1:21000  
✅ `09:44:28` …held by systemd (pid 1)…  
✅ `09:44:28` …and by the agent half (MainPID 36728), the same socket  
✅ `09:44:28` The agent half's descriptor 3 is that listening socket (inode 106978)  
✅ `09:44:28` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `09:44:29` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `09:44:29` …the installed version, 1.0.0  
✅ `09:44:29` …running as lamaste-app-e2e-apphost  
✅ `09:44:29` …which sees the admin as its caller  
✅ `09:44:29` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `09:44:29` The admin page's bundle comes from the agent half  
✅ `09:44:29` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `09:44:29` Sandbox: it writes its data directory  
✅ `09:44:29` Sandbox: no write to etc (EROFS)  
✅ `09:44:29` Sandbox: no write to code (EROFS)  
✅ `09:44:29` Sandbox: no write to appsDir (EROFS)  
✅ `09:44:29` Sandbox: no write to configDir (EROFS)  
✅ `09:44:29` Sandbox: no write to usrLocal (EROFS)  
✅ `09:44:29` Sandbox: no write to root (EACCES)  
✅ `09:44:29` Sandbox: no write to home (EACCES)  
✅ `09:44:29` Sandbox: no write to runLock (EROFS)  
✅ `09:44:29` Sandbox: no write to run (EROFS)  
✅ `09:44:29` Sandbox: no write to varCrash (EROFS)  
✅ `09:44:29` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `09:44:29` Sandbox: it has a /tmp…  
✅ `09:44:29` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `09:44:29` Sandbox: it has a /var/tmp…  
✅ `09:44:29` …of its own: nothing appears in the machine's /var/tmp  
✅ `09:44:29` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `09:44:29` …and nothing appears in the machine's /dev/shm  
✅ `09:44:29` Sandbox: no new privileges, no capabilities  
✅ `09:44:29` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `09:44:29` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `09:44:29` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `09:44:29` The packument of @lamalibre/e2e-apphost-server was read  
✅ `09:44:29` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `09:44:29` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `09:44:29` No package was served to a request the stand-in Feria could not attribute  
✅ `09:44:29` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `09:44:29` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `09:44:29` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `09:44:29` …and nobody else did: the relay pinned it from the packument alone  
✅ `09:44:29` Its token: an agent token, read scope  
✅ `09:44:29` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `09:44:36` The uninstall operation succeeded ()  
✅ `09:44:36` Step: agent uninstall:pre-teardown  
✅ `09:44:36` Step: remove the tunnel  
✅ `09:44:36` Step: agent uninstall:post-teardown  
✅ `09:44:37` Step: remove the agent half  
✅ `09:44:37` Step: revoke the secret and the capability  
✅ `09:44:37` Step: remove the package  
✅ `09:44:37` The agent half went before the secret it runs with  
✅ `09:44:37` The plugin is gone from the relay  
✅ `09:44:37` Uninstalled: no hosting record (no secret)  
✅ `09:44:37` Uninstalled: no internal tunnel  
✅ `09:44:37` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `09:44:37` Audit: plugin.agent-half.removed, purge  
✅ `09:44:37` No unit on the agent VM  
✅ `09:44:37` No socket unit  
✅ `09:44:37` No drop-in directory  
✅ `09:44:37` Nothing listens on port 21000 any more: the socket let go of it  
✅ `09:44:37` No code, config or data directory  
✅ `09:44:37` No lamaste-app-e2e-apphost account or group  
✅ `09:44:37` The agent's record no longer lists it  
✅ `09:44:37` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `09:44:37` Cleaning up test resources...  
