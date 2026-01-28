// Configuration and statistics commands

export async function handleConfigCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can view configuration',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get all configuration
    const { data: config } = await supabase
      .from('config')
      .select('key, value')
      .in('key', [
        'super_admin_users',
        'admin_users',
        'moderator_users',
        'discord_bot_token',
        'discord_client_id',
        'discord_guild_id',
        'discord_webhook_url'
      ])

    if (!config) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ No configuration found',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const configList = config.map(item => {
      if (item.key.includes('_users')) {
        const users = JSON.parse(item.value)
        return `**${item.key}:** ${users.length > 0 ? users.join(', ') : 'None'}`
      } else if (item.key.includes('token') || item.key.includes('webhook')) {
        return `**${item.key}:** ${item.value ? '✅ Set' : '❌ Not set'}`
      } else {
        return `**${item.key}:** ${item.value || 'Not set'}`
      }
    }).join('\n')

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `⚙️ **Commentum Configuration**\n\n${configList}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Config command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch configuration: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleStatsCommand(supabase: any) {
  try {
    // Get overall statistics
    const { data: stats } = await supabase
      .from('comments')
      .select('upvotes, downvotes, report_count')

    const totalComments = stats?.length || 0
    const totalUpvotes = stats?.reduce((sum, comment) => sum + comment.upvotes, 0) || 0
    const totalDownvotes = stats?.reduce((sum, comment) => sum + comment.downvotes, 0) || 0
    const totalReports = stats?.reduce((sum, comment) => sum + comment.report_count, 0) || 0

    // Get Discord users statistics
    const { data: discordUsers } = await supabase
      .from('discord_users')
      .select('is_active, user_role')

    const activeUsers = discordUsers?.filter(user => user.is_active).length || 0
    const mods = discordUsers?.filter(user => user.is_active && user.user_role === 'moderator').length || 0
    const admins = discordUsers?.filter(user => user.is_active && user.user_role === 'admin').length || 0
    const superAdmins = discordUsers?.filter(user => user.is_active && user.user_role === 'super_admin').length || 0

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `📊 **Commentum Statistics**\n\n` +
            `💬 **Comments:** ${totalComments}\n` +
            `👍 **Upvotes:** ${totalUpvotes}\n` +
            `👎 **Downvotes:** ${totalDownvotes}\n` +
            `🚨 **Reports:** ${totalReports}\n\n` +
            `👥 **Discord Users:** ${activeUsers}\n` +
            `🛡️ **Mods:** ${mods}\n` +
            `👑 **Admins:** ${admins}\n` +
            `⭐ **Super Admins:** ${superAdmins}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Stats command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch statistics: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleSyncCommand(supabase: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can sync commands',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Call the existing sync commands function
    return await handleSyncCommands(supabase)
  } catch (error) {
    console.error('Sync command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to sync commands: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}