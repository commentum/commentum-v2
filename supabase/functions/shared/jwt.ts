// JWT Signer & Verifier for Commentum v2
// Pure standard Web Crypto API (HMAC-SHA256) - zero external dependencies

export interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

export interface JwtPayload {
  sub: string;             // Unified ID, e.g. "anilist:12345"
  uid: string;             // Raw provider user id, e.g. "12345"
  provider: string;        // "anilist" | "mal" | "simkl"
  username: string;
  role: string;            // "owner" | "app_owner" | "super_admin" | "admin" | "moderator" | "user"
  iat?: number;
  exp?: number;
  [key: string]: any;
}

export function getJwtSecret(): string {
  const fromDeno = typeof Deno !== 'undefined'
    ? (Deno.env.get('JWT_SECRET') || Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    : null
  const fromProcess = typeof process !== 'undefined' && process.env
    ? (process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null
  const secret = fromDeno || fromProcess || 'commentum_default_secret_key_minimum_32_characters_long'
  return secret.trim()
}

// Base64URL Encoding & Decoding
function base64UrlEncode(data: Uint8Array | string): string {
  let uint8: Uint8Array
  if (typeof data === 'string') {
    uint8 = new TextEncoder().encode(data)
  } else {
    uint8 = data
  }

  let binary = ''
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i])
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// Crypto Key Cache for performance
let cachedCryptoKey: CryptoKey | null = null
let cachedSecretString: string | null = null

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  if (cachedCryptoKey && cachedSecretString === secret) {
    return cachedCryptoKey
  }
  const enc = new TextEncoder()
  const keyData = enc.encode(secret)
  cachedCryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
  cachedSecretString = secret
  return cachedCryptoKey
}

/**
 * Sign a JWT with payload
 * @param payload Object with claims (sub, uid, provider, username, role, etc.)
 * @param secret Optional HMAC secret. If not provided, reads from environment.
 * @param expiresInSeconds Lifetime in seconds (default: 7 days)
 * @returns Encrypted JWT string
 */
export async function signJwt(
  payload: JwtPayload,
  secret?: string,
  expiresInSeconds = 7 * 24 * 60 * 60
): Promise<{ token: string; expires_at: number }> {
  const sec = secret || getJwtSecret()
  const key = await getCryptoKey(sec)

  const now = Math.floor(Date.now() / 1000)
  const exp = now + expiresInSeconds

  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' }
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp,
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload))
  const dataToSign = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, dataToSign)
  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBuffer))

  return {
    token: `${encodedHeader}.${encodedPayload}.${encodedSignature}`,
    expires_at: exp,
  }
}

/**
 * Verify a JWT and extract payload
 * @param token Encrypted JWT string
 * @param secret Optional HMAC secret
 * @returns Object with valid flag, payload, or error description
 */
export async function verifyJwt<T = JwtPayload>(
  token: string,
  secret?: string
): Promise<{ valid: boolean; payload?: T; error?: string }> {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is missing or invalid' }
    }

    const parts = token.trim().split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed JWT structure' }
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const sec = secret || getJwtSecret()
    const key = await getCryptoKey(sec)

    // Verify signature
    const dataToVerify = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    const signatureBytes = base64UrlDecode(encodedSignature)

    const isValidSig = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      dataToVerify
    )

    if (!isValidSig) {
      return { valid: false, error: 'Invalid token signature' }
    }

    // Parse payload
    const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload))
    const payload = JSON.parse(payloadJson) as JwtPayload

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token has expired' }
    }

    return { valid: true, payload: payload as T }
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Token verification failed' }
  }
}
