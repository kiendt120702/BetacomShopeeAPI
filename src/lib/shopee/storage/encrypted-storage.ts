/**
 * Encrypted LocalStorage Token Storage
 * Lưu token với encryption vào localStorage
 * Theo docs/guides/token-storage.md - Security Best Practices
 */

import type { TokenStorage } from './token-storage.interface';
import type { AccessToken } from '../types';

const STORAGE_KEY_PREFIX = 'shopee_token_enc';

/**
 * Simple encryption using Web Crypto API
 * Sử dụng AES-GCM cho browser environment
 */
class CryptoHelper {
  private static encoder = new TextEncoder();
  private static decoder = new TextDecoder();

  /**
   * Derive key from password using PBKDF2
   */
  static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      this.encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt data
   */
  static async encrypt(data: string, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      this.encoder.encode(data)
    );

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data
   */
  static async decrypt(encryptedData: string, password: string): Promise<string> {
    // Decode from base64
    const combined = new Uint8Array(
      atob(encryptedData).split('').map(c => c.charCodeAt(0))
    );

    // Extract salt, iv, and encrypted data
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);

    const key = await this.deriveKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    return this.decoder.decode(decrypted);
  }
}

export class EncryptedLocalStorageTokenStorage implements TokenStorage {
  private key: string;
  private encryptionKey: string;

  constructor(shopId?: number, encryptionKey?: string) {
    this.key = shopId
      ? `${STORAGE_KEY_PREFIX}_${shopId}`
      : `${STORAGE_KEY_PREFIX}_default`;

    // Use provided key or generate from environment/default
    this.encryptionKey = encryptionKey
      || process.env.NEXT_PUBLIC_TOKEN_ENCRYPTION_KEY
      || this.generateDefaultKey();
  }

  /**
   * Generate a default encryption key based on browser fingerprint
   * Note: This is not cryptographically secure, use VITE_TOKEN_ENCRYPTION_KEY in production
   */
  private generateDefaultKey(): string {
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      new Date().getTimezoneOffset(),
    ].join('|');

    // Simple hash
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return `shopee_default_${Math.abs(hash).toString(36)}`;
  }

  async store(token: AccessToken): Promise<void> {
    try {
      const data = JSON.stringify(token);
      const encrypted = await CryptoHelper.encrypt(data, this.encryptionKey);

      localStorage.setItem(this.key, encrypted);

      // Also store in default key if first token
      const defaultKey = `${STORAGE_KEY_PREFIX}_default`;
      if (!localStorage.getItem(defaultKey)) {
        localStorage.setItem(defaultKey, encrypted);
      }

      console.log('[EncryptedStorage] Token stored securely');
    } catch (error) {
      console.error('[EncryptedStorage] Failed to store token:', error);
      throw error;
    }
  }

  async get(): Promise<AccessToken | null> {
    try {
      let encrypted = localStorage.getItem(this.key);

      if (!encrypted) {
        // Fallback to default key
        encrypted = localStorage.getItem(`${STORAGE_KEY_PREFIX}_default`);
        if (!encrypted) return null;
      }

      const data = await CryptoHelper.decrypt(encrypted, this.encryptionKey);
      return JSON.parse(data) as AccessToken;
    } catch (error) {
      console.error('[EncryptedStorage] Failed to get token:', error);
      // If decryption fails, clear corrupted data
      this.clear();
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(this.key);
    } catch (error) {
      console.error('[EncryptedStorage] Failed to clear token:', error);
    }
  }

  /**
   * Clear all encrypted tokens
   */
  static clearAll(): void {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  }

  /**
   * Migrate from unencrypted storage
   */
  async migrateFromUnencrypted(): Promise<boolean> {
    const unencryptedKey = this.key.replace('_enc', '');
    const unencryptedData = localStorage.getItem(unencryptedKey);

    if (!unencryptedData) {
      return false;
    }

    try {
      const token = JSON.parse(unencryptedData) as AccessToken;
      await this.store(token);
      localStorage.removeItem(unencryptedKey);
      console.log('[EncryptedStorage] Migrated from unencrypted storage');
      return true;
    } catch (error) {
      console.error('[EncryptedStorage] Migration failed:', error);
      return false;
    }
  }
}
