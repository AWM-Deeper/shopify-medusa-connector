// server.js
import 'dotenv/config';
import express from 'express';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

// Security + parsing
app.use(helmet());
app.use(cors());
app.use(express.json());

// Skip ngrok browser warning for OAuth 
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', '69420');
  next();
});

// Shopify setup
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(',') || [],
  hostName: process.env.HOST?.replace(/^https?:\/\//, '') || 'localhost:3000',
  apiVersion: ApiVersion.October24, // Use specific version
  isEmbeddedApp: false,
});

// Routes
app.get('/', (req, res) => {
  res.send(`
    ✅ Shopify-Medusa Connector
    <a href="/auth/begin?shop=your-shop.myshopify.com">Install App</a>
  `);
});

// Auth routes
app.get('/auth/begin', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  try {
    // shopify.auth.begin() handles the redirect internally via rawResponse
    // It does NOT return an authRoute - it sends the response itself
    await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
    // No res.redirect() needed - response already sent by shopify.auth.begin()
  } catch (error) {
    console.error('Auth begin error:', error);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).send('Authentication failed');
    }
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    
    console.log('✅ Access token:', callback.session.accessToken);
    
    // Only send success response if headers haven't been sent yet
    if (!res.headersSent) {
      res.send('Authentication successful! You can close this window.');
    }
  } catch (error) {
    console.error('Auth callback error:', error);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).send('Authentication callback failed');
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
