---
name: Bug report
about: Something is broken
labels: bug
---

## Describe the bug

<!-- What happened? What did you expect? -->

## Environment

- Ubuntu version:
- Node.js version (`node --version`):
- Lamaste version (`npx @lamalibre/create-lamaste --version`):
- DigitalOcean droplet size:

## Steps to reproduce

1.
2.
3.

## Error output

```
paste error here
```

## Relevant logs

```bash
# Check service logs:
journalctl -u lamalibre-lamaste-chisel-* -n 50
journalctl -u authelia -n 50
journalctl -u lamalibre-lamaste-serverd -n 50
tail -20 /var/log/nginx/error.log
```
