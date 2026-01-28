// User management commands

export async function handlePromoteCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can promote users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const newRole = options.find(opt => opt.name === 'role')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Promotion'

  if (!targetUserId || !newRole) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ User ID and new role are required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const validRoles = ['moderator', 'admin', 'super_admin']
  if (!validRoles.includes(newRole)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Invalid role. Must be one of: ${validRoles.join(', ')}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get current user roles
    const { data: currentConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', `${newRole}_users`)
      .single()

    const currentUsers = currentConfig?.value ? JSON.parse(currentConfig.value) : []
    
    if (currentUsers.includes(targetUserId)) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User is already a ${newRole}`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Add user to new role
    const updatedUsers = [...currentUsers, targetUserId]
    
    await supabase
      .from('config')
      .update({ value: JSON.stringify(updatedUsers) })
      .eq('key', `${newRole}_users`)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully promoted user ${targetUserId} to ${newRole}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Promote command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to promote user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export async function handleDemoteCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can demote users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const role = options.find(opt => opt.name === 'role')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Demotion'

  if (!targetUserId || !role) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ User ID and role are required',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const validRoles = ['moderator', 'admin', 'super_admin']
  if (!validRoles.includes(role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Invalid role. Must be one of: ${validRoles.join(', ')}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get current user roles
    const { data: currentConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', `${role}_users`)
      .single()

    const currentUsers = currentConfig?.value ? JSON.parse(currentConfig.value) : []
    
    if (!currentUsers.includes(targetUserId)) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User is not a ${role}`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Remove user from role
    const updatedUsers = currentUsers.filter((id: string) => id !== targetUserId)
    
    await supabase
      .from('config')
      .update({ value: JSON.stringify(updatedUsers) })
      .eq('key', `${role}_users`)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully demoted user ${targetUserId} from ${role}\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Demote command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to demote user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}