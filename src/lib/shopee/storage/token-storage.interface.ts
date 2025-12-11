/**
 * Token Storage Interface
 * Interface để implement custom token storage
 */

import type { AccessToken } from '../types';

export interface TokenStorage {
  /**
   * Lưu access token
   * @param token - Token cần lưu
   */
  store(token: AccessToken): Promise<void>;

  /**
   * Lấy token đã lưu
   * @returns Token hoặc null nếu không có
   */
  get(): Promise<AccessToken | null>;

  /**
   * Xóa token đã lưu
   */
  clear(): Promise<void>;
}
