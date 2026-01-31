import { createDiscordResponse, createErrorResponse, createModerationEmbed } from '../utils.ts'

// Handle warn command
export async function handleWarnCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Check permissions
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can warn users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value

    if (!targetUserId || !reason) {
      return createErrorResponse('user_id and reason are required.')
    }

    // Get target user's current status
    const { data: targetUserComment } = await supabase
      .from('comments')
      .select('user_role, user_warnings, user_banned, user_muted_until')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComment) {
      return createErrorResponse('User not found in the system.')
    }

    // Check permissions (can't moderate users with equal or higher role)
    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot moderate user with equal or higher role.')
    }

    // Update all user's comments with new warning
    const newWarningCount = (targetUserComment.user_warnings || 0) + 1
    const { error } = await supabase
      .from('comments')
      .update({
        user_warnings: newWarningCount,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'warn'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Check for auto-mute/ban thresholds
    const { data: autoWarnThreshold } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'auto_warn_threshold')
      .limit(1)

    const { data: autoMuteThreshold } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'auto_mute_threshold')
      .limit(1)

    const { data: autoBanThreshold } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'auto_ban_threshold')
      .limit(1)

    const warnThreshold = autoWarnThreshold ? parseInt(autoWarnThreshold.value) : 3
    const muteThreshold = autoMuteThreshold ? parseInt(autoMuteThreshold.value) : 5
    const banThreshold = autoBanThreshold ? parseInt(autoBanThreshold.value) : 10

    let autoAction = ''
    if (newWarningCount >= banThreshold) {
      // Auto-ban
      await supabase
        .from('comments')
        .update({
          user_banned: true,
          moderated: true,
          moderated_at: new Date().toISOString(),
          moderated_by: moderatorId,
          moderation_reason: `Auto-ban after ${newWarningCount} warnings: ${reason}`,
          moderation_action: 'auto_ban'
        })
        .eq('user_id', targetUserId)
      autoAction = `AUTO-BANNED - User exceeded ${banThreshold} warnings`
    } else if (newWarningCount >= muteThreshold) {
      // Auto-mute for 24 hours
      const muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabase
        .from('comments')
        .update({
          user_muted_until: muteUntil,
          moderated: true,
          moderated_at: new Date().toISOString(),
          moderated_by: moderatorId,
          moderation_reason: `Auto-mute after ${newWarningCount} warnings: ${reason}`,
          moderation_action: 'auto_mute'
        })
        .eq('user_id', targetUserId)
      autoAction = `AUTO-MUTED - User exceeded ${muteThreshold} warnings (24 hours)`
    }

    return createModerationEmbed(
      'warn',
      targetUserId,
      moderatorName,
      reason,
      `Warning Count: ${newWarningCount}${autoAction ? ' | ' + autoAction : ''}`
    )

  } catch (error) {
    console.error('Warn command error:', error)
    return createErrorResponse(`Failed to warn user: ${error.message}`)
  }
}

// Handle unwarn command
export async function handleUnwarnCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    // Check permissions
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can remove warnings.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Get target user's current status
    const { data: targetUserComment } = await supabase
      .from('comments')
      .select('user_role, user_warnings, user_banned, user_muted_until')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComment) {
      return createErrorResponse('User not found in the system.')
    }

    // Check permissions
    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot moderate user with equal or higher role.')
    }

    if (!targetUserComment.user_warnings || targetUserComment.user_warnings <= 0) {
      return createErrorResponse('User has no warnings to remove.')
    }

    // Update all user's comments with reduced warning count
    const newWarningCount = Math.max(0, targetUserComment.user_warnings - 1)
    const { error } = await supabase
      .from('comments')
      .update({
        user_warnings: newWarningCount,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason || 'Warning removed by moderator',
        moderation_action: 'unwarn'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // If user was auto-banned/muted and warnings are now below threshold, consider lifting the punishment
    let liftedAction = ''
    if (targetUserComment.user_banned && newWarningCount < 5) {
      // Could add logic here to auto-unban if desired
      liftedAction = 'Consider lifting ban as warnings are reduced'
    } else if (targetUserComment.user_muted_until && new Date(targetUserComment.user_muted_until) > new Date() && newWarningCount < 3) {
      // Could add logic here to auto-unmute if desired
      liftedAction = 'Consider lifting mute as warnings are reduced'
    }

    return createModerationEmbed(
      'unwarn',
      targetUserId,
      moderatorName,
      reason || 'No reason provided',
      `New Warning Count: ${newWarningCount}${liftedAction ? ' | ' + liftedAction : ''}`
    )

  } catch (error) {
    console.error('Unwarn command error:', error)
    return createErrorResponse(`Failed to remove warning: ${error.message}`)
  }
}

