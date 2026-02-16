import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

export async function verifySignature(body: string, signature: string, timestamp: string): Promise<boolean> {
  try {
    const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY')
    if (!DISCORD_PUBLIC_KEY) {
      console.error('DISCORD_PUBLIC_KEY not found')
      return false
    }

    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(DISCORD_PUBLIC_KEY),
      { name: 'ed25519', namedCurve: 'ed25519' },
      false,
      ['verify']
    )

    const timestampAndBody = timestamp + body
    const data = new TextEncoder().encode(timestampAndBody)
    const sig = hexToBytes(signature)

    const isValid = await crypto.subtle.verify(
      'ed25519',
      key,
      sig,
      data
    )

    return isValid
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

export function createDiscordResponse(content: string, ephemeral: boolean = false): Response {
  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content,
        flags: ephemeral ? 64 : 0
      }
    }),
    { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    }
  )
}

export function createErrorResponse(content: string, ephemeral: boolean = true): Response {
  return createDiscordResponse(`❌ ${content}`, ephemeral)
}

// Embed creation utilities
export function createEmbedResponse(title: string, description: string, fields: any[] = [], color: number = 0x5865F2, footer?: any, thumbnail?: string, ephemeral: boolean = false): Response {
  const embed: any = {
    title,
    description,
    color,
    fields: fields.filter(field => field && field.name && field.value),
    timestamp: new Date().toISOString()
  }

  if (footer) {
    embed.footer = footer
  }

  if (thumbnail) {
    embed.thumbnail = { url: thumbnail }
  }

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        embeds: [embed],
        flags: ephemeral ? 64 : 0
      }
    }),
    { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    }
  )
}

export function createCommentEmbed(comment: any, showFullContent: boolean = false): Response {
  const reports = JSON.parse(comment.reports || '[]')
  const userVotes = JSON.parse(comment.user_votes || '{}')
  const tags = JSON.parse(comment.tags || '[]')
  
  const fields = [
    {
      name: 'Author',
      value: `${comment.username} (${comment.user_id})`,
      inline: true
    },
    {
      name: 'Role',
      value: comment.user_role,
      inline: true
    },
    {
      name: 'Platform',
      value: comment.client_type,
      inline: true
    },
    {
      name: 'Engagement',
      value: `Up: ${comment.upvotes} | Down: ${comment.downvotes} | Score: ${comment.vote_score}`,
      inline: true
    },
    {
      name: 'Reports',
      value: `${comment.report_count} | Status: ${comment.report_status}`,
      inline: true
    },
    {
      name: 'Created',
      value: new Date(comment.created_at).toLocaleDateString(),
      inline: true
    }
  ]

  // Add moderation status if applicable
  const statusFields = []
  if (comment.deleted) statusFields.push('Deleted')
  if (comment.pinned) statusFields.push('Pinned')
  if (comment.locked) statusFields.push('Locked')
  if (comment.edited) statusFields.push(`Edited (${comment.edit_count})`)
  
  if (statusFields.length > 0) {
    fields.push({
      name: 'Status',
      value: statusFields.join(' | '),
      inline: true
    })
  }

  // Add media info
  fields.push({
    name: 'Media',
    value: `${comment.media_title} (${comment.media_type})`,
    inline: true
  })

  // Add content preview
  const content = showFullContent ? comment.content : 
    comment.content.length > 200 ? comment.content.substring(0, 200) + '...' : comment.content

  return createEmbedResponse(
    `Comment #${comment.id}`,
    content,
    fields,
    getStatusColor(comment),
    {
      text: `ID: ${comment.id}`
    },
    comment.user_avatar
  )
}

export function createUserEmbed(user: any, comments: any[], discordRegistration?: any): Response {
  const totalComments = comments.length
  const totalUpvotes = comments.reduce((sum, c) => sum + c.upvotes, 0)
  const totalDownvotes = comments.reduce((sum, c) => sum + c.downvotes, 0)
  const totalReports = comments.reduce((sum, c) => sum + c.report_count, 0)
  const lastActivity = comments.length > 0 ? new Date(comments[0].created_at).toLocaleDateString() : 'None'

  const fields = [
    {
      name: 'User ID',
      value: user.user_id,
      inline: true
    },
    {
      name: 'Role',
      value: user.user_role,
      inline: true
    },
    {
      name: 'Platform',
      value: user.client_type,
      inline: true
    },
    {
      name: 'Statistics',
      value: `Comments: ${totalComments} | Up: ${totalUpvotes} | Down: ${totalDownvotes} | Reports: ${totalReports}`,
      inline: true
    },
    {
      name: 'Last Activity',
      value: lastActivity,
      inline: true
    }
  ]

  // Add Discord info if available
  if (discordRegistration) {
    fields.push({
      name: 'Discord',
      value: `${discordRegistration.discord_username} | Registered`,
      inline: true
    })
  }

  // Add user status
  const statusFields = []
  if (user.user_banned) statusFields.push('Banned')
  if (user.user_shadow_banned) statusFields.push('Shadow Banned')
  if (user.user_muted_until) statusFields.push(`Muted until ${new Date(user.user_muted_until).toLocaleDateString()}`)
  if (user.user_warnings > 0) statusFields.push(`${user.user_warnings} warnings`)
  
  if (statusFields.length > 0) {
    fields.push({
      name: 'Status',
      value: statusFields.join(' | '),
      inline: true
    })
  }

  return createEmbedResponse(
    `User Profile: ${user.username}`,
    `Platform user with ${totalComments} comments`,
    fields,
    getRoleColor(user.user_role),
    {
      text: `User ID: ${user.user_id}`
    },
    user.user_avatar
  )
}

