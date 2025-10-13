const Order = require('../model/orderModel');
const User = require('../model/userModel');
const { createNotification } = require('./notificationController');
const StripeService = require('../services/stripeService');
const { default: mongoose } = require('mongoose');

/**
 * Handle payment_intent.succeeded event
 * This is triggered when a payment intent is successfully created
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const order = await Order.findOne({ 'stripeTransferIds.transferId': paymentIntent.id })
            .session(session);
            
        if (!order) {
            console.warn(`Order not found for payment intent: ${paymentIntent.id}`);
            await session.abortTransaction();
            session.endSession();
            return { success: false, message: 'Order not found' };
        }
        
        // Find the transfer in the order
        const transfer = order.stripeTransferIds.find(t => t.transferId === paymentIntent.id);
        if (!transfer) {
            console.warn(`Transfer not found in order for payment intent: ${paymentIntent.id}`);
            await session.abortTransaction();
            session.endSession();
            return { success: false, message: 'Transfer not found in order' };
        }
        
        // Update transfer status
        transfer.status = paymentIntent.status;
        transfer.metadata = {
            ...transfer.metadata,
            paymentIntentStatus: paymentIntent.status,
            lastUpdated: new Date()
        };
        
        // If all transfers are successful, update order status
        const allTransfersProcessed = order.stripeTransferIds.every(t => 
            ['succeeded', 'released'].includes(t.status)
        );
        
        if (allTransfersProcessed) {
            order.paymentStatus = 'held_in_escrow';
            order.status = 'confirmed';
        }
        
        await order.save({ session });
        await session.commitTransaction();
        session.endSession();
        
        // Send notifications
        await createNotification({
            user: order.user,
            type: 'payment_received',
            title: 'Payment Received',
            message: `Your payment for order #${order._id} has been received and is being held in escrow.`,
            link: `/orders/${order._id}`
        });
        
        return { success: true, orderId: order._id };
        
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error handling payment_intent.succeeded:', error);
        throw error;
    }
};

/**
 * Handle payment_intent.payment_failed event
 */
const handlePaymentIntentFailed = async (paymentIntent) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const order = await Order.findOne({ 'stripeTransferIds.transferId': paymentIntent.id })
            .session(session);
            
        if (!order) {
            console.warn(`Order not found for failed payment intent: ${paymentIntent.id}`);
            await session.abortTransaction();
            session.endSession();
            return { success: false, message: 'Order not found' };
        }
        
        // Update transfer status
        const transfer = order.stripeTransferIds.find(t => t.transferId === paymentIntent.id);
        if (transfer) {
            transfer.status = 'failed';
            transfer.metadata = {
                ...transfer.metadata,
                paymentIntentStatus: paymentIntent.status,
                failureCode: paymentIntent.last_payment_error?.code,
                failureMessage: paymentIntent.last_payment_error?.message,
                lastUpdated: new Date()
            };
        }
        
        // Update order status if all transfers failed
        const allTransfersFailed = order.stripeTransferIds.every(t => 
            ['failed', 'canceled'].includes(t.status)
        );
        
        if (allTransfersFailed) {
            order.paymentStatus = 'failed';
            order.status = 'cancelled';
        }
        
        await order.save({ session });
        await session.commitTransaction();
        session.endSession();
        
        // Notify user
        await createNotification({
            user: order.user,
            type: 'payment_failed',
            title: 'Payment Failed',
            message: `Your payment for order #${order._id} has failed. Please update your payment method.`,
            link: `/orders/${order._id}/payment`
        });
        
        return { success: true, orderId: order._id };
        
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error handling payment_intent.payment_failed:', error);
        throw error;
    }
};

/**
 * Handle charge.refunded event
 */
const handleChargeRefunded = async (charge) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const paymentIntentId = charge.payment_intent;
        const order = await Order.findOne({ 'stripeTransferIds.transferId': paymentIntentId })
            .session(session);
            
        if (!order) {
            console.warn(`Order not found for refunded charge: ${charge.id}`);
            await session.abortTransaction();
            session.endSession();
            return { success: false, message: 'Order not found' };
        }
        
        // Update transfer status
        const transfer = order.stripeTransferIds.find(t => t.transferId === paymentIntentId);
        if (transfer) {
            transfer.status = 'refunded';
            transfer.metadata = {
                ...transfer.metadata,
                refundId: charge.refunds.data[0]?.id,
                refundAmount: charge.amount_refunded,
                refundStatus: charge.refunded ? 'succeeded' : 'pending',
                lastUpdated: new Date()
            };
        }
        
        // Update order status if all transfers are refunded
        const allTransfersRefunded = order.stripeTransferIds.every(t => 
            ['refunded', 'canceled'].includes(t.status)
        );
        
        if (allTransfersRefunded) {
            order.paymentStatus = 'refunded';
            order.status = 'cancelled';
        }
        
        await order.save({ session });
        await session.commitTransaction();
        session.endSession();
        
        // Notify user
        await createNotification({
            user: order.user,
            type: 'refund_processed',
            title: 'Refund Processed',
            message: `Your refund for order #${order._id} has been processed.`,
            link: `/orders/${order._id}`
        });
        
        return { success: true, orderId: order._id };
        
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error handling charge.refunded:', error);
        throw error;
    }
};

/**
 * Handle transfer.paid event (when funds are sent to seller)
 */
const handleTransferPaid = async (transfer) => {
    try {
        const order = await Order.findOne({ 'stripeTransferIds.transferId': transfer.destination_payment });
        if (!order) {
            console.warn(`Order not found for transfer: ${transfer.id}`);
            return { success: false, message: 'Order not found' };
        }
        
        // Update transfer status
        const transferInOrder = order.stripeTransferIds.find(t => t.transferId === transfer.destination_payment);
        if (transferInOrder) {
            transferInOrder.status = 'released';
            transferInOrder.metadata = {
                ...transferInOrder.metadata,
                transferId: transfer.id,
                transferStatus: transfer.status,
                transferPaid: transfer.paid,
                transferAmount: transfer.amount,
                transferCurrency: transfer.currency,
                transferDate: new Date(transfer.created * 1000),
                lastUpdated: new Date()
            };
            
            await order.save();
            
            // Notify seller
            await createNotification({
                user: transferInOrder.sellerId,
                type: 'escrow_released',
                title: 'Escrow Funds Released',
                message: `Funds for order #${order._id} have been released to your account.`,
                link: `/seller/orders/${order._id}`
            });
        }
        
        return { success: true, orderId: order._id };
        
    } catch (error) {
        console.error('Error handling transfer.paid:', error);
        throw error;
    }
};

module.exports = {
    handlePaymentIntentSucceeded,
    handlePaymentIntentFailed,
    handleChargeRefunded,
    handleTransferPaid
};
