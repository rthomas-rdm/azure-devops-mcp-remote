import express, { type Express, type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Based on mcp typescript sdk example: https://github.com/modelcontextprotocol/typescript-sdk#without-session-management-recommended
export class StreamableHttpWebServerWithoutSessions {
  private app: Express;
  private mcpServer: McpServer;

  constructor(mcpServer: McpServer) {
    this.mcpServer = mcpServer;

    this.app = express();
    this.app.use(express.json());

    // Handle POST requests for client-to-server communication
    this.app.post("/mcp", this.handlePost);
  }

  private handlePost = async (request: ExpressRequest, response: ExpressResponse) => {
    // In stateless mode, create a new transport for each request to prevent
    // request ID collisions. Different clients may use the same JSON-RPC request IDs,
    // which would cause responses to be routed to the wrong HTTP connections if
    // the transport state is shared.

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      request.on("close", () => {
        transport.close();
      });

      await this.mcpServer.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
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
