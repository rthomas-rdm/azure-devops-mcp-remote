// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";
//import { AccountInfo, AuthenticationResult, PublicClientApplication } from "@azure/msal-node";
//import open from "open";
import { logger } from "./logger.js";
import type { AuthHeaderProvider } from "./tools/auth-provider-interfaces.js";

const ADO_AUDIENCE = "499b84ac-1321-427f-aa17-267ca6975798";
//const scopes = [`${ADO_AUDIENCE}/.default`];

// class OAuthAuthenticator {
//   static clientId = "0d50963b-7bb9-4fe7-94c7-a99af00b5136";
//   static defaultAuthority = "https://login.microsoftonline.com/common";
//   static zeroTenantId = "00000000-0000-0000-0000-000000000000";

//   private accountId: AccountInfo | null;
//   private publicClientApp: PublicClientApplication;

//   constructor(tenantId?: string) {
//     this.accountId = null;

//     let authority = OAuthAuthenticator.defaultAuthority;
//     if (tenantId && tenantId !== OAuthAuthenticator.zeroTenantId) {
//       authority = `https://login.microsoftonline.com/${tenantId}`;
//       logger.debug(`OAuthAuthenticator: Using tenant-specific authority for tenantId='${tenantId}'`);
//     } else {
//       logger.debug(`OAuthAuthenticator: Using default common authority`);
//     }

//     this.publicClientApp = new PublicClientApplication({
//       auth: {
//         clientId: OAuthAuthenticator.clientId,
//         authority,
//       },
//     });
//     logger.debug(`OAuthAuthenticator: Initialized with clientId='${OAuthAuthenticator.clientId}'`);
//   }

//   public async getAuthenticationResult(): Promise<AuthenticationResult> {
//     let authResult: AuthenticationResult | null = null;
//     if (this.accountId) {
//       logger.debug(`OAuthAuthenticator: Attempting silent token acquisition for cached account`);
//       try {
//         authResult = await this.publicClientApp.acquireTokenSilent({
//           scopes,
//           account: this.accountId,
//         });
//         logger.debug(`OAuthAuthenticator: Successfully acquired token silently`);
//       } catch (error) {
//         logger.debug(`OAuthAuthenticator: Silent token acquisition failed: ${error instanceof Error ? error.message : String(error)}`);
//         authResult = null;
//       }
//     } else {
//       logger.debug(`OAuthAuthenticator: No cached account available, interactive auth required`);
//     }
//     if (!authResult) {
//       logger.debug(`OAuthAuthenticator: Starting interactive token acquisition`);
//       authResult = await this.publicClientApp.acquireTokenInteractive({
//         scopes,
//         openBrowser: async (url) => {
//           logger.debug(`OAuthAuthenticator: Opening browser for authentication`);
//           open(url);
//         },
//       });
//       this.accountId = authResult.account;
//       logger.debug(`OAuthAuthenticator: Successfully acquired token interactively, account cached`);
//     }

//     if (!authResult.accessToken) {
//       logger.error(`OAuthAuthenticator: Authentication result contains no access token`);
//       throw new Error("Failed to obtain Azure DevOps OAuth token.");
//     }
//     logger.debug(`OAuthAuthenticator: Auth result obtained successfully`);
//     return authResult;
//   }

//   public async getToken(): Promise<string> {
//     const authResult = await this.getAuthenticationResult();
//     logger.debug(`OAuthAuthenticator: Token obtained successfully`);
//     return authResult.accessToken;
//   }
// }

// function createAuthenticator(type: string, tenantId?: string): AuthHeaderProvider {
//   logger.debug(`Creating authenticator of type '${type}' with tenantId='${tenantId ?? "undefined"}'`);
//   switch (type) {
//     case "envvar":
//       logger.debug(`Authenticator: Using environment variable authentication (ADO_MCP_AUTH_TOKEN)`);
//       // Read token from fixed environment variable
//       return async () => {
//         logger.debug(`${type}: Reading token from ADO_MCP_AUTH_TOKEN environment variable`);
//         const token = process.env["ADO_MCP_AUTH_TOKEN"];
//         if (!token) {
//           logger.error(`${type}: ADO_MCP_AUTH_TOKEN environment variable is not set or empty`);
//           throw new Error("Environment variable 'ADO_MCP_AUTH_TOKEN' is not set or empty. Please set it with a valid Azure DevOps Personal Access Token.");
//         }
//         logger.debug(`${type}: Successfully retrieved token from environment variable`);
//         return token;
//       };

//     case "azcli":
//     case "env":
//       if (type !== "env") {
//         logger.debug(`${type}: Setting AZURE_TOKEN_CREDENTIALS to 'dev' for development credential chain`);
//         process.env.AZURE_TOKEN_CREDENTIALS = "dev";
//       }
//       let credential: TokenCredential = new DefaultAzureCredential(); // CodeQL [SM05138] resolved by explicitly setting AZURE_TOKEN_CREDENTIALS
//       if (tenantId) {
//         // Use Azure CLI credential if tenantId is provided for multi-tenant scenarios
//         const azureCliCredential = new AzureCliCredential({ tenantId });
//         credential = new ChainedTokenCredential(azureCliCredential, credential);
//       }
//       return async () => {
//         const result = await credential.getToken(scopes);
//         if (!result) {
//           logger.error(`${type}: Failed to obtain token - credential.getToken returned null/undefined`);
//           throw new Error("Failed to obtain Azure DevOps token. Ensure you have Azure CLI logged or use interactive type of authentication.");
//         }
//         logger.debug(`${type}: Successfully obtained Azure DevOps token`);
//         return result.token;
//       };

//     default:
//       logger.debug(`Authenticator: Using OAuth interactive authentication (default)`);
//       const authenticator = new OAuthAuthenticator(tenantId);
//       return () => {
//         return authenticator.getToken();
//       };
//   }
// }

function createAuthHeaderProvider(): AuthHeaderProvider {
  logger.debug(
    `Creating default authenticator function that will re-use the incoming mcp server request authorization header if it's audience is valid for Azure Devops OR fallback on a PAT token from environment variable if configured`
  );
  return async (toolExtraContext) => {
    if (toolExtraContext.authInfo) {
      logger.debug(`Incoming tool extra context auth info: ${JSON.stringify(toolExtraContext.authInfo)}`);
      const canPassThroughIncomingAuthHeader = toolExtraContext.authInfo.scopes?.some((scope) => scope.startsWith(ADO_AUDIENCE));
      if (canPassThroughIncomingAuthHeader === true && toolExtraContext.authInfo.token) {
        logger.debug(`Re-using incoming mcp server request authorization header for Azure DevOps access`);
        return `Bearer ${toolExtraContext.authInfo.token}`;
      }
    }

    const patToken = process.env.AZURE_DEVOPS_PAT_TOKEN;
    if (patToken) {
      return `Basic ${Buffer.from(`PAT:${patToken}`).toString("base64")}`;
    }

    throw new Error(
      "No valid authentication method available for Azure DevOps access. Either the mcp server request authorization header must be valid to pass through to the Azure DevOps REST api (i.e. the ADO audience value is being used for JWT validation) OR the fallback AZURE_DEVOPS_PAT_TOKEN environment variable must be configured."
    );
  };
}

export { createAuthHeaderProvider };
