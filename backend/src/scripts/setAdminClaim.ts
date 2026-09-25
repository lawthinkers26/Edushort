/**
 * Grants (or revokes) the `admin` custom claim used by the admin dashboard.
 *
 *   npm run set-admin -- admin@example.com          # grant
 *   npm run set-admin -- admin@example.com --revoke # revoke
 *
 * The user must sign out and back in (or force-refresh their ID token) for the
 * new claim to appear in their token.
 */
import { firebaseAuth } from '../lib/firebaseAdmin';

async function main(): Promise<void> {
  const [email, flag] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: npm run set-admin -- <email> [--revoke]');
    process.exit(1);
  }

  const revoke = flag === '--revoke';
  try {
    const user = await firebaseAuth.getUserByEmail(email);
    const claims = { ...(user.customClaims ?? {}), admin: !revoke };
    await firebaseAuth.setCustomUserClaims(user.uid, claims);
    await firebaseAuth.revokeRefreshTokens(user.uid);
    console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${email} (uid ${user.uid}). Ask them to sign in again.`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to update admin claim:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
