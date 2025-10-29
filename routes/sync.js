// routes/sync.js
// Product sync from Shopify -> Medusa

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Fetch all products from Shopify for a store
async function fetchShopifyProducts(shop, shopify) {
  console.log(`📦 Fetching products from Shopify store: ${shop}`);
  
  const query = `{
    products(first: 250) {
      edges {
        node {
          id
          title
          description
          handle
          vendor
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                sku
                weight
                weightUnit
              }
            }
          }
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
        }
      }
    }
  }`;

  try {
    const client = shopify.clients.graphqlProxy({shop});
    const response = await client.query({data: query});
    
    if (response.body.errors) {
      throw new Error(JSON.stringify(response.body.errors));
    }
    
    return response.body.data.products.edges.map(edge => edge.node);
  } catch (error) {
    console.error(`❌ Failed to fetch Shopify products: ${error.message}`);
    throw error;
  }
}

// Transform Shopify product to Medusa format
function transformToMedusaFormat(shopifyProduct, storeName) {
  return {
    title: shopifyProduct.title,
    description: shopifyProduct.description || '',
    handle: shopifyProduct.handle,
    vendor: shopifyProduct.vendor,
    storeName: storeName,
    images: shopifyProduct.images.edges.map(edge => ({
      url: edge.node.url,
      alt: edge.node.altText || ''
    })),
    variants: shopifyProduct.variants.edges.map(edge => ({
      title: edge.node.title,
      sku: edge.node.sku,
      price: parseFloat(edge.node.price),
      compareAtPrice: edge.node.compareAtPrice ? parseFloat(edge.node.compareAtPrice) : null,
      weight: edge.node.weight,
      weightUnit: edge.node.weightUnit
    }))
  };
}

// Create/update product in Medusa
async function syncProductToMedusa(medusaClient, product, shop) {
  try {
    console.log(`🔄 Syncing product: ${product.title}`);
    
    // Create product in Medusa
    const medusaProduct = await medusaClient.admin.products.create({
      title: product.title,
      description: product.description,
      handle: product.handle,
      vendor: product.vendor,
      tags: [`store:${shop}`, 'synced-from-shopify'],
      images: product.images,
      variants: product.variants
    });
    
    return medusaProduct.product.id;
  } catch (error) {
    console.error(`❌ Failed to sync product to Medusa: ${error.message}`);
    throw error;
  }
}

// Save product mapping to database
async function saveProductMapping(shopifyId, medusaId, shop) {
  try {
    const mapping = await prisma.product.upsert({
      where: {
        shopifyProductId_storeName: {
          shopifyProductId: shopifyId,
          storeName: shop
        }
      },
      update: {
        medusaProductId: medusaId,
        updatedAt: new Date()
      },
      create: {
        shopifyProductId: shopifyId,
        medusaProductId: medusaId,
        storeName: shop
      }
    });
    
    return mapping;
  } catch (error) {
    console.error(`❌ Failed to save product mapping: ${error.message}`);
    throw error;
  }
}

// Main sync function
async function syncShopifyStore(shop, shopify, medusaClient) {
  console.log(`\n🚀 Starting full sync for store: ${shop}`);
  
  // Update sync status
  await prisma.syncStatus.upsert({
    where: {
      storeName_resourceType: {
        storeName: shop,
        resourceType: 'products'
      }
    },
    update: { status: 'syncing' },
    create: {
      storeName: shop,
      resourceType: 'products',
      status: 'syncing'
    }
  });

  let syncedCount = 0;
  try {
    // Fetch products from Shopify
    const products = await fetchShopifyProducts(shop, shopify);
    console.log(`✅ Fetched ${products.length} products from Shopify`);
    
    // Sync each product
    for (const product of products) {
      try {
        const transformed = transformToMedusaFormat(product, shop);
        const medusaId = await syncProductToMedusa(medusaClient, transformed, shop);
        await saveProductMapping(product.id, medusaId, shop);
        syncedCount++;
      } catch (error) {
        console.error(`⚠️ Skipped product ${product.title}: ${error.message}`);
      }
    }
    
    // Update sync status to completed
    await prisma.syncStatus.update({
      where: {
        storeName_resourceType: {
          storeName: shop,
          resourceType: 'products'
        }
      },
      data: {
        status: 'completed',
        lastSyncAt: new Date()
      }
    });
    
    console.log(`✅ Sync complete! Successfully synced ${syncedCount}/${products.length} products`);
    return { success: true, synced: syncedCount, total: products.length };
  } catch (error) {
    // Update sync status to failed
    await prisma.syncStatus.update({
      where: {
        storeName_resourceType: {
          storeName: shop,
          resourceType: 'products'
        }
      },
      data: {
        status: 'failed',
        errorMessage: error.message
      }
    });
    
    console.error(`❌ Sync failed: ${error.message}`);
    throw error;
  }
}

// Export for use in server.js
export { syncShopifyStore, fetchShopifyProducts };
