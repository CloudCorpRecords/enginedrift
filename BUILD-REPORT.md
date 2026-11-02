# enginedrift — Build Report

MCP Rebuild 1000, Batch 12. Original program build from the
packages-100 plan (cluster F #71: "Node / engine mismatches
across package.json, CI, and Dockerfile"), implemented from
the spec in `~/workspace/mcp-rebuild-100/specs-batch12/enginedrift.md`.
No external original exists. Local build only — nothing
pushed or published.

Identity: repo `enginedrift`, npm `@reneturcios/enginedrift`,
MCP name `io.github.CloudCorpRecords/enginedrift`, version
`0.1.0`, bin `enginedrift` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Detect Node
  engine drift across package.json, CI config, and Dockerfile
  before it breaks a build.", 97 chars ≤100; npm entry carries
  `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/enginedrift:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/enginedrift"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`check` with
  `--package-json` / `--ci` / `--dockerfile` file flags, `mcp`,
  `--version`; exit 2 usage / 1 runtime error / 0 when the
  check ran), `src/mcp.ts`, `src/types.ts`,
  `src/enginedrift.ts` (core, `VERSION = "0.1.0"`)
- `test/enginedrift.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container IMAGE = `ghcr.io/cloudcorprecords/enginedrift`)

## Tools implemented (1)

- `check_engine_drift` — `package_json` (string, required),
  `ci_yaml` (string, optional), `dockerfile` (string,
  optional). Output `{drift, sources, issues}`; `drift` is
  true iff `MAJOR_MISMATCH` or `BELOW_MINIMUM` fired.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the fixture,
  per the standing fleet rule; zod still validates every
  `tools/call`.
- package.json anchor: invalid JSON throws an error naming
  the parse failure (MCP surfaces it as `isError`). The
  declared minimum is the smallest major among all version
  tokens in `engines.node` (`>=20` → 20, `^18.2` → 18,
  `20.x` → 20); a bare `*` / `x` or a missing `engines.node`
  declares no major and reports `NO_ENGINES`. The source's
  `majors` list carries every major mentioned in the range,
  ascending and unique.
- CI extraction is line-based: `node-version:` scalars
  (quoted or bare), inline lists (`[20, 22]`), and YAML block
  lists under the key are all collected; a
  `node-version-file` key is recorded as declared `"file"`
  with no major and an explanatory note on the CI source.
  Templated `${{ ... }}` values are skipped.
- Dockerfile extraction scans every `FROM` line whose image
  is `node` or starts with `node:` (build flags before the
  image are tolerated, non-node images ignored). Numeric
  tags yield their major; `lts-*`, `latest`, and untagged
  images each produce one `UNPINNED_IMAGE` issue.
- Issues are emitted in spec order: `MAJOR_MISMATCH`,
  `BELOW_MINIMUM` (one per offending non-package source),
  `UNPINNED_IMAGE` (one per unpinned image), `NO_ENGINES`.
  Empty `ci_yaml` / `dockerfile` strings are treated as
  absent, and an absent source is never an issue.

## Verification (foreground, this session)

- `npx tsc` exit 0 (`dist/cli.js` built)
- `tsx --test test/*.test.ts`: **20 tests, 20 pass, 0 fail** —
  engines ranges (`>=20`, `^18.2`, `20.x`, `*`), missing
  engines → `NO_ENGINES`, invalid JSON error, missing/empty
  package_json error, CI scalar (bare + quoted) / inline
  matrix / block list / `node-version-file` note, Dockerfile
  tags (`20-alpine`, `lts-alpine` and untagged and `latest`
  unpinned, multi-stage scan, non-node images ignored),
  `MAJOR_MISMATCH`, `BELOW_MINIMUM` (CI and Dockerfile),
  issue ordering, no-drift case, empty optional inputs
  treated as absent
- `dist/cli.js --version` → `0.1.0`; no command exits 2
  with usage; a CLI `check` over sample files (package
  `>=20`, CI 18, Dockerfile `20-alpine` + `lts-alpine`)
  printed drift true with `MAJOR_MISMATCH`,
  `BELOW_MINIMUM`, and `UNPINNED_IMAGE`, exit 0
- Parity: `harness/parity.py` vs
  `harness/fixtures/enginedrift-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1**

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy
with only `package.json`, offline `npm install
--package-lock-only --ignore-scripts --offline`), verified:
parses, name `@reneturcios/enginedrift`, **128 package
entries**. Local `node_modules` was installed offline in the
build directory.

## Gaps / honest notes

- CI parsing is line-based rather than a full YAML parse:
  exotic flow styles beyond inline lists, and `node-version`
  values supplied through anchors or multi-line scalars, are
  not covered. The common GitHub Actions shapes in the spec
  (scalar, inline matrix list, block list, version file) all
  are.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
