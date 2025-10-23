const { Resend } = require('resend');
const twilio = require('twilio');
const logger = require('./logger');

// Initialize Resend for email notifications
const resend = new Resend(process.env.RESEND_API_KEY);

// Initialize Twilio for SMS notifications
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Send email notification for critical errors
 * @param {string} subject - Email subject
 * @param {string} errorMessage - Error message to send
 * @param {object} errorDetails - Additional error details
 */
async function sendEmailNotification(subject, errorMessage, errorDetails = {}) {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATION_EMAIL_TO) {
      logger.warn('Email notification skipped: Missing RESEND_API_KEY or NOTIFICATION_EMAIL_TO');
      return;
    }

    const emailBody = `
      <h2>${subject}</h2>
      <p><strong>Error Message:</strong> ${errorMessage}</p>
      <h3>Error Details:</h3>
      <pre>${JSON.stringify(errorDetails, null, 2)}</pre>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    `;

    await resend.emails.send({
      from: process.env.NOTIFICATION_EMAIL_FROM || 'notifications@yourdomain.com',
      to: process.env.NOTIFICATION_EMAIL_TO,
      subject: `[CRITICAL] ${subject}`,
      html: emailBody,
    });

    logger.info('Email notification sent successfully', { subject });
  } catch (error) {
    logger.error('Failed to send email notification', { error: error.message });
  }
}

/**
 * Send SMS notification for critical errors
 * @param {string} message - SMS message to send
 */
async function sendSMSNotification(message) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_FROM || !process.env.TWILIO_PHONE_TO) {
      logger.warn('SMS notification skipped: Missing Twilio configuration');
      return;
    }

    const truncatedMessage = message.length > 160 
      ? message.substring(0, 157) + '...'
      : message;

    await twilioClient.messages.create({
      body: `[CRITICAL] ${truncatedMessage}`,
      from: process.env.TWILIO_PHONE_FROM,
      to: process.env.TWILIO_PHONE_TO,
    });

    logger.info('SMS notification sent successfully');
  } catch (error) {
    logger.error('Failed to send SMS notification', { error: error.message });
  }
}

/**
 * Send both email and SMS notifications for critical failures
 * @param {string} subject - Notification subject
 * @param {string} errorMessage - Error message
 * @param {object} errorDetails - Additional error details
 */
async function notifyCriticalFailure(subject, errorMessage, errorDetails = {}) {
  logger.error('Critical failure detected', { subject, errorMessage, errorDetails });
  
  // Send both notifications in parallel
  await Promise.allSettled([
    sendEmailNotification(subject, errorMessage, errorDetails),
    sendSMSNotification(`${subject}: ${errorMessage}`)
  ]);
}

module.exports = {
  sendEmailNotification,
  sendSMSNotification,
  notifyCriticalFailure,
};
