// server.js
import 'dotenv/config';
import express from 'express';
import { shopifyApi, ApiVersion, LATEST_API_VERSION } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser'; // FIXED: Added cookie support

const app = express();

// Security + parsing
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(cookieParser()); // FIXED: Enable cookies for OAuth

// Skip ngrok browser warning
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', '69420');
  next();
});

// Validate required environment variables
if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !process.env.HOST) {
  console.error('\u274c Missing required environment variables!');
  console.error('Required: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, HOST');
  process.exit(1);
}

// Shopify setup - FIXED: Proper hostName parsing and config
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(',') || ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations', 'read_orders'],
  // FIXED: Remove protocol and trailing slash
  hostName: process.env.HOST
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, ''),
  hostScheme: 'https',
  apiVersion: LATEST_API_VERSION,
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
      <p><strong>To install:</strong> Visit <code>/auth/begin?shop=YOUR-STORE.myshopify.com</code></p>
      <hr>
      <p>Environment check:</p>
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

// FIXED: Proper async/await handling in /auth/begin
app.get('/auth/begin', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).send('❌ Missing shop parameter. Use: /auth/begin?shop=your-store.myshopify.com');
  }
  
  if (!shop.includes('.myshopify.com')) {
    return res.status(400).send('❌ Invalid shop format. Must be: your-store.myshopify.com');
  }
  
  try {
    console.log(`🔐 Starting OAuth for shop: ${shop}`);
    
    // shopify.auth.begin handles the redirect internally
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(shop, true),
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
    // Note: No need for res.redirect() - shopify.auth.begin handles it
  } catch (error) {
    console.error('❌ Auth begin error:', error.message);
    console.error('Full error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// FIXED: Proper callback handling
app.get('/auth/callback', async (req, res) => {
  try {
    console.log('📥 Received OAuth callback');
    
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    
    const { session } = callbackResponse;
    
    console.log('✅ Authentication successful!');
    console.log('Shop:', session.shop);
    console.log('Access Token:', session.accessToken?.substring(0, 20) + '...');
    console.log('Scope:', session.scope);
    
    // TODO: Store session in database
    // await storeSession(session);
    
    // TODO: Sync with Medusa
    // await syncToMedusa(session);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Success!</title></head>
      <body>
        <h1>✅ Authentication Successful!</h1>
        <p>Shop: <strong>${session.shop}</strong></p>
        <p>You can close this window.</p>
        <hr>
        <p><small>Access token stored. Ready to sync with Medusa.</small></p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Auth callback error:', error.message);
    console.error('Full error:', error);
    res.status(500).send(`Authentication callback failed: ${error.message}`);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    host: process.env.HOST,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('❌ Route not found');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal server error');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔗 Public URL: https://${process.env.HOST}`);
  console.log(`📝 Callback URL: https://${process.env.HOST}/auth/callback`);
  console.log('\n⚠️ Make sure your Shopify Partner Dashboard has:');
  console.log(` App URL: https://${process.env.HOST}/auth/begin`);
  console.log(` Redirect URL: https://${process.env.HOST}/auth/callback`);
});
