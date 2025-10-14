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
    <h1>✅ Shopify-Medusa Connector</h1>
    <p><a href="/auth/begin?shop=your-test-store.myshopify.com">Install App</a></p>
  `);
});

// Auth routes
app.get('/auth/begin', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  try {
    // Start OAuth flow
    const authRoute = await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
    
    res.redirect(authRoute);
  } catch (error) {
    console.error('Auth begin error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    console.log('✅ Access token:', callback.session.accessToken);
    res.send('Authentication successful! You can close this window.');
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).send('Authentication callback failed');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});