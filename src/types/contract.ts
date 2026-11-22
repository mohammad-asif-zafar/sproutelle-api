/**
 * Sproutelle Shared API Contract & Data Transfer Objects (DTOs)
 * File: src/types/contract.ts
 */

// Generic API Response Envelope
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string; details?: unknown } };

// Pagination Envelope
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// -----------------------------------------------------------------------------
// 1. AUTHENTICATION & USER DTOs
// -----------------------------------------------------------------------------

export interface UserSession {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  image?: string | null;
}

export interface SignInPayload {
  email: string;
  password: string;
}

// -----------------------------------------------------------------------------
// 2. DASHBOARD METRICS
// -----------------------------------------------------------------------------

export interface DashboardMetrics {
  totalMediaAssets: number;
  totalCategories: number;
  totalGames: number;
  totalQuestions: number;
  totalGameVersions: number;
  recentChanges: Array<{
    id: string;
    type: string;
    title: string;
    timestamp: string;
  }>;
}

// -----------------------------------------------------------------------------
// 3. MEDIA ASSETS
// -----------------------------------------------------------------------------

export interface MediaAssetDTO {
  id: string;
  name: string;
  bucket_name: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256?: string | null;
  created_by?: string | null;
  created_at: string;
  public_url?: string;
}

export interface CreateMediaAssetPayload {
  name: string;
  bucket_name?: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256?: string | null;
}

// -----------------------------------------------------------------------------
// 4. GAME CATEGORIES
// -----------------------------------------------------------------------------

export interface GameCategoryDTO {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  icon_asset_id?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  icon_asset?: MediaAssetDTO | null;
}

export interface CreateCategoryPayload {
  name: string;
  slug: string;
  description?: string | null;
  icon_asset_id?: string | null;
  sort_order?: number;
}

export interface UpdateCategoryPayload {
  name?: string;
  slug?: string;
  description?: string | null;
  icon_asset_id?: string | null;
  sort_order?: number;
}

// -----------------------------------------------------------------------------
// 5. GAMES
// -----------------------------------------------------------------------------

export interface GameDTO {
  id: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  game_type: string;
  config?: Record<string, unknown> | null;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  category?: GameCategoryDTO | null;
  subcategory?: HomescreenExplorerSubcategoryDTO | null;
}

export interface CreateGamePayload {
  name: string;
  slug: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  description?: string | null;
  game_type?: string;
  config?: Record<string, unknown>;
  sort_order?: number;
}

export interface UpdateGamePayload {
  name?: string;
  slug?: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  description?: string | null;
  game_type?: string;
  config?: Record<string, unknown>;
  is_published?: boolean;
  sort_order?: number;
}

// -----------------------------------------------------------------------------
// 6. GAME LEVELS
// -----------------------------------------------------------------------------

export interface GameLevelDTO {
  id: string;
  game_id: string;
  level_number: number;
  title?: string | null;
  description?: string | null;
  pass_score: number;
  sort_order: number;
  created_at: string;
  game?: GameDTO | null;
}

export interface CreateGameLevelPayload {
  game_id: string;
  level_number: number;
  title?: string | null;
  description?: string | null;
  pass_score?: number;
  sort_order?: number;
}

export interface UpdateGameLevelPayload {
  level_number?: number;
  title?: string | null;
  description?: string | null;
  pass_score?: number;
  sort_order?: number;
}

// -----------------------------------------------------------------------------
// 7. QUESTIONS & OPTIONS (ADMIN FULL DTO)
// -----------------------------------------------------------------------------

export interface QuestionOptionDTO {
  id: string;
  question_id: string;
  option_text?: string | null;
  is_correct: boolean;
  sort_order: number;
  media_asset_id?: string | null;
  created_at: string;
  media_asset?: MediaAssetDTO | null;
}

export interface QuestionDTO {
  id: string;
  game_id: string;
  subcategory_id?: string | null;
  level_id?: string | null;
  question_text: string;
  question_type: string;
  instructions?: string | null;
  sort_order: number;
  is_draft: boolean;
  config?: Record<string, unknown> | null;
  image_asset_id?: string | null;
  audio_asset_id?: string | null;
  created_at: string;
  updated_at: string;
  image_asset?: MediaAssetDTO | null;
  audio_asset?: MediaAssetDTO | null;
  options?: QuestionOptionDTO[];
  game?: GameDTO | null;
  level?: GameLevelDTO | null;
}

