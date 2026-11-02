/**
 * enginedrift core: Node engine drift across package.json, CI,
 * and Dockerfile.
 *
 *   checkEngineDrift(packageJson, ciYaml?, dockerfile?) -> report
 *
 * Extraction:
 * - package.json is parsed as JSON; invalid JSON is an error
 *   naming the parse failure, because it is the anchor source.
 *   `engines.node` (a string) when present is the declaration;
 *   the declared minimum is the smallest major mentioned in the
 *   range (every (\d+)(\.\d+)?(\.\d+)? token contributes its
 *   major). A bare `*` / `x`, or a missing engines.node, declares
 *   nothing (declared null internally).
 * - CI YAML: every `node-version:` value — a quoted or bare
 *   scalar, an inline list (`[20, 22]`), or a YAML block list
 *   under the key. A `node-version-file` key is recorded as the
 *   declared string "file" with no major and an explanatory note.
 * - Dockerfile: every `FROM` line whose image is `node` or
 *   starts with `node:`. A numeric tag (`20`, `20-alpine`,
 *   `20.11`) yields its major; `lts-alpine`, `latest`, or no tag
 *   declares the image but pins no major (unpinned).
 *
 * Issues, applied in this order:
 *   MAJOR_MISMATCH  distinct declared majors across sources (>1)
 *   BELOW_MINIMUM   a source's majors are all below package.json's
 *                   minimum major
 *   UNPINNED_IMAGE  a Dockerfile FROM node with no numeric tag
 *   NO_ENGINES      package.json declares no engines.node major
 *
 * `drift` is true iff MAJOR_MISMATCH or BELOW_MINIMUM fired.
 * Absence of a source is never an issue by itself; an empty
 * ci_yaml / dockerfile string is treated as absent.
 */
import type { DriftIssue, EngineDriftResult, SourceSummary } from "./types.js";

export const VERSION = "0.1.0";

const VERSION_TOKEN = /(\d+)(?:\.\d+)?(?:\.\d+)?/g;

function majorsIn(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(VERSION_TOKEN)) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function firstMajor(text: string): number | null {
  const majors = majorsIn(text);
  return majors.length > 0 ? majors[0] : null;
}

