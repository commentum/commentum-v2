// Comment management commands

export async function handleCommentCommand(supabase: any, options: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  try {
    // Get comment information
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, upvotes, downvotes, report_count, created_at, moderated, pinned, locked, user_muted_until, user_shadow_banned')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Comment not found',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Determine status
    let status = '✅ Normal'
    if (comment.moderated) status = '🔨 Moderated'
    if (comment.pinned) status = '📌 Pinned'
    if (comment.locked) status = '🔒 Locked'
    if (comment.user_muted_until && new Date(comment.user_muted_until) > new Date()) status = '🔇 Muted'
    if (comment.user_shadow_banned) status = '👻 Shadow Banned'

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `💬 **Comment Information for ${commentId}**\n\n` +
            `👤 **User:** ${comment.username} (${comment.user_id})\n` +
            `📺 **Media ID:** ${comment.media_id}\n` +
            `👍 **Upvotes:** ${comment.upvotes}\n` +
            `👎 **Downvotes:** ${comment.downvotes}\n` +
            `🚨 **Reports:** ${comment.report_count}\n` +
            `📅 **Created:** ${new Date(comment.created_at).toLocaleString()}\n` +
            `🏷️ **Status:** ${status}\n\n` +
            `📝 **Content:**\n${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Comment command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch comment information: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleUserCommand(supabase: any, options: any) {
  const userId = options.find(opt => opt.name === 'user_id')?.value

  try {
    // Get user's comments and statistics
    const { data: comments } = await supabase
      .from('comments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (!comments || comments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ No comments found for this user',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const totalComments = comments.length
    const totalUpvotes = comments.reduce((sum, comment) => sum + comment.upvotes, 0)
    const totalDownvotes = comments.reduce((sum, comment) => sum + comment.downvotes, 0)
    const totalReports = comments.reduce((sum, comment) => sum + comment.report_count, 0)
    const moderatedComments = comments.filter(comment => comment.moderated).length

    // Get user's role from latest comment
    const userRole = comments[0]?.user_role || 'user'
    const username = comments[0]?.username || 'Unknown'

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `👤 **User Information for ${userId}**\n\n` +
            `🏷️ **Username:** ${username}\n` +
            `🔑 **Role:** ${userRole}\n` +
            `💬 **Total Comments:** ${totalComments}\n` +
            `👍 **Total Upvotes:** ${totalUpvotes}\n` +
            `👎 **Total Downvotes:** ${totalDownvotes}\n` +
            `🚨 **Total Reports:** ${totalReports}\n` +
            `🔨 **Moderated Comments:** ${moderatedComments}\n` +
            `📊 **Score:** ${totalUpvotes - totalDownvotes}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('User command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch user information: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}