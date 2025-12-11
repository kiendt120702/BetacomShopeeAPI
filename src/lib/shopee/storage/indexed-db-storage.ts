/**
 * IndexedDB Token Storage
 * Lưu token vào IndexedDB (persistent, larger storage)
 */

import type { TokenStorage } from './token-storage.interface';
import type { AccessToken } from '../types';

const DB_NAME = 'shopee_sdk';
const DB_VERSION = 1;
const STORE_NAME = 'tokens';

export class IndexedDBTokenStorage implements TokenStorage {
  private shopId: number | undefined;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(shopId?: number) {
    this.shopId = shopId;
  }

  private getKey(): string {
    return this.shopId ? `shop_${this.shopId}` : 'default';
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
    });

    return this.dbPromise;
  }

  async store(token: AccessToken): Promise<void> {
    const db = await this.getDB();
    const key = this.getKey();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.put({ key, token, updatedAt: Date.now() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Lưu vào default nếu chưa có
        if (key !== 'default') {
          const defaultRequest = store.get('default');
          defaultRequest.onsuccess = () => {
            if (!defaultRequest.result) {
              store.put({ key: 'default', token, updatedAt: Date.now() });
            }
          };
        }
        resolve();
      };
    });
  }

  async get(): Promise<AccessToken | null> {
    const db = await this.getDB();
    const key = this.getKey();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.token);
        } else if (key !== 'default') {
          // Fallback to default
          const defaultRequest = store.get('default');
          defaultRequest.onerror = () => reject(defaultRequest.error);
          defaultRequest.onsuccess = () => {
            resolve(defaultRequest.result?.token || null);
          };
        } else {
          resolve(null);
        }
      };
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    const key = this.getKey();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Xóa tất cả tokens
   */
  async clearAll(): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Lấy tất cả shop IDs đã lưu
   */
  async getAllShopIds(): Promise<number[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = request.result as string[];
        const shopIds = keys
          .filter(key => key.startsWith('shop_'))
          .map(key => parseInt(key.replace('shop_', ''), 10))
          .filter(id => !isNaN(id));
        resolve(shopIds);
      };
    });
  }
}
