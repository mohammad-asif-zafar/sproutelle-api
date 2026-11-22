import { safeCleanupDb } from "../db/cleanup";

import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { verifyNeonJWT, AuthVerificationError } from '../middleware/auth';
import { getDbClient } from '../db/client';
import type { ApiResponse, UserSession } from '../types/contract';

const authRouter = new Hono<AppEnv>();

// Session inspection endpoint for frontend session restoration
authRouter.get('/get-session', async (c) => {
  let userSession: UserSession;
  try {
    userSession = await verifyNeonJWT(c);
  } catch (authErr: any) {
    const status = authErr instanceof AuthVerificationError ? authErr.status : 401;
    const msg = authErr instanceof AuthVerificationError ? authErr.message : 'Invalid or expired authentication token';
    const code = authErr instanceof AuthVerificationError ? authErr.code : 'UNAUTHENTICATED';

    return c.json({
      success: false,
      error: {
        message: msg,
        code: code
      }
    }, status as any);
  }

  let isAdmin = false;
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    // Strict lookup by verified JWT subject ID ($1) in public.admin_users
    const result = await dbClient.query(
      `SELECT is_admin FROM admin_users WHERE id = $1 AND is_admin = true LIMIT 1`,
      [userSession.id]
    );
    isAdmin = result.rows.length > 0 && result.rows[0].is_admin === true;
  } catch (dbErr) {
    console.error('Database query failure during admin_users status lookup:', dbErr);
    isAdmin = false; // Fail closed on database failure
  } finally {
    safeCleanupDb(c, dbClient);
  }

  userSession.isAdmin = isAdmin;

  const response: ApiResponse<UserSession> = {
    success: true,
    data: userSession,
  };

  return c.json(response);
});

export default authRouter;
