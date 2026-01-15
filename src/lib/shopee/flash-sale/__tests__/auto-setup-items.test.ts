/**
 * Test cases for Flash Sale Auto Setup - Item Processing
 * Kiểm tra logic xử lý sản phẩm có và không có biến thể
 */

import { describe, it, expect } from 'vitest';

// Simulate the item processing logic from FlashSaleAutoSetupPage
interface FlashSaleModel {
  model_id: number;
  model_name?: string;
  item_id: number;
  original_price: number;
  input_promotion_price: number;
  stock: number;
  campaign_stock: number;
  status?: number;
}

interface FlashSaleItem {
  item_id: number;
  item_name?: string;
  status: number;
  purchase_limit: number;
  campaign_stock?: number;
  // Cho sản phẩm không có biến thể - giá nằm trực tiếp trong item
  input_promotion_price?: number;
  models?: FlashSaleModel[];
}

function processItemsToAdd(templateItems: FlashSaleItem[]) {
  return templateItems.map(item => {
    const enabledModels = item.models?.filter(m => m.status === 1) || [];
    
    // Trường hợp 1: Sản phẩm không có biến thể với model_id = 0
    const isNonVariantWithModel = enabledModels.length === 1 && enabledModels[0].model_id === 0;
    
    if (isNonVariantWithModel) {
      const model = enabledModels[0];
      if (!model.input_promotion_price || model.input_promotion_price <= 0) {
        return null;
      }
      return {
        item_id: item.item_id,
        purchase_limit: item.purchase_limit || 0,
        item_input_promo_price: model.input_promotion_price,
        item_stock: model.campaign_stock || 0,
      };
    }
    
    // Trường hợp 2: Sản phẩm không có biến thể - không có models, giá nằm trong item
    if (enabledModels.length === 0 && item.input_promotion_price && item.input_promotion_price > 0) {
      return {
        item_id: item.item_id,
        purchase_limit: item.purchase_limit || 0,
        item_input_promo_price: item.input_promotion_price,
        item_stock: item.campaign_stock || 0,
      };
    }
    
    // Trường hợp 3: Không có model nào enabled và không có giá item
    if (enabledModels.length === 0) {
      return null;
    }
    
    // Trường hợp 4: Sản phẩm có biến thể - gửi với models array
    return {
      item_id: item.item_id,
      purchase_limit: item.purchase_limit || 0,
      models: enabledModels.map(m => ({
        model_id: m.model_id,
        input_promo_price: m.input_promotion_price || 0,
        stock: m.campaign_stock || 0,
      })),
    };
  }).filter(item => {
    // Loại bỏ item null hoặc không hợp lệ
    if (!item) return false;
    // Kiểm tra sản phẩm có biến thể
    if ('models' in item && item.models) {
      return item.models.length > 0 && item.models.every(m => m.input_promo_price > 0);
    }
    // Kiểm tra sản phẩm không có biến thể
    if ('item_input_promo_price' in item) {
      return item.item_input_promo_price > 0;
    }
    return false;
  });
}

