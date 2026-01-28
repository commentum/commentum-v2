// Content management commands (Pin, Lock, Delete, etc.)

export async function handlePinCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can pin comments',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Pinned by moderator'

  if (!commentId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    await supabase
      .from('comments')
      .update({ 
        pinned: true,
        pinned_at: new Date().toISOString(),
        pinned_by: registration.discord_user_id
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `📌 Successfully pinned comment ${commentId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Pin command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to pin comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleUnpinCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can unpin comments',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Unpinned by moderator'

  if (!commentId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    await supabase
      .from('comments')
      .update({ 
        pinned: false,
        pinned_at: null,
        pinned_by: null
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `📌 Successfully unpinned comment ${commentId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unpin command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unpin comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleLockCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can lock comments',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Locked by moderator'

  if (!commentId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    await supabase
      .from('comments')
      .update({ 
        locked: true,
        locked_at: new Date().toISOString(),
        locked_by: registration.discord_user_id
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🔒 Successfully locked comment ${commentId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Lock command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to lock comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleUnlockCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can unlock comments',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Unlocked by moderator'

  if (!commentId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    await supabase
      .from('comments')
      .update({ 
        locked: false,
        locked_at: null,
        locked_by: null
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🔓 Successfully unlocked comment ${commentId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unlock command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unlock comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleDeleteCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can delete comments',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Deleted by moderator'

  if (!commentId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    await supabase
      .from('comments')
      .update({ 
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: registration.discord_user_id
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🗑️ Successfully deleted comment ${commentId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Delete command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to delete comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}