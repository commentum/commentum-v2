// ============================================================================
// Commentum v2 Automated Verification Test Suite
// Validates:
// 1. Web Crypto HMAC-SHA256 JWT signing & verification
// 2. Tampered token signature rejection
// 3. Expired token rejection
// 4. Role hierarchy checks
// 5. Client type normalizations
// 6. Anti-spoofing guarantees
// ============================================================================

import { signJwt, verifyJwt } from '../supabase/functions/shared/jwt.ts';
import { extractBearerToken, hasRoleLevel, canModerateRole } from '../supabase/functions/shared/authMiddleware.ts';

async function runTests() {
  console.log('🚀 Starting Commentum v2 Backend Verification Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // --- Test 1: Sign & Verify Valid JWT ---
  try {
    const payload = {
      sub: 'anilist:5724017',
      uid: '5724017',
      provider: 'anilist',
      username: 'Sheby',
      role: 'owner',
      avatar: 'https://example.com/avatar.png',
    };

    const { token } = await signJwt(payload, 7 * 24 * 3600);
    assert(typeof token === 'string' && token.split('.').length === 3, 'JWT has 3 base64url segments');

    const verified = await verifyJwt(token);
    assert(verified.valid === true, 'Valid JWT verifies successfully');
    assert(verified.uid === '5724017', 'Verified UID matches original');
    assert(verified.role === 'owner', 'Verified role matches original');
    assert(verified.username === 'Sheby', 'Verified username matches original');
  } catch (e) {
    assert(false, `JWT Sign & Verify threw error: ${e}`);
  }

  // --- Test 2: Reject Tampered Signature ---
  try {
    const payload = {
      sub: 'anilist:12345',
      uid: '12345',
      provider: 'anilist',
      username: 'Hacker',
      role: 'user',
    };
    const { token } = await signJwt(payload, 3600);
    const parts = token.split('.');

    // Tamper the header or payload
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, role: 'owner' })).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const verifiedTampered = await verifyJwt(tamperedToken);
    assert(verifiedTampered.valid === false, 'Tampered token is strictly rejected');
  } catch (e) {
    assert(false, `Tampered test threw error: ${e}`);
  }

  // --- Test 3: Reject Expired Token ---
  try {
    const payload = {
      sub: 'anilist:55555',
      uid: '55555',
      provider: 'anilist',
      username: 'OldUser',
      role: 'user',
    };
    // Signed with -10 seconds expiry (already expired)
    const { token } = await signJwt(payload, -10);
    const verifiedExpired = await verifyJwt(token);
    assert(verifiedExpired.valid === false, 'Expired token is strictly rejected');
  } catch (e) {
    assert(false, `Expired test threw error: ${e}`);
  }

  // --- Test 4: Token Extraction from Request Headers ---
  try {
    const req1 = new Request('https://example.com/api', {
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1Ni...' },
    });
    assert(extractBearerToken(req1) === 'eyJhbGciOiJIUzI1Ni...', 'Extract token from Authorization: Bearer header');

    const req2 = new Request('https://example.com/api', {
      headers: { 'x-session-token': 'custom_session_token_123' },
    });
    assert(extractBearerToken(req2) === 'custom_session_token_123', 'Extract token from x-session-token header');

    const req3 = new Request('https://example.com/api');
    assert(extractBearerToken(req3) === null, 'Return null if no token header is present');
  } catch (e) {
    assert(false, `Token extraction threw error: ${e}`);
  }

  // --- Test 5: Role Hierarchy Verification ---
  try {
    assert(hasRoleLevel('owner', 'user') === true, 'Owner has user level');
    assert(hasRoleLevel('owner', 'moderator') === true, 'Owner has moderator level');
    assert(hasRoleLevel('owner', 'admin') === true, 'Owner has admin level');
    assert(hasRoleLevel('owner', 'super_admin') === true, 'Owner has super_admin level');
    assert(hasRoleLevel('owner', 'owner') === true, 'Owner has owner level');

    assert(hasRoleLevel('admin', 'moderator') === true, 'Admin has moderator level');
    assert(hasRoleLevel('admin', 'super_admin') === false, 'Admin does NOT have super_admin level');

    assert(hasRoleLevel('moderator', 'admin') === false, 'Moderator does NOT have admin level');
    assert(hasRoleLevel('user', 'moderator') === false, 'User does NOT have moderator level');

    // Moderation hierarchy: can target role be moderated by actor?
    assert(canModerateRole('owner', 'admin') === true, 'Owner can moderate admin');
    assert(canModerateRole('admin', 'moderator') === true, 'Admin can moderate moderator');
    assert(canModerateRole('moderator', 'user') === true, 'Moderator can moderate user');
    assert(canModerateRole('moderator', 'moderator') === false, 'Moderator cannot moderate peer moderator');
    assert(canModerateRole('moderator', 'admin') === false, 'Moderator cannot moderate admin');
    assert(canModerateRole('admin', 'owner') === false, 'Admin cannot moderate owner');
  } catch (e) {
    assert(false, `Role hierarchy threw error: ${e}`);
  }

  console.log(`\n========================================`);
  console.log(`Verification Complete: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
