/**
 * Token Storage Module
 * Export tất cả storage implementations
 */

export type { TokenStorage } from './token-storage.interface';
export { LocalStorageTokenStorage } from './local-storage';
export { MemoryTokenStorage } from './memory-storage';
export { IndexedDBTokenStorage } from './indexed-db-storage';

// Factory function để tạo storage phù hợp
import { LocalStorageTokenStorage } from './local-storage';
import { MemoryTokenStorage } from './memory-storage';
import { IndexedDBTokenStorage } from './indexed-db-storage';
import type { TokenStorage } from './token-storage.interface';

export type StorageType = 'localStorage' | 'indexedDB' | 'memory';

/**
 * Tạo token storage instance
 * @param type - Loại storage
 * @param shopId - Shop ID (optional)
 */
export function createTokenStorage(
  type: StorageType = 'localStorage',
  shopId?: number
): TokenStorage {
  switch (type) {
    case 'indexedDB':
      return new IndexedDBTokenStorage(shopId);
    case 'memory':
      return new MemoryTokenStorage(shopId);
    case 'localStorage':
    default:
      return new LocalStorageTokenStorage(shopId);
  }
}

/**
 * Tự động chọn storage phù hợp với môi trường
 */
export function createAutoStorage(shopId?: number): TokenStorage {
  // Kiểm tra môi trường
  if (typeof window === 'undefined') {
    // Server-side: dùng memory
    return new MemoryTokenStorage(shopId);
  }

  // Browser: ưu tiên localStorage, fallback to memory
  try {
    localStorage.setItem('__test__', 'test');
    localStorage.removeItem('__test__');
    return new LocalStorageTokenStorage(shopId);
  } catch {
    console.warn('[TokenStorage] localStorage not available, using memory storage');
    return new MemoryTokenStorage(shopId);
  }
}