// Handle mute command
export async function handleMuteCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can mute users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const duration = options?.find((opt: any) => opt.name === 'duration')?.value || 24
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

    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot moderate user with equal or higher role.')
    }

    // Calculate mute end time
    const muteUntil = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_muted_until: muteUntil,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'mute'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createModerationEmbed(
      'mute',
      targetUserId,
      moderatorName,
      reason,
      `Duration: ${duration} hours | Muted Until: ${new Date(muteUntil).toLocaleString()}`
    )

  } catch (error) {
    console.error('Mute command error:', error)
    return createErrorResponse(`Failed to mute user: ${error.message}`)
  }
}

// Handle unmute command
export async function handleUnmuteCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can unmute users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Manual unmute'

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_muted_until: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'unmute'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createModerationEmbed(
      'unmute',
      targetUserId,
      moderatorName,
      reason,
      'User can now post and interact normally'
    )

  } catch (error) {
    console.error('Unmute command error:', error)
    return createErrorResponse(`Failed to unmute user: ${error.message}`)
  }
}

// Handle pin command
export async function handlePinCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can pin comments.')
    }

    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Pinned by moderator'

    if (!commentId) {
      return createErrorResponse('comment_id is required.')
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
      return createErrorResponse('Cannot pin deleted comment.')
    }

    if (comment.pinned) {
      return createErrorResponse('Comment is already pinned.')
    }

    // Update comment
    const { error } = await supabase
      .from('comments')
      .update({
        pinned: true,
        pinned_at: new Date().toISOString(),
        pinned_by: moderatorId,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'pin'
      })
      .eq('id', commentId)

    if (error) throw error

    return createModerationEmbed(
      'pin',
      `Comment ${commentId} by ${comment.username}`,
      moderatorName,
      reason,
      `Content: ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}`
    )

  } catch (error) {
    console.error('Pin command error:', error)
    return createErrorResponse(`Failed to pin comment: ${error.message}`)
  }
}

// Handle unpin command
export async function handleUnpinCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can unpin comments.')
    }

    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Unpinned by moderator'

    if (!commentId) {
      return createErrorResponse('comment_id is required.')
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

    if (!comment.pinned) {
      return createErrorResponse('Comment is not pinned.')
    }

    // Update comment
    const { error } = await supabase
      .from('comments')
      .update({
        pinned: false,
        pinned_at: null,
        pinned_by: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'unpin'
      })
      .eq('id', commentId)

    if (error) throw error

    return createModerationEmbed(
      'unpin',
      `Comment ${commentId} by ${comment.username}`,
      moderatorName,
      reason,
      'Comment is no longer pinned'
    )

  } catch (error) {
    console.error('Unpin command error:', error)
    return createErrorResponse(`Failed to unpin comment: ${error.message}`)
  }
}

