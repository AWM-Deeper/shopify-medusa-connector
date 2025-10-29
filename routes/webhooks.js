// routes/webhooks.js
// Handle webhooks from Shopify, Medusa, and Stuart

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Verify Shopify webhook signature
function verifyShopifyWebhook(req, secret) {
  const hmacHeader = req.get('X-Shopify-Hmac-SHA256');
  if (!hmacHeader) return false;
  
  const body = req.rawBody; // Must be raw body, not parsed
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  
  return hmac === hmacHeader;
}

// Log webhook event
async function logWebhook(source, event, payload, processed = false, error = null) {
  try {
    await prisma.webhookLog.create({
      data: {
        source,
        event,
        payload: JSON.stringify(payload),
        processed,
        error
      }
    });
  } catch (err) {
    console.error('Failed to log webhook:', err.message);
  }
}

// Shopify Webhooks
export async function handleShopifyProductCreate(req, res) {
  console.log('📦 Shopify product created webhook');
  
  const { shop, body } = req;
  const product = body;
  
  try {
    await logWebhook('shopify', 'product/create', product);
    
    // Trigger product sync
    console.log(`🔄 Queuing sync for new product: ${product.title}`);
    
    // TODO: Queue product sync job
    // await queueSyncJob(shop, 'product', product.id);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    await logWebhook('shopify', 'product/create', product, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

export async function handleShopifyProductUpdate(req, res) {
  console.log('🔄 Shopify product updated webhook');
  
  const { shop, body } = req;
  const product = body;
  
  try {
    await logWebhook('shopify', 'product/update', product);
    
    // Queue product update
    console.log(`🔄 Queuing update for product: ${product.title}`);
    
    // TODO: Queue product update job
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    await logWebhook('shopify', 'product/update', product, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

export async function handleShopifyInventoryUpdate(req, res) {
  console.log('📄 Shopify inventory levels updated webhook');
  
  const { shop, body } = req;
  const inventoryLevel = body;
  
  try {
    await logWebhook('shopify', 'inventory_levels/update', inventoryLevel);
    
    console.log(`🔄 Updating inventory for SKU: ${inventoryLevel.sku}`);
    
    // TODO: Update product variant inventory in Medusa
    // await updateMedusaInventory(inventoryLevel);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    await logWebhook('shopify', 'inventory_levels/update', inventoryLevel, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

export async function handleShopifyOrderCreate(req, res) {
  console.log('📑 Shopify order created webhook');
  
  const { shop, body } = req;
  const order = body;
  
  try {
    await logWebhook('shopify', 'orders/create', order);
    
    console.log(`📑 New order from Shopify: ${order.name}`);
    
    // TODO: Create order in Medusa if fulfilling via this platform
    // await createMedusaOrder(shop, order);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    await logWebhook('shopify', 'orders/create', order, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

// Stuart Webhooks (Delivery Events)
export async function handleStuartWebhook(req, res) {
  console.log('🚘 Stuart delivery webhook received');
  
  const { body } = req;
  const { job_id, status, event_type } = body;
  
  try {
    await logWebhook('stuart', `job/${event_type}`, body);
    
    // Find the Stuart job mapping
    const stuartJob = await prisma.stuartJob.findUnique({
      where: { stuartJobId: job_id }
    });
    
    if (!stuartJob) {
      console.warn(`⚠️ Stuart job not found: ${job_id}`);
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Update job status
    await prisma.stuartJob.update({
      where: { id: stuartJob.id },
      data: {
        status,
        rawData: JSON.stringify(body)
      }
    });
    
    console.log(`✅ Updated Stuart job ${job_id} to status: ${status}`);
    
    // Update related orders/returns based on status
    if (event_type === 'delivered') {
      console.log(`🚦 Delivery completed for job ${job_id}`);
      
      // Update order delivery status
      await prisma.order.updateMany({
        where: { stuartJobId: stuartJob.id },
        data: { deliveryStatus: 'DELIVERED' }
      });
      
      // Update return delivery status
      await prisma.return.updateMany({
        where: { stuartPickupJobId: stuartJob.id },
        data: { deliveredAt: new Date() }
      });
      
      // TODO: Send notifications
      // await notifyCustomers(stuartJob);
    }
    
    await logWebhook('stuart', `job/${event_type}`, body, true);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Stuart webhook error:', error.message);
    await logWebhook('stuart', 'job/error', body, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

// Medusa Webhooks
export async function handleMedusaOrderCreated(req, res) {
  console.log('📑 Medusa order created webhook');
  
  const { body } = req;
  const { id: orderId, customer, items } = body;
  
  try {
    await logWebhook('medusa', 'order.created', body);
    
    console.log(`📑 New Medusa order: ${orderId} from ${customer.email}`);
    
    // TODO: Store order reference
    // TODO: Check if order needs fulfillment via Stuart
    // TODO: Calculate delivery quote
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    await logWebhook('medusa', 'order.created', body, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

export async function handleMedusaOrderCompleted(req, res) {
  console.log('✅ Medusa order completed webhook');
  
  const { body } = req;
  const { id: orderId } = body;
  
  try {
    await logWebhook('medusa', 'order.completed', body);
    
    console.log(`✅ Order completed: ${orderId}`);
    
    // TODO: Update order status in database
    // TODO: Confirm delivery with Stuart if applicable
    // TODO: Send notifications
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    await logWebhook('medusa', 'order.completed', body, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

// Webhook registration helper
export async function setupWebhooks(shop, shopify) {
  console.log(`📁 Setting up webhooks for shop: ${shop}`);
  
  const webhookTopics = [
    { topic: 'PRODUCTS_CREATE', path: '/webhooks/shopify/products/create' },
    { topic: 'PRODUCTS_UPDATE', path: '/webhooks/shopify/products/update' },
    { topic: 'INVENTORY_LEVELS_UPDATE', path: '/webhooks/shopify/inventory/update' },
    { topic: 'ORDERS_CREATE', path: '/webhooks/shopify/orders/create' }
  ];
  
  try {
    for (const webhook of webhookTopics) {
      const response = await shopify.clients.graphqlProxy({ shop }).query({
        data: `mutation {
          webhookSubscriptionCreate(
            topic: ${webhook.topic}
            webhookSubscription: {
              format: JSON
              address: "${process.env.HOST}${webhook.path}"
            }
          ) {
            userErrors { field message }
            webhookSubscription { id }
          }
        }`
      });
      
      if (response.body.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
        console.error(`❌ Failed to create ${webhook.topic}:`, response.body.data.webhookSubscriptionCreate.userErrors);
      } else {
        console.log(`✅ Created webhook for ${webhook.topic}`);
      }
    }
  } catch (error) {
    console.error('Failed to setup webhooks:', error.message);
    throw error;
  }
}

export default {
  handleShopifyProductCreate,
  handleShopifyProductUpdate,
  handleShopifyInventoryUpdate,
  handleShopifyOrderCreate,
  handleStuartWebhook,
  handleMedusaOrderCreated,
  handleMedusaOrderCompleted,
  setupWebhooks
};
