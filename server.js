// server.js
import 'dotenv/config';
import express from 'express';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

const app = express();

// Security + parsing
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Skip ngrok browser warning
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', '69420');
  next();
});

// Validate required environment variables
if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !process.env.HOST) {
  console.error('❌ Missing required environment variables!');
  console.error('Required: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, HOST');
  process.exit(1);
}

// Shopify setup
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(',') || [
    'read_products',
    'write_products',
    'read_inventory',
    'write_inventory',
    'read_locations',
    'read_orders'
  ],
  hostName: process.env.HOST
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, ''),
  hostScheme: 'https',
  apiVersion: '2024-10',
  isEmbeddedApp: false,
  auth: {
    path: '/auth',
    callbackPath: '/auth/callback',
  },
});

// Root route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Shopify-Medusa Connector</title></head>
    <body>
      <h1>✅ Shopify-Medusa Connector</h1>
      <p>Server is running correctly!</p>
      <p>To install: Visit /auth/begin?shop=YOUR-STORE.myshopify.com</p>
      <h2>Environment check:</h2>
      <ul>
        <li>API Key: ${process.env.SHOPIFY_API_KEY ? '✅ Set' : '❌ Missing'}</li>
        <li>API Secret: ${process.env.SHOPIFY_API_SECRET ? '✅ Set' : '❌ Missing'}</li>
        <li>Host: ${process.env.HOST || '❌ Missing'}</li>
        <li>Scopes: ${process.env.SCOPES || 'read_products,write_products (default)'}</li>
      </ul>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ===== ADMIN ENDPOINTS =====
// GET /admin/products - Retrieve all products
app.get('/admin/products', (req, res) => {
  res.json({
    status: 'success',
    data: {
      products: [
        {
          id: '1',
          title: 'Sample Product 1',
          price: 29.99,
          inventory: 100
        },
        {
          id: '2',
          title: 'Sample Product 2',
          price: 49.99,
          inventory: 50
        }
      ],
      total: 2
    },
    message: 'Admin products endpoint - returning mock data for testing'
  });
});

// GET /admin/orders - Retrieve all orders
app.get('/admin/orders', (req, res) => {
  res.json({
    status: 'success',
    data: {
      orders: [
        {
          id: 'ORD-001',
          customer: 'John Doe',
          total: 79.98,
          status: 'completed'
        },
        {
          id: 'ORD-002',
          customer: 'Jane Smith',
          total: 49.99,
          status: 'pending'
        }
      ],
      total: 2
    },
    message: 'Admin orders endpoint - returning mock data for testing'
  });
});

// GET /admin/store - Retrieve store information
app.get('/admin/store', (req, res) => {
  res.json({
    status: 'success',
    data: {
      store: {
        name: 'Stingray Store',
        domain: 'stingray-app-yitsm.ondigitalocean.app',
        currency: 'USD',
        timezone: 'UTC',
        totalProducts: 2,
        totalOrders: 2
      }
    },
    message: 'Admin store endpoint - returning store information'
  });
});
// ===== END ADMIN ENDPOINTS =====

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: '❌ Route not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /admin/products',
      'GET /admin/orders',
      'GET /admin/store'
    ]
  });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Host: ${process.env.HOST}`);
  console.log(`🛍️  Shopify API initialized`);
});
