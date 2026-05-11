# TODO

## Future Work

- [ ] Allow multiple agent definitions on the same OS — run multiple chisel processes with separate configs, enabling simultaneous connections to different servers
- [ ] Add local server installation capability to desktop app — run `create-lamaste` flow from within the desktop app to install serverd on the local machine
- [ ] Extract agent management UI into `lamaste-agent-panel` shared package — reuse agent pages (tunnels, services, logs, settings) across desktop app and web
- [ ] Web-exposed agent panel — agent can expose its management panel via a new tunnelled subdomain, serving the `lamaste-agent-panel` UI over HTTPS
- [ ] Add agent installation capability to desktop app — run `lamaste-agent setup` flow from within the desktop app for users who haven't installed an agent yet
- [ ] Standalone local plugin installation via desktop app — install and manage plugins directly on the local machine without requiring a server or agent installation
