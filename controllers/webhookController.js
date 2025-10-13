const StripeService = require('../services/stripeService');
const Order = require('../model/orderModel');
const {
    handlePaymentIntentSucceeded,
    handlePaymentIntentFailed,
    handleChargeRefunded,
    handleTransferPaid
} = require('./escrowWebhookController');

// Webhook event types we want to handle
const HANDLED_EVENTS = [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
    'transfer.paid'
];

const handleWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = StripeService.verifyWebhookSignature(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Log the event for debugging
    console.log(`Received event: ${event.type}`, event.id);
    
    // Only process events we're interested in
    if (!HANDLED_EVENTS.includes(event.type)) {
        console.log(`Skipping unhandled event type: ${event.type}`);
        return res.json({ received: true, status: 'skipped', reason: 'unhandled_event_type' });
    }

    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                await handlePaymentIntentSucceeded(event.data.object);
                break;
                
            case 'payment_intent.payment_failed':
                await handlePaymentIntentFailed(event.data.object);
                break;
                
            case 'charge.refunded':
                await handleChargeRefunded(event.data.object);
                break;
                
            case 'transfer.paid':
                await handleTransferPaid(event.data.object);
                break;
                
            default:
                console.log(`No handler for event type: ${event.type}`);
        }
        
        console.log(`Successfully processed ${event.type} event`);
    } catch (error) {
        console.error(`Error processing ${event.type} event:`, error);
        return res.status(500).json({ 
            received: true, 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }

    res.json({ received: true });
};

module.exports = {
    handleWebhook
};


