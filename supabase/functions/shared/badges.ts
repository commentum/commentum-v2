// Shared badge resolver for Commentum Edge Functions
// Delivers Discord-style badge metadata completely from backend

const BADGE_CDN_BASE = 'https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets/'

export interface UserBadge {
  id: string
  name: string
  description: string
  icon_url: string
  type: 'svg' | 'png'
  color: string
  priority: number
}

export function resolveUserBadges(params: {
  role?: string | null
  tier?: string | null
  points?: number | null
}): UserBadge[] {
  const badges: UserBadge[] = []
  const role = params.role?.toLowerCase()
  const tier = params.tier?.toLowerCase()
  const points = params.points || 0

  // 1. Role Badges
  if (role === 'owner') {
    badges.push({
      id: 'owner',
      name: 'Commentum Owner',
      description: 'Owner and creator of the Commentum community platform.',
      icon_url: `${BADGE_CDN_BASE}server/crown.svg`,
      type: 'svg',
      color: '#FFD700',
      priority: 1
    })
  } else if (role === 'app_owner' || role === 'appowner') {
    badges.push({
      id: 'app_owner',
      name: 'App Creator',
      description: 'Creator and developer of AnymeX.',
      icon_url: `${BADGE_CDN_BASE}server/crown.svg`,
      type: 'svg',
      color: '#FFD700',
      priority: 2
    })
  } else if (role === 'super_admin' || role === 'superadmin') {
    badges.push({
      id: 'super_admin',
      name: 'Super Administrator',
      description: 'Super Administrator with system-wide management authority.',
      icon_url: `${BADGE_CDN_BASE}discord-staff.svg`,
      type: 'svg',
      color: '#5865F2',
      priority: 3
    })
  } else if (role === 'admin') {
    badges.push({
      id: 'admin',
      name: 'Administrator',
      description: 'Community administrator overseeing moderation and policies.',
      icon_url: `${BADGE_CDN_BASE}discord-staff.svg`,
      type: 'svg',
      color: '#ED4245',
      priority: 4
    })
  } else if (role === 'moderator') {
    badges.push({
      id: 'moderator',
      name: 'Moderator',
      description: 'Verified moderator keeping comments respectful and safe.',
      icon_url: `${BADGE_CDN_BASE}discord-mod.svg`,
      type: 'svg',
      color: '#57F287',
      priority: 5
    })
  }

  // 2. Leaderboard Tier Badges
  if (tier === 'master' || tier === 'opal' || points >= 10000) {
    badges.push({
      id: 'tier_master',
      name: 'Opal (Master)',
      description: 'Grandmaster commenter with over 10,000 points.',
      icon_url: `${BADGE_CDN_BASE}subscriptions/badges/opal.png`,
      type: 'png',
      color: '#9B59B6',
      priority: 15
    })
  } else if (tier === 'elite' || tier === 'diamond' || points >= 5000) {
    badges.push({
      id: 'tier_elite',
      name: 'Diamond (Elite)',
      description: 'Elite top-tier commenter with over 5,000 points.',
      icon_url: `${BADGE_CDN_BASE}subscriptions/badges/diamond.png`,
      type: 'png',
      color: '#B9F2FF',
      priority: 16
    })
  } else if (tier === 'veteran' || tier === 'platinum' || points >= 1500) {
    badges.push({
      id: 'tier_veteran',
      name: 'Platinum (Veteran)',
      description: 'Veteran community member with over 1,500 points.',
      icon_url: `${BADGE_CDN_BASE}subscriptions/badges/platinum.png`,
      type: 'png',
      color: '#E5E4E2',
      priority: 17
    })
  } else if (tier === 'active' || tier === 'gold' || points >= 500) {
    badges.push({
      id: 'tier_active',
      name: 'Gold (Active)',
      description: 'Dedicated contributor with over 500 points.',
      icon_url: `${BADGE_CDN_BASE}subscriptions/badges/gold.png`,
      type: 'png',
      color: '#FFD700',
      priority: 18
    })
  } else if (tier === 'regular' || tier === 'silver' || points >= 100) {
    badges.push({
      id: 'tier_regular',
      name: 'Silver (Regular)',
      description: 'Active community participant with over 100 points.',
      icon_url: `${BADGE_CDN_BASE}subscriptions/badges/silver.png`,
      type: 'png',
      color: '#C0C0C0',
      priority: 19
    })
  } else if (tier === 'newcomer' || tier === 'bronze' || points > 0) {
    badges.push({
      id: 'tier_newcomer',
      name: 'Bronze (Newcomer)',
      description: 'Earned by community newcomers starting their journey.',
      icon_url: `${BADGE_CDN_BASE}subscriptions/badges/bronze.png`,
      type: 'png',
      color: '#CD7F32',
      priority: 20
    })
  }

  // Sort by priority (lowest number first)
  return badges.sort((a, b) => a.priority - b.priority)
}
