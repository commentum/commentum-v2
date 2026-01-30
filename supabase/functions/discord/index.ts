import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifySignature } from './utils.ts'
import { routeInteraction } from './router.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify Discord signature
    const signature = req.headers.get('x-signature-ed25519')
    const timestamp = req.headers.get('x-signature-timestamp')
    
    if (!signature || !timestamp) {
      return new Response('Missing signature headers', { status: 401 })
    }

    const body = await req.text()
    const isValidSignature = await verifySignature(body, signature, timestamp)
    
    if (!isValidSignature) {
      return new Response('Invalid signature', { status: 401 })
    }

    const interaction = JSON.parse(body)
    
    // Handle ping for Discord verification
    if (interaction.type === 1) {
      return new Response(
        JSON.stringify({ type: 1 }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Route interaction to appropriate handler
    return await routeInteraction(supabase, interaction)

  } catch (error) {
    console.error('Discord bot error:', error)
    return new Response(
      JSON.stringify({ 
        type: 4,
        data: {
          content: '❌ An error occurred while processing your command.',
          flags: 64
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})