const express = require('express');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /sync-products/:storeId
 * Sync products from Shopify to Medusa
 */
router.post('/sync-products/:storeId', async (req, res) => {
  const { storeId } = req.params;
  
  try {
    // Get store configuration from database
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: {
        shopifyConfig: true,
        medusaConfig: true
      }
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    if (!store.shopifyConfig || !store.medusaConfig) {
      return res.status(400).json({ error: 'Store configuration incomplete' });
    }

    // Fetch products from Shopify
    const shopifyProducts = await fetchShopifyProducts(store.shopifyConfig);
    
    if (!shopifyProducts || shopifyProducts.length === 0) {
      return res.status(200).json({ 
        message: 'No products found in Shopify store',
        synced: 0
      });
    }

    let syncedCount = 0;
    const errors = [];

    // Process each product
    for (const shopifyProduct of shopifyProducts) {
      try {
        // Transform Shopify product to Medusa format
        const medusaProduct = transformProductToMedusa(shopifyProduct);
        
        // Sync to Medusa
        const syncedProduct = await syncProductToMedusa(medusaProduct, store.medusaConfig);
        
        // Save mapping in database
        await saveProductMapping({
          storeId: store.id,
          shopifyProductId: shopifyProduct.id.toString(),
          medusaProductId: syncedProduct.id,
          shopifyHandle: shopifyProduct.handle,
          medusaHandle: syncedProduct.handle,
          lastSyncedAt: new Date()
        });

        syncedCount++;
      } catch (error) {
        console.error(`Error syncing product ${shopifyProduct.id}:`, error);
        errors.push({
          shopifyProductId: shopifyProduct.id,
          error: error.message
        });
      }
    }

    res.status(200).json({
      message: `Successfully synced ${syncedCount} products`,
      synced: syncedCount,
      total: shopifyProducts.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error in product sync:', error);
    res.status(500).json({ error: 'Internal server error during product sync' });
  }
});

/**
 * Fetch products from Shopify using REST API
 */
async function fetchShopifyProducts(shopifyConfig) {
  const { shopUrl, accessToken } = shopifyConfig;
  
  try {
    const response = await axios.get(`https://${shopUrl}/admin/api/2023-10/products.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 250, // Maximum allowed by Shopify
        status: 'active'
      }
    });

    return response.data.products;
  } catch (error) {
    console.error('Error fetching Shopify products:', error.response?.data || error.message);
    throw new Error('Failed to fetch products from Shopify');
  }
}

/**
 * Transform Shopify product format to Medusa product format
 */
function transformProductToMedusa(shopifyProduct) {
  return {
    title: shopifyProduct.title,
    handle: shopifyProduct.handle,
    description: shopifyProduct.body_html,
    status: shopifyProduct.status === 'active' ? 'published' : 'draft',
    thumbnail: shopifyProduct.image?.src || null,
    images: shopifyProduct.images?.map(img => ({ url: img.src })) || [],
    options: shopifyProduct.options?.map(option => ({
      title: option.name,
      values: option.values
    })) || [],
    variants: shopifyProduct.variants?.map(variant => ({
      title: variant.title,
      sku: variant.sku,
      ean: variant.barcode,
      upc: variant.barcode,
      barcode: variant.barcode,
      inventory_quantity: variant.inventory_quantity,
      manage_inventory: variant.inventory_management === 'shopify',
      allow_backorder: variant.inventory_policy === 'continue',
      weight: variant.weight,
      length: null,
      height: null,
      width: null,
      hs_code: null,
      origin_country: null,
      mid_code: null,
      material: null,
      prices: [{
        currency_code: 'USD', // Default currency, should be configurable
        amount: Math.round(parseFloat(variant.price) * 100) // Convert to cents
      }],
      options: variant.option1 || variant.option2 || variant.option3 ? [
        variant.option1 && { value: variant.option1 },
        variant.option2 && { value: variant.option2 },
        variant.option3 && { value: variant.option3 }
      ].filter(Boolean) : []
    })) || [],
    tags: shopifyProduct.tags ? shopifyProduct.tags.split(', ').map(tag => ({ value: tag })) : [],
    type: shopifyProduct.product_type ? { value: shopifyProduct.product_type } : null,
    vendor: shopifyProduct.vendor,
    metadata: {
      shopify_id: shopifyProduct.id.toString(),
      shopify_created_at: shopifyProduct.created_at,
      shopify_updated_at: shopifyProduct.updated_at
    }
  };
}

/**
 * Sync product to Medusa via REST API
 */
async function syncProductToMedusa(medusaProduct, medusaConfig) {
  const { apiUrl, apiKey } = medusaConfig;
  
  try {
    // Check if product already exists by handle
    const existingResponse = await axios.get(`${apiUrl}/admin/products`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      params: {
        handle: medusaProduct.handle
      }
    });

    if (existingResponse.data.products && existingResponse.data.products.length > 0) {
      // Update existing product
      const existingProduct = existingResponse.data.products[0];
      const updateResponse = await axios.post(`${apiUrl}/admin/products/${existingProduct.id}`, {
        ...medusaProduct,
        id: existingProduct.id
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return updateResponse.data.product;
    } else {
      // Create new product
      const createResponse = await axios.post(`${apiUrl}/admin/products`, medusaProduct, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return createResponse.data.product;
    }
  } catch (error) {
    console.error('Error syncing to Medusa:', error.response?.data || error.message);
    throw new Error('Failed to sync product to Medusa');
  }
}

/**
 * Save product mapping in PostgreSQL database using Prisma
 */
async function saveProductMapping(mappingData) {
  try {
    const mapping = await prisma.productMapping.upsert({
      where: {
        storeId_shopifyProductId: {
          storeId: mappingData.storeId,
          shopifyProductId: mappingData.shopifyProductId
        }
      },
      update: {
        medusaProductId: mappingData.medusaProductId,
        medusaHandle: mappingData.medusaHandle,
        lastSyncedAt: mappingData.lastSyncedAt
      },
      create: mappingData
    });
    return mapping;
  } catch (error) {
    console.error('Error saving product mapping:', error);
    throw new Error('Failed to save product mapping');
  }
}

module.exports = router;
