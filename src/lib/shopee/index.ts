/**
 * Shopee SDK Module - Browser Safe
 * Export tất cả functions cho browser
 */

// Browser-safe exports (mock/local storage)
export {
  SHOPEE_CONFIG,
  ShopeeRegion,
  isConfigValid,
  getAuthorizationUrl as getLocalAuthUrl,
  getStoredToken,
  storeToken,
  clearToken,
  isTokenValid,
  authenticateWithCode as authenticateLocal,
  refreshToken as refreshTokenLocal,
  handleOAuthCallback,
  isServer,
  isBrowser,
} from './browser-safe';

// Supabase Client (Backend API)
export {
  isSupabaseConfigured,
  getAuthorizationUrl,
  authenticateWithCode,
  refreshToken,
  getStoredTokenFromDB,
} from './supabase-client';

// Token Storage
export {
  createTokenStorage,
  createAutoStorage,
  LocalStorageTokenStorage,
  MemoryTokenStorage,
  IndexedDBTokenStorage,
} from './storage';
export type { TokenStorage } from './storage';

// Ads Client
export {
  getCampaignIdList,
  getCampaignSettingInfo,
  getAllCampaignsWithInfo,
  editManualProductAds,
  editAutoProductAds,
  editCampaignBudget,
  editCampaignStatus,
  // Cache functions
  getCampaignsFromCache,
  saveCampaignsToCache,
  isCacheStale,
} from './ads-client';
export type {
  GetCampaignIdListParams,
  GetCampaignSettingInfoParams,
  EditCampaignBudgetParams,
  EditCampaignStatusParams,
  CachedCampaign,
} from './ads-client';

// Ads Budget Scheduler Client
export {
  createBudgetSchedule,
  updateBudgetSchedule,
  deleteBudgetSchedule,
  listBudgetSchedules,
  getBudgetLogs,
  runScheduleNow,
  formatHourRange,
  formatDaysOfWeek,
} from './ads-scheduler-client';
export type {
  ScheduledAdsBudget,
  AdsBudgetLog,
  CreateScheduleParams,
  UpdateScheduleParams,
} from './ads-scheduler-client';

// Types
export type {
  AccessToken,
  RefreshedAccessToken,
  // Ads Types
  AdType,
  CampaignStatus,
  BiddingMethod,
  CampaignPlacement,
  CampaignIdItem,
  GetCampaignIdListResponse,
  CampaignDuration,
  CommonInfo,
  SelectedKeyword,
  DiscoveryAdsLocation,
  ManualBiddingInfo,
  AutoBiddingInfo,
  AutoProductAdsInfo,
  CampaignSettingInfo,
  GetCampaignSettingInfoResponse,
  // Edit Ads Types
  EditAction,
  SmartCreativeSetting,
  EditManualProductAdsParams,
  EditAutoProductAdsParams,
  EditAdsResponse,
} from './types';
export { CampaignInfoType } from './types';
