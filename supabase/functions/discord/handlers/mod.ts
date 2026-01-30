import { handleAddCommand, handleRegisterCommand, handleStatsCommand, handleHelpCommand, getAvailableServers } from './info.ts'
import { handleWarnCommand, handleUnwarnCommand, handleMuteCommand, handleUnmuteCommand, handleBanCommand, handleUnbanCommand, handleShadowbanCommand, handleUnshadowbanCommand, handlePinCommand, handleUnpinCommand, handleLockCommand, handleUnlockCommand, handleDeleteCommand, handleResolveCommand, handleQueueCommand } from './moderation.ts'
import { handlePromoteCommand, handleDemoteCommand, handleConfigCommand, handleUserCommand, handleCommentCommand, handleReportCommand } from './management.ts'

export async function routeInteraction(supabase: any, interaction: any): Promise<Response> {
  const { data, guild_id, member, user } = interaction

  // Only handle application command interactions
  if (interaction.type !== 2) {
    return new Response('Not a command interaction', { status: 400 })
  }

  const commandName = data.name
  const userId = user.id
  const username = user.username
  const guildId = guild_id
  const guildName = member?.guild?.name || 'Unknown Server'

  // Get user registration and role
  const { data: registration } = await supabase
    .from('discord_users')
    .select('*')
    .eq('discord_user_id', userId)
    .eq('is_active', true)
    .single()

  const userRole = registration?.user_role || 'user'

  // Route to appropriate command handler
  try {
    switch (commandName) {
      // Server Management
      case 'add':
        return await handleAddCommand(supabase, userId, username, data.options, userRole)

      // User Commands
      case 'register':
        return await handleRegisterCommand(supabase, userId, username, guildId, guildName, data.options, registration)
      case 'report':
        return await handleReportCommand(supabase, userId, username, data.options, registration)
      case 'user':
        return await handleUserCommand(supabase, data.options, userRole)
      case 'comment':
        return await handleCommentCommand(supabase, data.options, userRole)
      case 'stats':
        return await handleStatsCommand(supabase, userRole)
      case 'help':
        return await handleHelpCommand(userRole)

      // Moderator Commands
      case 'warn':
        return await handleWarnCommand(supabase, userId, username, data.options, registration, userRole)
      case 'unwarn':
        return await handleUnwarnCommand(supabase, userId, username, data.options, registration, userRole)
      case 'mute':
        return await handleMuteCommand(supabase, userId, username, data.options, registration, userRole)
      case 'unmute':
        return await handleUnmuteCommand(supabase, userId, username, data.options, registration, userRole)
      case 'pin':
        return await handlePinCommand(supabase, userId, username, data.options, registration, userRole)
      case 'unpin':
        return await handleUnpinCommand(supabase, userId, username, data.options, registration, userRole)
      case 'lock':
        return await handleLockCommand(supabase, userId, username, data.options, registration, userRole)
      case 'unlock':
        return await handleUnlockCommand(supabase, userId, username, data.options, registration, userRole)
      case 'resolve':
        return await handleResolveCommand(supabase, userId, username, data.options, registration, userRole)
      case 'queue':
        return await handleQueueCommand(supabase, registration, userRole)
      case 'delete':
        return await handleDeleteCommand(supabase, userId, username, data.options, registration, userRole)

      // Admin Commands
      case 'ban':
        return await handleBanCommand(supabase, userId, username, data.options, registration, userRole)
      case 'unban':
        return await handleUnbanCommand(supabase, userId, username, data.options, registration, userRole)
      case 'shadowban':
        return await handleShadowbanCommand(supabase, userId, username, data.options, registration, userRole)
      case 'unshadowban':
        return await handleUnshadowbanCommand(supabase, userId, username, data.options, registration, userRole)

      // Super Admin Commands
      case 'promote':
        return await handlePromoteCommand(supabase, userId, username, data.options, registration, userRole)
      case 'demote':
        return await handleDemoteCommand(supabase, userId, username, data.options, registration, userRole)
      case 'config':
        return await handleConfigCommand(supabase, userId, username, data.options, registration, userRole)

      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Unknown command. Use `/help` to see available commands.',
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    }
  } catch (error) {
    console.error(`Command ${commandName} error:`, error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Error executing command: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}