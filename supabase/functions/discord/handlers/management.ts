import { createDiscordResponse, createErrorResponse, createCommentEmbed, createUserEmbed, createModerationEmbed } from '../utils.ts'

// Handle ban command
export async function handleBanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only admin and super_admin can ban
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only administrators can ban users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value
    const shadow = options?.find((opt: any) => opt.name === 'shadow')?.value || false

    if (!targetUserId || !reason) {
      return createErrorResponse('user_id and reason are required.')
    }

    // Get target user's current status
    const { data: targetUserComment } = await supabase
      .from('comments')
      .select('user_role')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComment) {
      return createErrorResponse('User not found in the system.')
    }

    // Check permissions
    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot ban user with equal or higher role.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: true,
        user_shadow_banned: shadow,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: shadow ? 'shadow_ban' : 'ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createModerationEmbed(
      shadow ? 'shadow ban' : 'ban',
      targetUserId,
      moderatorName,
      reason,
      shadow ? 'User can still post but others cannot see their content' : 'User cannot post or interact'
    )

  } catch (error) {
    console.error('Ban command error:', error)
    return createErrorResponse(`Failed to ban user: ${error.message}`)
  }
}

// Handle unban command
export async function handleUnbanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only admin and super_admin can unban
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only administrators can unban users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Ban lifted by admin'

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: false,
        user_shadow_banned: false,
        user_muted_until: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'unban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createDiscordResponse(
      `User Unbanned\n\n` +
      `User: ${targetUserId}\n` +
      `Admin: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n` +
      `User can now post and interact normally`
    )

  } catch (error) {
    console.error('Unban command error:', error)
    return createErrorResponse(`Failed to unban user: ${error.message}`)
  }
}

// Handle shadowban command
export async function handleShadowbanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only admin and super_admin can shadowban
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only administrators can shadow ban users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value

    if (!targetUserId || !reason) {
      return createErrorResponse('user_id and reason are required.')
    }

    // Get target user's current status
    const { data: targetUserComment } = await supabase
      .from('comments')
      .select('user_role')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComment) {
      return createErrorResponse('User not found in the system.')
    }

    // Check permissions
    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot shadow ban user with equal or higher role.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: false, // Shadow ban is separate from regular ban
        user_shadow_banned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'shadow_ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createDiscordResponse(
      `User Shadow Banned\n\n` +
      `User: ${targetUserId}\n` +
      `Admin: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `Shadow Ban Effect:\n` +
      `• User can still see their own comments\n` +
      `• Other users cannot see their comments\n` +
      `• User is not notified of the ban\n` +
      `• User can still vote and report`
    )

  } catch (error) {
    console.error('Shadowban command error:', error)
    return createErrorResponse(`Failed to shadow ban user: ${error.message}`)
  }
}

// Handle unshadowban command
export async function handleUnshadowbanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only admin and super_admin can unshadowban
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only administrators can remove shadow bans.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Shadow ban lifted by admin'

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_shadow_banned: false,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'unshadowban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createDiscordResponse(
      `Shadow Ban Removed\n\n` +
      `User: ${targetUserId}\n` +
      `Admin: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `User comments are now visible to everyone again`
    )

  } catch (error) {
    console.error('Unshadowban command error:', error)
    return createErrorResponse(`Failed to remove shadow ban: ${error.message}`)
  }
}

// Handle promote command
export async function handlePromoteCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only super_admin can promote
    if (!['super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only super administrators can promote users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const newRole = options?.find((opt: any) => opt.name === 'role')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Promoted by super admin'

    if (!targetUserId || !newRole) {
      return createErrorResponse('user_id and role are required.')
    }

    if (!['moderator', 'admin', 'super_admin'].includes(newRole)) {
      return createErrorResponse('Role must be moderator, admin, or super_admin.')
    }

    // Get target user's current role
    const { data: targetUserComment } = await supabase
      .from('comments')
      .select('user_role')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComment) {
      return createErrorResponse('User not found in the system.')
    }

    // Check permissions
    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot promote user with equal or higher role.')
    }

    // Update config to add user to new role
    const configKey = `${newRole}_users`
    const { data: currentConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', configKey)
      .limit(1)

    const currentUsers = currentConfig ? JSON.parse(currentConfig.value) : []
    
    // Remove from all other role lists first
    await removeFromAllRoles(supabase, targetUserId)
    
    // Add to new role
    if (!currentUsers.includes(targetUserId)) {
      currentUsers.push(targetUserId)
    }

    const { error: updateError } = await supabase
      .from('config')
      .update({ value: JSON.stringify(currentUsers) })
      .eq('key', configKey)

    if (updateError) throw updateError

    // Update user's comments to reflect new role
    const { error: commentError } = await supabase
      .from('comments')
      .update({
        user_role: newRole,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'promote'
      })
      .eq('user_id', targetUserId)

    if (commentError) throw commentError

    // Update Discord user registration if exists
    await supabase
      .from('discord_users')
      .update({ user_role: newRole })
      .eq('platform_user_id', targetUserId)

    return createModerationEmbed(
      'promote',
      targetUserId,
      moderatorName,
      reason,
      `From ${targetUserComment.user_role} to ${newRole}`
    )

  } catch (error) {
    console.error('Promote command error:', error)
    return createErrorResponse(`Failed to promote user: ${error.message}`)
  }
}

