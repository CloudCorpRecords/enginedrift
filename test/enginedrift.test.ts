import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkEngineDrift } from "../src/enginedrift.js";

/**
 * All tests are pure local computation over inline package.json,
 * CI YAML, and Dockerfile texts: no filesystem, no network.
 */

const pkg = (node?: string) =>
  JSON.stringify(
    node === undefined ? { name: "x" } : { name: "x", engines: { node } },
  );

function codes(out: ReturnType<typeof checkEngineDrift>): string[] {
  return out.issues.map((i) => i.code);
}

describe("checkEngineDrift — package.json engines parsing", () => {
  it("parses a >=20 range to major 20", () => {
    const out = checkEngineDrift(pkg(">=20"));
    assert.deepEqual(out.sources[0].declared, [">=20"]);
    assert.deepEqual(out.sources[0].majors, [20]);
    assert.equal(out.drift, false);
    assert.deepEqual(codes(out), []);
  });

  it("parses a ^18.2 range to the smallest major mentioned, 18", () => {
    const out = checkEngineDrift(pkg("^18.2"));
    assert.deepEqual(out.sources[0].majors, [18]);
    assert.deepEqual(codes(out), []);
  });

  it("parses a 20.x range to major 20", () => {
    const out = checkEngineDrift(pkg("20.x"));
    assert.deepEqual(out.sources[0].majors, [20]);
    assert.deepEqual(codes(out), []);
  });

  it("treats a bare * range as declaring nothing and reports NO_ENGINES", () => {
    const out = checkEngineDrift(pkg("*"));
    assert.deepEqual(out.sources[0].declared, ["*"]);
    assert.deepEqual(out.sources[0].majors, []);
    assert.ok(codes(out).includes("NO_ENGINES"));
    assert.equal(out.drift, false);
  });

  it("reports NO_ENGINES when engines.node is missing", () => {
    const out = checkEngineDrift(pkg());
    assert.deepEqual(out.sources[0].declared, []);
    assert.deepEqual(out.sources[0].majors, []);
    assert.deepEqual(codes(out), ["NO_ENGINES"]);
  });

  it("rejects invalid package.json JSON, naming the parse failure", () => {
    assert.throws(() => checkEngineDrift("{ not json"), /package_json is not valid JSON/);
  });

  it("rejects a missing or empty package_json", () => {
    assert.throws(() => checkEngineDrift(""), /package_json is required/);
    assert.throws(() => checkEngineDrift(undefined), /package_json is required/);
  });
});

describe("checkEngineDrift — CI extraction", () => {
  it("reads a scalar node-version, quoted or bare", () => {
    const bare = checkEngineDrift(pkg(">=20"), "steps:\n  - uses: actions/setup-node@v4\n    with:\n      node-version: 20\n");
    assert.deepEqual(bare.sources[1].declared, ["20"]);
    assert.deepEqual(bare.sources[1].majors, [20]);
    const quoted = checkEngineDrift(pkg(">=20"), "with:\n  node-version: '20.11'\n");
    assert.deepEqual(quoted.sources[1].declared, ["20.11"]);
    assert.deepEqual(quoted.sources[1].majors, [20]);
  });

  it("collects each entry of an inline matrix list", () => {
    const out = checkEngineDrift(pkg(">=20"), "strategy:\n  matrix:\n    node-version: [20, 22]\n");
    assert.deepEqual(out.sources[1].declared, ["20", "22"]);
    assert.deepEqual(out.sources[1].majors, [20, 22]);
    assert.ok(codes(out).includes("MAJOR_MISMATCH"));
  });

  it("collects a YAML block list under node-version", () => {
    const ci = "strategy:\n  matrix:\n    node-version:\n      - 20\n      - 22\n";
    const out = checkEngineDrift(pkg(">=20"), ci);
    assert.deepEqual(out.sources[1].declared, ["20", "22"]);
    assert.deepEqual(out.sources[1].majors, [20, 22]);
  });

  it("records a node-version-file key as declared 'file' with a note and no major", () => {
    const out = checkEngineDrift(pkg(">=20"), "with:\n  node-version-file: '.nvmrc'\n");
    assert.deepEqual(out.sources[1].declared, ["file"]);
    assert.deepEqual(out.sources[1].majors, []);
    assert.match(out.sources[1].note ?? "", /node-version-file/);
    assert.equal(out.drift, false);
  });
});

