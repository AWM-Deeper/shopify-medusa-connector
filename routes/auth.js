// routes/auth.js
import { Router } from 'express';
import prisma from '../lib/prisma.js';

export default function authRoutes(shopify, shopifyExpress) {
  const router = Router();

  router.get('/begin', async (req, res) => {
    return shopifyExpress.beginAuth(req, res, req.query.shop, '/auth/callback');
  });

  router.get('/callback', async (req, res) => {
    try {
      const session = await shopifyExpress.validateAuthCallback(req, res, req.query);
      console.log(`✅ Connected shop: ${session.shop}`);
      
      // Save or update store information
      const store = await prisma.store.upsert({
        where: { shopDomain: session.shop },
        update: {
          updatedAt: new Date(),
        },
        create: {
          shopDomain: session.shop,
          storeName: session.shop,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      
      // Deactivate any existing active tokens for this store
      await prisma.token.updateMany({
        where: {
          storeId: store.id,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });
      
      // Save the new access token securely
      const token = await prisma.token.create({
        data: {
          storeId: store.id,
          accessToken: session.accessToken,
          scope: session.scope,
          tokenType: 'access_token',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      
      console.log(`✅ Saved token for store: ${store.shopDomain}`);
      
      res.send(`🎉 Successfully connected ${session.shop}!`);
    } catch (e) {
      console.error('OAuth error:', e);
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  return router;
}
