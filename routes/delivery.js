const express = require('express');
const { PrismaClient } = require('@prisma/client');
const StuartClient = require('../lib/stuartClient');
const MedusaClient = require('../lib/medusaClient');

const router = express.Router();
const prisma = new PrismaClient();
const stuartClient = new StuartClient();
const medusaClient = new MedusaClient();

// Delivery statuses
const DELIVERY_STATUS = {
  QUOTE_REQUESTED: 'QUOTE_REQUESTED',
  QUOTE_PROVIDED: 'QUOTE_PROVIDED',
  CONFIRMED: 'CONFIRMED',
  PICKING_UP: 'PICKING_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVING: 'ARRIVING',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  CANCELLED: 'CANCELLED'
};

/**
 * POST /delivery/quote
 * Get delivery quote from Stuart based on order details
 */
router.post('/quote', async (req, res) => {
  try {
    const { orderId, deliveryAddress, items } = req.body;

    if (!orderId || !deliveryAddress) {
      return res.status(400).json({ error: 'orderId and deliveryAddress required' });
    }

    console.log(`📄 Fetching delivery quote for order ${orderId}`);

    // Get quote from Stuart
    const quoteResponse = await stuartClient.getDeliveryQuote({
      deliveryAddress,
      items: items || []
    });

    console.log(`✅ Quote received: $${quoteResponse.price / 100} for ${quoteResponse.estimatedTime} min delivery`);

    // Save quote to database
    const quote = await prisma.deliveryQuote.create({
      data: {
        orderId,
        stuartQuoteId: quoteResponse.id,
        price: quoteResponse.price,
        estimatedTime: quoteResponse.estimatedTime,
        deliveryType: quoteResponse.type,
        expiresAt: quoteResponse.expiresAt,
        status: 'ACTIVE'
      }
    });

    res.json({
      quoteId: quote.id,
      price: quoteResponse.price,
      estimatedTime: quoteResponse.estimatedTime,
      deliveryType: quoteResponse.type,
      expiresAt: quoteResponse.expiresAt
    });
  } catch (error) {
    console.error(`❌ Failed to get delivery quote: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /delivery/orders/:orderId/confirm
 * Confirm order with delivery by accepting a quote
 */
router.post('/orders/:orderId/confirm', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { quoteId } = req.body;

    if (!quoteId) {
      return res.status(400).json({ error: 'quoteId required' });
    }

    console.log(`📅 Confirming delivery for order ${orderId} with quote ${quoteId}`);

    // Get quote
    const quote = await prisma.deliveryQuote.findUnique({
      where: { id: quoteId }
    });

    if (!quote || quote.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Quote not found or expired' });
    }

    // Get order and customer details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, items: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Create delivery job with Stuart
    console.log(`🔗 Creating Stuart delivery job for order ${orderId}`);

    const jobResponse = await stuartClient.createDeliveryJob({
      orderId,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      customerEmail: order.customer.email,
      deliveryAddress: order.deliveryAddress,
      pickupAddress: process.env.WAREHOUSE_ADDRESS,
      items: order.items.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity
      }))
    });

    console.log(`✅ Delivery job created: ${jobResponse.id}`);

    // Create delivery record in database
    const delivery = await prisma.delivery.create({
      data: {
        orderId,
        stuartJobId: jobResponse.id,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        customerEmail: order.customer.email,
        deliveryAddress: JSON.stringify(order.deliveryAddress),
        status: DELIVERY_STATUS.CONFIRMED,
        price: quote.price,
        estimatedDeliveryTime: jobResponse.scheduledDate,
        quoteId
      }
    });

    // Update quote status
    await prisma.deliveryQuote.update({
      where: { id: quoteId },
      data: { status: 'ACCEPTED' }
    });

    // Update order status to confirmed
    await prisma.order.update({
      where: { id: orderId },
      data: { 
        status: 'DELIVERY_CONFIRMED',
        deliveryId: delivery.id
      }
    });

    res.json({
      deliveryId: delivery.id,
      stuartJobId: jobResponse.id,
      status: delivery.status,
      scheduledDate: jobResponse.scheduledDate,
      message: 'Delivery confirmed'
    });
  } catch (error) {
    console.error(`❌ Error confirming delivery: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /delivery/orders/:orderId
 * Get delivery status for an order
 */
router.get('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const delivery = await prisma.delivery.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' }
    });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    // Get latest status from Stuart
    if (delivery.stuartJobId) {
      const jobStatus = await stuartClient.getJobStatus(delivery.stuartJobId);
      
      // Update delivery status if changed
      if (jobStatus.status !== delivery.status) {
        await prisma.delivery.update({
          where: { id: delivery.id },
          data: { 
            status: jobStatus.status,
            driverName: jobStatus.driver?.name,
            driverPhone: jobStatus.driver?.phone,
            lastUpdate: new Date()
          }
        });
      }

      res.json({
        ...delivery,
        stuartStatus: jobStatus
      });
    } else {
      res.json(delivery);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /delivery/:deliveryId
 * Update delivery status (typically called by Stuart webhooks)
 */
router.put('/:deliveryId', async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, driverName, driverPhone, location, eta } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status required' });
    }

    if (!Object.values(DELIVERY_STATUS).includes(status)) {
      return res.status(400).json({ error: 'Invalid delivery status' });
    }

    console.log(`📄 Updating delivery ${deliveryId} status to ${status}`);

    const delivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status,
        driverName: driverName || undefined,
        driverPhone: driverPhone || undefined,
        lastLocation: location ? JSON.stringify(location) : undefined,
        estimatedArrival: eta ? new Date(eta) : undefined,
        lastUpdate: new Date()
      },
      include: { order: { include: { customer: true } } }
    });

    // If delivered, update order status
    if (status === DELIVERY_STATUS.DELIVERED) {
      await prisma.order.update({
        where: { id: delivery.orderId },
        data: { status: 'DELIVERED' }
      });

      console.log(`🎉 Order ${delivery.orderId} delivered!`);
    }

    // If failed, notify customer
    if (status === DELIVERY_STATUS.DELIVERY_FAILED) {
      console.log(`⚠️  Delivery failed for order ${delivery.orderId}`);
      // TODO: Send customer notification
    }

    res.json(delivery);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /delivery/status/:status
 * Get all deliveries with specific status
 */
