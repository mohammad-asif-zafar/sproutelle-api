import { getAuthDb } from '../src/auth/db';
import { adminUsers, user as userTable, account as accountTable } from '../src/auth/schema';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Out-of-band Administrator Provisioning Script.
 * Security Rules:
 * 1. Tokens must be passed via environment variables (never command line arguments process.argv).
 * 2. Requires strict pre-shared ADMIN_BOOTSTRAP_TOKEN matching.
 * 3. Does not silently overwrite or elevate existing admin accounts.
 * 4. Logs zero credentials or sensitive connection strings.
 */
async function bootstrapAdmin() {
  const connectionString = process.env.NEON_HTTP_URL;
  if (!connectionString) {
    console.error('Error: NEON_HTTP_URL environment variable is missing.');
    process.exit(1);
  }

  // 1. Strict Token Verification (ENV ONLY)
  const requiredToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  const providedToken = process.env.PROVIDED_BOOTSTRAP_TOKEN;

  if (!requiredToken || !providedToken || requiredToken !== providedToken) {
    console.error('Security Error: Unauthorized provisioning request. Bootstrap token mismatch or missing in environment variables.');
    console.log('Usage: ADMIN_BOOTSTRAP_TOKEN=secret PROVIDED_BOOTSTRAP_TOKEN=secret ADMIN_EMAIL=admin@sproutelle.com ADMIN_PASSWORD=secret npx tsx scripts/poc-bootstrap.ts');
    process.exit(1);
  }

  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Sproutelle Administrator';

  if (!email || !password) {
    console.error('Error: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.');
    process.exit(1);
  }

  const db = getAuthDb(connectionString);

  // 2. Check existing user
  const existingUsers = await db.select().from(userTable).where(eq(userTable.email, email));
  let userId: string;

  if (existingUsers.length > 0) {
    userId = existingUsers[0].id;
    console.log(`Verified existing user record for email: ${email}.`);
  } else {
    // Manually create user and credential account using Better Auth password hashing
    userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);

    console.log(`Provisioning user record for ${email}...`);
    await db.insert(userTable).values({
      id: userId,
      email: email,
      name: name,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(accountTable).values({
      id: accountId,
      userId: userId,
      accountId: userId,
      providerId: 'credential',
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 3. Check existing admin record in admin_users
  const existingAdmin = await db.select().from(adminUsers).where(eq(adminUsers.id, userId));

  if (existingAdmin.length > 0) {
    if (existingAdmin[0].isAdmin) {
      console.log(`Account ${email} is already an authorized administrator. No changes performed.`);
      return;
    }

    // Explicit elevation check
    const forceElevate = process.env.ALLOW_ELEVATE_ADMIN === 'true';
    if (!forceElevate) {
      console.error(`Security Warning: Account ${email} exists in admin_users with is_admin = false. Set ALLOW_ELEVATE_ADMIN=true to elevate.`);
      process.exit(1);
    }

    await db.update(adminUsers).set({ isAdmin: true }).where(eq(adminUsers.id, userId));
    console.log(`Successfully elevated existing user ${email} to is_admin = true.`);
  } else {
    // Insert into admin_users with explicit is_admin: true
    await db.insert(adminUsers).values({
      id: userId,
      email: email,
      isAdmin: true,
      createdAt: new Date(),
    });
    console.log(`Successfully provisioned new administrator mapping for ${email}.`);
  }
}

bootstrapAdmin().catch((err) => {
  console.error('Provisioning failed:', err?.message || err);
  process.exit(1);
});
