import { handleAddCommand, handleRegisterCommand, handleStatsCommand, handleHelpCommand, getAvailableServers } from './info.ts'
import { handleWarnCommand, handleUnwarnCommand, handleMuteCommand, handleUnmuteCommand, handleBanCommand, handleUnbanCommand, handleShadowbanCommand, handleUnshadowbanCommand, handlePinCommand, handleUnpinCommand, handleLockCommand, handleUnlockCommand, handleDeleteCommand, handleResolveCommand, handleQueueCommand } from './moderation.ts'
import { handlePromoteCommand, handleDemoteCommand, handleConfigCommand, handleUserCommand, handleCommentCommand, handleReportCommand } from './management.ts'

// Discord interaction types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,  // Button clicks
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5
}

// Handle button interactions from notification messages
async function handleButtonInteraction(supabase: any, interaction: any): Promise<Response> {
  const { data, member, user, message } = interaction
  const customId = data?.custom_id
  
  if (!customId) {
    return new Response(
      JSON.stringify({ type: 4, data: { content: '❌ Invalid button interaction', flags: 64 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  const userId = user?.id || member?.user?.id
  const username = user?.username || member?.user?.username || 'Unknown'
  
  // Get user registration
  const { data: registration } = await supabase
    .from('discord_users')
    .select('*')
    .eq('discord_user_id', userId)
    .eq('is_active', true)
    .single()
  
  const userRole = registration?.user_role || 'user'
  
  // Parse custom_id (format: action:id1:id2)
  const parts = customId.split(':')
  const action = parts[0]
  const id1 = parts[1]
  const id2 = parts[2]
  
  console.log(`Button clicked: ${customId} by ${username} (${userRole})`)
  
  try {
    switch (action) {
      case 'mod_delete': {
        // mod_delete:commentId:userId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can delete comments.', true)
        }
        const commentId = id1
        
        // Get comment to check owner's role
        const { data: comment } = await supabase
          .from('comments')
          .select('deleted, deleted_by, user_id')
          .eq('id', commentId)
          .single()
        
        if (!comment) {
          return createButtonResponse('❌ Comment not found.', true)
        }
        
        if (comment?.deleted) {
          // Get mod name who deleted
          const { data: deleter } = await supabase
            .from('discord_users')
            .select('discord_username')
            .eq('discord_user_id', comment.deleted_by)
            .single()
          const deleterName = deleter?.discord_username || comment.deleted_by || 'Unknown'
          return createButtonResponse(`🗑️ Comment already deleted by **${deleterName}**.`, true)
        }
        
        // Check if target user has equal or higher role
        const targetUserRole = await getTargetUserRole(supabase, comment.user_id)
        if (!canModerateUser(userRole, targetUserRole)) {
          return createButtonResponse(`❌ Cannot delete comment from **${targetUserRole}**. You need higher role.`, true)
        }
        
        const { error } = await supabase
          .from('comments')
          .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: userId })
          .eq('id', commentId)
        if (error) throw error
        return createButtonResponse(`✅ Comment \`${commentId}\` deleted successfully!`)
      }
      
      case 'mod_warn': {
        // mod_warn:userId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can warn users.', true)
        }
        const targetUserId = id1
        
        // Check if target user has equal or higher role
        const targetUserRole = await getTargetUserRole(supabase, targetUserId)
        if (!canModerateUser(userRole, targetUserRole)) {
          return createButtonResponse(`❌ Cannot warn **${targetUserRole}**. You need higher role.`, true)
        }
        
        // Check current warning count and who warned
        const { data: targetUsers } = await supabase
          .from('commentum_users')
          .select('commentum_client_type, commentum_user_warnings, commentum_user_last_warning_by')
          .eq('commentum_user_id', targetUserId)
        
        if (!targetUsers || targetUsers.length === 0) {
          return createButtonResponse('❌ User not found.', true)
        }
        
        // Warn user across all platforms
        for (const u of targetUsers) {
          await supabase.rpc('add_user_warning', {
            p_client_type: u.commentum_client_type,
            p_user_id: targetUserId,
            p_warning_reason: 'Warned via Discord button',
            p_warned_by: userId
          })
        }
        
        const newWarningCount = (targetUsers[0]?.commentum_user_warnings || 0) + 1
        return createButtonResponse(`⚠️ User \`${targetUserId}\` has been warned! (Total: ${newWarningCount} warnings)`)
      }
      
      case 'mod_mute': {
        // mod_mute:userId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can mute users.', true)
        }
        const targetUserId = id1
        
        // Check if target user has equal or higher role
        const targetUserRole = await getTargetUserRole(supabase, targetUserId)
        if (!canModerateUser(userRole, targetUserRole)) {
          return createButtonResponse(`❌ Cannot mute **${targetUserRole}**. You need higher role.`, true)
        }
        
        // Check if already muted
        const { data: userStatus } = await supabase
          .from('commentum_users')
          .select('commentum_user_muted, commentum_user_muted_until, commentum_user_muted_by')
          .eq('commentum_user_id', targetUserId)
          .limit(1)
          .single()
        
        if (userStatus?.commentum_user_muted && userStatus?.commentum_user_muted_until && new Date(userStatus.commentum_user_muted_until) > new Date()) {
          // Get mod name who muted
          const { data: muter } = await supabase
            .from('discord_users')
            .select('discord_username')
            .eq('discord_user_id', userStatus.commentum_user_muted_by)
            .single()
          const muterName = muter?.discord_username || userStatus.commentum_user_muted_by || 'Unknown'
          return createButtonResponse(`🔇 User already muted by **${muterName}** until ${new Date(userStatus.commentum_user_muted_until).toLocaleString()}.`, true)
        }
        
        const muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        
        // Mute user across all platforms
        const { data: targetUsers } = await supabase
          .from('commentum_users')
          .select('commentum_client_type')
          .eq('commentum_user_id', targetUserId)
        
        for (const u of targetUsers || []) {
          await supabase.rpc('mute_commentum_user', {
            p_client_type: u.commentum_client_type,
            p_user_id: targetUserId,
            p_mute_duration_hours: 24,
            p_mute_reason: 'Muted via Discord button',
            p_muted_by: userId
          })
        }
        return createButtonResponse(`🔇 User \`${targetUserId}\` muted for 24 hours until ${muteUntil.toLocaleString()}!`)
      }
      
      case 'mod_ban': {
        // mod_ban:userId
        if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only admins can ban users.', true)
        }
        const targetUserId = id1
        
        // Check if target user has equal or higher role
        const targetUserRole = await getTargetUserRole(supabase, targetUserId)
        if (!canModerateUser(userRole, targetUserRole)) {
          return createButtonResponse(`❌ Cannot ban **${targetUserRole}**. You need higher role.`, true)
        }
        
        // Check if already banned
        const { data: userStatus } = await supabase
          .from('commentum_users')
          .select('commentum_user_banned, commentum_user_banned_by')
          .eq('commentum_user_id', targetUserId)
          .limit(1)
          .single()
        
        if (userStatus?.commentum_user_banned) {
          // Get mod name who banned
          const { data: banner } = await supabase
            .from('discord_users')
            .select('discord_username')
            .eq('discord_user_id', userStatus.commentum_user_banned_by)
            .single()
          const bannerName = banner?.discord_username || userStatus.commentum_user_banned_by || 'Unknown'
          return createButtonResponse(`🔨 User already banned by **${bannerName}**.`, true)
        }
        
        // Ban user across all platforms
        const { data: targetUsers } = await supabase
          .from('commentum_users')
          .select('commentum_client_type')
          .eq('commentum_user_id', targetUserId)
        
        for (const u of targetUsers || []) {
          await supabase.rpc('ban_commentum_user', {
            p_client_type: u.commentum_client_type,
            p_user_id: targetUserId,
            p_ban_reason: 'Banned via Discord button',
            p_banned_by: userId,
            p_shadow_ban: false
          })
        }
        return createButtonResponse(`🔨 User \`${targetUserId}\` has been banned!`)
      }
      
      case 'mod_del_warn': {
        // mod_del_warn:commentId:userId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can perform this action.', true)
        }
        const commentId = id1
        const targetUserId = id2
        
        // Check if target user has equal or higher role
        const targetUserRole = await getTargetUserRole(supabase, targetUserId)
        if (!canModerateUser(userRole, targetUserRole)) {
          return createButtonResponse(`❌ Cannot warn **${targetUserRole}**. You need higher role.`, true)
        }
        
        // Check if already deleted
        const { data: comment } = await supabase
          .from('comments')
          .select('deleted, deleted_by')
          .eq('id', commentId)
          .single()
        
        if (comment?.deleted) {
          const { data: deleter } = await supabase
            .from('discord_users')
            .select('discord_username')
            .eq('discord_user_id', comment.deleted_by)
            .single()
          const deleterName = deleter?.discord_username || comment.deleted_by || 'Unknown'
          return createButtonResponse(`🗑️ Comment already deleted by **${deleterName}**.`, true)
        }
        
        // Delete comment
        await supabase
          .from('comments')
          .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: userId })
          .eq('id', commentId)
        
        // Warn user
        const { data: targetUsers } = await supabase
          .from('commentum_users')
          .select('commentum_client_type')
          .eq('commentum_user_id', targetUserId)
        for (const u of targetUsers || []) {
          await supabase.rpc('add_user_warning', {
            p_client_type: u.commentum_client_type,
            p_user_id: targetUserId,
            p_warning_reason: 'Warned via delete & warn action',
            p_warned_by: userId
          })
        }
        return createButtonResponse(`🗑️⚠️ Comment deleted and user \`${targetUserId}\` warned!`)
      }
      
      case 'mod_del_ban': {
        // mod_del_ban:commentId:userId
        if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only admins can ban users.', true)
        }
        const commentId = id1
        const targetUserId = id2
        
        // Check if target user has equal or higher role
        const targetUserRole = await getTargetUserRole(supabase, targetUserId)
        if (!canModerateUser(userRole, targetUserRole)) {
          return createButtonResponse(`❌ Cannot ban **${targetUserRole}**. You need higher role.`, true)
        }
        
        // Check if already deleted and banned
        const { data: comment } = await supabase
          .from('comments')
          .select('deleted, deleted_by')
          .eq('id', commentId)
          .single()
        
        const { data: userStatus } = await supabase
          .from('commentum_users')
          .select('commentum_user_banned, commentum_user_banned_by')
          .eq('commentum_user_id', targetUserId)
          .limit(1)
          .single()
        
        if (comment?.deleted && userStatus?.commentum_user_banned) {
          const { data: deleter } = await supabase
            .from('discord_users')
            .select('discord_username')
            .eq('discord_user_id', comment.deleted_by)
            .single()
          const deleterName = deleter?.discord_username || comment.deleted_by || 'Unknown'
          const { data: banner } = await supabase
            .from('discord_users')
            .select('discord_username')
            .eq('discord_user_id', userStatus.commentum_user_banned_by)
            .single()
          const bannerName = banner?.discord_username || userStatus.commentum_user_banned_by || 'Unknown'
          return createButtonResponse(`✅ Already handled: Deleted by **${deleterName}**, Banned by **${bannerName}**.`, true)
        }
        
        // Delete comment if not already deleted
        if (!comment?.deleted) {
          await supabase
            .from('comments')
            .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: userId })
            .eq('id', commentId)
        }
        
        // Ban user if not already banned
        if (!userStatus?.commentum_user_banned) {
          const { data: targetUsers } = await supabase
            .from('commentum_users')
            .select('commentum_client_type')
            .eq('commentum_user_id', targetUserId)
          for (const u of targetUsers || []) {
            await supabase.rpc('ban_commentum_user', {
              p_client_type: u.commentum_client_type,
              p_user_id: targetUserId,
              p_ban_reason: 'Banned via delete & ban action',
              p_banned_by: userId,
              p_shadow_ban: false
            })
          }
        }
        return createButtonResponse(`🗑️🔨 Comment deleted and user \`${targetUserId}\` banned!`)
      }
      
      case 'report_approve': {
        // report_approve:commentId:userId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can approve reports.', true)
        }
        const commentId = id1
        
        // Check current status
        const { data: comment } = await supabase
          .from('comments')
          .select('report_status')
          .eq('id', commentId)
          .single()
        
        if (comment?.report_status === 'resolved') {
          return createButtonResponse(`✅ Report already resolved.`, true)
        }
        
        const { error } = await supabase
          .from('comments')
          .update({ reported: false, report_status: 'resolved' })
          .eq('id', commentId)
        if (error) throw error
        return createButtonResponse(`✅ Report for comment \`${commentId}\` approved!`)
      }
      
      case 'report_dismiss': {
        // report_dismiss:commentId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can dismiss reports.', true)
        }
        const commentId = id1
        
        // Check current status
        const { data: comment } = await supabase
          .from('comments')
          .select('report_status')
          .eq('id', commentId)
          .single()
        
        if (comment?.report_status === 'dismissed') {
          return createButtonResponse(`❌ Report already dismissed.`, true)
        }
        
        const { error } = await supabase
          .from('comments')
          .update({ reported: false, report_status: 'dismissed' })
          .eq('id', commentId)
        if (error) throw error
        return createButtonResponse(`❌ Report for comment \`${commentId}\` dismissed!`)
      }
      
      case 'mod_unpin': {
        // mod_unpin:commentId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can unpin comments.', true)
        }
        const commentId = id1
        
        // Check if pinned
        const { data: comment } = await supabase
          .from('comments')
          .select('pinned, pinned_by')
          .eq('id', commentId)
          .single()
        
        if (!comment?.pinned) {
          return createButtonResponse(`📍 Comment is not pinned.`, true)
        }
        
        const { error } = await supabase
          .from('comments')
          .update({ pinned: false, pinned_at: null, pinned_by: null })
          .eq('id', commentId)
        if (error) throw error
        return createButtonResponse(`📍 Comment \`${commentId}\` unpinned!`)
      }
      
      case 'mod_unlock': {
        // mod_unlock:commentId
        if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
          return createButtonResponse('❌ Only moderators can unlock threads.', true)
        }
        const commentId = id1
        
        // Check if locked
        const { data: comment } = await supabase
          .from('comments')
          .select('locked, locked_by')
          .eq('id', commentId)
          .single()
        
        if (!comment?.locked) {
          return createButtonResponse(`🔓 Comment is not locked.`, true)
        }
        
        const { error } = await supabase
          .from('comments')
          .update({ locked: false, locked_at: null, locked_by: null })
          .eq('id', commentId)
        if (error) throw error
        return createButtonResponse(`🔓 Comment \`${commentId}\` unlocked!`)
      }
      
      case 'mod_history': {
        // mod_history:userId - just show info
        const targetUserId = id1
        const { data: userComments } = await supabase
          .from('comments')
          .select('id, content, created_at, deleted, user_banned')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false })
          .limit(5)
        const history = userComments?.map((c: any) => 
          `• \`${c.id}\`: ${c.content?.substring(0, 30) || 'N/A'}... ${c.deleted ? '🗑️' : ''}`
        ).join('\n') || 'No comments found'
        return createButtonResponse(`📋 **User History for \`${targetUserId}\`**\n\n${history}`)
      }
      
      default:
        return createButtonResponse(`❌ Unknown action: \`${action}\``, true)
    }
  } catch (error) {
    console.error('Button interaction error:', error)
    return createButtonResponse(`❌ Error: ${error.message}`, true)
  }
}

