// Client OAuth token verification for AniList, MyAnimeList, and Simkl

export interface VerifiedUser {
  provider_user_id: string;
  username: string;
  avatar_url?: string;
  provider: "anilist" | "mal" | "simkl" | "other";
}

/**
 * Verify MyAnimeList access token
 */
export async function verifyMalToken(accessToken: string): Promise<VerifiedUser | null> {
  try {
    const res = await fetch("https://api.myanimelist.net/v2/users/@me?fields=picture", {
      headers: { 
        Authorization: `Bearer ${accessToken}`,
      },
    });
    
    if (!res.ok) {
      console.error("MAL token verification failed:", res.status);
      return null;
    }
    
    const data = await res.json() as any;
    return { 
      provider_user_id: String(data.id), 
      username: data.name, 
      avatar_url: data.picture || undefined,
      provider: "mal"
    };
  } catch (error) {
    console.error("MAL verification error:", error);
    return null;
  }
}

/**
 * Verify AniList access token
 */
export async function verifyAnilistToken(accessToken: string): Promise<VerifiedUser | null> {
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
      console.error("AniList token verification failed:", res.status);
      return null;
    }
    
    const data = await res.json() as any;
    const viewer = data?.data?.Viewer;
    
    if (!viewer) {
      console.error("AniList: No viewer data in response");
      return null;
    }
    
    return { 
      provider_user_id: String(viewer.id), 
      username: viewer.name, 
      avatar_url: viewer.avatar?.large || undefined,
      provider: "anilist"
    };
  } catch (error) {
    console.error("AniList verification error:", error);
    return null;
  }
}

/**
 * Verify Simkl access token
 */
export async function verifySimklToken(accessToken: string, simklClientId?: string): Promise<VerifiedUser | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (simklClientId) {
      headers["simkl-api-key"] = simklClientId;
    }

    const res = await fetch("https://api.simkl.com/users/settings", {
      headers,
    });
    
    if (!res.ok) {
      console.error("Simkl token verification failed:", res.status);
      return null;
    }
    
    const data = await res.json() as any;
    const user = data?.user;
    if (!user) {
      return null;
    }
    
    return { 
      provider_user_id: String(user.id || user.account), 
      username: user.name, 
      avatar_url: user.avatar || undefined,
      provider: "simkl"
    };
  } catch (error) {
    console.error("Simkl verification error:", error);
    return null;
  }
}

/**
 * Unified token verification across all providers
 */
export async function verifyClientToken(
  clientType: string,
  accessToken: string,
  simklClientId?: string
): Promise<VerifiedUser | null> {
  const normType = clientType.toLowerCase().trim();
  
  if (normType === "anilist") {
    return verifyAnilistToken(accessToken);
  } else if (normType === "mal" || normType === "myanimelist") {
    return verifyMalToken(accessToken);
  } else if (normType === "simkl") {
    return verifySimklToken(accessToken, simklClientId);
  }
  
  return null;
}
