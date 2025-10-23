const express = require('express');
const router = express.Router();
const axios = require('axios');

// Webhook handler for Shopify events
router.post('/shopify', async (req, res) => {
  try {
    const topic = req.headers['x-shopify-topic'];
    const shopDomain = req.headers['x-shopify-shop-domain'];
    const webhookData = req.body;

    console.log(`[Webhook] Received ${topic} event from ${shopDomain}`);
    console.log('[Webhook] Payload:', JSON.stringify(webhookData, null, 2));

    // Respond quickly to Shopify
    res.status(200).send('Webhook received');

    // Process webhook based on topic
    switch (topic) {
      case 'products/create':
        await handleProductCreate(webhookData, shopDomain);
        break;
      case 'products/update':
        await handleProductUpdate(webhookData, shopDomain);
        break;
      case 'products/delete':
        await handleProductDelete(webhookData, shopDomain);
        break;
      case 'inventory_levels/update':
        await handleInventoryUpdate(webhookData, shopDomain);
        break;
      default:
        console.log(`[Webhook] Unhandled topic: ${topic}`);
    }
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error.message);
    console.error('[Webhook] Stack trace:', error.stack);
    // Still return 200 to prevent Shopify from retrying
    if (!res.headersSent) {
      res.status(200).send('Webhook received with errors');
    }
  }
});

// Handler for product create
async function handleProductCreate(product, shopDomain) {
  try {
    console.log(`[Webhook] Processing product create: ${product.id} - ${product.title}`);
    
    // Look up existing product in Medusa
    const existingProduct = await lookupMedusaProduct(product.id);
    
    if (existingProduct) {
      console.log(`[Webhook] Product ${product.id} already exists in Medusa, updating instead`);
      await upsertMedusaProduct(product, existingProduct.id);
    } else {
      console.log(`[Webhook] Creating new product in Medusa`);
      await upsertMedusaProduct(product, null);
    }
    
    console.log(`[Webhook] Successfully processed product create for ${product.id}`);
  } catch (error) {
    console.error(`[Webhook] Error handling product create:`, error.message);
    console.error('[Webhook] Error details:', error.stack);
    throw error;
  }
}

// Handler for product update
async function handleProductUpdate(product, shopDomain) {
  try {
    console.log(`[Webhook] Processing product update: ${product.id} - ${product.title}`);
    
    // Look up existing product in Medusa
    const existingProduct = await lookupMedusaProduct(product.id);
    
    if (existingProduct) {
      console.log(`[Webhook] Updating existing product ${existingProduct.id} in Medusa`);
      await upsertMedusaProduct(product, existingProduct.id);
    } else {
      console.log(`[Webhook] Product not found in Medusa, creating new product`);
      await upsertMedusaProduct(product, null);
    }
    
    console.log(`[Webhook] Successfully processed product update for ${product.id}`);
  } catch (error) {
    console.error(`[Webhook] Error handling product update:`, error.message);
    console.error('[Webhook] Error details:', error.stack);
    throw error;
  }
}

// Handler for product delete
async function handleProductDelete(product, shopDomain) {
  try {
    console.log(`[Webhook] Processing product delete: ${product.id}`);
    
    // Look up existing product in Medusa
    const existingProduct = await lookupMedusaProduct(product.id);
    
    if (existingProduct) {
      console.log(`[Webhook] Deleting product ${existingProduct.id} from Medusa`);
      await deleteMedusaProduct(existingProduct.id);
      console.log(`[Webhook] Successfully deleted product ${product.id}`);
    } else {
      console.log(`[Webhook] Product ${product.id} not found in Medusa, nothing to delete`);
    }
  } catch (error) {
    console.error(`[Webhook] Error handling product delete:`, error.message);
    console.error('[Webhook] Error details:', error.stack);
    throw error;
  }
}

// Handler for inventory update
async function handleInventoryUpdate(inventoryLevel, shopDomain) {
  try {
    console.log(`[Webhook] Processing inventory update for inventory item: ${inventoryLevel.inventory_item_id}`);
    console.log(`[Webhook] New available quantity: ${inventoryLevel.available}`);
    
    // Look up product by inventory item ID
    const product = await lookupProductByInventoryItem(inventoryLevel.inventory_item_id);
    
    if (product) {
      console.log(`[Webhook] Updating inventory for product ${product.id}`);
      await updateMedusaInventory(product.id, inventoryLevel.available);
      console.log(`[Webhook] Successfully updated inventory`);
    } else {
      console.log(`[Webhook] Product not found for inventory item ${inventoryLevel.inventory_item_id}`);
    }
  } catch (error) {
    console.error(`[Webhook] Error handling inventory update:`, error.message);
    console.error('[Webhook] Error details:', error.stack);
    throw error;
  }
}

