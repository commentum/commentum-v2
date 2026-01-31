// Media mapping utilities for cross-platform comment aggregation
// Handles mapping between AniList, MyAnimeList, and SIMKL IDs

interface MediaMapping {
  anilist?: {
    id: number;
    type: "anime" | "manga";
  };
  myanimelist?: {
    id: number;
    type: "anime" | "manga";
  };
  simkl?: {
    id: string;
    type: "anime" | "manga";
  };
}

interface CachedMappingData {
  anime: { [anilistId: string]: MediaMapping };
  manga: { [anilistId: string]: MediaMapping };
  lastUpdated: number;
}

// Cache variables
let mappingCache: CachedMappingData | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
const MAPPING_DATA_URLS = {
  anime: "https://raw.githubusercontent.com/itsmechinmoy/animanga-mapped/refs/heads/main/mapped-data/anime-list-full-mapped.json",
  manga: "https://raw.githubusercontent.com/itsmechinmoy/animanga-mapped/refs/heads/main/mapped-data/manga-list-full-mapped.json"
};

/**
 * Fetch and cache mapping data from GitHub
 */
async function fetchMappingData(type: 'anime' | 'manga'): Promise<{ [anilistId: string]: MediaMapping }> {
  try {
    const response = await fetch(MAPPING_DATA_URLS[type]);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${type} mapping data: ${response.status}`);
    }
    
    const data = await response.json();
    const mapping: { [anilistId: string]: MediaMapping } = {};
    
    // Process the mapping data
    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item.anilist?.id) {
          const anilistId = item.anilist.id.toString();
          mapping[anilistId] = {
            anilist: item.anilist,
            myanimelist: item.myanimelist,
            simkl: item.simkl
          };
        }
      });
    }
    
    return mapping;
  } catch (error) {
    console.error(`Error fetching ${type} mapping data:`, error);
    return {};
  }
}

/**
 * Get cached mapping data or fetch if expired
 */
async function getMappingData(): Promise<CachedMappingData> {
  const now = Date.now();
  
  // Return cached data if still valid
  if (mappingCache && (now - mappingCache.lastUpdated) < CACHE_DURATION) {
    return mappingCache;
  }
  
  // Fetch fresh data
  console.log('Fetching fresh mapping data...');
  const [animeMapping, mangaMapping] = await Promise.all([
    fetchMappingData('anime'),
    fetchMappingData('manga')
  ]);
  
  mappingCache = {
    anime: animeMapping,
    manga: mangaMapping,
    lastUpdated: now
  };
  
  console.log(`Cached mapping data: ${Object.keys(animeMapping).length} anime, ${Object.keys(mangaMapping).length} manga entries`);
  return mappingCache;
}

/**
 * Get platform mappings for ANY platform ID and type
 * Now supports reverse mapping from any platform to all others
 */
export async function getPlatformMappings(
  mediaId: string, 
  mediaType: 'anime' | 'manga',
  sourcePlatform: 'anilist' | 'myanimelist' | 'mal' | 'simkl' = 'anilist'
): Promise<MediaMapping | null> {
  try {
    const mappingData = await getMappingData();
    
    // Normalize MAL client_type to myanimelist for internal consistency
    const normalizedPlatform = sourcePlatform === 'mal' ? 'myanimelist' : sourcePlatform;
    
    // If source is AniList, direct lookup
    if (normalizedPlatform === 'anilist') {
      return mappingData[mediaType][mediaId] || null;
    }
    
    // For other platforms, we need to search through the mapping data
    for (const [anilistId, mapping] of Object.entries(mappingData[mediaType])) {
      if (normalizedPlatform === 'myanimelist' && mapping.myanimelist?.id.toString() === mediaId) {
        return mapping;
      }
      if (normalizedPlatform === 'simkl' && mapping.simkl?.id === mediaId) {
        return mapping;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting platform mappings:', error);
    return null;
  }
}

/**
 * Get all platform media IDs for cross-platform fetching from ANY source platform
 */
export async function getCrossPlatformIds(
  mediaId: string, 
  mediaType: 'anime' | 'manga',
  sourcePlatform: 'anilist' | 'myanimelist' | 'mal' | 'simkl' = 'anilist'
): Promise<{
  anilist?: string;
  myanimelist?: string;
  simkl?: string;
}> {
  const mapping = await getPlatformMappings(mediaId, mediaType, sourcePlatform);
  
  if (!mapping) {
    // Return only the source platform if no mapping found
    const normalizedPlatform = sourcePlatform === 'mal' ? 'myanimelist' : sourcePlatform;
    return { [normalizedPlatform]: mediaId };
  }
  
  const result: { anilist?: string; myanimelist?: string; simkl?: string } = {};
  
  if (mapping.anilist?.id) {
    result.anilist = mapping.anilist.id.toString();
  }
  
  if (mapping.myanimelist?.id) {
    result.myanimelist = mapping.myanimelist.id.toString();
  }
  
  if (mapping.simkl?.id) {
    result.simkl = mapping.simkl.id;
  }
  
  return result;
}

/**
 * Fetch comments from multiple platforms in parallel
 * Now supports cross-platform fetching from ANY source platform
 */
export async function fetchCrossPlatformComments(
  supabase: any,
  mediaId: string,
  mediaType: 'anime' | 'manga',
  sourcePlatform: 'anilist' | 'myanimelist' | 'mal' | 'simkl',
  page: number = 1,
  limit: number = 50,
  sort: string = 'newest'
): Promise<{
  comments: any[];
  totalCount: number;
  platforms: string[];
}> {
  // Normalize MAL to myanimelist for internal consistency
  const normalizedSourcePlatform = sourcePlatform === 'mal' ? 'myanimelist' : sourcePlatform;
  
  // Get platform mappings from the source platform
  const platformIds = await getCrossPlatformIds(mediaId, mediaType, sourcePlatform);
  const platforms = Object.keys(platformIds);
  
  // Build queries for each available platform
  const offset = (page - 1) * limit;
  const queries = [];
  
  for (const platform of platforms) {
    const platformMediaId = platformIds[platform as keyof typeof platformIds];
    
    if (!platformMediaId) continue;
    
    const query = supabase
      .from('comments')
      .select('*')
      .eq('media_id', platformMediaId)
      .eq('client_type', platform)
      .eq('deleted', false)
      .eq('user_banned', false)
      .eq('user_shadow_banned', false);
    
    queries.push(query);
  }
  
  try {
    // Execute all queries in parallel
    const results = await Promise.all(queries);
    
    // Combine all comments
    let allComments: any[] = [];
    let totalCount = 0;
    
    results.forEach((result, index) => {
      if (result.data) {
        // Add platform info to each comment for debugging/display purposes
        const platformComments = result.data.map(comment => ({
          ...comment,
          _platform: platforms[index] // Add platform info
        }));
        allComments = allComments.concat(platformComments);
      }
      totalCount += result.data?.length || 0;
    });
    
    // Sort combined comments
    let sortedComments = allComments;
    switch (sort) {
      case 'oldest':
        sortedComments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'top':
        sortedComments.sort((a, b) => b.vote_score - a.vote_score);
        break;
      case 'controversial':
        sortedComments.sort((a, b) => b.upvotes - a.upvotes);
        break;
      default: // newest
        sortedComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    
    // Apply pagination to combined results
    const paginatedComments = sortedComments.slice(offset, offset + limit);
    
    console.log(`Cross-platform fetch completed: ${paginatedComments.length} comments from ${platforms.length} platforms (${platforms.join(', ')})`);
    
    return {
      comments: paginatedComments,
      totalCount: totalCount,
      platforms: platforms
    };
  } catch (error) {
    console.error('Error fetching cross-platform comments:', error);
    // Fallback to source platform only
    return fetchSinglePlatformComments(supabase, mediaId, normalizedSourcePlatform, page, limit, sort);
  }
}

/**
 * Fallback function for single platform fetching
 */
export async function fetchSinglePlatformComments(
  supabase: any,
  mediaId: string,
  clientType: string,
  page: number,
  limit: number,
  sort: string
): Promise<{
  comments: any[];
  totalCount: number;
  platforms: string[];
}> {
  const offset = (page - 1) * limit;
  
  const { data: comments, error } = await supabase
    .from('comments')
    .select('*')
    .eq('media_id', mediaId)
    .eq('client_type', clientType)
    .eq('deleted', false)
    .eq('user_banned', false)
    .eq('user_shadow_banned', false)
    .order('created_at', { ascending: sort === 'oldest' })
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  
  const { count } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('media_id', mediaId)
    .eq('client_type', clientType)
    .eq('deleted', false)
    .eq('user_banned', false)
    .eq('user_shadow_banned', false);
  
  return {
    comments: comments || [],
    totalCount: count || 0,
    platforms: [clientType]
  };
}

/**
 * Clear mapping cache (for testing or manual refresh)
 */
export function clearMappingCache(): void {
  mappingCache = null;
  console.log('Mapping cache cleared');
}
