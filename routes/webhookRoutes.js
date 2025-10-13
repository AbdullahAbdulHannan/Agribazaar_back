const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/webhookController');
const logger = require('../utils/logger');

// Middleware to log webhook events
const logWebhook = (req, res, next) => {
    const eventType = req.body?.type || 'unknown';
    logger.info(`Received Stripe webhook: ${eventType}`, {
        eventId: req.body?.id,
        type: eventType
    });
    next();
};

// Stripe webhook endpoint (no authentication required for webhooks)
router.post('/stripe', 
    // Parse raw body for signature verification
    express.raw({ type: 'application/json' }), 
    // Log the webhook event
    logWebhook,
    // Handle the webhook
    handleWebhook
);

// Health check endpoint for webhook
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'webhook-handler',
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware for webhook routes
router.use((err, req, res, next) => {
    logger.error('Webhook error:', {
        error: err.message,
        stack: err.stack,
        eventType: req.body?.type,
        eventId: req.body?.id
    });
    
    // Return a 200 status to prevent Stripe from retrying for certain errors
    if (err.type === 'StripeSignatureVerificationError') {
        return res.status(400).json({ received: false, error: 'Webhook signature verification failed' });
    }
    
    res.status(500).json({ received: false, error: 'Internal server error' });
});

module.exports = router;


