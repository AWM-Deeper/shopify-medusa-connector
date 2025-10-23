import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/stores - List all stores
router.get('/api/stores', async (req, res) => {
  try {
    const stores = await prisma.store.findMany({
      select: {
        id: true,
        shop: true,
        accessToken: false,
        lastSyncAt: true,
        syncStatus: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      stores: stores.map(store => ({
        ...store,
        lastSyncAt: store.lastSyncAt?.toISOString() || null,
        createdAt: store.createdAt.toISOString(),
        updatedAt: store.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stores'
    });
  }
});

// POST /api/sync/:storeId - Trigger manual sync for a store
router.post('/api/sync/:storeId', async (req, res) => {
  const { storeId } = req.params;

  try {
    // Find the store
    const store = await prisma.store.findUnique({
      where: { id: storeId }
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        error: 'Store not found'
      });
    }

    // Update sync status to 'syncing'
    await prisma.store.update({
      where: { id: storeId },
      data: {
        syncStatus: 'syncing',
        lastSyncAt: new Date()
      }
    });

    // TODO: Implement actual sync logic here
    // This is a placeholder - you should implement your Shopify to Medusa sync logic
    // For now, we'll simulate a successful sync
    setTimeout(async () => {
      try {
        await prisma.store.update({
          where: { id: storeId },
          data: {
            syncStatus: 'completed'
          }
        });
      } catch (err) {
        console.error('Error updating sync status:', err);
      }
    }, 3000);

    res.json({
      success: true,
      message: 'Sync initiated',
      storeId
    });
  } catch (error) {
    console.error('Error syncing store:', error);
    
    // Update sync status to 'failed'
    try {
      await prisma.store.update({
        where: { id: storeId },
        data: {
          syncStatus: 'failed'
        }
      });
    } catch (err) {
      console.error('Error updating sync status:', err);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to sync store'
    });
  }
});

export default router;