describe('Flash Sale Auto Setup - Item Processing', () => {
  describe('Sản phẩm không có biến thể (model_id = 0)', () => {
    it('should process non-variant item with model_id = 0 correctly', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        item_name: 'Sản phẩm đơn',
        status: 1,
        purchase_limit: 5,
        models: [{
          model_id: 0,
          item_id: 123456,
          original_price: 100000,
          input_promotion_price: 80000,
          stock: 100,
          campaign_stock: 50,
          status: 1,
        }],
      }];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        item_id: 123456,
        purchase_limit: 5,
        item_input_promo_price: 80000,
        item_stock: 50,
      });
      // Không có models array
      expect(result[0]).not.toHaveProperty('models');
    });

    it('should skip non-variant item with invalid price (0)', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        status: 1,
        purchase_limit: 5,
        models: [{
          model_id: 0,
          item_id: 123456,
          original_price: 100000,
          input_promotion_price: 0, // Invalid price
          stock: 100,
          campaign_stock: 50,
          status: 1,
        }],
      }];

      const result = processItemsToAdd(templateItems);
      expect(result).toHaveLength(0);
    });

    it('should skip non-variant item with disabled status', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        status: 1,
        purchase_limit: 5,
        models: [{
          model_id: 0,
          item_id: 123456,
          original_price: 100000,
          input_promotion_price: 80000,
          stock: 100,
          campaign_stock: 50,
          status: 0, // Disabled
        }],
      }];

      const result = processItemsToAdd(templateItems);
      expect(result).toHaveLength(0);
    });

    it('should process non-variant item WITHOUT models (price in item)', () => {
      // Trường hợp Shopee API không trả về models cho sản phẩm không có biến thể
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        item_name: 'Sản phẩm đơn không có models',
        status: 1,
        purchase_limit: 5,
        input_promotion_price: 339000, // Giá nằm trực tiếp trong item
        campaign_stock: 11,
        models: undefined, // Không có models
      }];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        item_id: 123456,
        purchase_limit: 5,
        item_input_promo_price: 339000,
        item_stock: 11,
      });
      expect(result[0]).not.toHaveProperty('models');
    });

    it('should process non-variant item with empty models array (price in item)', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        status: 1,
        purchase_limit: 5,
        input_promotion_price: 250000,
        campaign_stock: 20,
        models: [], // Empty models array
      }];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        item_id: 123456,
        purchase_limit: 5,
        item_input_promo_price: 250000,
        item_stock: 20,
      });
    });
  });

  describe('Sản phẩm có biến thể (model_id > 0)', () => {
    it('should process variant item with multiple models correctly', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 789012,
        item_name: 'Sản phẩm có biến thể',
        status: 1,
        purchase_limit: 3,
        models: [
          {
            model_id: 111,
            item_id: 789012,
            original_price: 150000,
            input_promotion_price: 120000,
            stock: 200,
            campaign_stock: 100,
            status: 1,
          },
          {
            model_id: 222,
            item_id: 789012,
            original_price: 160000,
            input_promotion_price: 130000,
            stock: 150,
            campaign_stock: 80,
            status: 1,
          },
        ],
      }];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        item_id: 789012,
        purchase_limit: 3,
        models: [
          { model_id: 111, input_promo_price: 120000, stock: 100 },
          { model_id: 222, input_promo_price: 130000, stock: 80 },
        ],
      });
      // Không có item_input_promo_price
      expect(result[0]).not.toHaveProperty('item_input_promo_price');
    });

    it('should only include enabled models', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 789012,
        status: 1,
        purchase_limit: 3,
        models: [
          {
            model_id: 111,
            item_id: 789012,
            original_price: 150000,
            input_promotion_price: 120000,
            stock: 200,
            campaign_stock: 100,
            status: 1, // Enabled
          },
          {
            model_id: 222,
            item_id: 789012,
            original_price: 160000,
            input_promotion_price: 130000,
            stock: 150,
            campaign_stock: 80,
            status: 0, // Disabled
          },
        ],
      }];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('models');
      const models = (result[0] as { models: unknown[] }).models;
      expect(models).toHaveLength(1);
      expect(models[0]).toEqual({ model_id: 111, input_promo_price: 120000, stock: 100 });
    });

    it('should skip variant item if all models have invalid price', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 789012,
        status: 1,
        purchase_limit: 3,
        models: [
          {
            model_id: 111,
            item_id: 789012,
            original_price: 150000,
            input_promotion_price: 0, // Invalid
            stock: 200,
            campaign_stock: 100,
            status: 1,
          },
        ],
      }];

      const result = processItemsToAdd(templateItems);
      expect(result).toHaveLength(0);
    });
  });

  describe('Mixed items (cả có và không có biến thể)', () => {
    it('should process mixed items correctly', () => {
      const templateItems: FlashSaleItem[] = [
        // Sản phẩm không có biến thể
        {
          item_id: 111111,
          status: 1,
          purchase_limit: 5,
          models: [{
            model_id: 0,
            item_id: 111111,
            original_price: 50000,
            input_promotion_price: 40000,
            stock: 100,
            campaign_stock: 30,
            status: 1,
          }],
        },
        // Sản phẩm có biến thể
        {
          item_id: 222222,
          status: 1,
          purchase_limit: 3,
          models: [
            {
              model_id: 333,
              item_id: 222222,
              original_price: 100000,
              input_promotion_price: 80000,
              stock: 200,
              campaign_stock: 50,
              status: 1,
            },
            {
              model_id: 444,
              item_id: 222222,
              original_price: 120000,
              input_promotion_price: 90000,
              stock: 150,
              campaign_stock: 40,
              status: 1,
            },
          ],
        },
        // Sản phẩm không có biến thể - disabled
        {
          item_id: 333333,
          status: 1,
          purchase_limit: 2,
          models: [{
            model_id: 0,
            item_id: 333333,
            original_price: 30000,
            input_promotion_price: 25000,
            stock: 50,
            campaign_stock: 20,
            status: 0, // Disabled - should be skipped
          }],
        },
      ];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(2);
      
      // First item: non-variant
      expect(result[0]).toEqual({
        item_id: 111111,
        purchase_limit: 5,
        item_input_promo_price: 40000,
        item_stock: 30,
      });
      
      // Second item: variant
      expect(result[1]).toEqual({
        item_id: 222222,
        purchase_limit: 3,
        models: [
          { model_id: 333, input_promo_price: 80000, stock: 50 },
          { model_id: 444, input_promo_price: 90000, stock: 40 },
        ],
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty template items', () => {
      const result = processItemsToAdd([]);
      expect(result).toHaveLength(0);
    });

    it('should handle item with no models', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        status: 1,
        purchase_limit: 5,
        models: [],
      }];

      const result = processItemsToAdd(templateItems);
      expect(result).toHaveLength(0);
    });

    it('should handle item with undefined models', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        status: 1,
        purchase_limit: 5,
      }];

      const result = processItemsToAdd(templateItems);
      expect(result).toHaveLength(0);
    });

    it('should handle purchase_limit = 0 (no limit)', () => {
      const templateItems: FlashSaleItem[] = [{
        item_id: 123456,
        status: 1,
        purchase_limit: 0, // No limit
        models: [{
          model_id: 0,
          item_id: 123456,
          original_price: 100000,
          input_promotion_price: 80000,
          stock: 100,
          campaign_stock: 50,
          status: 1,
        }],
      }];

      const result = processItemsToAdd(templateItems);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('purchase_limit', 0);
    });
  });
});
