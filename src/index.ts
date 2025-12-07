#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getBearerHandler, getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { createAuthHeaderProvider } from "./auth.js";
import { logger } from "./logger.js";
import { getOrgTenant } from "./org-tenants.js";
//import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";
import { StreamableHttpWebServerWithSessions } from "./transport/http-web-server-with-sessions.js";
import type { AdoConnectionProvider, AuthHeaderProvider, ToolExtraContext } from "./tools/auth-provider-interfaces.js";
import type { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces.js";

function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 [options]", "Azure DevOps MCP Server")
  .option("domains", {
    alias: "d",
    describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("authentication", {
    alias: "a",
    describe: "Type of authentication to use",
    type: "string",
    choices: ["interactive", "azcli", "env", "envvar"],
    default: defaultAuthenticationType,
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, applied when using 'interactive' and 'azcli' type of authentication)",
    type: "string",
  })
  .option("organization", {
    describe: "Azure DevOps organization name",
    type: "string",
    alias: "o",
  })
  .help()
  .parseSync();

let orgNameLocal = argv.organization as string;
if (!orgNameLocal) {
  orgNameLocal = process.env.AZURE_DEVOPS_ORG_NAME || "";
  if (!orgNameLocal) {
    logger.error("Azure DevOps organization name not provided. Set the AZURE_DEVOPS_ORG_NAME environment variable or use the --organization cli argument.");
    process.exit(1);
  }
}

export const orgName = orgNameLocal;

const orgUrl = "https://dev.azure.com/" + orgName;

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();

function getAzureDevOpsClient(getAzureDevAuthHeader: AuthHeaderProvider, userAgentComposer: UserAgentComposer): AdoConnectionProvider {
  return async (toolExtraContext: ToolExtraContext) => {
    const authHeader = await getAzureDevAuthHeader(toolExtraContext);

    let authHandler: IRequestHandler;
    if (authHeader.startsWith("Bearer ")) {
      authHandler = getBearerHandler(authHeader.substring("Bearer ".length));
    } else {
      // If the auth header is not a Bearer token, assume it's a PAT token starting with BASIC.
      // Because the auth header value after BASIC will already be base64 encoded, we don't want to pass it through to the PAT handler which will try to encode it again.
      // Instead we'll just get the token directly from the environment variable in here to pass through:
      const patToken = process.env.AZURE_DEVOPS_PAT_TOKEN;
      if (!patToken) {
        throw new Error("No Personal Access Token (PAT) available in environment variable AZURE_DEVOPS_PAT_TOKEN for connection authentication.");
      }

      authHandler = getPersonalAccessTokenHandler(patToken);
    }

    const connection = new WebApi(orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

async function main() {
  logger.info("Starting Azure DevOps MCP Server", {
    organization: orgName,
    organizationUrl: orgUrl,
    authentication: argv.authentication,
    tenant: argv.tenant,
    domains: argv.domains,
    enabledDomains: Array.from(enabledDomains),
    version: packageVersion,
    isCodespace: isGitHubCodespaceEnv(),
  });

  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  const tenantId = (await getOrgTenant(orgName)) ?? argv.tenant;
  logger.debug(`Using tenant ID: ${tenantId ?? "not specified"}`);

  const authHeaderProvider = createAuthHeaderProvider();

  // removing prompts untill further notice
  // configurePrompts(server);

  configureAllTools(server, authHeaderProvider, getAzureDevOpsClient(authHeaderProvider, userAgentComposer), () => userAgentComposer.userAgent, enabledDomains);

  //const transport = new StdioServerTransport();
  //await server.connect(transport);

  const webServer = new StreamableHttpWebServerWithSessions(server);
  await webServer.start();
}

main().catch((error) => {
  logger.error("Fatal error in main():", error);
  process.exit(1);
});