// Handle demote command
export async function handleDemoteCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only super_admin can demote
    if (!['super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only super administrators can demote users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const newRole = options?.find((opt: any) => opt.name === 'role')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Demoted by super admin'

    if (!targetUserId || !newRole) {
      return createErrorResponse('user_id and role are required.')
    }

    if (!['user', 'moderator', 'admin'].includes(newRole)) {
      return createErrorResponse('Role must be user, moderator, or admin.')
    }

    // Get target user's current role
    const { data: targetUserComment } = await supabase
      .from('comments')
      .select('user_role')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComment) {
      return createErrorResponse('User not found in the system.')
    }

    // Check permissions
    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot demote user with equal or higher role.')
    }

    // Remove from all role lists
    await removeFromAllRoles(supabase, targetUserId)
    
    // Add to new role if not user
    if (newRole !== 'user') {
      const configKey = `${newRole}_users`
      const { data: currentConfig } = await supabase
        .from('config')
        .select('value')
        .eq('key', configKey)
        .limit(1)

      const currentUsers = currentConfig ? JSON.parse(currentConfig.value) : []
      if (!currentUsers.includes(targetUserId)) {
        currentUsers.push(targetUserId)
      }

      const { error: updateError } = await supabase
        .from('config')
        .update({ value: JSON.stringify(currentUsers) })
        .eq('key', configKey)

      if (updateError) throw updateError
    }

    // Update user's comments to reflect new role
    const { error: commentError } = await supabase
      .from('comments')
      .update({
        user_role: newRole,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'demote'
      })
      .eq('user_id', targetUserId)

    if (commentError) throw commentError

    // Update Discord user registration if exists
    await supabase
      .from('discord_users')
      .update({ user_role: newRole })
      .eq('platform_user_id', targetUserId)

    return createDiscordResponse(
      `User Demoted\n\n` +
      `User: ${targetUserId}\n` +
      `New Role: ${newRole}\n` +
      `Previous Role: ${targetUserComment.user_role}\n` +
      `Demoted by: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `User now has ${newRole} permissions`
    )

  } catch (error) {
    console.error('Demote command error:', error)
    return createErrorResponse(`Failed to demote user: ${error.message}`)
  }
}

// Handle config command
export async function handleConfigCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Only super_admin can manage config
    if (!['super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only super administrators can manage system configuration.')
    }

    const action = options?.find((opt: any) => opt.name === 'action')?.value
    const key = options?.find((opt: any) => opt.name === 'key')?.value
    const value = options?.find((opt: any) => opt.name === 'value')?.value

    if (!action) {
      return createErrorResponse('action is required.')
    }

    if (action === 'view') {
      // Get all configuration
      const { data: configs } = await supabase
        .from('config')
        .select('*')
        .order('key')

      if (!configs || configs.length === 0) {
        return createDiscordResponse('System Configuration\n\nNo configuration found.')
      }

      const configList = configs.map((config: any) => {
        const displayValue = config.key.includes('users') ? 
          `[${JSON.parse(config.value).length} users]` : 
          config.value
        return `• **${config.key}:** ${displayValue}`
      }).join('\n')

      return createDiscordResponse(`System Configuration\n\n${configList}`)
    }

    if (action === 'update') {
      if (!key || !value) {
        return createErrorResponse('key and value are required for update action.')
      }

      // Validate key exists
      const { data: existingConfig } = await supabase
        .from('config')
        .select('*')
        .eq('key', key)
        .limit(1)

      if (!existingConfig) {
        return createErrorResponse(`Configuration key "${key}" not found.`)
      }

      // Validate value format for specific keys
      if (key.includes('users') || key === 'banned_keywords' || key === 'discord_webhook_urls' || key === 'discord_notification_types') {
        try {
          JSON.parse(value)
        } catch {
          return createErrorResponse(`Value for "${key}" must be valid JSON.`)
        }
      }

      // Update configuration
      const { error } = await supabase
        .from('config')
        .update({ 
          value: value,
          updated_at: new Date().toISOString()
        })
        .eq('key', key)

      if (error) throw error

      return createDiscordResponse(
        `Configuration Updated\n\n` +
        `Key: ${key}\n` +
        `New Value: ${value}\n` +
        `Updated by: ${moderatorName}\n` +
        `Time: ${new Date().toLocaleString()}`
      )
    }

    return createErrorResponse('Action must be "view" or "update".')

  } catch (error) {
    console.error('Config command error:', error)
    return createErrorResponse(`Failed to manage configuration: ${error.message}`)
  }
}

// Handle user command
export async function handleUserCommand(supabase: any, options: any, userRole: string) {
  try {
    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Get user information from comments
    const { data: userComments } = await supabase
      .from('comments')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (!userComments || userComments.length === 0) {
      return createErrorResponse('User not found in the system.')
    }

    const userComment = userComments[0]

    // Get user's Discord registration if exists
    const { data: discordRegistration } = await supabase
      .from('discord_users')
      .select('*')
      .eq('platform_user_id', targetUserId)
      .eq('is_active', true)
      .limit(1)

    // Get all user comments for statistics
    const { data: allUserComments } = await supabase
      .from('comments')
      .select('id, upvotes, downvotes, report_count, deleted, created_at')
      .eq('user_id', targetUserId)

    return createUserEmbed(userComment, allUserComments || [], discordRegistration)

  } catch (error) {
    console.error('User command error:', error)
    return createErrorResponse(`Failed to get user information: ${error.message}`)
  }
}

// Handle comment command
export async function handleCommentCommand(supabase: any, options: any, userRole: string) {
  try {
    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value

    if (!commentId) {
      return createErrorResponse('comment_id is required.')
    }

    // Get comment information
    const { data: comment, error } = await supabase
      .from('comments')
      .select('*')
      .eq('id', commentId)
      .limit(1)

    if (error || !comment) {
      return createErrorResponse('Comment not found.')
    }

    return createCommentEmbed(comment)

  } catch (error) {
    console.error('Comment command error:', error)
    return createErrorResponse(`Failed to get comment information: ${error.message}`)
  }
}

// Handle report command
export async function handleReportCommand(supabase: any, reporterId: string, reporterName: string, options: any[], registration: any) {
  try {
    if (!registration) {
      return createErrorResponse('You must register with `/register` before reporting comments.')
    }

    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value
    const notes = options?.find((opt: any) => opt.name === 'notes')?.value

    if (!commentId || !reason) {
      return createErrorResponse('comment_id and reason are required.')
    }

    const validReasons = ['spam', 'offensive', 'harassment', 'spoiler', 'nsfw', 'off_topic', 'other']
    if (!validReasons.includes(reason)) {
      return createErrorResponse(`Reason must be one of: ${validReasons.join(', ')}`)
    }

    // Get comment
    const { data: comment, error: fetchError } = await supabase
      .from('comments')
      .select('*')
      .eq('id', commentId)
      .limit(1)

    if (fetchError || !comment) {
      return createErrorResponse('Comment not found.')
    }

    if (comment.deleted) {
      return createErrorResponse('Cannot report deleted comment.')
    }

    // Prevent self-reporting
    if (comment.user_id === registration.platform_user_id) {
      return createErrorResponse('Cannot report your own comment.')
    }

    // Parse existing reports
    const existingReports = JSON.parse(comment.reports || '[]')

    // Check if user already reported this comment
    const existingReport = existingReports.find((r: any) => r.reporter_id === registration.platform_user_id)
    if (existingReport) {
      return createErrorResponse('You have already reported this comment.')
    }

    // Create new report
    const newReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      reporter_id: registration.platform_user_id,
      reason,
      notes: notes || '',
      created_at: new Date().toISOString(),
      status: 'pending'
    }

    existingReports.push(newReport)

    // Update comment with new report
    const { error } = await supabase
      .from('comments')
      .update({
        reported: true,
        report_count: comment.report_count + 1,
        reports: JSON.stringify(existingReports),
        report_status: 'pending'
      })
      .eq('id', commentId)

    if (error) throw error

    return createDiscordResponse(
      `Comment Reported\n\n` +
      `Comment ID: ${commentId}\n` +
      `Author: ${comment.username} (${comment.user_id})\n` +
      `Reported by: ${reporterName}\n` +
      `Reason: ${reason}\n` +
      `Notes: ${notes || 'No notes provided'}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `Report submitted for moderation review\n` +
      `Comment now has ${comment.report_count + 1} total reports`
    )

  } catch (error) {
    console.error('Report command error:', error)
    return createErrorResponse(`Failed to report comment: ${error.message}`)
  }
}

// Helper function to remove user from all role configurations
async function removeFromAllRoles(supabase: any, userId: string) {
  const roleKeys = ['moderator_users', 'admin_users', 'super_admin_users']
  
  for (const roleKey of roleKeys) {
    const { data: config } = await supabase
      .from('config')
      .select('value')
      .eq('key', roleKey)
      .limit(1)

    if (config) {
      const users = JSON.parse(config.value)
      const filteredUsers = users.filter((id: string) => id !== userId)
      
      await supabase
        .from('config')
        .update({ value: JSON.stringify(filteredUsers) })
        .eq('key', roleKey)
    }
  }
}

// Helper function to check if a user can moderate another
function canModerate(moderatorRole: string, targetRole: string): boolean {
  const roleHierarchy = {
    'user': 0,
    'moderator': 1,
    'admin': 2,
    'super_admin': 3,
    'owner': 4
  }
  
  return roleHierarchy[moderatorRole] > roleHierarchy[targetRole]
}
