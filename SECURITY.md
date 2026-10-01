# Security & Credential Rotation

The SFTP login used by `npm run push` is the only credential betafied holds. It
can replace the pack on the live server, so a value that reaches a commit is
compromised: deleting it from the tip of `main` leaves it in every commit that
introduced it, and the remote is public. Rotation is the fix; code changes only
stop the leak from spreading.

The pack itself ships no runtime secrets — no webhooks, no API keys — so unlike
a project that bakes values into scripts at build time, there is no build-time
path from `.env` into the committed tree.

## Rotation register

| Credential | Leaked in | Exposure | Status |
| --- | --- | --- | --- |
| SFTP login — `BETAFIED_SFTP_USER`, `BETAFIED_SFTP_PASSWORD` | never committed | — | **CLEAR** |

Status is `CLEAR` while no value has ever been committed, `ROTATE` once one has
and before the operator confirms a replacement is live at the provider. The
history scan that backs `CLEAR` uses `git log -S "<literal>"` for each real
value; re-run it after any change to how credentials are supplied.

## How secrets are supplied now

- `.env` at the project root is the only place a value lives. `.gitignore`
  ignores `.env` and every `.env.*` variant while keeping `.env.example`
  tracked, so the template documents each variable without carrying a value.
- Node entrypoints load `.env` through `scripts/lib/env.mjs`. `npm run push`
  refuses to start without `BETAFIED_SFTP_USER` and `BETAFIED_SFTP_PASSWORD`,
  naming the missing variable instead of connecting with a default.
- `scripts/regolith.sh` sources `.env` before building, so the build sees the
  same values the Node entrypoints do.

`.env.example` lists every variable. No value belongs in source, in a design
doc, in a commit message, or in an issue.

## Rotating a leaked secret

1. Rotate it at the provider (new SFTP password). Do this **before** scrubbing
   history: until the old value is dead, anyone holding it can still use it.
2. Put the new value in `.env`.
3. Scrub the old value from history (below).
4. Move the register row to `ROTATED`, noting the date.

## Scrubbing history

The old value is public the moment it was pushed, so assume it is burnt and
rotate first. Rewrite a throwaway clone so uncommitted work is never disturbed,
then adopt it:

```bash
git clone --no-hardlinks . /tmp/betafied-scrubbed
cd /tmp/betafied-scrubbed
# One `literal==>REDACTED` line per leaked value, then:
git filter-repo --replace-text expressions.txt
git reflog expire --expire=now --all && git gc --prune=now
```

Verify with a `git log -S "<literal>"` that returns nothing. Because the repo
has a remote, the rewrite must be force-pushed (`git push --force-with-lease`)
for the exposure to actually go away, and any fork or clone that already
fetched the old objects must be treated as still holding them.
