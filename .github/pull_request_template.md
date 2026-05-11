## What does this PR do?

<!-- Brief description of the change -->

## Type of change

- [ ] New feature
- [ ] Bug fix
- [ ] Installer phase implementation
- [ ] Panel route implementation
- [ ] Frontend page implementation
- [ ] Documentation

## Testing done

- [ ] Syntax check passed: `node --check packages/**/*.js`
- [ ] Installer dry-run works: `node packages/provisioners/server/bin/create-lamaste.js --help`
- [ ] Tested on real droplet (if applicable)

## Security checklist

- [ ] No hardcoded secrets or credentials
- [ ] Shell commands use `execa` with array args (no string concatenation)
- [ ] New API inputs validated with Zod
- [ ] New privileged operations have sudoers rules in `05-panel.js`

## Notes for reviewers

<!-- Anything specific to look at, tricky logic, decisions made -->
