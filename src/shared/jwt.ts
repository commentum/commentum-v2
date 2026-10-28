// JWT Signer & Verifier for Commentum v2
// Pure standard Web Crypto API (HMAC-SHA256) - zero external dependencies

export interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

export interface JwtPayload {
  sub: string;             // Unified ID, e.g. "anilist:12345"
  uid: string;             // Raw provider user id, e.g. "12345"
  provider: string;        // "anilist" | "mal" | "simkl" | "other"
  username: string;
  role: string;            // "owner" | "app_owner" | "super_admin" | "admin" | "moderator" | "user"
  avatar?: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

function base64UrlEncode(data: Uint8Array | string): string {
  let uint8: Uint8Array;
  if (typeof data === "string") {
    uint8 = new TextEncoder().encode(data);
  } else {
    uint8 = data;
  }

  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

let cachedCryptoKey: CryptoKey | null = null;
let cachedSecretString: string | null = null;

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  if (cachedCryptoKey && cachedSecretString === secret) {
    return cachedCryptoKey;
  }
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  cachedCryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedSecretString = secret;
  return cachedCryptoKey;
}

export type JwtVerifyResult<T> = {
  valid: boolean;
  payload?: T;
  error?: string;
};

/**
 * Sign a JWT with payload using standard HMAC-SHA256
 */
export async function signJwt(
  payload: JwtPayload,
  secret: string,
  expiresInSeconds = 7 * 24 * 60 * 60
): Promise<{ token: string; expires_at: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expiresInSeconds;

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: expiresAt,
  };

  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getCryptoKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  const signature = base64UrlEncode(new Uint8Array(signatureBuffer));
  return {
    token: `${signingInput}.${signature}`,
    expires_at: expiresAt,
  };
}

/**
 * Verify a JWT string against secret
 */
export async function verifyJwt<T = JwtPayload>(
  token: string,
  secret: string
): Promise<JwtVerifyResult<T>> {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format (expected 3 parts)" };
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await getCryptoKey(secret);
    const signatureBytes = base64UrlDecode(signature);

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!isValid) {
      return { valid: false, error: "Invalid token signature" };
    }

    const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson) as T & { exp?: number };

    if (payload.exp && typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        return { valid: false, error: "Token has expired", payload };
      }
    }

    return { valid: true, payload };
  } catch (error: any) {
    return { valid: false, error: error?.message || "Token verification failed" };
  }
}
