import express, { type Express, type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auth as jwtBearerOAuthMiddleware } from "express-oauth2-jwt-bearer";
import { logger } from "../logger.js";
import cors from "cors";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export type VerifyJwtResult = ExpressRequest["auth"];

// Based on mcp typescript sdk example: https://github.com/modelcontextprotocol/typescript-sdk#with-session-management
export class StreamableHttpWebServerWithSessions {
  private app: Express;
  private mcpServer: McpServer;
  private transportsBySessionId: Map<string, StreamableHTTPServerTransport> = new Map<string, StreamableHTTPServerTransport>();

  constructor(mcpServer: McpServer) {
    this.mcpServer = mcpServer;

    const issuerBaseUrl = process.env.OAUTH_ISSUER_BASE_URL;
    if (!issuerBaseUrl) {
      throw new Error("OAUTH_ISSUER_BASE_URL environment variable is not set");
    }

    const audience = process.env.OAUTH_AUDIENCE;
    if (!audience) {
      throw new Error("OAUTH_AUDIENCE environment variable is not set");
    }

    this.app = express();

    this.app.use(
      cors({
        origin: "*", // Configure appropriately for production, for example:
        // origin: ['https://your-remote-domain.com', 'https://your-other-remote-domain.com'],
        exposedHeaders: ["Mcp-Session-Id"],
        allowedHeaders: ["Content-Type", "mcp-session-id"],
      })
    );

    this.app.use(
      jwtBearerOAuthMiddleware({
        issuerBaseURL: issuerBaseUrl,
        audience,
      })
    );

    this.app.use(express.json());

    // Handle POST requests for client-to-server communication
    this.app.post("/mcp", this.handlePost);
    this.app.get("/mcp", this.handleGetOrDeleteSessionRequest);
    this.app.delete("/mcp", this.handleGetOrDeleteSessionRequest);
  }

  // Reusable handler for GET and DELETE requests
  private handleGetOrDeleteSessionRequest = async (request: any, response: ExpressResponse) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;

    const transport = sessionId ? this.transportsBySessionId.get(sessionId || "") : undefined;

    if (!sessionId || !transport) {
      response.status(400).send("Invalid or missing session ID");
      return;
    }

    await transport.handleRequest(request, response);
  };

  private handlePost = async (request: ExpressRequest, response: ExpressResponse) => {
    // Check for existing session ID
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    logger.debug(`request data object keys: ${JSON.stringify(Object.keys(request))}`);

    if (sessionId && this.transportsBySessionId.has(sessionId)) {
      // Reuse existing transport
      logger.debug(`Reusing existing transport for session ID: ${sessionId}`);
      const transportBySession = this.transportsBySessionId.get(sessionId);
      if (!transportBySession) {
        throw new Error(`transportsBySessionId has matching key but returned null/undefined value for session ID: ${sessionId}`);
      }
      transport = transportBySession;
    } else if (!sessionId && isInitializeRequest(request.body)) {
      logger.debug("Initializing new transport for new session");

      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          this.transportsBySessionId.set(sessionId, transport);
        },

        // Per the docs, DNS rebinding protection is disabled by default for backwards compatibility.
        // Will disable it if testing fails with it enabled
        enableDnsRebindingProtection: true,
        enableJsonResponse: true,
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          this.transportsBySessionId.delete(transport.sessionId);
        }
      };

      // Connect to the MCP server
      await this.mcpServer.connect(transport);
    } else {
      logger.debug("Invalid or missing session ID for POST request. Was an initialization request sent?");

      // Invalid request
      response.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    if (!request.auth) {
      throw new Error("Request is missing auth information. Ensure the jwt bearer oauth validation middleware is correctly configured.");
    }

    const jwtPayload: any = request.auth.payload;

    // Normalize the auth object that express-oauth2-jwt-bearer package adds to the request to match the MCP AuthInfo interface
    // TODO: Make the normalization configurable, for now we'll just map under the assumption the JWT will be using microsoft identity platform claims
    // See https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference
    const scopes = jwtPayload.scp.split(" ");
    // azp == client id value in microsoft identity platform v2.0 tokens, appid == client id in v1.0 tokens
    const clientId = jwtPayload.azp || jwtPayload.appid || "";
    const expiresAt = jwtPayload.exp;

    request.auth = {
      ...request.auth,
      clientId,
      expiresAt,
      scopes,
    } as AuthInfo & VerifyJwtResult;

    // Handle the request
    await transport.handleRequest(request as any, response, request.body);
  };

  public start = (): Promise<void> => {
    const port = process.env.MCP_HTTP_PORT || 8080;

    return new Promise((resolve, reject) => {
      this.app
        .listen(port, () => {
          console.log(`MCP WebServer listening on port ${port}`);
          resolve();
        })
        .on("error", (listenError) => {
          console.error("Failed to start MCP WebServer:", listenError);
          reject(listenError);
        });
    });
  };
}
