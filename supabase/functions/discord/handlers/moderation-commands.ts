// Moderation commands

export async function handleBanCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can ban users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Violation of rules'
  const shadowBan = options.find(opt => opt.name === 'shadow')?.value === 'true'

  if (!targetUserId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Update all comments by this user
    await supabase
      .from('comments')
      .update({ 
        user_banned: !shadowBan,
        user_shadow_banned: shadowBan,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: reason,
        moderation_action: shadowBan ? 'shadow_ban' : 'ban'
      })
      .eq('user_id', targetUserId)

    const banType = shadowBan ? 'shadow banned' : 'banned'
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully ${banType} user ${targetUserId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Ban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to ban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleUnbanCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can unban users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Ban lifted'

  if (!targetUserId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Update all comments by this user
    await supabase
      .from('comments')
      .update({ 
        user_banned: false,
        user_shadow_banned: false,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: reason,
        moderation_action: 'unban'
      })
      .eq('user_id', targetUserId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unbanned user ${targetUserId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleWarnCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can warn users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Warning issued'

  if (!targetUserId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Increment warning count for all comments by this user
    const { data: comments } = await supabase
      .from('comments')
      .select('id, user_warnings')
      .eq('user_id', targetUserId)

    if (comments && comments.length > 0) {
      for (const comment of comments) {
        await supabase
          .from('comments')
          .update({ 
            user_warnings: (comment.user_warnings || 0) + 1,
            moderated: true,
            moderated_at: new Date().toISOString(),
            moderated_by: registration.discord_user_id,
            moderation_reason: reason,
            moderation_action: 'warn'
          })
          .eq('id', comment.id)
      }
    }

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `⚠️ Successfully warned user ${targetUserId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Warn command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to warn user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}