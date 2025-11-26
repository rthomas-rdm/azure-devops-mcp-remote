import { type OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { type AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export class JwtTokenVerifier implements OAuthTokenVerifier {
  public verifyAccessToken = async (token: string) => {
    // TODO: Implement actual token verification logic here.
    // See also https://github.com/auth0/node-oauth2-jwt-bearer/tree/main/packages/express-oauth2-jwt-bearer
    const authInfo: AuthInfo = {
      token: token,
      clientId: "example-client-id",
      scopes: ["read", "write"],
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
    };

    return authInfo;
  };
}
