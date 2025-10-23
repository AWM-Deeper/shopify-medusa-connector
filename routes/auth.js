// routes/auth.js
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { notifyCriticalFailure } from '../lib/notifications.js';

export default function authRoutes(shopify, shopifyExpress) {
  const router = Router();

  router.get('/begin', async (req, res) => {
    try {
      logger.info('OAuth flow started', { shop: req.query.shop });
      return shopifyExpress.beginAuth(req, res, req.query.shop, '/auth/callback');
    } catch (error) {
      logger.error('Error starting OAuth flow', { error: error.message, stack: error.stack });
      await notifyCriticalFailure(
        'OAuth Flow Start Failed',
        error.message,
        { shop: req.query.shop, stack: error.stack }
      );
      res.status(500).send(`Error starting authentication: ${error.message}`);
    }
  });

  router.get('/callback', async (req, res) => {
    try {
      const session = await shopifyExpress.validateAuthCallback(req, res, req.query);
      logger.info('OAuth callback successful', { shop: session.shop });
      
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
      
      logger.info('Store upserted', { storeId: store.id, shopDomain: store.shopDomain });
      
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
      
      logger.info('Access token saved', { storeId: store.id, tokenId: token.id });
      
      res.send(`🎉 Successfully connected ${session.shop}!`);
    } catch (error) {
      logger.error('OAuth callback failed', { 
        error: error.message, 
        stack: error.stack,
        query: req.query 
      });
      
      await notifyCriticalFailure(
        'OAuth Callback Failed',
        error.message,
        { query: req.query, stack: error.stack }
      );
      
      res.status(500).send(`Error: ${error.message}`);
    }
  });

  return router;
}
