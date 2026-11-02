# enginedrift

Three places in a Node project quietly name a Node version:
`engines.node` in package.json, the `node-version` values in CI,
and the `FROM node:...` tags in a Dockerfile. When they disagree,
the failure usually shows up late — a CI job running a different
major than the container, or a syntax feature that works in one
place and not another. enginedrift extracts what each source
actually declares and reports the drift up front.

It answers with:

- `drift` — true when sources declare conflicting majors, or a
  source sits entirely below package.json's declared minimum
- `sources` — one entry per provided source, with the raw
  declared strings, the majors found (ascending, unique), and a
  note when a source cannot pin a major (for example a CI
  `node-version-file` key)
- `issues` — in a fixed order: `MAJOR_MISMATCH` (distinct majors
  across sources), `BELOW_MINIMUM` (a source entirely below
  package.json's minimum major), `UNPINNED_IMAGE` (a Dockerfile
  `FROM node` with no numeric tag, such as `lts-alpine` or
  `latest`), and `NO_ENGINES` (package.json declares no
  `engines.node`)

Extraction notes: for an engines range, the declared minimum is
the smallest major mentioned (`>=20` means 20, `^18.2` means
18, `20.x` means 20, and a bare `*` declares nothing). CI values
may be scalars, inline matrix lists such as `[20, 22]`, or YAML
block lists under the key. Every Dockerfile stage is scanned, so
multi-stage builds report each `FROM node` line. An absent CI
config or Dockerfile is never an issue by itself. Pure local
computation: no network, no configuration, no files read by the
tool itself.

## CLI

```bash
npx @reneturcios/enginedrift check --package-json package.json --ci .github/workflows/ci.yml --dockerfile Dockerfile
npx @reneturcios/enginedrift --version
```

The `--ci` and `--dockerfile` flags are optional. The result is
printed as JSON. Exit codes: `0` when the check ran (drift is
data, not an error), `1` on a runtime error (including an
unreadable file or an invalid package.json), `2` on a usage
error.

## MCP server

```bash
npx -y @reneturcios/enginedrift mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "enginedrift": {
      "command": "npx",
      "args": ["-y", "@reneturcios/enginedrift", "mcp"]
    }
  }
}
```

### Tools

- `check_engine_drift` — Compare Node majors declared in
  package.json, CI config, and a Dockerfile, and report drift.
  - `package_json` (string, required) — package.json text; its
    engines.node range is the anchor source
  - `ci_yaml` (string, optional) — CI workflow YAML text;
    node-version values are extracted
  - `dockerfile` (string, optional) — Dockerfile text; FROM
    node image tags are extracted

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/enginedrift
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/enginedrift check --package-json /w/package.json --dockerfile /w/Dockerfile
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
