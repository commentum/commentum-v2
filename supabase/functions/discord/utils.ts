import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

export async function verifySignature(body: string, signature: string, timestamp: string): Promise<boolean> {
  try {
    const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY')
    if (!DISCORD_PUBLIC_KEY) {
      console.error('DISCORD_PUBLIC_KEY not found')
      return false
    }

    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(DISCORD_PUBLIC_KEY),
      { name: 'ed25519', namedCurve: 'ed25519' },
      false,
      ['verify']
    )

    const timestampAndBody = timestamp + body
    const data = new TextEncoder().encode(timestampAndBody)
    const sig = hexToBytes(signature)

    const isValid = await crypto.subtle.verify(
      'ed25519',
      key,
      sig,
      data
    )

    return isValid
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

export function createDiscordResponse(content: string, ephemeral: boolean = false): Response {
  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content,
        flags: ephemeral ? 64 : 0
      }
    }),
    { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    }
  )
}

export function createErrorResponse(content: string, ephemeral: boolean = true): Response {
  return createDiscordResponse(`❌ ${content}`, ephemeral)
}