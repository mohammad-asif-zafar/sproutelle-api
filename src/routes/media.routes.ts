import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { requireAdmin } from '../middleware/auth';
import { getDbClient } from '../db/client';
import type { ApiResponse, MediaAssetDTO, PaginatedResult } from '../types/contract';

const mediaRouter = new Hono<AppEnv>();

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'mp3', 'wav', 'ogg', 'json']);
const EXECUTABLE_EXTENSIONS = new Set(['exe', 'sh', 'bat', 'cmd', 'js', 'vbs', 'app', 'dmg', 'php', 'py', 'pl']);
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function getPublicUrl(c: any, filePath: string): string {
  const baseUrl = (c.env.PUBLIC_MEDIA_URL || 'http://localhost:8787/api/media/file').replace(/\/$/, '');
  return `${baseUrl}/${filePath}`;
}

export async function calculateSHA256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeCleanupDb(c: any, dbClient: any) {
  if (dbClient) {
    try {
      const ctx = (c as any).executionCtx;
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    } catch {
      dbClient.end().catch(() => {});
    }
  }
}

// -----------------------------------------------------------------------------
// 1. PUBLIC MEDIA FILE STREAMING ROUTE
// -----------------------------------------------------------------------------
mediaRouter.get('/file/*', async (c) => {
  const rawPath = c.req.path;
  const prefix = '/api/media/file/';
  const fileKey = rawPath.startsWith(prefix) ? rawPath.substring(prefix.length) : c.req.param('*');

  if (!fileKey || fileKey.trim() === '') {
    return c.text('File key required', 400);
  }

  if (!c.env.MEDIA_BUCKET) {
    return c.text('R2 bucket binding MEDIA_BUCKET is misconfigured', 503);
  }

  try {
    const object = await c.env.MEDIA_BUCKET.get(fileKey);
    if (!object) {
      return c.text('File not found', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    // SVG security: force Content-Disposition to attachment to prevent script execution if viewed directly
    if (fileKey.toLowerCase().endsWith('.svg')) {
      headers.set('Content-Disposition', 'attachment');
    }

    return new Response(object.body as ReadableStream, {
      headers,
      status: 200,
    });
  } catch (err: any) {
    console.error('R2 object fetch failed');
    return c.text('Error retrieving media file', 500);
  }
});

// -----------------------------------------------------------------------------
// 2. ADMIN PROTECTED MEDIA ENDPOINTS
// -----------------------------------------------------------------------------

// Upload Media Asset
mediaRouter.post('/', requireAdmin, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, 401);
  }

  if (!c.env.MEDIA_BUCKET) {
    return c.json({ success: false, error: { message: 'R2 bucket MEDIA_BUCKET is misconfigured', code: 'CONFIG_ERROR' } }, 503);
  }

  const bucketName = c.env.MEDIA_BUCKET_NAME || 'sproutelle-media-dev';

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch (err: any) {
    return c.json({ success: false, error: { message: 'Failed to parse form payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const file = body['file'] as File | undefined;
  if (!file || typeof file === 'string') {
    return c.json({ success: false, error: { message: 'No media file provided in request', code: 'MISSING_FILE' } }, 400);
  }

  // File size validation (Max 50MB)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return c.json({
      success: false,
      error: { message: `File size exceeds the maximum allowed limit of 50MB (${(file.size / (1024 * 1024)).toFixed(1)}MB)`, code: 'FILE_TOO_LARGE' },
    }, 400);
  }

  // Extension validation
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    return c.json({
      success: false,
      error: { message: `Executable file extension .${ext} is prohibited for security reasons`, code: 'INVALID_FILE_TYPE' },
    }, 400);
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json({
      success: false,
      error: { message: `File extension .${ext} is not supported. Allowed formats: PNG, JPG, WEBP, SVG, MP3, WAV, OGG, JSON`, code: 'UNSUPPORTED_FORMAT' },
    }, 400);
  }

  // Determine media category folder
  let category = 'other';
  const mimeType = file.type || 'application/octet-stream';
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) {
    category = 'image';
  } else if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'ogg'].includes(ext)) {
    category = 'audio';
  }

  // Construct unique object key
  const assetId = crypto.randomUUID();
  const fileKey = `media/${category}/${assetId}.${ext}`;

  // Read file arrayBuffer
  let fileBuffer: ArrayBuffer;
  try {
    fileBuffer = await file.arrayBuffer();
  } catch (err: any) {
    return c.json({ success: false, error: { message: 'Failed to read uploaded file stream', code: 'READ_ERROR' } }, 400);
  }

  let checksum = '';
  try {
    checksum = await calculateSHA256(fileBuffer);
  } catch(e) {
    console.warn("Failed to calculate SHA256 checksum", e);
  }

  // Upload to R2 Bucket
  try {
    await c.env.MEDIA_BUCKET.put(fileKey, fileBuffer, {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        originalName: file.name,
        uploadedBy: user.id,
      },
    });
  } catch (r2Err: any) {
    console.error('Cloudflare R2 put error');
    return c.json({
      success: false,
      error: { message: 'Cloudflare R2 storage upload failed', code: 'STORAGE_UPLOAD_ERROR' },
    }, 500);
  }

  // Insert metadata into Neon PostgreSQL
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    const insertRes = await dbClient.query(
      `INSERT INTO media_assets (id, name, bucket_name, file_path, mime_type, size_bytes, checksum_sha256, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, name, bucket_name, file_path, mime_type, size_bytes, checksum_sha256, created_by, created_at`,
      [assetId, file.name, bucketName, fileKey, mimeType, file.size, checksum || null, user.id]
    );

    const row = insertRes.rows[0];
    const dto: MediaAssetDTO = {
      id: row.id,
      name: row.name,
      bucket_name: row.bucket_name,
      file_path: row.file_path,
      mime_type: row.mime_type,
      size_bytes: Number(row.size_bytes),
      checksum_sha256: row.checksum_sha256,
      created_by: row.created_by,
      created_at: new Date(row.created_at).toISOString(),
      public_url: getPublicUrl(c, row.file_path),
    };

    const response: ApiResponse<MediaAssetDTO> = {
      success: true,
      data: dto,
    };

    return c.json(response, 201);
  } catch (dbErr: any) {
    console.error('Neon DB metadata insert failed after R2 upload');

    // ROLLBACK SAFETY: Attempt to delete the orphaned R2 object to prevent storage leaks
    try {
      await c.env.MEDIA_BUCKET.delete(fileKey);
      console.log(`Rollback cleanup: Successfully deleted orphaned R2 object`);
    } catch (cleanupErr: any) {
      console.error(`Rollback cleanup error: Failed to delete orphaned object ${fileKey} in bucket ${bucketName}`);
    }

    return c.json({
      success: false,
      error: { message: 'Failed to record asset metadata in database', code: 'DATABASE_INSERT_ERROR' },
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// List Media Assets
mediaRouter.get('/', requireAdmin, async (c) => {
  const query = (c.req.query('query') || '').trim();
  const typeFilter = (c.req.query('type') || 'all').toLowerCase().trim();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    // Build parameterized count and items queries
    let mimeCondition = '';
    if (typeFilter === 'image') {
      mimeCondition = "AND (mime_type LIKE 'image/%' OR file_path LIKE '%.png' OR file_path LIKE '%.jpg' OR file_path LIKE '%.jpeg' OR file_path LIKE '%.webp' OR file_path LIKE '%.svg')";
    } else if (typeFilter === 'audio') {
      mimeCondition = "AND (mime_type LIKE 'audio/%' OR file_path LIKE '%.mp3' OR file_path LIKE '%.wav' OR file_path LIKE '%.ogg')";
    } else if (typeFilter === 'other') {
      mimeCondition = "AND (mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'audio/%' AND file_path NOT LIKE '%.png' AND file_path NOT LIKE '%.jpg' AND file_path NOT LIKE '%.jpeg' AND file_path NOT LIKE '%.webp' AND file_path NOT LIKE '%.svg' AND file_path NOT LIKE '%.mp3' AND file_path NOT LIKE '%.wav' AND file_path NOT LIKE '%.ogg')";
    }

    const searchQuery = query ? `%${query}%` : '';

    const countRes = await dbClient.query(
      `SELECT COUNT(*)::int AS total FROM media_assets
       WHERE ($1 = '' OR name ILIKE $1 OR id::text = $2) ${mimeCondition}`,
      [searchQuery, query]
    );

    const total = Number(countRes.rows[0]?.total || 0);

    const itemsRes = await dbClient.query(
      `SELECT id, name, bucket_name, file_path, mime_type, size_bytes, checksum_sha256, created_by, created_at
       FROM media_assets
       WHERE ($1 = '' OR name ILIKE $1 OR id::text = $2) ${mimeCondition}
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [searchQuery, query, limit, offset]
    );

    const items: MediaAssetDTO[] = itemsRes.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      bucket_name: row.bucket_name,
      file_path: row.file_path,
      mime_type: row.mime_type,
      size_bytes: Number(row.size_bytes),
      checksum_sha256: row.checksum_sha256,
      created_by: row.created_by,
      created_at: new Date(row.created_at).toISOString(),
      public_url: getPublicUrl(c, row.file_path),
    }));

    const paginated: PaginatedResult<MediaAssetDTO> = {
      items,
      total,
      page,
      pageSize: limit,
      hasMore: offset + items.length < total,
    };

    const response: ApiResponse<PaginatedResult<MediaAssetDTO>> = {
      success: true,
      data: paginated,
    };

    return c.json(response);
  } catch (err: any) {
    console.error('Failed to list media assets');
    return c.json({
      success: false,
      error: { message: 'Failed to retrieve media library assets from database', code: 'DATABASE_ERROR' },
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Get Single Media Asset
mediaRouter.get('/:id', requireAdmin, async (c) => {
  const assetId = c.req.param('id');

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    const res = await dbClient.query(
      `SELECT id, name, bucket_name, file_path, mime_type, size_bytes, checksum_sha256, created_by, created_at
       FROM media_assets WHERE id::text = $1 LIMIT 1`,
      [assetId]
    );

    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Media asset not found', code: 'NOT_FOUND' } }, 404);
    }

    const row = res.rows[0];
    const dto: MediaAssetDTO = {
      id: row.id,
      name: row.name,
      bucket_name: row.bucket_name,
      file_path: row.file_path,
      mime_type: row.mime_type,
      size_bytes: Number(row.size_bytes),
      checksum_sha256: row.checksum_sha256,
      created_by: row.created_by,
      created_at: new Date(row.created_at).toISOString(),
      public_url: getPublicUrl(c, row.file_path),
    };

    return c.json({ success: true, data: dto });
  } catch (err: any) {
    console.error('Failed to fetch media asset details');
    return c.json({
      success: false,
      error: { message: 'Database error fetching media asset details', code: 'DATABASE_ERROR' },
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Delete Media Asset
mediaRouter.delete('/:id', requireAdmin, async (c) => {
  const assetId = c.req.param('id') || '';

  if (!c.env.MEDIA_BUCKET) {
    return c.json({ success: false, error: { message: 'R2 bucket MEDIA_BUCKET is misconfigured', code: 'CONFIG_ERROR' } }, 503);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    // 1. Fetch metadata record from Neon
    const fetchRes = await dbClient.query(
      `SELECT id, name, file_path FROM media_assets WHERE id::text = $1 LIMIT 1`,
      [assetId]
    );

    if (fetchRes.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Media asset not found', code: 'NOT_FOUND' } }, 404);
    }

    const asset = fetchRes.rows[0];

    // 2. Application-level reference check in content tables
    const refChecks = await Promise.all([
      dbClient.query('SELECT COUNT(*)::int AS count FROM game_categories WHERE icon_asset_id::text = $1', [assetId]),
      dbClient.query('SELECT COUNT(*)::int AS count FROM questions WHERE image_asset_id::text = $1 OR audio_asset_id::text = $1', [assetId]),
      dbClient.query('SELECT COUNT(*)::int AS count FROM question_options WHERE media_asset_id::text = $1', [assetId]),
      dbClient.query('SELECT COUNT(*)::int AS count FROM homescreen_explorer WHERE title_image_asset_id::text = $1', [assetId]),
      dbClient.query('SELECT COUNT(*)::int AS count FROM homescreen_explorer_subcategories WHERE image_asset_id::text = $1', [assetId]),
    ]);

    const totalRefs = refChecks.reduce((sum, res) => sum + Number(res.rows[0]?.count || 0), 0);
    if (totalRefs > 0) {
      return c.json({
        success: false,
        error: {
          message: `Cannot delete asset "${asset.name}": It is currently referenced by ${totalRefs} active educational item(s) (questions, categories, or explorer tiles).`,
          code: 'ASSET_IN_USE',
        },
      }, 409);
    }

    // 3. Delete object from Cloudflare R2
    try {
      await c.env.MEDIA_BUCKET.delete(asset.file_path);
    } catch (r2Err: any) {
      console.error(`Failed to delete object from R2`);
      return c.json({
        success: false,
        error: { message: 'Cloudflare R2 object deletion failed. Database record preserved.', code: 'R2_DELETE_ERROR' },
      }, 500);
    }

    // 4. Delete Neon database record AFTER successful R2 object deletion
    await dbClient.query(`DELETE FROM media_assets WHERE id::text = $1`, [assetId]);

    const response: ApiResponse<{ id: string }> = {
      success: true,
      data: { id: assetId },
    };

    return c.json(response);
  } catch (err: any) {
    console.error('Delete media asset operation error');
    return c.json({
      success: false,
      error: { message: 'Database error deleting media asset record', code: 'DATABASE_ERROR' },
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

export default mediaRouter;
