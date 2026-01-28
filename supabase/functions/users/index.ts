import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyToken, getUserRole } from '../shared/auth.ts'

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

    const { action, client_type, user_id, token } = await req.json()

    // Validate required fields
    if (!client_type || !user_id) {
      return new Response(
        JSON.stringify({ error: 'client_type and user_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (action) {
      case 'get_role':
        return await handleGetRole(supabase, { client_type, user_id, token })

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
  const { client_type, user_id, token } = params

  try {
    // If token is provided, verify it first
    if (token) {
      const tokenValid = await verifyToken(supabase, client_type, user_id, token)
      if (!tokenValid) {
        return new Response(
          JSON.stringify({ 
            error: 'Invalid token or user_id does not match',
            role: 'user'
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get user role from config
    const role = await getUserRole(supabase, user_id)

    return new Response(
      JSON.stringify({
        success: true,
        role: role,
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
