// Utility and helper functions

export async function verifyPlatformToken(platformType: string, userId: string, token: string): Promise<boolean> {
  try {
    switch (platformType) {
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
    console.error('Platform token verification error:', error)
    return false
  }
}

async function verifyAniListToken(userId: string, token: string): Promise<boolean> {
  try {
    const query = `
      query {
        User(id: ${userId}) {
          id
          name
        }
      }
    `
    
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ query })
    })
    
    return response.ok
  } catch (error) {
    console.error('AniList token verification error:', error)
    return false
  }
}

async function verifyMyAnimeListToken(userId: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.myanimelist.net/v2/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    return response.ok
  } catch (error) {
    console.error('MyAnimeList token verification error:', error)
    return false
  }
}

async function verifySIMKLToken(userId: string, token: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.simkl.com/users/settings', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    
    return response.ok
  } catch (error) {
    console.error('SIMKL token verification error:', error)
    return false
  }
}

export async function getUserRoleFromPlatform(supabase: any, userId: string): Promise<string> {
  try {
    // Check if user is in any role lists
    const { data: superAdminConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'super_admin_users')
      .single()

    const { data: adminConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'admin_users')
      .single()

    const { data: moderatorConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'moderator_users')
      .single()

    const superAdmins = superAdminConfig?.value ? JSON.parse(superAdminConfig.value) : []
    const admins = adminConfig?.value ? JSON.parse(adminConfig.value) : []
    const moderators = moderatorConfig?.value ? JSON.parse(moderatorConfig.value) : []

    if (superAdmins.includes(userId)) return 'super_admin'
    if (admins.includes(userId)) return 'admin'
    if (moderators.includes(userId)) return 'moderator'
    
    return 'user'
  } catch (error) {
    console.error('Get user role error:', error)
    return 'user'
  }
}

export async function removeFromAllRoles(supabase: any, userId: string): Promise<void> {
  try {
    const roleKeys = ['super_admin_users', 'admin_users', 'moderator_users']
    
    for (const roleKey of roleKeys) {
      const { data: config } = await supabase
        .from('config')
        .select('value')
        .eq('key', roleKey)
        .single()

      if (config?.value) {
        const users = JSON.parse(config.value)
        const updatedUsers = users.filter((id: string) => id !== userId)
        
        await supabase
          .from('config')
          .update({ value: JSON.stringify(updatedUsers) })
          .eq('key', roleKey)
      }
    }
  } catch (error) {
    console.error('Remove from all roles error:', error)
    throw error
  }
}

