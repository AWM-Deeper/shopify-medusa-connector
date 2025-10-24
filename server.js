// server.js
import 'dotenv/config';
import express from 'express';
im
import '@shopify/shopify-api/adapters/node';
imp
// Allow Shopify admin and store domains to frame this app
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://myshopify.com");
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
import cors from 'cors';
  import helmet from 'helmet';
// Configure Helmet to allow embedding in Shopify iframe
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
}));
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
  isEmbeddedApp: true,
});

// Routes
app.get('/', (req, res) => {
  res.send(`
 <!DOCTYPE html>
 <html>
 <head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <style>
 body { font-family: sans-serif; margin: 20px; }
 .container { max-width: 800px; margin: 0 auto; }
 h1 { color: #333; }
 .status { padding: 10px; background: #e8f5e9; border-radius: 4px; margin: 10px 0; }
 </style>
 </head>
 <body>
 <div class="container">
 <h1>✅ Shopify-Medusa Connector</h1>
 <div class="status">App is connected and ready to sync products between Shopify and Medusa</div>
 </div>
 <script src="https://cdn.jsdelivr.net/npm/@shopify/app@latest/dist/index.js"><\/script>
 </body>
 </html>
 `
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