// Handle lock command
export async function handleLockCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can lock threads.')
    }

    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Thread locked by moderator'

    if (!commentId) {
      return createErrorResponse('comment_id is required.')
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

    if (comment.locked) {
      return createErrorResponse('Comment thread is already locked.')
    }

    // Update comment
    const { error } = await supabase
      .from('comments')
      .update({
        locked: true,
        locked_at: new Date().toISOString(),
        locked_by: moderatorId,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'lock'
      })
      .eq('id', commentId)

    if (error) throw error

    return createDiscordResponse(
      `Thread Locked\n\n` +
      `Comment ID: ${commentId}\n` +
      `Author: ${comment.username} (${comment.user_id})\n` +
      `Moderator: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `Content Preview: ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}`
    )

  } catch (error) {
    console.error('Lock command error:', error)
    return createErrorResponse(`Failed to lock thread: ${error.message}`)
  }
}

// Handle unlock command
export async function handleUnlockCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can unlock threads.')
    }

    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Thread unlocked by moderator'

    if (!commentId) {
      return createErrorResponse('comment_id is required.')
    }

    // Get comment
    const { data: comment, error: fetchError } = await supabase
      .from('comments')
      .eq('id', commentId)
      .limit(1)

    if (fetchError || !comment) {
      return createErrorResponse('Comment not found.')
    }

    if (!comment.locked) {
      return createErrorResponse('Comment thread is not locked.')
    }

    // Update comment
    const { error } = await supabase
      .from('comments')
      .update({
        locked: false,
        locked_at: null,
        locked_by: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'unlock'
      })
      .eq('id', commentId)

    if (error) throw error

    return createDiscordResponse(
      `Thread Unlocked\n\n` +
      `Comment ID: ${commentId}\n` +
      `Author: ${comment.username} (${comment.user_id})\n` +
      `Moderator: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}`
    )

  } catch (error) {
    console.error('Unlock command error:', error)
    return createErrorResponse(`Failed to unlock thread: ${error.message}`)
  }
}

// Handle delete command
export async function handleDeleteCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value

    if (!commentId) {
      return createErrorResponse('comment_id is required.')
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
      return createErrorResponse('Comment is already deleted.')
    }

    // Check permissions
    const canDelete = comment.user_id === moderatorId || 
                     ['admin', 'super_admin', 'owner'].includes(userRole)

    if (!canDelete) {
      return createErrorResponse('You can only delete your own comments (admins can delete any comment).')
    }

    // Update comment
    const { error } = await supabase
      .from('comments')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: moderatorId,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_action: 'delete'
      })
      .eq('id', commentId)

    if (error) throw error

    const deleterRole = comment.user_id === moderatorId ? 'Owner' : 'Moderator'
    
    return createDiscordResponse(
      `Comment Deleted\n\n` +
      `Comment ID: ${commentId}\n` +
      `Author: ${comment.username} (${comment.user_id})\n` +
      `Deleted by: ${moderatorName} (${deleterRole})\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `Deleted Content: ${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}`
    )

  } catch (error) {
    console.error('Delete command error:', error)
    return createErrorResponse(`Failed to delete comment: ${error.message}`)
  }
}

// Handle resolve command
export async function handleResolveCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can resolve reports.')
    }

    const commentId = options?.find((opt: any) => opt.name === 'comment_id')?.value
    const reporterId = options?.find((opt: any) => opt.name === 'reporter_id')?.value
    const resolution = options?.find((opt: any) => opt.name === 'resolution')?.value
    const notes = options?.find((opt: any) => opt.name === 'notes')?.value

    if (!commentId || !reporterId || !resolution) {
      return createErrorResponse('comment_id, reporter_id, and resolution are required.')
    }

    if (!['resolved', 'dismissed'].includes(resolution)) {
      return createErrorResponse('Resolution must be "resolved" or "dismissed".')
    }

    // Get comment with reports
    const { data: comment, error: fetchError } = await supabase
      .from('comments')
      .select('*')
      .eq('id', commentId)
      .limit(1)

    if (fetchError || !comment) {
      return createErrorResponse('Comment not found.')
    }

    const reports = JSON.parse(comment.reports || '[]')
    const reportIndex = reports.findIndex((r: any) => r.reporter_id === reporterId)

    if (reportIndex === -1) {
      return createErrorResponse('Report not found.')
    }

    // Update report
    reports[reportIndex] = {
      ...reports[reportIndex],
      status: resolution,
      reviewed_by: moderatorId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes || ''
    }

    // Check if all reports are resolved
    const allResolved = reports.every((r: any) => r.status !== 'pending')
    const newReportStatus = allResolved ? resolution : 'pending'

    // Update comment
    const { error } = await supabase
      .from('comments')
      .update({
        reports: JSON.stringify(reports),
        report_status: newReportStatus,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: `Report ${resolution}: ${notes || 'No notes provided'}`,
        moderation_action: `resolve_report_${resolution}`
      })
      .eq('id', commentId)

    if (error) throw error

    return createDiscordResponse(
      `Report ${resolution.charAt(0).toUpperCase() + resolution.slice(1)}\n\n` +
      `Comment ID: ${commentId}\n` +
      `Reporter: ${reporterId}\n` +
      `Moderator: ${moderatorName}\n` +
      `Resolution: ${resolution}\n` +
      `Notes: ${notes || 'No notes provided'}\n` +
      `Time: ${new Date().toLocaleString()}\n` +
      `Status: ${allResolved ? 'All reports resolved' : 'Some reports still pending'}`
    )

  } catch (error) {
    console.error('Resolve command error:', error)
    return createErrorResponse(`Failed to resolve report: ${error.message}`)
  }
}

