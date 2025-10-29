// lib/stuartClient.js
// Stuart API Client for same-day delivery

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class StuartClient {
  constructor(clientId, clientSecret, env = 'sandbox') {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.env = env;
    this.baseUrl = env === 'production' 
      ? 'https://api.stuart.com'
      : 'https://sandbox.stuart.com';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async authenticate() {
    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        grant_type: 'client_credentials',
        scope: 'job:write job:read'
      }, {
        auth: {
          username: this.clientId,
          password: this.clientSecret
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      console.log('✅ Stuart API authentication successful');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Stuart authentication failed:', error.message);
      throw error;
    }
  }

  async ensureAuthenticated() {
    if (!this.accessToken || Date.now() > this.tokenExpiry) {
      await this.authenticate();
    }
  }

  async getDeliveryQuote(delivery) {
    await this.ensureAuthenticated();

    try {
      console.log('🚘 Getting delivery quote from Stuart');
      
      const response = await axios.post(
        `${this.baseUrl}/v2/jobs/estimate`,
        {
          origin: {
            address: delivery.originAddress,
            phone_number: delivery.originPhone
          },
          destination: {
            address: delivery.destinationAddress,
            phone_number: delivery.destinationPhone
          },
          package_type: 'small_parcel'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const quote = response.data;
      console.log(`💰 Delivery quote: €${quote.amount} (${quote.eta_to_pickup}min to pickup)`);
      
      return {
        price: quote.amount,
        pickupEta: quote.eta_to_pickup,
        deliveryEta: quote.eta_to_delivery,
        distance: quote.distance
      };
    } catch (error) {
      console.error('❌ Failed to get delivery quote:', error.message);
      throw error;
    }
  }

  async createDeliveryJob(delivery) {
    await this.ensureAuthenticated();

    try {
      console.log('🚘 Creating Stuart delivery job');
      
      const response = await axios.post(
        `${this.baseUrl}/v2/jobs`,
        {
          origin: {
            address: delivery.originAddress,
            contact: {
              firstname: delivery.originName,
              phone: delivery.originPhone,
              email: delivery.originEmail
            }
          },
          destination: {
            address: delivery.destinationAddress,
            contact: {
              firstname: delivery.destinationName,
              phone: delivery.destinationPhone,
              email: delivery.destinationEmail
            }
          },
          package: {
            type: 'small_parcel',
            description: delivery.description || 'Order delivery'
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const job = response.data;
      console.log(`✅ Stuart job created: ${job.id}`);
      
      // Save job to database
      const stuartJob = await prisma.stuartJob.create({
        data: {
          stuartJobId: job.id,
          type: 'DELIVERY',
          status: job.status,
          rawData: JSON.stringify(job)
        }
      });
      
      return { jobId: job.id, dbId: stuartJob.id, status: job.status };
    } catch (error) {
      console.error('❌ Failed to create delivery job:', error.message);
      throw error;
    }
  }

  async createReturnPickupJob(returnRequest) {
    await this.ensureAuthenticated();

    try {
      console.log('🚘 Creating Stuart return pickup job');
      
      const response = await axios.post(
        `${this.baseUrl}/v2/jobs`,
        {
          origin: {
            address: returnRequest.customerAddress,
            contact: {
              firstname: returnRequest.customerName,
              phone: returnRequest.customerPhone,
              email: returnRequest.customerEmail
            }
          },
          destination: {
            address: returnRequest.merchantAddress,
            contact: {
              firstname: returnRequest.merchantName,
              phone: returnRequest.merchantPhone,
              email: returnRequest.merchantEmail
            }
          },
          package: {
            type: 'small_parcel',
            description: `Return pickup: ${returnRequest.reason}`
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const job = response.data;
      console.log(`✅ Stuart return pickup job created: ${job.id}`);
      
      // Save job to database
      const stuartJob = await prisma.stuartJob.create({
        data: {
          stuartJobId: job.id,
          type: 'RETURN_PICKUP',
          status: job.status,
          rawData: JSON.stringify(job)
        }
      });
      
      return { jobId: job.id, dbId: stuartJob.id, status: job.status };
    } catch (error) {
      console.error('❌ Failed to create return pickup job:', error.message);
      throw error;
    }
  }

  async getJobStatus(jobId) {
    await this.ensureAuthenticated();

    try {
      const response = await axios.get(
        `${this.baseUrl}/v2/jobs/${jobId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Failed to get job status:', error.message);
      throw error;
    }
  }

  async cancelJob(jobId) {
    await this.ensureAuthenticated();

    try {
      console.log(`🛑 Cancelling Stuart job: ${jobId}`);
      
      const response = await axios.post(
        `${this.baseUrl}/v2/jobs/${jobId}/cancel`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      console.log(`✅ Job cancelled: ${jobId}`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to cancel job:', error.message);
      throw error;
    }
  }
}

export default StuartClient;