function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/** Strip a trailing YAML comment from a bare scalar value. */
function stripComment(value: string): string {
  return value.replace(/\s+#.*$/, "").trim();
}

interface PackageExtraction {
  summary: SourceSummary;
  /** Smallest major mentioned in engines.node, or null. */
  minMajor: number | null;
  raw: string | null;
}

function extractPackage(packageJson: unknown): PackageExtraction {
  if (typeof packageJson !== "string" || !packageJson.trim()) {
    throw new Error("package_json is required and must be a non-empty string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch (err) {
    throw new Error(
      `package_json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const engines =
    parsed !== null && typeof parsed === "object"
      ? (parsed as { engines?: unknown }).engines
      : undefined;
  const nodeRange =
    engines !== null && typeof engines === "object"
      ? (engines as { node?: unknown }).node
      : undefined;
  const raw = typeof nodeRange === "string" && nodeRange.trim() ? nodeRange.trim() : null;
  if (raw === null) {
    return { summary: { source: "package.json", declared: [], majors: [], note: null }, minMajor: null, raw };
  }
  const majors = majorsIn(raw);
  const minMajor = majors.length > 0 ? majors[0] : null;
  return {
    summary: { source: "package.json", declared: [raw], majors, note: null },
    minMajor,
    raw,
  };
}

function extractCi(ciYaml: string): SourceSummary {
  const declared: string[] = [];
  const majors = new Set<number>();
  let sawFileKey = false;
  const lines = ciYaml.split(/\r?\n/);
  const record = (value: string) => {
    const v = unquote(stripComment(value));
    if (!v || v.includes("${{")) return;
    declared.push(v);
    const major = firstMajor(v);
    if (major !== null) majors.add(major);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fileMatch = line.match(/node-version-file\s*:\s*(.*)$/);
    if (fileMatch) {
      sawFileKey = true;
      declared.push("file");
      continue;
    }
    const match = line.match(/node-version\s*:\s*(.*)$/);
    if (!match) continue;
    const value = stripComment(match[1].trim());
    if (value.startsWith("[")) {
      const inner = value.replace(/^\[/, "").replace(/\]$/, "");
      for (const part of inner.split(",")) {
        if (part.trim()) record(part);
      }
      continue;
    }
    if (value) {
      record(value);
      continue;
    }
    // No inline value: collect a following YAML block list.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (!next.startsWith("-")) break;
      record(next.replace(/^-\s*/, ""));
      i = j;
    }
  }
  return {
    source: "ci",
    declared,
    majors: [...majors].sort((a, b) => a - b),
    note: sawFileKey
      ? "node-version-file used: the Node version is read from a file, so no major can be extracted from the CI config"
      : null,
  };
}

interface DockerExtraction {
  summary: SourceSummary;
  unpinned: string[];
}

function extractDocker(dockerfile: string): DockerExtraction {
  const declared: string[] = [];
  const majors = new Set<number>();
  const unpinned: string[] = [];
  for (const line of dockerfile.split(/\r?\n/)) {
    const match = line.match(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/i);
    if (!match) continue;
    const image = match[1];
    if (image !== "node" && !image.startsWith("node:") && !image.startsWith("node@")) continue;
    declared.push(image);
    const tag = image.startsWith("node:") ? image.slice("node:".length).split("@")[0] : "";
    const major = tag ? firstMajor(tag) : null;
    // A tag like "20-alpine" starts numeric; "lts-alpine" does not.
    if (major !== null && /^\d/.test(tag)) {
      majors.add(major);
    } else {
      unpinned.push(image);
    }
  }
  return {
    summary: {
      source: "dockerfile",
      declared,
      majors: [...majors].sort((a, b) => a - b),
      note: null,
    },
    unpinned,
  };
}

function optionalText(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value.trim() ? value : null;
}

/** Compare the Node declarations across the provided sources. */
export function checkEngineDrift(
  packageJson: unknown,
  ciYaml?: unknown,
  dockerfile?: unknown,
): EngineDriftResult {
  const pkg = extractPackage(packageJson);
  const ciText = optionalText(ciYaml, "ci_yaml");
  const dockerText = optionalText(dockerfile, "dockerfile");

  const sources: SourceSummary[] = [pkg.summary];
  let ci: SourceSummary | null = null;
  let docker: DockerExtraction | null = null;
  if (ciText !== null) {
    ci = extractCi(ciText);
    sources.push(ci);
  }
  if (dockerText !== null) {
    docker = extractDocker(dockerText);
    sources.push(docker.summary);
  }

  const issues: DriftIssue[] = [];

  // MAJOR_MISMATCH — distinct majors across sources, with at
  // least two sources declaring a major.
  const union = new Set<number>();
  let sourcesWithMajor = 0;
  for (const source of sources) {
    if (source.majors.length > 0) sourcesWithMajor++;
    for (const major of source.majors) union.add(major);
  }
  if (union.size > 1 && sourcesWithMajor >= 2) {
    issues.push({
      code: "MAJOR_MISMATCH",
      message: `sources declare different Node majors: ${[...union].sort((a, b) => a - b).join(", ")}`,
    });
  }

  // BELOW_MINIMUM — a non-package source entirely below the
  // package.json minimum major.
  if (pkg.minMajor !== null) {
    for (const source of sources) {
      if (source.source === "package.json" || source.majors.length === 0) continue;
      if (source.majors.every((major) => major < pkg.minMajor!)) {
        issues.push({
          code: "BELOW_MINIMUM",
          message: `${source.source} declares Node major(s) ${source.majors.join(", ")}, all below the package.json minimum major ${pkg.minMajor}`,
        });
      }
    }
  }

  // UNPINNED_IMAGE — a Dockerfile FROM node with no numeric tag.
  if (docker !== null) {
    for (const image of docker.unpinned) {
      issues.push({
        code: "UNPINNED_IMAGE",
        message: `Dockerfile uses '${image}' with no numeric Node tag, so its major is unpinned`,
      });
    }
  }

  // NO_ENGINES — package.json declares no engines.node major.
  if (pkg.minMajor === null) {
    issues.push({
      code: "NO_ENGINES",
      message: "package.json has no engines.node declaration pinning a Node major",
    });
  }

  const drift = issues.some(
    (issue) => issue.code === "MAJOR_MISMATCH" || issue.code === "BELOW_MINIMUM",
  );
  return { drift, sources, issues };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
