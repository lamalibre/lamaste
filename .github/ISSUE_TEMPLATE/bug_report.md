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
- Portlama version (`npx @lamalibre/create-portlama --version`):
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
journalctl -u chisel -n 50
journalctl -u authelia -n 50
journalctl -u portlama-panel -n 50
tail -20 /var/log/nginx/error.log
```