export interface CreateQuestionOptionPayload {
  option_text?: string | null;
  is_correct: boolean;
  sort_order?: number;
  media_asset_id?: string | null;
}

export interface CreateQuestionPayload {
  game_id: string;
  subcategory_id?: string | null;
  level_id?: string | null;
  question_text: string;
  question_type?: string;
  instructions?: string | null;
  sort_order?: number;
  is_draft?: boolean;
  config?: Record<string, unknown>;
  image_asset_id?: string | null;
  audio_asset_id?: string | null;
  options?: CreateQuestionOptionPayload[];
}

export interface UpdateQuestionPayload {
  question_text?: string;
  question_type?: string;
  instructions?: string | null;
  subcategory_id?: string | null;
  level_id?: string | null;
  sort_order?: number;
  is_draft?: boolean;
  config?: Record<string, unknown>;
  image_asset_id?: string | null;
  audio_asset_id?: string | null;
  options?: Array<CreateQuestionOptionPayload & { id?: string }>;
}

// -----------------------------------------------------------------------------
// 8. HOMESCREEN EXPLORER & SUBCATEGORIES
// -----------------------------------------------------------------------------

export interface HomescreenExplorerDTO {
  id: string;
  title_name: string;
  title_image_asset_id?: string | null;
  background_color: string;
  category_id?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  title_image_asset?: MediaAssetDTO | null;
  category?: GameCategoryDTO | null;
}

export interface CreateHomescreenExplorerPayload {
  title_name: string;
  title_image_asset_id?: string | null;
  background_color?: string;
  category_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface HomescreenExplorerSubcategoryDTO {
  id: string;
  explorer_id: string;
  name: string;
  image_asset_id?: string | null;
  background_color: string;
  category_id?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  image_asset?: MediaAssetDTO | null;
  category?: GameCategoryDTO | null;
  explorer?: HomescreenExplorerDTO | null;
}

export interface CreateSubcategoryPayload {
  explorer_id: string;
  name: string;
  image_asset_id?: string | null;
  background_color?: string;
  category_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface SubcategoryGameAssignmentDTO {
  id: string;
  subcategory_id: string;
  game_id: string;
  enabled_patterns: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  game?: GameDTO | null;
  subcategory?: HomescreenExplorerSubcategoryDTO | null;
}

export interface CreateSubcategoryGameAssignmentPayload {
  subcategory_id: string;
  game_id: string;
  enabled_patterns?: string[];
  sort_order?: number;
  is_active?: boolean;
}

// -----------------------------------------------------------------------------
// 9. PUBLISHING & RELEASES (SANITIZED PUBLIC MOBILE CONTRACT)
// -----------------------------------------------------------------------------

export interface PublicPublishedQuestionOptionDTO {
  id: string;
  question_id: string;
  option_text?: string | null;
  sort_order: number;
  media_asset_id?: string | null;
}

export interface PublicPublishedQuestionDTO {
  id: string;
  game_id: string;
  subcategory_id: string;
  level_id?: string | null;
  question_text: string;
  question_type: string;
  instructions?: string | null;
  sort_order: number;
  image_asset_id?: string | null;
  audio_asset_id?: string | null;
  options: PublicPublishedQuestionOptionDTO[];
}

export interface PublicPublishedContentPackDTO {
  pack_version: string;
  generated_at: string;
  game_id: string;
  game_name: string;
  game_slug: string;
  engine_type: string;
  category_id?: string | null;
  config: Record<string, unknown>;
  questions: PublicPublishedQuestionDTO[];
  referenced_assets: Array<{
    id: string;
    name: string;
    file_path: string;
    mime_type: string;
  }>;
}

export interface GameReleaseDTO {
  id: string;
  game_id: string;
  version_number: string;
  pack_data: PublicPublishedContentPackDTO;
  is_active: boolean;
  created_at: string;
}
