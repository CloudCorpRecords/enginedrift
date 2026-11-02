/**
 * enginedrift MCP server. Tools: check_engine_drift.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod
 * still validates every tools/call argument set.
 *
 * The comparison is pure local computation: no upstream API,
 * no authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { checkEngineDrift, formatPayload, VERSION } from "./enginedrift.js";

const CheckArgs = z.object({
  package_json: z.string().min(1),
  ci_yaml: z.string().optional(),
  dockerfile: z.string().optional(),
});

const TOOLS = [
  {
    name: "check_engine_drift",
    description:
      "Detect Node engine drift across package.json, CI config, and Dockerfile: compare the Node majors declared in engines.node, CI node-version values, and Dockerfile FROM node tags, and report drift, sources, and issues.",
    inputSchema: {
      type: "object" as const,
      properties: {
        package_json: {
          type: "string",
          description: "package.json text; its engines.node range is the anchor source",
        },
        ci_yaml: {
          type: "string",
          description: "CI workflow YAML text (optional); node-version values are extracted",
        },
        dockerfile: {
          type: "string",
          description: "Dockerfile text (optional); FROM node image tags are extracted",
        },
      },
      required: ["package_json"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "enginedrift", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "check_engine_drift") {
      const parsed = CheckArgs.parse(args ?? {});
      out = checkEngineDrift(parsed.package_json, parsed.ci_yaml, parsed.dockerfile);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
