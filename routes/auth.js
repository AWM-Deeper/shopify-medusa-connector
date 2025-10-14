// routes/auth.js
import { Router } from 'express';

export default function authRoutes(shopify, shopifyExpress) {
  const router = Router();

  router.get('/begin', async (req, res) => {
    return shopifyExpress.beginAuth(req, res, req.query.shop, '/auth/callback');
  });

  router.get('/callback', async (req, res) => {
    try {
      const session = await shopifyExpress.validateAuthCallback(req, res, req.query);
      console.log(`✅ Connected shop: ${session.shop}`);
      res.send(`🎉 Successfully connected ${session.shop}!`);
    } catch (e) {
      console.error('OAuth error:', e);
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  return router;
}