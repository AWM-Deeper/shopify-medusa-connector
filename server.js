import 'dotenv/config';
import express from 'express';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

const app = express();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://admin.shopify.com https://*.myshopify.com");
  next();
});

// Shopify setup
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(',') || [],
  hostName: process.env.HOST?.replace(/^https?:\/\//, '') || 'localhost:3000',
  apiVersion: ApiVersion.October24,
  isEmbeddedApp: true,
});

// Root route - embedded app
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Shopify-Medusa Connector</title>
      <style>body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }</style>
    </head>
    <body>
      <div style="max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px;">
        <h1>✅ Shopify-Medusa Connector</h1>
        <p>App is installed and connected to Medusa</p>
        <p style="color: #666; font-size: 14px;">Ready to sync products and orders</p>
      </div>
    </body>
    </html>
  `);
});

// Auth routes
app.get('/auth/begin', async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');
  try {
    await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
  } catch (error) {
    console.error('Auth begin error:', error);
    if (!res.headersSent) res.status(500).send('Authentication failed');
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    console.log('✅ Access token:', callback.session.accessToken);
    if (!res.headersSent) res.send('Authentication successful!');
  } catch (error) {
    console.error('Auth callback error:', error);
    if (!res.headersSent) res.status(500).send('Authentication failed');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
