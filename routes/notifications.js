const express = require('express');
const { Resend } = require('resend');
const twilio = require('twilio');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Email templates
const EMAIL_TEMPLATES = {
  orderConfirmation: {
    subject: 'Order Confirmed - Your Purchase Details',
    getHtml: (order) => `
      <h2>Order Confirmed</h2>
      <p>Thank you for your order!</p>
      <p><strong>Order ID:</strong> ${order.id}</p>
      <p><strong>Total:</strong> $${(order.total / 100).toFixed(2)}</p>
      <p><strong>Estimated Delivery:</strong> ${new Date(order.expectedDeliveryDate).toLocaleDateString()}</p>
    `
  },
  returnInitiated: {
    subject: 'Return Request Initiated',
    getHtml: (returnRequest) => `
      <h2>Return Initiated</h2>
      <p>Your return request has been submitted.</p>
      <p><strong>Return ID:</strong> ${returnRequest.id}</p>
      <p><strong>Reason:</strong> ${returnRequest.reason}</p>
      <p>We will send pickup instructions within 24 hours.</p>
    `
  },
  returnApproved: {
    subject: 'Return Approved - Pickup Scheduled',
    getHtml: (returnRequest) => `
      <h2>Return Approved</h2>
      <p>Your return has been approved!</p>
      <p><strong>Pickup Date:</strong> ${returnRequest.pickupDate}</p>
      <p><strong>Tracking Number:</strong> ${returnRequest.stuartJobId}</p>
      <p>A driver will collect your package on the scheduled date.</p>
    `
  },
  deliveryUpdate: {
    subject: 'Delivery Update',
    getHtml: (delivery) => `
      <h2>Delivery Status Update</h2>
      <p><strong>Status:</strong> ${delivery.status}</p>
      <p><strong>Estimated Arrival:</strong> ${delivery.estimatedArrival}</p>
      <p><strong>Driver:</strong> ${delivery.driverName}</p>
      <p><strong>Contact:</strong> ${delivery.driverPhone}</p>
    `
  },
  refundProcessed: {
    subject: 'Refund Processed',
    getHtml: (refund) => `
      <h2>Refund Processed</h2>
      <p>Your refund has been successfully processed.</p>
      <p><strong>Amount:</strong> $${(refund.amount / 100).toFixed(2)}</p>
      <p><strong>Expected in Account:</strong> 3-5 business days</p>
    `
  }
};

/**
 * Send email notification via Resend
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {string} params.templateType - Template type (orderConfirmation, returnInitiated, etc)
 * @param {Object} params.data - Data for template rendering
 */
async function sendEmail({ to, templateType, data }) {
  try {
    const template = EMAIL_TEMPLATES[templateType];
    if (!template) {
      throw new Error(`Unknown email template: ${templateType}`);
    }

    console.log(`📧 Sending ${templateType} email to ${to}`);

    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject: template.subject,
      html: template.getHtml(data)
    });

    console.log(`✅ Email sent successfully: ${response.id}`);

    // Log notification
    await prisma.notification.create({
      data: {
        type: 'EMAIL',
        templateType,
        recipient: to,
        status: 'SENT',
        externalId: response.id,
        metadata: { templateData: data }
      }
    });

    return response;
  } catch (error) {
    console.error(`❌ Failed to send email: ${error.message}`);
    
    // Log failed notification
    await prisma.notification.create({
      data: {
        type: 'EMAIL',
        templateType,
        recipient: to,
        status: 'FAILED',
        error: error.message,
        metadata: { templateData: data }
      }
    });

    throw error;
  }
}

/**
 * Send SMS notification via Twilio
 * @param {Object} params - SMS parameters
 * @param {string} params.phone - Recipient phone number
 * @param {string} params.message - SMS message body
 * @param {string} params.type - Notification type for tracking
 */
