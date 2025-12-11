/**
 * In-Memory Token Storage
 * Lưu token trong memory (cho testing hoặc SSR)
 */

import type { TokenStorage } from './token-storage.interface';
import type { AccessToken } from '../types';

export class MemoryTokenStorage implements TokenStorage {
  private static tokens: Map<string, AccessToken> = new Map();
  private key: string;

  constructor(shopId?: number) {
    this.key = shopId ? `shop_${shopId}` : 'default';
  }

  async store(token: AccessToken): Promise<void> {
    MemoryTokenStorage.tokens.set(this.key, token);
    
    // Lưu vào default nếu chưa có
    if (!MemoryTokenStorage.tokens.has('default')) {
      MemoryTokenStorage.tokens.set('default', token);
    }
  }

  async get(): Promise<AccessToken | null> {
    return MemoryTokenStorage.tokens.get(this.key) 
      || MemoryTokenStorage.tokens.get('default') 
      || null;
  }

  async clear(): Promise<void> {
    MemoryTokenStorage.tokens.delete(this.key);
  }

  /**
   * Xóa tất cả tokens
   */
  static clearAll(): void {
    MemoryTokenStorage.tokens.clear();
  }

  /**
   * Lấy tất cả tokens (for debugging)
   */
  static getAll(): Map<string, AccessToken> {
    return new Map(MemoryTokenStorage.tokens);
  }
}