describe("checkEngineDrift — Dockerfile extraction", () => {
  it("reads a 20-alpine tag as major 20", () => {
    const out = checkEngineDrift(pkg(">=20"), undefined, "FROM node:20-alpine AS build\n");
    assert.deepEqual(out.sources[1].declared, ["node:20-alpine"]);
    assert.deepEqual(out.sources[1].majors, [20]);
    assert.deepEqual(codes(out), []);
  });

  it("flags an lts-alpine tag as UNPINNED_IMAGE with no major", () => {
    const out = checkEngineDrift(pkg(">=20"), undefined, "FROM node:lts-alpine\n");
    assert.deepEqual(out.sources[1].majors, []);
    assert.deepEqual(codes(out), ["UNPINNED_IMAGE"]);
    assert.equal(out.drift, false);
  });

  it("flags a FROM node with no tag, and latest, as unpinned", () => {
    const out = checkEngineDrift(pkg(">=20"), undefined, "FROM node\nFROM node:latest\n");
    assert.equal(codes(out).filter((c) => c === "UNPINNED_IMAGE").length, 2);
  });

  it("scans multiple FROM stages and ignores non-node images", () => {
    const dockerfile = [
      "FROM node:20-alpine AS build",
      "RUN npm run build",
      "FROM node:20-alpine",
      "COPY --from=build /app/dist ./dist",
      "FROM alpine:3.20 AS tools",
      "",
    ].join("\n");
    const out = checkEngineDrift(pkg(">=20"), undefined, dockerfile);
    assert.deepEqual(out.sources[1].declared, ["node:20-alpine", "node:20-alpine"]);
    assert.deepEqual(out.sources[1].majors, [20]);
    assert.equal(out.drift, false);
  });
});

describe("checkEngineDrift — drift rules", () => {
  it("reports MAJOR_MISMATCH when sources declare different majors", () => {
    const out = checkEngineDrift(pkg(">=20"), "node-version: 22\n", "FROM node:20-alpine\n");
    assert.equal(out.drift, true);
    assert.equal(codes(out)[0], "MAJOR_MISMATCH");
  });

  it("reports BELOW_MINIMUM when a source is entirely below the package minimum", () => {
    const out = checkEngineDrift(pkg(">=20"), "node-version: 18\n");
    assert.equal(out.drift, true);
    assert.ok(codes(out).includes("MAJOR_MISMATCH"));
    assert.ok(codes(out).includes("BELOW_MINIMUM"));
    const below = out.issues.find((i) => i.code === "BELOW_MINIMUM");
    assert.match(below?.message ?? "", /below the package\.json minimum major 20/);
    const dockerOnly = checkEngineDrift(pkg(">=20"), undefined, "FROM node:18-alpine\n");
    assert.ok(codes(dockerOnly).includes("BELOW_MINIMUM"));
  });

  it("reports no drift when every source agrees", () => {
    const out = checkEngineDrift(
      pkg(">=20"),
      "node-version: 20\n",
      "FROM node:20-alpine AS build\nFROM node:20.11\n",
    );
    assert.equal(out.drift, false);
    assert.deepEqual(out.issues, []);
    assert.equal(out.sources.length, 3);
  });

  it("treats empty ci_yaml and dockerfile strings as absent sources", () => {
    const out = checkEngineDrift(pkg(">=20"), "", "   ");
    assert.equal(out.sources.length, 1);
    assert.deepEqual(out.issues, []);
    assert.equal(out.drift, false);
  });

  it("orders issues MAJOR_MISMATCH, BELOW_MINIMUM, UNPINNED_IMAGE, NO_ENGINES", () => {
    const out = checkEngineDrift(pkg(), "node-version: 18\n", "FROM node:lts-alpine\nFROM node:20\n");
    assert.deepEqual(codes(out), ["MAJOR_MISMATCH", "UNPINNED_IMAGE", "NO_ENGINES"]);
    const drifted = checkEngineDrift(pkg(">=22"), "node-version: 20\n", "FROM node:lts-alpine\n");
    assert.deepEqual(codes(drifted), ["MAJOR_MISMATCH", "BELOW_MINIMUM", "UNPINNED_IMAGE"]);
  });
});
