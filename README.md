# Watchtower release action

[![CI](https://github.com/watchtowerobservability/watchtower-action-release/actions/workflows/ci.yml/badge.svg)](https://github.com/watchtowerobservability/watchtower-action-release/actions/workflows/ci.yml)

A GitHub Action that creates a Watchtower release (with the commits since the previous tag), uploads
source maps and debug-id-stamped scripts, records a deploy for an environment and finalizes it.

## Install

Add the step to a workflow (see `examples/workflow.yml`) and store your key as the repository secret
`WT_AUTH_TOKEN`. Use a checkout with `fetch-depth: 0` so tags are available for the commit range.

## Quick start

```yaml
- uses: watchtowerobservability/watchtower-action-release@v0
  env:
    WT_AUTH_TOKEN: ${{ secrets.WT_AUTH_TOKEN }}
  with:
    project: ${{ vars.WT_PROJECT }}
    environment: production
    sourcemaps: dist
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `project` | `$WT_PROJECT` | Project id |
| `environment` | none | Deploy target; created if missing. Omit to skip the deploy |
| `release` | commit SHA | Release version |
| `sourcemaps` | none | Space/newline separated directories or files (`.map`, and `.js` carrying `//# debugId=`) |
| `url_prefix` | empty | Prefix for stored file names, e.g. `~/static` |
| `dist` | `.` | Build output directory that `sourcemaps` paths are relative to |
| `api_url` | `https://api.watchtower.observer` | API base (`WT_API_URL` also works) |
| `finalize` | `true` | `false` leaves the deploy `started` |

Secret: `WT_AUTH_TOKEN` (never logged; masked in errors). Output: `release`.

Scripts without a debug id are skipped because the API refuses them.

## Verify a release

`gh attestation verify watchtower-action-release.zip --repo watchtowerobservability/watchtower-action-release`

## License

Apache-2.0
