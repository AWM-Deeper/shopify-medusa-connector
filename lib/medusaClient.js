// lib/medusaClient.js
// Wrapper for Medusa SaaS Admin API

import axios from 'axios';

class MedusaClient {
  constructor(baseUrl, apiToken) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    
    this.client = axios.create({
      baseURL: `${baseUrl}/admin`,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  // Products
  async createProduct(productData) {
    try {
      const response = await this.client.post('/products', { product: productData });
      return response.data;
    } catch (error) {
      console.error('Failed to create product in Medusa:', error.message);
      throw error;
    }
  }

  async updateProduct(productId, productData) {
    try {
      const response = await this.client.post(`/products/${productId}`, { product: productData });
      return response.data;
    } catch (error) {
      console.error('Failed to update product in Medusa:', error.message);
      throw error;
    }
  }

  async getProduct(productId) {
    try {
      const response = await this.client.get(`/products/${productId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch product from Medusa:', error.message);
      throw error;
    }
  }

  // Collections
  async createCollection(collectionData) {
    try {
      const response = await this.client.post('/collections', { collection: collectionData });
      return response.data;
    } catch (error) {
      console.error('Failed to create collection in Medusa:', error.message);
      throw error;
    }
  }

  async getOrCreateCollection(title, handle) {
    try {
      // Try to find existing collection
      const response = await this.client.get('/collections', {
        params: { q: handle }
      });
      
      if (response.data.collections && response.data.collections.length > 0) {
        return response.data.collections[0];
      }
      
      // Create new collection if not found
      return await this.createCollection({
        title,
        handle
      });
    } catch (error) {
      console.error('Failed to get or create collection:', error.message);
      throw error;
    }
  }

  async addProductToCollection(productId, collectionId) {
    try {
      const response = await this.client.post(
        `/collections/${collectionId}/products`,
        { product_id: productId }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to add product to collection:', error.message);
      throw error;
    }
  }

  // Orders
  async getOrder(orderId) {
    try {
      const response = await this.client.get(`/orders/${orderId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch order from Medusa:', error.message);
      throw error;
    }
  }

  async updateOrder(orderId, orderData) {
    try {
      const response = await this.client.post(`/orders/${orderId}`, { order: orderData });
      return response.data;
    } catch (error) {
      console.error('Failed to update order in Medusa:', error.message);
      throw error;
    }
  }

  // Refunds
  async createRefund(orderId, amount, reason) {
    try {
      const response = await this.client.post(`/orders/${orderId}/refunds`, {
        amount: Math.round(amount * 100), // Convert to cents
        reason
      });
      return response.data;
    } catch (error) {
      console.error('Failed to create refund in Medusa:', error.message);
      throw error;
    }
  }

  // Analytics
  async getAnalytics(params = {}) {
    try {
      const response = await this.client.get('/analytics', { params });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch analytics from Medusa:', error.message);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      console.error('Medusa health check failed:', error.message);
      return { status: 'down' };
    }
  }
}

export default MedusaClient;
