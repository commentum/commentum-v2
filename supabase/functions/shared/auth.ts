// Token verification utilities for admin/moderator authentication

export async function verifyToken(supabase: any, clientType: string, userId: string, token: string) {
  try {
    switch (clientType) {
      case 'anilist':
        return await verifyAniListToken(userId, token)
      case 'myanimelist':
        return await verifyMyAnimeListToken(userId, token)
      case 'simkl':
        return await verifySIMKLToken(userId, token)
      default:
        return false
    }
  } catch (error) {
    console.error(`Token verification error for ${clientType}:`, error)
    return false
  }
}

// AniList token verification
async function verifyAniListToken(userId: string, token: string) {
  try {
    const query = `
      query {
        Viewer {
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
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    })

    if (!response.ok) return false

    const data = await response.json()
    if (data.errors) return false

    const user = data.data.Viewer
    return user.id.toString() === userId
  } catch (error) {
    console.error('AniList token verification error:', error)
    return false
  }
}

// MyAnimeList token verification
async function verifyMyAnimeListToken(userId: string, token: string) {
  try {
    const response = await fetch('https://api.myanimelist.net/v2/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    })

    if (!response.ok) return false

    const data = await response.json()
    return data.id.toString() === userId
  } catch (error) {
    console.error('MyAnimeList token verification error:', error)
    return false
  }
}

// SIMKL token verification
async function verifySIMKLToken(userId: string, token: string) {
  try {
    const response = await fetch('https://api.simkl.com/users/settings', {
      headers: {
        'simkl-api-key': token,
      }
    })

    if (!response.ok) return false

    const data = await response.json()
    return data.account?.id?.toString() === userId
  } catch (error) {
    console.error('SIMKL token verification error:', error)
    return false
  }
}

// Check if user has admin/moderator role and verify token
export async function verifyAdminAccess(supabase: any, clientType: string, userId: string, token: string) {
  // First verify the token is valid
  const tokenValid = await verifyToken(supabase, clientType, userId, token)
  if (!tokenValid) {
    return { valid: false, reason: 'Invalid token' }
  }

  // Then check if user has admin role
  const userRole = await getUserRole(supabase, userId)
  if (!['moderator', 'admin', 'super_admin'].includes(userRole)) {
    return { valid: false, reason: 'Insufficient permissions' }
  }

  return { valid: true, role: userRole }
}

// Get user role from configuration
async function getUserRole(supabase: any, userId: string) {
  try {
    const { data: superAdmins } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'super_admin_users')
      .single()

    const { data: admins } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'admin_users')
      .single()

    const { data: moderators } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'moderator_users')
      .single()

    const superAdminList = superAdmins ? JSON.parse(superAdmins.value) : []
    const adminList = admins ? JSON.parse(admins.value) : []
    const moderatorList = moderators ? JSON.parse(moderators.value) : []

    if (superAdminList.includes(userId)) return 'super_admin'
    if (adminList.includes(userId)) return 'admin'
    if (moderatorList.includes(userId)) return 'moderator'
    return 'user'
  } catch (error) {
    console.error('Get user role error:', error)
    return 'user'
  }
}

// Check if user can moderate target user
export function canModerate(moderatorRole: string, targetRole: string) {
  const roleHierarchy: { [key: string]: number } = {
    'user': 0,
    'moderator': 1,
    'admin': 2,
    'super_admin': 3
  }
  
  return roleHierarchy[moderatorRole] > roleHierarchy[targetRole]
}