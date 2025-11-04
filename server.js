// server.js - Productionized Shopify-Medusa Connector
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

const app = express();

// Security middlewares
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

// Shopify API Setup
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes:
    process.env.SCOPES?.split(',') || [
      'read_products',
      'write_products',
      'read_inventory',
      'write_inventory',
      'read_locations',
      'read_orders',
    ],
  hostName: process.env.HOST.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  hostScheme: 'https',
  apiVersion: '2024-10',
  isEmbeddedApp: false,
  auth: {
    path: '/auth',
    callbackPath: '/auth/callback',
  },
});

// Basic root route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <h2>Shopify-Medusa Connector</h2>
    <p>✅ Server OK. Ready for install!</p>
    <ul>
      <li>To install: Visit <code>/auth/begin?shop=YOUR-STORE.myshopify.com</code></li>
      <li>API Key: ${process.env.SHOPIFY_API_KEY ? '✅ Set' : '❌ Missing'}</li>
      <li>API Secret: ${process.env.SHOPIFY_API_SECRET ? '✅ Set' : '❌ Missing'}</li>
      <li>Host: ${process.env.HOST || '❌ Missing'}</li>
      <li>Scopes: ${process.env.SCOPES || 'read_products,write_products (default)'}</li>
    </ul>
  `);
});

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// ===== REAL SHOPIFY ENDPOINTS ===== //

// Begin OAuth install
app.get('/auth/begin', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  try {
    const authRoute = await shopify.auth.begin({ shop, callbackPath: '/auth/callback' });
    return res.redirect(authRoute.url);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// OAuth callback -- store tokens securely
// Use in-memory store for demo (replace with DB in production)
const sessionStore = {};
app.get('/auth/callback', async (req, res) => {
  try {
    const callbackResponse = await shopify.auth.callback({
      query: req.query,
      body: req.body,
    });
    const { shop, accessToken, scope } = callbackResponse.session;
    // TODO: Store tokens in secure DB. Here we use in-memory for demo/testing.
    sessionStore[shop] = { accessToken, scope };
    return res.redirect(`/?shop=${shop}&installed=1`);
  } catch (error) {
    return res.status(500).send('Authentication error: ' + error.message);
  }
});

// Example: Proxy Shopify REST API request (products)
app.get('/shop/products', async (req, res) => {
  const shop = req.query.shop;
  if (!shop || !sessionStore[shop]) {
    return res.status(401).json({ error: 'Not installed or authenticated'});
  }
  try {
    const response = await fetch(`https://${shop}/admin/api/2024-10/products.json`, {
      headers: {
        'X-Shopify-Access-Token': sessionStore[shop].accessToken,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return res.json({ status: 'success', products: data.products || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Example: Webhook handler (for products, orders etc)
app.post('/shopify/webhook', async (req, res) => {
  // Shopify sends webhook data in req.body
  // TODO: Verify HMAC signature, route to Medusa backend
  try {
    // Forward event to Medusa (replace URL with real Medusa endpoint)
    await fetch(process.env.MEDUSA_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    res.status(200).send('Webhook processed');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy Medusa sync (push Shopify product to Medusa)
app.post('/medusa/sync-product', async (req, res) => {
  const { shop, productId } = req.body;
  if (!shop || !productId || !sessionStore[shop]) {
    return res.status(400).json({ error: 'Missing shop or productId'});
  }
  try {
    // Get product details from Shopify
    const response = await fetch(`https://${shop}/admin/api/2024-10/products/${productId}.json`, {
      headers: {
        'X-Shopify-Access-Token': sessionStore[shop].accessToken,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    // Push product to Medusa backend
    await fetch(process.env.MEDUSA_PRODUCT_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.product)
    });
    return res.json({ status: 'success', message: 'Synced with Medusa' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: '❌ Route not found', path: req.path, method: req.method });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🛍️  Shopify API initialized`);
});