// Handle queue command
export async function handleQueueCommand(supabase: any, registration: any, userRole: string) {
  try {
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators can view the moderation queue.')
    }

    // Get reported comments
    const { data: comments, error } = await supabase
      .from('comments')
      .select('*')
      .eq('reported', true)
      .eq('report_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10) // Limit to 10 most recent

    if (error) throw error

    if (!comments || comments.length === 0) {
      return createDiscordResponse('Moderation Queue\n\nNo pending reports to review.')
    }

    // Format reports
    const queueItems = comments.map((comment: any, index: number) => {
      const reports = JSON.parse(comment.reports || '[]')
      const pendingReports = reports.filter((r: any) => r.status === 'pending')
      
      return (
        `**${index + 1}. Comment ${comment.id}**\n` +
        `Author: ${comment.username} (${comment.user_id})\n` +
        `Reports: ${pendingReports.length}\n` +
        `Reasons: ${pendingReports.map((r: any) => r.reason).join(', ')}\n` +
        `Preview: ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}\n` +
        `Created: ${new Date(comment.created_at).toLocaleDateString()}\n`
      )
    }).join('\n')

    return createDiscordResponse(
      `Moderation Queue (${comments.length} pending)\n\n` +
      queueItems +
      `\nUse \`/resolve <comment_id> <reporter_id> <resolution>\` to handle reports`
    )

  } catch (error) {
    console.error('Queue command error:', error)
    return createErrorResponse(`Failed to fetch moderation queue: ${error.message}`)
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
// Handle ban command
export async function handleBanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only admins can ban users.')
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

    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot ban user with equal or higher role.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createDiscordResponse(
      `User Banned\n\n` +
      `User: ${targetUserId}\n` +
      `Moderator: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}`
    )

  } catch (error) {
    console.error('Ban command error:', error)
    return createErrorResponse(`Failed to ban user: ${error.message}`)
  }
}

// Handle unban command
export async function handleUnbanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only admins can unban users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Manual unban'

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: false,
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
      `Moderator: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}`
    )

  } catch (error) {
    console.error('Unban command error:', error)
    return createErrorResponse(`Failed to unban user: ${error.message}`)
  }
}

// Handle shadowban command
export async function handleShadowbanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only admins can shadowban users.')
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

    if (!canModerate(userRole, targetUserComment.user_role)) {
      return createErrorResponse('Cannot shadowban user with equal or higher role.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_shadowbanned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'shadowban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createDiscordResponse(
      `🕶️ **User Shadowbanned**\n\n` +
      `User: ${targetUserId}\n` +
      `Moderator: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `User's comments will be hidden from others but visible to themselves.`
    )

  } catch (error) {
    console.error('Shadowban command error:', error)
    return createErrorResponse(`Failed to shadowban user: ${error.message}`)
  }
}

// Handle unshadowban command
export async function handleUnshadowbanCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], registration: any, userRole: string) {
  try {
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only admins can unshadowban users.')
    }

    const targetUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const reason = options?.find((opt: any) => opt.name === 'reason')?.value || 'Manual unshadowban'

    if (!targetUserId) {
      return createErrorResponse('user_id is required.')
    }

    // Update all user's comments
    const { error } = await supabase
      .from('comments')
      .update({
        user_shadowbanned: false,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: moderatorId,
        moderation_reason: reason,
        moderation_action: 'unshadowban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return createDiscordResponse(
      `🌟 **User Unshadowbanned**\n\n` +
      `User: ${targetUserId}\n` +
      `Moderator: ${moderatorName}\n` +
      `Reason: ${reason}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `User's comments will now be visible to everyone again.`
    )

  } catch (error) {
    console.error('Unshadowban command error:', error)
    return createErrorResponse(`Failed to unshadowban user: ${error.message}`)
  }
}
