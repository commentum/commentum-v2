// User management commands (Mute, Shadowban, etc.)

export async function handleMuteCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can mute users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const duration = options.find(opt => opt.name === 'duration')?.value || '24h'
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Muted by moderator'

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
    // Calculate mute duration
    let muteUntil = new Date()
    const durationMatch = duration.match(/^(\d+)([hdw])$/)
    if (durationMatch) {
      const [, amount, unit] = durationMatch
      const numAmount = parseInt(amount)
      
      switch (unit) {
        case 'h': muteUntil.setHours(muteUntil.getHours() + numAmount); break
        case 'd': muteUntil.setDate(muteUntil.getDate() + numAmount); break
        case 'w': muteUntil.setDate(muteUntil.getDate() + (numAmount * 7)); break
      }
    } else {
      muteUntil.setHours(muteUntil.getHours() + 24) // Default 24 hours
    }

    // Update all comments by this user
    await supabase
      .from('comments')
      .update({ 
        user_muted_until: muteUntil.toISOString(),
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: reason,
        moderation_action: 'mute'
      })
      .eq('user_id', targetUserId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🔇 Successfully muted user ${targetUserId}\nDuration: ${duration}\nReason: ${reason}\nUntil: ${muteUntil.toLocaleString()}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Mute command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to mute user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleUnmuteCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can unmute users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Mute lifted'

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
        user_muted_until: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: reason,
        moderation_action: 'unmute'
      })
      .eq('user_id', targetUserId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🔊 Successfully unmuted user ${targetUserId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unmute command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unmute user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleShadowbanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can shadowban users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Shadowbanned by admin'

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
        user_shadow_banned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: reason,
        moderation_action: 'shadow_ban'
      })
      .eq('user_id', targetUserId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `👻 Successfully shadowbanned user ${targetUserId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Shadowban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to shadowban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleUnshadowbanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can unshadowban users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Shadowban lifted'

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
        user_shadow_banned: false,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: reason,
        moderation_action: 'unshadow_ban'
      })
      .eq('user_id', targetUserId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unshadowbanned user ${targetUserId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unshadowban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unshadowban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}