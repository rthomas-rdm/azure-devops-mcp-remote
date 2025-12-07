import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { WebApi } from "azure-devops-node-api";

export type ToolExtraContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type AuthHeaderProvider = (toolExtraContext: ToolExtraContext) => Promise<string>;
export type AdoConnectionProvider = (toolExtraContext: ToolExtraContext) => Promise<WebApi>;
