const express = require('express');
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
const StuartClient = require('../lib/stuartClient');
const notificationsRouter = require('./notifications');

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const stuartClient = new StuartClient();

// Return statuses
const RETURN_STATUS = {
  INITIATED: 'INITIATED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PICKUP_SCHEDULED: 'PICKUP_SCHEDULED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED'
};

/**
 * POST /returns/initiate
 * Customer initiates a return request
 */
router.post('/initiate', async (req, res) => {
  try {
    const { orderId, reason, itemIds, comments } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    console.log(`📦 Initiating return for order ${orderId}`);

    // Verify order exists and belongs to customer
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, items: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if return is eligible (within 30 days)
    const daysSinceOrder = Math.floor((Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceOrder > 30) {
      return res.status(400).json({ error: 'Return window expired (30 days)' });
    }

    // Create return request
    const returnRequest = await prisma.return.create({
      data: {
        orderId,
        customerId: order.customerId,
        reason,
        itemIds: itemIds || order.items.map(i => i.id),
        comments,
        status: RETURN_STATUS.INITIATED,
        returnAmount: order.total // Will be updated after approval
      }
    });

    console.log(`✅ Return initiated: ${returnRequest.id}`);

    // Send notification to customer
    try {
      await notificationsRouter.post('/send-return-initiated', {
        body: {
          returnId: returnRequest.id,
          email: order.customer.email,
          phone: order.customer.phone
        }
      });
    } catch (error) {
      console.error(`⚠️  Failed to send return notification: ${error.message}`);
    }

    // Notify merchant of new return
    await prisma.merchantNotification.create({
      data: {
        type: 'RETURN_INITIATED',
        title: `New Return: ${returnRequest.id}`,
        message: `Customer initiated return for order ${orderId}. Reason: ${reason}`,
        relatedId: returnRequest.id,
        status: 'UNREAD'
      }
    });

    res.status(201).json({
      id: returnRequest.id,
      status: returnRequest.status,
      message: 'Return request created successfully'
    });
  } catch (error) {
    console.error(`❌ Error initiating return: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /returns/:id
 * Retrieve return request details
 */
router.get('/:id', async (req, res) => {
  try {
    const returnRequest = await prisma.return.findUnique({
      where: { id: req.params.id },
      include: {
        order: { include: { customer: true } },
        pickupJob: true
      }
    });

    if (!returnRequest) {
      return res.status(404).json({ error: 'Return not found' });
    }

    res.json(returnRequest);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /returns/:id/approve
 * Merchant approves the return
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const { returnAmount } = req.body;
    const returnId = req.params.id;

    console.log(`✅ Approving return: ${returnId}`);

    const returnRequest = await prisma.return.findUnique({
      where: { id: returnId },
      include: { order: { include: { customer: true } } }
    });

    if (!returnRequest) {
      return res.status(404).json({ error: 'Return not found' });
    }

    // Update return status
    const approvedReturn = await prisma.return.update({
      where: { id: returnId },
      data: {
        status: RETURN_STATUS.APPROVED,
        approvedAt: new Date(),
        returnAmount: returnAmount || returnRequest.order.total
      }
    });

    // Schedule pickup with Stuart
    console.log(`📍 Scheduling Stuart pickup for return ${returnId}`);
    
    const pickupResponse = await stuartClient.createReturnPickupJob({
      orderId: returnRequest.orderId,
      pickupAddress: returnRequest.order.customer.address,
      items: returnRequest.itemIds
    });

    // Save Stuart job reference
    await prisma.return.update({
      where: { id: returnId },
      data: {
        stuartJobId: pickupResponse.id,
        status: RETURN_STATUS.PICKUP_SCHEDULED,
        pickupDate: pickupResponse.scheduledDate
      }
    });

    console.log(`✅ Pickup scheduled: ${pickupResponse.id}`);

    // Send notification to customer
    try {
      await notificationsRouter.post('/send-return-approved', {
        body: {
          returnId,
          email: returnRequest.order.customer.email,
          phone: returnRequest.order.customer.phone
        }
      });
    } catch (error) {
      console.error(`⚠️  Failed to send approval notification: ${error.message}`);
    }

    res.json({
      ...approvedReturn,
      pickupJob: pickupResponse
    });
  } catch (error) {
    console.error(`❌ Error approving return: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /returns/:id/reject
 * Merchant rejects the return
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;

    console.log(`❌ Rejecting return: ${req.params.id}`);

    const returnRequest = await prisma.return.update({
      where: { id: req.params.id },
      data: {
        status: RETURN_STATUS.REJECTED,
        rejectionReason: reason,
        rejectedAt: new Date()
      },
      include: { order: { include: { customer: true } } }
    });

    // Notify customer
    try {
      await notificationsRouter.post('/send-return-rejected', {
        body: {
          returnId: req.params.id,
          email: returnRequest.order.customer.email,
          reason
        }
      });
    } catch (error) {
      console.error(`⚠️  Failed to send rejection notification: ${error.message}`);
    }

    res.json(returnRequest);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /returns/:id/process-refund
 * Process refund to customer's original payment method
 */
router.post('/:id/process-refund', async (req, res) => {
  try {
    const returnId = req.params.id;

    console.log(`💳 Processing refund for return ${returnId}`);

    const returnRequest = await prisma.return.findUnique({
      where: { id: returnId },
      include: { order: true }
    });

    if (!returnRequest) {
      return res.status(404).json({ error: 'Return not found' });
    }

    if (returnRequest.status !== RETURN_STATUS.RECEIVED) {
      return res.status(400).json({ error: 'Return must be received before processing refund' });
    }

    // Create refund via Stripe
    const refund = await stripe.refunds.create({
      payment_intent: returnRequest.order.stripePaymentIntentId,
      amount: returnRequest.returnAmount
    });

    console.log(`✅ Refund processed: ${refund.id}`);

    // Update return status
    const refundedReturn = await prisma.return.update({
      where: { id: returnId },
      data: {
        status: RETURN_STATUS.REFUNDED,
        refundedAt: new Date(),
        stripeRefundId: refund.id
      }
    });

    // Create refund record
    await prisma.refund.create({
      data: {
        returnId,
        orderId: returnRequest.orderId,
        amount: returnRequest.returnAmount,
        stripeRefundId: refund.id,
        status: 'PROCESSED'
      }
    });

    // Send refund notification
    try {
      const order = await prisma.order.findUnique({
        where: { id: returnRequest.orderId },
        include: { customer: true }
      });
      
      await notificationsRouter.post('/send-refund-processed', {
        body: {
          refundId: refund.id,
          email: order.customer.email,
          phone: order.customer.phone
        }
      });
    } catch (error) {
      console.error(`⚠️  Failed to send refund notification: ${error.message}`);
    }

    res.json(refundedReturn);
  } catch (error) {
    console.error(`❌ Error processing refund: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /returns/status/:status
 * Get all returns with specific status
 */
router.get('/status/:status', async (req, res) => {
  try {
    const { status } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    if (!Object.values(RETURN_STATUS).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const returns = await prisma.return.findMany({
      where: { status },
      take: Math.min(parseInt(limit), 100),
      skip: parseInt(offset),
      orderBy: { createdAt: 'desc' },
      include: { order: { include: { customer: true } } }
    });

    const total = await prisma.return.count({ where: { status } });

    res.json({
      returns,
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
 * PATCH /returns/:id/status
 * Update return status (used by webhooks from Stuart)
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const returnId = req.params.id;

    if (!Object.values(RETURN_STATUS).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    console.log(`🔄 Updating return ${returnId} status to ${status}`);

    const updatedReturn = await prisma.return.update({
      where: { id: returnId },
      data: { status }
    });

    res.json(updatedReturn);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
