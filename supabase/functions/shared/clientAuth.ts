// Client token verification utilities for MAL, AniList, Simkl
// Verifies user access tokens with provider APIs and returns verified user info

export interface VerifiedUser {
  provider_user_id: string;
  username: string;
  avatar_url?: string;
  provider: string;
}

/**
 * Verify MyAnimeList access token
 */
async function verifyMalToken(accessToken: string): Promise<VerifiedUser | null> {
  try {
    const res = await fetch("https://api.myanimelist.net/v2/users/@me?fields=picture", {
      headers: { 
        Authorization: `Bearer ${accessToken}`,
      },
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('MAL token verification failed:', res.status, errorText);
      return null;
    }
    
    const data = await res.json();
    return { 
      provider_user_id: String(data.id), 
      username: data.name, 
      avatar_url: data.picture || undefined,
      provider: 'mal'
    };
  } catch (error) {
    console.error('MAL verification error:', error);
    return null;
  }
}

/**
 * Verify AniList access token
 */
async function verifyAnilistToken(accessToken: string): Promise<VerifiedUser | null> {
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: "query { Viewer { id name avatar { large } } }",
      }),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('AniList token verification failed:', res.status, errorText);
      return null;
    }
    
    const data = await res.json();
    const viewer = data?.data?.Viewer;
    
    if (!viewer) {
      console.error('AniList: No viewer data in response');
      return null;
    }
    
    return { 
      provider_user_id: String(viewer.id), 
      username: viewer.name, 
      avatar_url: viewer.avatar?.large || undefined,
      provider: 'anilist'
    };
  } catch (error) {
    console.error('AniList verification error:', error);
    return null;
  }
}

/**
 * Verify Simkl access token
 */
async function verifySimklToken(accessToken: string): Promise<VerifiedUser | null> {
  try {
    const res = await fetch("https://api.simkl.com/users/settings", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "simkl-api-key": Deno.env.get('SIMKL_CLIENT_ID')!,
      },
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Simkl token verification failed:', res.status, errorText);
      return null;
    }
    
    const data = await res.json();
    const account = data?.account;
    
    if (!account) {
      console.error('Simkl: No account data in response');
      return null;
    }
    
    return { 
      provider_user_id: String(account.id), 
      username: data.user?.name || `simkl_${account.id}`, 
      avatar_url: account.avatar || undefined,
      provider: 'simkl'
    };
  } catch (error) {
    console.error('Simkl verification error:', error);
    return null;
  }
}

// Provider verification functions mapping
const providerVerifiers: Record<string, (token: string) => Promise<VerifiedUser | null>> = {
  mal: verifyMalToken,
  anilist: verifyAnilistToken,
  simkl: verifySimklToken,
};

/**
 * Verify client access token with the appropriate provider
 * @param clientType - The client type: 'mal', 'anilist', or 'simkl'
 * @param accessToken - The OAuth access token from the client
 * @returns VerifiedUser object with provider_user_id, username, avatar_url, provider
 */
export async function verifyClientToken(
  clientType: string, 
  accessToken: string
): Promise<VerifiedUser | null> {
  // Normalize client type
  const normalizedType = clientType.toLowerCase();
  
  const verifier = providerVerifiers[normalizedType];
  if (!verifier) {
    console.error(`Unknown client type: ${clientType}`);
    return null;
  }
  
  return await verifier(accessToken);
}

/**
 * Get list of supported client types
 */
export function getSupportedClientTypes(): string[] {
  return Object.keys(providerVerifiers);
}

/**
 * Check if a client type is supported
 */
export function isClientTypeSupported(clientType: string): boolean {
  return clientType.toLowerCase() in providerVerifiers;
}