export async function handleHelpCommand(registration: any) {
  const userRole = registration?.user_role || 'user'
  
  let commands = '**📚 Available Commands:**\n\n'
  
  // Basic commands for all users
  commands += '**🔍 Basic Commands:**\n'
  commands += '`/user <user_id>` - Get user information\n'
  commands += '`/comment <comment_id>` - Get comment information\n'
  commands += '`/stats` - View system statistics\n\n'
  
  // Moderator commands
  if (['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
    commands += '**🛡️ Moderator Commands:**\n'
    commands += '`/ban <user_id> [reason]` - Ban a user\n'
    commands += '`/unban <user_id> [reason]` - Unban a user\n'
    commands += '`/warn <user_id> [reason]` - Warn a user\n'
    commands += '`/mute <user_id> [duration] [reason]` - Mute a user (e.g., 24h, 3d, 1w)\n'
    commands += '`/unmute <user_id> [reason]` - Unmute a user\n'
    commands += '`/pin <comment_id> [reason]` - Pin a comment\n'
    commands += '`/unpin <comment_id> [reason]` - Unpin a comment\n'
    commands += '`/lock <comment_id> [reason]` - Lock a comment\n'
    commands += '`/unlock <comment_id> [reason]` - Unlock a comment\n'
    commands += '`/delete <comment_id> [reason]` - Delete a comment\n'
    commands += '`/report <comment_id> [reason]` - Report a comment\n'
    commands += '`/resolve <comment_id> [resolution]` - Resolve a report\n'
    commands += '`/queue` - View moderation queue\n\n'
  }
  
  // Admin commands
  if (['admin', 'super_admin', 'owner'].includes(userRole)) {
    commands += '**👑 Admin Commands:**\n'
    commands += '`/shadowban <user_id> [reason]` - Shadowban a user\n'
    commands += '`/unshadowban <user_id> [reason]` - Unshadowban a user\n'
    commands += '`/promote <user_id> <role> [reason]` - Promote a user\n'
    commands += '`/demote <user_id> <role> [reason]` - Demote a user\n\n'
  }
  
  // Super Admin commands
  if (['super_admin', 'owner'].includes(userRole)) {
    commands += '**⭐ Super Admin Commands:**\n'
    commands += '`/config` - View system configuration\n'
    commands += '`/sync` - Sync Discord commands\n'
    commands += '`/register` - Register Discord user\n'
    commands += '`/webhooks <action>` - Manage webhooks\n\n'
  }
  
  commands += '**📖 Usage Tips:**\n'
  commands += '• Use `[reason]` for optional reasons\n'
  commands += '• Duration format: `<number><h|d|w>` (hours, days, weeks)\n'
  commands += '• Roles: `moderator`, `admin`, `super_admin`\n'
  
  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: commands,
        flags: 64
      }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

export async function handleRegisterCommand(supabase: any, options: any, member: any) {
  const platformUserId = options.find(opt => opt.name === 'user_id')?.value
  const platformType = options.find(opt => opt.name === 'platform')?.value
  const token = options.find(opt => opt.name === 'token')?.value

  if (!platformUserId || !platformType || !token) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ User ID, platform, and token are required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Verify platform token
    const tokenValid = await verifyPlatformToken(platformType, platformUserId, token)
    if (!tokenValid) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Invalid platform token',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get user role from platform
    const userRole = await getUserRoleFromPlatform(supabase, platformUserId)

    // Register Discord user
    const { data: existingUser } = await supabase
      .from('discord_users')
      .select('*')
      .eq('discord_user_id', member.user.id)
      .single()

    if (existingUser) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Discord user already registered',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await supabase
      .from('discord_users')
      .insert({
        discord_user_id: member.user.id,
        discord_username: member.user.username,
        platform_user_id: platformUserId,
        platform_type: platformType,
        user_role: userRole,
        is_active: true,
        registered_at: new Date().toISOString()
      })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully registered ${member.user.username} as ${userRole}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Register command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to register: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleWebhooksCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can manage webhooks',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const action = options.find(opt => opt.name === 'action')?.value
  const webhookUrl = options.find(opt => opt.name === 'webhook_url')?.value

  try {
    switch (action) {
      case 'list':
        const { data: webhooks } = await supabase
          .from('discord_notifications')
          .select('*')
        
        const webhookList = webhooks?.map(webhook => 
          `• ${webhook.webhook_url} (${webhook.is_active ? 'Active' : 'Inactive'})`
        ).join('\n') || 'No webhooks configured'
        
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `📡 **Configured Webhooks:**\n\n${webhookList}`,
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )

      case 'add':
        if (!webhookUrl) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Webhook URL is required',
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        await supabase
          .from('discord_notifications')
          .insert({
            webhook_url: webhookUrl,
            is_active: true,
            created_at: new Date().toISOString()
          })

        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `✅ Successfully added webhook`,
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )

      case 'remove':
        if (!webhookUrl) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Webhook URL is required',
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        await supabase
          .from('discord_notifications')
          .delete()
          .eq('webhook_url', webhookUrl)

        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `✅ Successfully removed webhook`,
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )

      case 'test':
        // Test webhook functionality
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '🧪 Webhook test functionality not implemented yet',
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )

      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Invalid action. Use: list, add, remove, test',
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Webhooks command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to manage webhooks: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}