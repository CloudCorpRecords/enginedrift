# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `check_engine_drift` MCP tool and `check`
  CLI command comparing Node majors across package.json,
  CI config, and Dockerfile.
- Issue codes: `MAJOR_MISMATCH`, `BELOW_MINIMUM`,
  `UNPINNED_IMAGE`, `NO_ENGINES`; output carries `drift`,
  per-source `sources`, and `issues`.
