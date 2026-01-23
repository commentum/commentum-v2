// Client API integration utilities for fetching user and media information

export async function fetchUserInfo(clientType: string, userId: string) {
  try {
    switch (clientType) {
      case 'anilist':
        return await fetchAniListUser(userId)
      case 'myanimelist':
        return await fetchMyAnimeListUser(userId)
      case 'simkl':
        return await fetchSIMKLUser(userId)
      default:
        return {
          username: `User-${userId}`,
          avatar: null
        }
    }
  } catch (error) {
    console.error(`Fetch user info from ${clientType} error:`, error)
    return null
  }
}

export async function fetchMediaInfo(clientType: string, mediaId: string) {
  try {
    switch (clientType) {
      case 'anilist':
        return await fetchAniListMedia(mediaId)
      case 'myanimelist':
        return await fetchMyAnimeListMedia(mediaId)
      case 'simkl':
        return await fetchSIMKLMedia(mediaId)
      default:
        return {
          type: 'other',
          title: `Media-${mediaId}`,
          year: null,
          poster: null
        }
    }
  } catch (error) {
    console.error(`Fetch media info from ${clientType} error:`, error)
    return null
  }
}

// AniList API functions
async function fetchAniListUser(userId: string) {
  const query = `
    query ($id: Int) {
      User(id: $id) {
        id
        name
        avatar {
          large
          medium
        }
      }
    }
  `

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { id: parseInt(userId) }
    })
  })

  if (!response.ok) return null

  const data = await response.json()
  if (data.errors) return null

  const user = data.data.User
  return {
    username: user.name,
    avatar: user.avatar?.large || user.avatar?.medium
  }
}

async function fetchAniListMedia(mediaId: string) {
  const query = `
    query ($id: Int) {
      Media(id: $id) {
        id
        title {
          romaji
          english
          native
        }
        type
        seasonYear
        coverImage {
          large
          medium
        }
      }
    }
  `

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { id: parseInt(mediaId) }
    })
  })

  if (!response.ok) return null

  const data = await response.json()
  if (data.errors) return null

  const media = data.data.Media
  return {
    type: media.type.toLowerCase(),
    title: media.title.romaji || media.title.english || media.title.native,
    year: media.seasonYear,
    poster: media.coverImage?.large || media.coverImage?.medium
  }
}

// MyAnimeList API functions
async function fetchMyAnimeListUser(userId: string) {
  const clientId = Deno.env.get('MYANIMELIST_CLIENT_ID')
  if (!clientId) {
    console.warn('MYANIMELIST_CLIENT_ID not configured')
    return null
  }

  const response = await fetch(`https://api.myanimelist.net/v2/users/${userId}`, {
    headers: {
      'X-MAL-CLIENT-ID': clientId
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  return {
    username: data.name,
    avatar: data.picture?.large || data.picture?.medium
  }
}

async function fetchMyAnimeListMedia(mediaId: string) {
  const clientId = Deno.env.get('MYANIMELIST_CLIENT_ID')
  if (!clientId) {
    console.warn('MYANIMELIST_CLIENT_ID not configured')
    return null
  }

  const response = await fetch(`https://api.myanimelist.net/v2/anime/${mediaId}?fields=title,start_season,main_picture`, {
    headers: {
      'X-MAL-CLIENT-ID': clientId
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  return {
    type: 'anime',
    title: data.title,
    year: data.start_season?.year,
    poster: data.main_picture?.large
  }
}

// SIMKL API functions
async function fetchSIMKLUser(userId: string) {
  const clientId = Deno.env.get('SIMKL_CLIENT_ID')
  if (!clientId) {
    console.warn('SIMKL_CLIENT_ID not configured')
    return null
  }

  const response = await fetch(`https://api.simkl.com/users/${userId}`, {
    headers: {
      'simkl-api-key': clientId
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  return {
    username: data.name,
    avatar: data.avatar
  }
}

async function fetchSIMKLMedia(mediaId: string) {
  const clientId = Deno.env.get('SIMKL_CLIENT_ID')
  if (!clientId) {
    console.warn('SIMKL_CLIENT_ID not configured')
    return null
  }

  const response = await fetch(`https://api.simkl.com/anime/${mediaId}`, {
    headers: {
      'simkl-api-key': clientId
    }
  })

  if (!response.ok) return null

  const data = await response.json()
  return {
    type: 'anime',
    title: data.title,
    year: data.year,
    poster: data.poster
  }
}