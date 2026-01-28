import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getUserRole, getDisplayRole } from '../shared/auth.ts'

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

    const { action, client_type, user_info, token } = await req.json()

    // Validate required fields
    if (!client_type || !user_info) {
      return new Response(
        JSON.stringify({ error: 'client_type and user_info are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract user_id from user_info
    const user_id = user_info?.user_id
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_info.user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (action) {
      case 'get_role':
        return await handleGetRole(supabase, { client_type, user_id })

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Must be get_role' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Users API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handleGetRole(supabase: any, params: any) {
  const { client_type, user_id } = params

  try {
    // Get user role from config (no token verification needed)
    const role = await getUserRole(supabase, user_id)
    // Hide owner role by displaying it as super_admin
    const displayRole = getDisplayRole(role)

    return new Response(
      JSON.stringify({
        success: true,
        role: displayRole,
        user_id: user_id,
        client_type: client_type
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Get role error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to get user role',
        role: 'user' // Default to user on error
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}