// Lookup product in Medusa by Shopify ID
async function lookupMedusaProduct(shopifyProductId) {
  try {
    const medusaUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
    const response = await axios.get(`${medusaUrl}/admin/products`, {
      headers: {
        'Authorization': `Bearer ${process.env.MEDUSA_ADMIN_TOKEN}`
      },
      params: {
        external_id: shopifyProductId
      }
    });
    
    if (response.data && response.data.products && response.data.products.length > 0) {
      return response.data.products[0];
    }
    
    return null;
  } catch (error) {
    console.error(`[Webhook] Error looking up product in Medusa:`, error.message);
    if (error.response) {
      console.error('[Webhook] Response data:', error.response.data);
    }
    throw error;
  }
}

// Lookup product by inventory item ID
async function lookupProductByInventoryItem(inventoryItemId) {
  try {
    // This would need to query Shopify or a local database to map inventory item to product
    // For now, returning null as placeholder
    console.log(`[Webhook] Inventory item lookup not yet implemented for ${inventoryItemId}`);
    return null;
  } catch (error) {
    console.error(`[Webhook] Error looking up product by inventory item:`, error.message);
    throw error;
  }
}

// Upsert product in Medusa
async function upsertMedusaProduct(shopifyProduct, medusaProductId) {
  try {
    const medusaUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
    
    const productData = {
      title: shopifyProduct.title,
      description: shopifyProduct.body_html,
      handle: shopifyProduct.handle,
      external_id: String(shopifyProduct.id),
      status: shopifyProduct.status === 'active' ? 'published' : 'draft',
      metadata: {
        shopify_id: shopifyProduct.id,
        vendor: shopifyProduct.vendor,
        product_type: shopifyProduct.product_type,
        tags: shopifyProduct.tags
      }
    };
    
    let response;
    if (medusaProductId) {
      // Update existing product
      console.log(`[Webhook] Updating Medusa product ${medusaProductId}`);
      response = await axios.post(
        `${medusaUrl}/admin/products/${medusaProductId}`,
        productData,
        {
          headers: {
            'Authorization': `Bearer ${process.env.MEDUSA_ADMIN_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } else {
      // Create new product
      console.log(`[Webhook] Creating new Medusa product`);
      response = await axios.post(
        `${medusaUrl}/admin/products`,
        productData,
        {
          headers: {
            'Authorization': `Bearer ${process.env.MEDUSA_ADMIN_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }
    
    console.log(`[Webhook] Product upserted successfully:`, response.data.product?.id);
    return response.data.product;
  } catch (error) {
    console.error(`[Webhook] Error upserting product in Medusa:`, error.message);
    if (error.response) {
      console.error('[Webhook] Response status:', error.response.status);
      console.error('[Webhook] Response data:', error.response.data);
    }
    throw error;
  }
}

// Delete product from Medusa
async function deleteMedusaProduct(medusaProductId) {
  try {
    const medusaUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
    
    console.log(`[Webhook] Deleting Medusa product ${medusaProductId}`);
    const response = await axios.delete(
      `${medusaUrl}/admin/products/${medusaProductId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.MEDUSA_ADMIN_TOKEN}`
        }
      }
    );
    
    console.log(`[Webhook] Product deleted successfully`);
    return response.data;
  } catch (error) {
    console.error(`[Webhook] Error deleting product from Medusa:`, error.message);
    if (error.response) {
      console.error('[Webhook] Response status:', error.response.status);
      console.error('[Webhook] Response data:', error.response.data);
    }
    throw error;
  }
}

// Update inventory in Medusa
async function updateMedusaInventory(medusaProductId, quantity) {
  try {
    const medusaUrl = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';
    
    console.log(`[Webhook] Updating inventory for product ${medusaProductId} to ${quantity}`);
    const response = await axios.post(
      `${medusaUrl}/admin/products/${medusaProductId}/variants`,
      {
        inventory_quantity: quantity
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.MEDUSA_ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[Webhook] Inventory updated successfully`);
    return response.data;
  } catch (error) {
    console.error(`[Webhook] Error updating inventory in Medusa:`, error.message);
    if (error.response) {
      console.error('[Webhook] Response status:', error.response.status);
      console.error('[Webhook] Response data:', error.response.data);
    }
    throw error;
  }
}

module.exports = router;