export function createStatsEmbed(stats: any): Response {
  const fields = [
    {
      name: 'Comments',
      value: `${stats.totalComments} total (${stats.activeComments} active)`,
      inline: true
    },
    {
      name: 'Engagement',
      value: `Up: ${stats.totalUpvotes} | Down: ${stats.totalDownvotes}`,
      inline: true
    },
    {
      name: 'Reports',
      value: stats.totalReports.toString(),
      inline: true
    },
    {
      name: 'Servers',
      value: stats.activeServers.toString(),
      inline: true
    },
    {
      name: 'Users',
      value: `Mods: ${stats.mods} | Admins: ${stats.admins} | Super Admins: ${stats.superAdmins}`,
      inline: true
    },
    {
      name: 'Platforms',
      value: `AniList: ${stats.anilistUsers} | MAL: ${stats.malUsers} | SIMKL: ${stats.simklUsers}`,
      inline: true
    }
  ]

  const systemStatus = [
    stats.systemEnabled ? 'System: Online' : 'System: Offline',
    stats.votingEnabled ? 'Voting: Online' : 'Voting: Offline',
    stats.reportingEnabled ? 'Reporting: Online' : 'Reporting: Offline',
    stats.discordEnabled ? 'Discord: Online' : 'Discord: Offline'
  ].join(' | ')

  fields.push({
    name: 'System Status',
    value: systemStatus,
    inline: false
  })

  return createEmbedResponse(
    'Commentum System Statistics',
    'Real-time system performance metrics',
    fields,
    0x00FF00,
    {
      text: `Generated: ${new Date().toLocaleString()}`
    }
  )
}

// Helper functions for colors
function getStatusColor(comment: any): number {
  if (comment.deleted) return 0xFF0000 // Red
  if (comment.report_count > 0) return 0xFFA500 // Orange
  if (comment.pinned) return 0xFFD700 // Gold
  if (comment.locked) return 0xFF69B4 // Pink
  return 0x5865F2 // Blue (default)
}

function getRoleColor(role: string): number {
  switch (role) {
    case 'super_admin': return 0xFF0000 // Red
    case 'admin': return 0xFF8C00 // Dark Orange
    case 'moderator': return 0xFFD700 // Gold
    case 'user': return 0x5865F2 // Blue
    default: return 0x808080 // Gray
  }
}

// Simple embed for general messages
export function createSimpleEmbed(title: string, description: string, color: number = 0x5865F2): Response {
  return createEmbedResponse(
    title,
    description,
    [],
    color
  )
}

// Moderation action embeds
export function createModerationEmbed(action: string, target: string, moderator: string, reason: string, details?: string): Response {
  const fields = [
    {
      name: 'Target',
      value: target,
      inline: true
    },
    {
      name: 'Moderator',
      value: moderator,
      inline: true
    },
    {
      name: 'Reason',
      value: reason,
      inline: false
    }
  ]

  if (details) {
    fields.push({
      name: 'Details',
      value: details,
      inline: false
    })
  }

  const colors = {
    ban: 0xFF0000,
    unban: 0x00FF00,
    shadowban: 0x800080,
    unshadowban: 0x9400D3,
    warn: 0xFFA500,
    mute: 0xFF69B4,
    promote: 0x00FF00,
    demote: 0xFF8C00,
    pin: 0xFFD700,
    lock: 0xFF69B4
  }

  return createEmbedResponse(
    `${action.charAt(0).toUpperCase() + action.slice(1)}`,
    'Moderation action completed',
    fields,
    colors[action as keyof typeof colors] || 0x5865F2,
    {
      text: `Action by ${moderator} | ${new Date().toLocaleString()}`
    }
  )
}

// Create modal response for gathering user input
export function createModalResponse(title: string, customId: string, inputLabel: string, placeholder: string = 'Enter reason...', minLength: number = 1, maxLength: number = 500): Response {
  return new Response(
    JSON.stringify({
      type: 9, // MODAL
      data: {
        title,
        custom_id: customId,
        components: [
          {
            type: 1, // ACTION_ROW
            components: [
              {
                type: 4, // TEXT_INPUT
                custom_id: 'reason_input',
                label: inputLabel,
                style: 1, // PARAGRAPH style for longer input
                placeholder,
                min_length: minLength,
                max_length: maxLength,
                required: true
              }
            ]
          }
        ]
      }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}