router.get('/status/:status', async (req, res) => {
  try {
    const { status } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    if (!Object.values(DELIVERY_STATUS).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const deliveries = await prisma.delivery.findMany({
      where: { status },
      take: Math.min(parseInt(limit), 100),
      skip: parseInt(offset),
      orderBy: { createdAt: 'desc' },
      include: { order: { include: { customer: true } } }
    });

    const total = await prisma.delivery.count({ where: { status } });

    res.json({
      deliveries,
      total,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /delivery/:deliveryId/cancel
 * Cancel a delivery job
 */
router.post('/:deliveryId/cancel', async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { reason } = req.body;

    console.log(`❌ Cancelling delivery ${deliveryId}`);

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    // Cancel with Stuart
    if (delivery.stuartJobId) {
      await stuartClient.cancelJob(delivery.stuartJobId);
    }

    // Update delivery status
    const cancelled = await prisma.delivery.update({
      where: { id: deliveryId },
      data: { 
        status: DELIVERY_STATUS.CANCELLED,
        cancellationReason: reason
      }
    });

    console.log(`✅ Delivery cancelled: ${deliveryId}`);

    res.json(cancelled);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /delivery/quote/active
 * Get all active delivery quotes
 */
router.get('/quote/active', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const quotes = await prisma.deliveryQuote.findMany({
      where: { status: 'ACTIVE' },
      take: Math.min(parseInt(limit), 100),
      skip: parseInt(offset),
      orderBy: { expiresAt: 'asc' }
    });

    const total = await prisma.deliveryQuote.count({ where: { status: 'ACTIVE' } });

    res.json({
      quotes,
      total,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