// Helper to create button response
function createButtonResponse(content: string, ephemeral: boolean = false): Response {
  return new Response(
    JSON.stringify({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: {
        content,
        flags: ephemeral ? 64 : 0
      }
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<string, number> = {
  'user': 0,
  'moderator': 1,
  'admin': 2,
  'super_admin': 3,
  'owner': 4
}

// Check if moderator can perform action on target
function canModerateUser(moderatorRole: string, targetRole: string): boolean {
  return (ROLE_HIERARCHY[moderatorRole] || 0) > (ROLE_HIERARCHY[targetRole] || 0)
}

// Get target user's role from commentum_users table
async function getTargetUserRole(supabase: any, targetUserId: string): Promise<string> {
  const { data } = await supabase
    .from('commentum_users')
    .select('commentum_user_role')
    .eq('commentum_user_id', targetUserId)
    .limit(1)
    .single()
  
  return data?.commentum_user_role || 'user'
}

export async function routeInteraction(supabase: any, interaction: any): Promise<Response> {
  const { data, guild_id, member, user } = interaction

  // Handle button clicks (type 3)
  if (interaction.type === 3) {
    return await handleButtonInteraction(supabase, interaction)
  }

  // Only handle application command interactions (type 2)
  if (interaction.type !== 2) {
    return new Response('Not a command interaction', { status: 400 })
  }

  const commandName = data.name
  // Handle both guild and DM interactions - user info can be in different places
  const userId = user?.id || member?.user?.id
  const username = user?.username || member?.user?.username || 'Unknown'
  const guildId = guild_id
  const guildName = member?.guild?.name || 'Unknown Server'

  // Validate we have a user ID
  if (!userId) {
    console.error('Could not extract user ID from interaction:', JSON.stringify(interaction, null, 2))
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Could not identify user. Please try again.',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

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