async function sendSMS({ phone, message, type }) {
  try {
    if (!phone || !message) {
      throw new Error('Phone and message are required');
    }

    console.log(`📱 Sending SMS to ${phone}`);

    const response = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });

    console.log(`✅ SMS sent successfully: ${response.sid}`);

    // Log notification
    await prisma.notification.create({
      data: {
        type: 'SMS',
        templateType: type,
        recipient: phone,
        status: 'SENT',
        externalId: response.sid,
        metadata: { message }
      }
    });

    return response;
  } catch (error) {
    console.error(`❌ Failed to send SMS: ${error.message}`);
    
    // Log failed notification
    await prisma.notification.create({
      data: {
        type: 'SMS',
        templateType: type,
        recipient: phone,
        status: 'FAILED',
        error: error.message,
        metadata: { message }
      }
    });

    throw error;
  }
}

// POST /notifications/send-order-confirmation
router.post('/send-order-confirmation', async (req, res) => {
  try {
    const { orderId, email, phone } = req.body;

    if (!orderId || !email) {
      return res.status(400).json({ error: 'orderId and email required' });
    }

    // Fetch order details from database
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Send email
    await sendEmail({
      to: email,
      templateType: 'orderConfirmation',
      data: order
    });

    // Send SMS if phone provided
    if (phone) {
      await sendSMS({
        phone,
        message: `Your order #${order.id} has been confirmed. Total: $${(order.total / 100).toFixed(2)}. Expected delivery: ${new Date(order.expectedDeliveryDate).toLocaleDateString()}`,
        type: 'orderConfirmation'
      });
    }

    res.json({ success: true, message: 'Order confirmation sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// POST /notifications/send-return-initiated
router.post('/send-return-initiated', async (req, res) => {
  try {
    const { returnId, email, phone } = req.body;

    if (!returnId || !email) {
      return res.status(400).json({ error: 'returnId and email required' });
    }

    const returnRequest = await prisma.return.findUnique({
      where: { id: returnId },
      include: { order: true }
    });

    if (!returnRequest) {
      return res.status(404).json({ error: 'Return not found' });
    }

    await sendEmail({
      to: email,
      templateType: 'returnInitiated',
      data: returnRequest
    });

    if (phone) {
      await sendSMS({
        phone,
        message: `Return request #${returnRequest.id} received for order #${returnRequest.orderId}. Reason: ${returnRequest.reason}. We'll contact you with pickup details.`,
        type: 'returnInitiated'
      });
    }

    res.json({ success: true, message: 'Return notification sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// POST /notifications/send-delivery-update
router.post('/send-delivery-update', async (req, res) => {
  try {
    const { deliveryId, email, phone } = req.body;

    if (!deliveryId) {
      return res.status(400).json({ error: 'deliveryId required' });
    }

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: { include: { customer: true } } }
    });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const recipientEmail = email || delivery.order.customer.email;
    const recipientPhone = phone || delivery.order.customer.phone;

    if (recipientEmail) {
      await sendEmail({
        to: recipientEmail,
        templateType: 'deliveryUpdate',
        data: delivery
      });
    }

    if (recipientPhone) {
      await sendSMS({
        phone: recipientPhone,
        message: `Your delivery is ${delivery.status.toLowerCase()}. ETA: ${delivery.estimatedArrival}. Driver: ${delivery.driverName}`,
        type: 'deliveryUpdate'
      });
    }

    res.json({ success: true, message: 'Delivery update sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// POST /notifications/send-refund-processed
router.post('/send-refund-processed', async (req, res) => {
  try {
    const { refundId, email, phone } = req.body;

    if (!refundId || !email) {
      return res.status(400).json({ error: 'refundId and email required' });
    }

    const refund = await prisma.refund.findUnique({
      where: { id: refundId }
    });

    if (!refund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    await sendEmail({
      to: email,
      templateType: 'refundProcessed',
      data: refund
    });

    if (phone) {
      await sendSMS({
        phone,
        message: `Refund of $${(refund.amount / 100).toFixed(2)} has been processed. It will appear in your account within 3-5 business days.`,
        type: 'refundProcessed'
      });
    }

    res.json({ success: true, message: 'Refund notification sent' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /notifications/status/:id
router.get('/status/:id', async (req, res) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(notification);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /notifications/logs?limit=50&offset=0
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const notifications = await prisma.notification.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' }
    });

    const total = await prisma.notification.count();

    res.json({
      notifications,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
