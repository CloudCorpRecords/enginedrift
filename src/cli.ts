#!/usr/bin/env node
/**
 * enginedrift CLI.
 *
 *   enginedrift check --package-json <path> [--ci <path>] [--dockerfile <path>]
 *   enginedrift mcp
 *
 * The named files are read as text and handed to the drift
 * check. Pure local computation: no network, no configuration.
 * Exit codes: 0 when the check ran (drift is data), 1 on a
 * runtime error (including an unreadable file or an invalid
 * package.json), 2 on a usage error.
 */
import { readFileSync } from "node:fs";
import { checkEngineDrift, formatPayload, VERSION } from "./enginedrift.js";

function usage(): never {
  console.error(`Usage:
  enginedrift check --package-json <path> [--ci <path>] [--dockerfile <path>]
  enginedrift mcp
  enginedrift --version`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function read(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(
      `error: cannot read ${label} file '${path}': ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd !== "check") usage();

  const flags = ["--package-json", "--ci", "--dockerfile"];
  if (rest.some((a) => a.startsWith("--") && !flags.includes(a))) usage();
  const packagePath = flag(rest, "--package-json");
  if (packagePath === undefined) usage();
  const ciPath = flag(rest, "--ci");
  if (rest.includes("--ci") && ciPath === undefined) usage();
  const dockerPath = flag(rest, "--dockerfile");
  if (rest.includes("--dockerfile") && dockerPath === undefined) usage();

  const packageJson = read(packagePath, "package-json");
  const ciYaml = ciPath === undefined ? undefined : read(ciPath, "ci");
  const dockerfile = dockerPath === undefined ? undefined : read(dockerPath, "dockerfile");

  try {
    const out = checkEngineDrift(packageJson, ciYaml, dockerfile);
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
