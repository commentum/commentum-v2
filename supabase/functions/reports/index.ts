import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyAdminAccess, getUserRole } from '../shared/auth.ts'
import { queueDiscordNotification } from '../shared/discordNotifications.ts'
import { getOrCreateUser, updateUserStats } from '../shared/userUtils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { action, comment_id, reporter_info, reason, notes, moderator_info, resolution, review_notes } = await req.json()

    switch (action) {
      case 'create':
        return await handleCreateReport(supabase, { comment_id, reporter_info, reason, notes })
      
      case 'resolve':
        // Resolve requires admin authentication (no token needed)
        if (!moderator_info) {
          return new Response(
            JSON.stringify({ error: 'moderator_info is required to resolve reports' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Extract moderator_id from moderator_info
        const moderator_id = moderator_info?.user_id
        if (!moderator_id) {
          return new Response(
            JSON.stringify({ error: 'moderator_info.user_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Validate comment_id (must be integer)
        if (!Number.isInteger(comment_id) || comment_id <= 0) {
          return new Response(
            JSON.stringify({ error: 'comment_id must be a positive integer' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const adminVerification = await verifyAdminAccess(supabase, moderator_id)
        if (!adminVerification.valid) {
          return new Response(
            JSON.stringify({ error: adminVerification.reason || 'Insufficient permissions' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return await handleResolveReport(supabase, { comment_id, reporter_info, moderator_id, resolution, review_notes })
      
      case 'get_queue':
        // Get queue requires admin authentication (no token needed)
        if (!moderator_info) {
          return new Response(
            JSON.stringify({ error: 'moderator_info is required to view reports queue' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Extract moderator_id from moderator_info
        const queueModeratorId = moderator_info?.user_id
        if (!queueModeratorId) {
          return new Response(
            JSON.stringify({ error: 'moderator_info.user_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const queueAdminVerification = await verifyAdminAccess(supabase, queueModeratorId)
        if (!queueAdminVerification.valid) {
          return new Response(
            JSON.stringify({ error: queueAdminVerification.reason || 'Insufficient permissions' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        return await handleGetReportsQueue(supabase, { queueModeratorId })
      
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Reports API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handleCreateReport(supabase: any, params: any) {
  const { comment_id, reporter_info, reason, notes } = params

  // Validate required fields
  if (!comment_id || !reporter_info || !reason) {
    return new Response(
      JSON.stringify({ error: 'comment_id, reporter_info, and reason are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Extract reporter_id from reporter_info
  const reporter_id = reporter_info?.user_id
  if (!reporter_id) {
    return new Response(
      JSON.stringify({ error: 'reporter_info.user_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate comment_id (must be integer)
  if (!Number.isInteger(comment_id) || comment_id <= 0) {
    return new Response(
      JSON.stringify({ error: 'comment_id must be a positive integer' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate reason
  const validReasons = ['spam', 'offensive', 'harassment', 'spoiler', 'nsfw', 'off_topic', 'other']
  if (!validReasons.includes(reason)) {
    return new Response(
      JSON.stringify({ error: 'Invalid reason' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check if reporting is enabled
  const { data: reportingConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'reporting_enabled')
    .single()

  if (reportingConfig && JSON.parse(reportingConfig.value) === false) {
    return new Response(
      JSON.stringify({ error: 'Reporting system is disabled' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get comment
  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.deleted) {
    return new Response(
      JSON.stringify({ error: 'Cannot report deleted comment' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Prevent self-reporting
  if (comment.user_id === reporter_id) {
    return new Response(
      JSON.stringify({ error: 'Cannot report your own comment' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Parse existing reports
  const existingReports = comment.reports ? JSON.parse(comment.reports) : []

  // Check if user already reported this comment
  const existingReport = existingReports.find((r: any) => r.reporter_id === reporter_id)
  if (existingReport) {
    return new Response(
      JSON.stringify({ error: 'You have already reported this comment' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create new report
  const newReport = {
    id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    reporter_id,
    reason,
    notes: notes || '',
    created_at: new Date().toISOString(),
    status: 'pending'
  }

  existingReports.push(newReport)

  // Update comment with new report
  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      reported: true,
      report_count: comment.report_count + 1,
      reports: JSON.stringify(existingReports),
      report_status: 'pending'
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  // Update user statistics (report filed)
  await updateUserStats(supabase, reporter_id, comment.client_type, 'report_filed', 1, 0)
  
  // Update user statistics (report received)
  await updateUserStats(supabase, comment.user_id, comment.client_type, 'report_received', 1, 0)

  // Queue Discord notification for new report in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'report_filed',
    comment: {
      id: comment.id,
      username: comment.username,
      user_id: comment.user_id,
      content: comment.content,
      client_type: comment.client_type,
      media_id: comment.media_id
    },
    user: {
      id: reporter_id,
      username: `User ${reporter_id}` // We don't have reporter username without API call
    },
    media: {
      id: comment.media_id,
      title: comment.media_title,
      year: comment.media_year,
      poster: comment.media_poster
    },
    reportReason: reason
  })

  return new Response(
    JSON.stringify({
      success: true,
      report: newReport,
      reportCount: updatedComment.report_count
    }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleResolveReport(supabase: any, params: any) {
  const { comment_id, reporter_info, moderator_id, resolution, review_notes } = params

  // Validate required fields
  if (!comment_id || !reporter_info || !moderator_id || !resolution) {
    return new Response(
      JSON.stringify({ error: 'comment_id, reporter_info, moderator_id, and resolution are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Extract reporter_id from reporter_info
  const reporter_id = reporter_info?.user_id
  if (!reporter_id) {
    return new Response(
      JSON.stringify({ error: 'reporter_info.user_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate resolution
  if (!['resolved', 'dismissed'].includes(resolution)) {
    return new Response(
      JSON.stringify({ error: 'Invalid resolution' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get comment with full data for notification
  const { data: fullComment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!fullComment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const reports = JSON.parse(fullComment.reports || '[]')
  const reportIndex = reports.findIndex((r: any) => r.reporter_id === reporter_id)

  if (reportIndex === -1) {
    return new Response(
      JSON.stringify({ error: 'Report not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update report
  reports[reportIndex] = {
    ...reports[reportIndex],
    status: resolution,
    reviewed_by: moderator_id,
    reviewed_at: new Date().toISOString(),
    review_notes: review_notes || ''
  }

  // Check if all reports are resolved
  const allResolved = reports.every((r: any) => r.status !== 'pending')
  const newReportStatus = allResolved ? resolution : 'pending'

  // Update comment
  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      reports: JSON.stringify(reports),
      report_status: newReportStatus,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: `Report ${resolution}: ${review_notes || 'No notes provided'}`,
      moderation_action: `resolve_report_${resolution}`
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  // Queue Discord notification for report resolution in background - NON-BLOCKING
  queueDiscordNotification({
    type: resolution === 'resolved' ? 'report_resolved' : 'report_dismissed',
    comment: {
      id: fullComment.id,
      username: fullComment.username,
      user_id: fullComment.user_id,
      content: fullComment.content,
      client_type: fullComment.client_type,
      media_id: fullComment.media_id
    },
    moderator: {
      id: moderator_id,
      username: `Moderator ${moderator_id}`
    },
    media: {
      id: fullComment.media_id,
      title: fullComment.media_title,
      year: fullComment.media_year,
      poster: fullComment.media_poster
    },
    reason: review_notes || `Report ${resolution}`,
    reportReason: reports[reportIndex].reason
  })

  return new Response(
    JSON.stringify({
      success: true,
      report: reports[reportIndex],
      commentId: comment_id,
      newReportStatus
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetReportsQueue(supabase: any, params: any) {
  const { queueModeratorId } = params

  // Get reported comments
  const { data: comments, error } = await supabase
    .from('comments')
    .select('*')
    .eq('reported', true)
    .eq('report_status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw error

  // Format reports
  const reportQueue = comments.map((comment: any) => {
    const reports = JSON.parse(comment.reports || '[]')
    const pendingReports = reports.filter((r: any) => r.status === 'pending')

    return {
      commentId: comment.id,
      content: comment.content,
      author: {
        id: comment.user_id,
        username: comment.username,
        avatar: comment.user_avatar
      },
      media: {
        id: comment.media_id,
        title: comment.media_title,
        type: comment.media_type,
        year: comment.media_year
      },
      createdAt: comment.created_at,
      reports: pendingReports,
      totalReports: comment.report_count,
      reportStatus: comment.report_status
    }
  })

  return new Response(
    JSON.stringify({
      reports: reportQueue,
      total: reportQueue.length
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}