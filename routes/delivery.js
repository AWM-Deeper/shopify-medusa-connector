const express = require('express');
const router = express.Router();
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Stuart API configuration
const STUART_API_URL = process.env.STUART_API_URL || 'https://api.stuart.com';
const STUART_API_KEY = process.env.STUART_API_KEY;
const STUART_CLIENT_ID = process.env.STUART_CLIENT_ID;
const STUART_CLIENT_SECRET = process.env.STUART_CLIENT_SECRET;

// Helper function to get Stuart access token
const getStuartToken = async () => {
  try {
    const response = await axios.post(`${STUART_API_URL}/oauth/token`, {
      client_id: STUART_CLIENT_ID,
      client_secret: STUART_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'api'
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting Stuart token:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Stuart API');
  }
};

// POST /delivery/quote - Fetch delivery quote from Stuart
router.post('/quote', async (req, res) => {
  try {
    const { pickup_address, dropoff_address, package_size } = req.body;

    if (!pickup_address || !dropoff_address) {
      return res.status(400).json({ error: 'Pickup and dropoff addresses are required' });
    }

    const token = await getStuartToken();

    const quoteData = {
      job: {
        pickups: [{
          address: pickup_address,
          comment: 'Store pickup'
        }],
        dropoffs: [{
          address: dropoff_address,
          package_type: package_size || 'small',
          comment: 'Customer delivery'
        }]
      }
    };

    const response = await axios.post(
      `${STUART_API_URL}/v2/jobs/validate`,
      quoteData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      quote: response.data
    });
  } catch (error) {
    console.error('Error fetching delivery quote:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch delivery quote',
      details: error.response?.data || error.message
    });
  }
});

// POST /delivery/webhook - Create delivery job on order webhook
router.post('/webhook', async (req, res) => {
  try {
    const { order_id, pickup_address, dropoff_address, package_size, customer_phone } = req.body;

    if (!order_id || !pickup_address || !dropoff_address) {
      return res.status(400).json({ error: 'Order ID, pickup and dropoff addresses are required' });
    }

    const token = await getStuartToken();

    const jobData = {
      job: {
        pickups: [{
          address: pickup_address,
          comment: `Order #${order_id}`,
          contact: {
            phone: process.env.STORE_PHONE || '+1234567890'
          }
        }],
        dropoffs: [{
          address: dropoff_address,
          package_type: package_size || 'small',
          comment: `Delivery for Order #${order_id}`,
          contact: {
            phone: customer_phone
          }
        }]
      }
    };

    const response = await axios.post(
      `${STUART_API_URL}/v2/jobs`,
      jobData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const stuartJob = response.data;

    // Save job status to database
    const deliveryJob = await prisma.deliveryJob.create({
      data: {
        orderId: order_id.toString(),
        stuartJobId: stuartJob.id.toString(),
        status: stuartJob.status || 'created',
        pickupAddress: pickup_address,
        dropoffAddress: dropoff_address,
        packageSize: package_size || 'small',
        jobData: JSON.stringify(stuartJob)
      }
    });

    res.json({
      success: true,
      job: deliveryJob,
      stuart_data: stuartJob
    });
  } catch (error) {
    console.error('Error creating delivery job:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to create delivery job',
      details: error.response?.data || error.message
    });
  }
});

// GET /delivery/status/:orderId - Get delivery status for an order
router.get('/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const deliveryJob = await prisma.deliveryJob.findFirst({
      where: { orderId: orderId },
      orderBy: { createdAt: 'desc' }
    });

    if (!deliveryJob) {
      return res.status(404).json({ error: 'No delivery job found for this order' });
    }

    // Fetch latest status from Stuart API
    try {
      const token = await getStuartToken();
      const response = await axios.get(
        `${STUART_API_URL}/v2/jobs/${deliveryJob.stuartJobId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const stuartJob = response.data;

      // Update status in database
      await prisma.deliveryJob.update({
        where: { id: deliveryJob.id },
        data: {
          status: stuartJob.status,
          jobData: JSON.stringify(stuartJob),
          updatedAt: new Date()
        }
      });

      res.json({
        success: true,
        status: stuartJob.status,
        job: stuartJob
      });
    } catch (apiError) {
      // If Stuart API fails, return cached status
      console.error('Error fetching from Stuart API, returning cached status:', apiError.message);
      res.json({
        success: true,
        status: deliveryJob.status,
        job: JSON.parse(deliveryJob.jobData || '{}'),
        cached: true
      });
    }
  } catch (error) {
    console.error('Error getting delivery status:', error.message);
    res.status(500).json({ 
      error: 'Failed to get delivery status',
      details: error.message
    });
  }
});

// GET /delivery/admin/dashboard - Get all delivery jobs for admin dashboard
router.get('/admin/dashboard', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const where = status ? { status } : {};

    const deliveryJobs = await prisma.deliveryJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const total = await prisma.deliveryJob.count({ where });

    res.json({
      success: true,
      jobs: deliveryJobs,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching delivery jobs:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch delivery jobs',
      details: error.message
    });
  }
});

// POST /delivery/webhook/stuart - Stuart webhook for job status updates
router.post('/webhook/stuart', async (req, res) => {
  try {
    const { event, data } = req.body;

    if (!data || !data.id) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Find delivery job by Stuart job ID
    const deliveryJob = await prisma.deliveryJob.findFirst({
      where: { stuartJobId: data.id.toString() }
    });

    if (!deliveryJob) {
      console.log('Delivery job not found for Stuart job ID:', data.id);
      return res.status(404).json({ error: 'Delivery job not found' });
    }

    // Update job status
    await prisma.deliveryJob.update({
      where: { id: deliveryJob.id },
      data: {
        status: data.status,
        jobData: JSON.stringify(data),
        updatedAt: new Date()
      }
    });

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Error processing Stuart webhook:', error.message);
    res.status(500).json({ 
      error: 'Failed to process webhook',
      details: error.message
    });
  }
});

module.exports = router;
