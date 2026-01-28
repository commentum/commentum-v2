// Report and queue management commands

export async function handleReportCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can manage reports',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Reported by moderator'

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
    // Add a report to the comment
    const { data: comment } = await supabase
      .from('comments')
      .select('reports, report_count')
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

    const reports = comment.reports ? JSON.parse(comment.reports) : []
    reports.push({
      reporter_id: registration.discord_user_id,
      reporter_name: registration.discord_username,
      reason: reason,
      created_at: new Date().toISOString()
    })

    await supabase
      .from('comments')
      .update({ 
        reports: JSON.stringify(reports),
        report_count: reports.length,
        reported: true,
        report_status: 'pending'
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🚨 Successfully reported comment ${commentId}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Report command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to report comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleResolveCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and Admins can resolve reports',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const resolution = options.find(opt => opt.name === 'resolution')?.value || 'resolved'

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
        report_status: resolution,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.discord_user_id,
        moderation_reason: `Report ${resolution}`,
        moderation_action: 'resolve_report'
      })
      .eq('id', commentId)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully marked report for comment ${commentId} as ${resolution}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Resolve command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to resolve report: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleQueueCommand(supabase: any) {
  try {
    // Get all pending reports
    const { data: pendingReports } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, report_count, reports, created_at')
      .eq('report_status', 'pending')
      .order('report_count', { ascending: false })
      .limit(10)

    if (!pendingReports || pendingReports.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '📋 **No pending reports**',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const queueList = pendingReports.map((comment, index) => {
      const reports = comment.reports ? JSON.parse(comment.reports) : []
      const latestReport = reports[reports.length - 1]
      
      return `**${index + 1}. Comment ${comment.id}** (${comment.report_count} reports)\n` +
        `👤 User: ${comment.username} (${comment.user_id})\n` +
        `📺 Media: ${comment.media_id}\n` +
        `📅 Created: ${new Date(comment.created_at).toLocaleDateString()}\n` +
        `📝 Content: ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}\n` +
        `🚨 Latest reason: ${latestReport?.reason || 'No reason'}\n`
    }).join('\n')

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `📋 **Moderation Queue (${pendingReports.length} pending)**\n\n${queueList}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Queue command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch moderation queue: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}