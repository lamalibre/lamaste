# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-04 13:46:17 UTC`


## Pre-flight

✅ `13:46:17` Onboarding is complete  
✅ `13:46:18` Agent test-agent is enrolled on the host  
✅ `13:46:18` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:46:19` The agent VM's lamaste-agent has the apphost command  
ℹ️ `13:46:19` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `13:46:20` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `13:46:27` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `13:46:27` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:46:29` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T13:46:29.060Z"})  
✅ `13:46:29` …through its own OIDC client  
✅ `13:46:29` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `13:46:29` sqlite3 on the agent VM before: absent  
✅ `13:46:52` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `13:46:52` …an agent-hosted plugin  
✅ `13:46:52` Preview: the agent package Lamaste installs  
✅ `13:46:52` Preview: at the plugin's version  
✅ `13:46:52` Preview: the tarball integrity, pinned from the registry at install  
✅ `13:46:52` Preview: the system package it brings  
✅ `13:46:52` Preview: the service account  
✅ `13:46:52` Preview: the unit  
✅ `13:46:52` Preview: the service entry and its memory limit  
✅ `13:46:52` Its approval is pending  
✅ `13:46:53` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `13:46:53` Hosting an unapproved agent half is refused (409)  
✅ `13:46:53` …hooks_not_approved  
✅ `13:46:53` Approved with the digest the preview showed  
✅ `13:46:54` The relay holds the agent's current host facts  
✅ `13:46:54` Eligibility: test-agent cannot host it yet  
✅ `13:46:54` …the app host helper is not enabled  
✅ `13:46:54` Hosting on it is refused (409)  
✅ `13:46:54` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `13:46:55` The relay signs with key 23f2eec13ad533a640bb504a4c413f5d  
✅ `13:46:55` apphost enable --user root (2,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"23f2eec13ad533a640bb504a4c413f5d","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `13:46:55` …installed the helper, protocol 2  
✅ `13:46:55` …and no sudoers rule: the agent runs as root  
✅ `13:46:55` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `13:46:55` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `13:46:56` apphost status: e2e-agent has that key pinned  
✅ `13:46:56` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `13:46:56` apphost status: the helper is installed  
✅ `13:46:56` …the one this lamaste-agent ships  
✅ `13:46:56` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `13:46:57` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `13:46:57` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `13:47:00` The agent's sync reported the helper to the relay  
✅ `13:47:00` Host facts: Linux, systemd  
✅ `13:47:00` Host facts: helper protocol 2  
✅ `13:47:00` Host facts: the helper's Node.js  
✅ `13:47:00` Host facts: the relay key the helper verifies jobs with  
✅ `13:47:00` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `13:47:01` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `13:47:01` Push-install off: hosting is refused  
✅ `13:47:01` …push_install_refused (Push install is not enabled globally)  
✅ `13:47:02` Push-install on, the agent's window closed: hosting is refused  
✅ `13:47:02` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `13:47:03` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `13:47:03` Hosting on test-agent started (operation c1201c89-150c-4e1d-8683-0c3a57f7ee79)  
✅ `13:48:51` The hosting operation succeeded ()  
✅ `13:48:51` Step: reserve port, secret and capability  
✅ `13:48:51` Step: install the agent half  
✅ `13:48:51` Step: agent install:pre-tunnel  
✅ `13:48:51` Step: grant the tunnel and wait for the agent half  
✅ `13:48:51` Step: agent install:post-tunnel  
✅ `13:48:51` Step: activate  
✅ `13:48:51` The agent half was installed before its first hook ran  
✅ `13:48:51` The hosting is active  
✅ `13:48:51` The relay records agent half 1.0.0 on test-agent  
✅ `13:48:51` Port 21000 assigned from the internal range  
✅ `13:48:51` The push is in the push-install session log  
✅ `13:48:52` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `13:48:52` The agent's sync ran the app-install job (sync.log)  
✅ `13:48:52` …then the pre-tunnel hook job  
✅ `13:48:53` The installed service answered install:pre-tunnel (its journal)  
✅ `13:48:53` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `13:48:53` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `13:48:53` It runs as User=lamaste-app-e2e-apphost  
✅ `13:48:53` …and its process is owned by lamaste-app-e2e-apphost  
✅ `13:48:53` The account is not root  
✅ `13:48:53` …a system account without login shell or home  
✅ `13:48:53` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `13:48:53` current → 1.0.0, the version installed  
✅ `13:48:53` Every file of the code is root's and writable by root only  
✅ `13:48:53` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `13:48:53` …where the agent half keeps its state  
✅ `13:48:53` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `13:48:53` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `13:48:53` …for this plugin and its port  
✅ `13:48:53` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `13:48:53` The agent records the agent half it had installed  
✅ `13:48:53` sqlite3 is installed  
✅ `13:48:53` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `13:48:53` Unit: User=lamaste-app-e2e-apphost  
✅ `13:48:53` Unit: Group=lamaste-app-e2e-apphost  
✅ `13:48:53` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `13:48:53` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `13:48:53` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `13:48:53` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `13:48:53` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `13:48:53` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:48:53` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:48:53` Unit: Restart=always  
✅ `13:48:53` Unit: NoNewPrivileges=yes  
✅ `13:48:53` Unit: ProtectSystem=strict  
✅ `13:48:53` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:48:53` Unit: ProtectHome=yes  
✅ `13:48:53` Unit: PrivateTmp=yes  
✅ `13:48:53` Unit: PrivateDevices=yes  
✅ `13:48:53` Unit: ProtectKernelTunables=yes  
✅ `13:48:53` Unit: ProtectKernelModules=yes  
✅ `13:48:53` Unit: ProtectKernelLogs=yes  
✅ `13:48:53` Unit: ProtectControlGroups=yes  
✅ `13:48:53` Unit: ProtectClock=yes  
✅ `13:48:54` Unit: ProtectHostname=yes  
✅ `13:48:54` Unit: RestrictSUIDSGID=yes  
✅ `13:48:54` Unit: RestrictRealtime=yes  
✅ `13:48:54` Unit: RestrictNamespaces=yes  
✅ `13:48:54` Unit: LockPersonality=yes  
✅ `13:48:54` Unit: SystemCallArchitectures=native  
✅ `13:48:54` Unit: CapabilityBoundingSet=  
✅ `13:48:54` Unit: UMask=0077  
✅ `13:48:54` Unit: LimitCORE=0  
✅ `13:48:54` Unit: MemoryMax=256M  
✅ `13:48:54` Unit: WantedBy=multi-user.target  
✅ `13:48:54` The unit names paths, never the secret  
✅ `13:48:54` systemctl show: ProtectSystem=strict  
✅ `13:48:54` systemctl show: ProtectHome=yes  
✅ `13:48:54` systemctl show: NoNewPrivileges=yes  
✅ `13:48:54` systemctl show: PrivateTmp=yes  
✅ `13:48:54` systemctl show: PrivateDevices=yes  
✅ `13:48:54` systemctl show: RestrictSUIDSGID=yes  
✅ `13:48:54` systemctl show: LockPersonality=yes  
✅ `13:48:54` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `13:48:54` systemctl show: MemoryMax=268435456  
✅ `13:48:54` systemctl show: CapabilityBoundingSet=  
✅ `13:48:54` systemctl show: UMask=0077  
✅ `13:48:54` systemctl show: Restart=always  
✅ `13:48:54` systemctl show: LimitCORE=0  
✅ `13:48:54` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `13:48:54` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `13:48:54` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `13:48:54` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `13:48:54` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `13:48:54` …its sections: [Unit], [Socket], [Install]  
✅ `13:48:54` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `13:48:54` Socket unit: ListenStream=127.0.0.1:21000  
✅ `13:48:54` Socket unit: Accept=no  
✅ `13:48:54` Socket unit: NoDelay=true  
✅ `13:48:54` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `13:48:54` Socket unit: WantedBy=sockets.target  
✅ `13:48:54` …and no secret in it  
✅ `13:48:54` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `13:48:54` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `13:48:54` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `13:48:54` ss: one listening socket on port 21000  
✅ `13:48:54` …on 127.0.0.1:21000  
✅ `13:48:54` …held by systemd (pid 1)…  
✅ `13:48:54` …and by the agent half (MainPID 35986), the same socket  
✅ `13:48:54` The agent half's descriptor 3 is that listening socket (inode 104572)  
✅ `13:48:55` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `13:48:55` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `13:48:55` …the installed version, 1.0.0  
✅ `13:48:55` …running as lamaste-app-e2e-apphost  
✅ `13:48:55` …which sees the admin as its caller  
✅ `13:48:55` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `13:48:55` The admin page's bundle comes from the agent half  
✅ `13:48:55` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `13:48:56` Sandbox: it writes its data directory  
✅ `13:48:56` Sandbox: no write to etc (EROFS)  
✅ `13:48:56` Sandbox: no write to code (EROFS)  
✅ `13:48:56` Sandbox: no write to appsDir (EROFS)  
✅ `13:48:56` Sandbox: no write to configDir (EROFS)  
✅ `13:48:56` Sandbox: no write to usrLocal (EROFS)  
✅ `13:48:56` Sandbox: no write to root (EACCES)  
✅ `13:48:56` Sandbox: no write to home (EACCES)  
✅ `13:48:56` Sandbox: no write to runLock (EROFS)  
✅ `13:48:56` Sandbox: no write to run (EROFS)  
✅ `13:48:56` Sandbox: no write to varCrash (EROFS)  
✅ `13:48:56` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `13:48:56` Sandbox: it has a /tmp…  
✅ `13:48:56` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `13:48:56` Sandbox: it has a /var/tmp…  
✅ `13:48:56` …of its own: nothing appears in the machine's /var/tmp  
✅ `13:48:56` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `13:48:56` …and nothing appears in the machine's /dev/shm  
✅ `13:48:56` Sandbox: no new privileges, no capabilities  
✅ `13:48:56` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `13:48:56` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `13:48:56` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `13:48:56` The packument of @lamalibre/e2e-apphost-server was read  
✅ `13:48:56` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `13:48:56` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `13:48:56` No package was served to a request the stand-in Feria could not attribute  
✅ `13:48:56` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `13:48:56` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `13:48:56` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `13:48:56` …and nobody else did: the relay pinned it from the packument alone  
✅ `13:48:56` Its token: an agent token, read scope  
✅ `13:48:56` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `13:49:06` The uninstall operation succeeded ()  
✅ `13:49:06` Step: agent uninstall:pre-teardown  
✅ `13:49:06` Step: remove the tunnel  
✅ `13:49:06` Step: agent uninstall:post-teardown  
✅ `13:49:06` Step: remove the agent half  
✅ `13:49:06` Step: revoke the secret and the capability  
✅ `13:49:06` Step: remove the package  
✅ `13:49:06` The agent half went before the secret it runs with  
✅ `13:49:06` The plugin is gone from the relay  
✅ `13:49:06` Uninstalled: no hosting record (no secret)  
✅ `13:49:06` Uninstalled: no internal tunnel  
✅ `13:49:06` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `13:49:07` Audit: plugin.agent-half.removed, purge  
✅ `13:49:07` No unit on the agent VM  
✅ `13:49:07` No socket unit  
✅ `13:49:07` No drop-in directory  
✅ `13:49:07` Nothing listens on port 21000 any more: the socket let go of it  
✅ `13:49:07` No code, config or data directory  
✅ `13:49:07` No lamaste-app-e2e-apphost account or group  
✅ `13:49:07` The agent's record no longer lists it  
✅ `13:49:08` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `13:49:08` Cleaning up test resources...  
