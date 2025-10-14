const Order = require('../model/orderModel');
const Cart = require('../model/cartModel');
const Product = require('../model/productModel');
const User = require('../model/userModel');
const StripeService = require('../services/stripeService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createNotification, createOrderNotification } = require('../controllers/notificationController');
const { default: mongoose } = require('mongoose');
const { ObjectId } = mongoose.Types;

const createEscrowOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { shippingAddress, contactInfo, deliveryNotes, paymentMethod = 'card' } = req.body;
        const userId = req.user._id;
        let user = await User.findById(userId).session(session);

        if (!user) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Geocode shipping address if provided
        let resolvedShippingAddress = shippingAddress;
        if (shippingAddress) {
            try {
                const { geocodeAddress, buildFullAddress } = require('../utils/geocode');
                const full = typeof shippingAddress === 'string' ? shippingAddress : buildFullAddress(shippingAddress);
                const geo = await geocodeAddress(full);
                const base = typeof shippingAddress === 'string' ? { street: shippingAddress } : shippingAddress;
                resolvedShippingAddress = {
                    street: base.street || base.addressLine1 || full,
                    city: base.city || '',
                    state: base.state || '',
                    postalCode: base.postalCode || '',
                    country: base.country || 'Pakistan',
                    latitude: geo?.latitude,
                    longitude: geo?.longitude
                };
            } catch (e) {
                console.warn('Shipping address geocoding failed:', e.message);
            }
        }

        // Get user's cart with seller information
        const cart = await Cart.findOne({ user: userId })
            .populate({
                path: 'items.product',
                select: 'name price category image stock seller type deliveryCharges',
                populate: {
                    path: 'seller',
                    select: 'stripeAccountId email'
                }
            })
            .session(session);

        if (!cart || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }

        let totalAmount = 0;
        const orderItems = [];
        const sellerOrders = new Map();
        const releaseDate = new Date();
        releaseDate.setDate(releaseDate.getDate() + 14); // 14-day escrow period

        // Helper for distance
        const toRad = (v) => (v * Math.PI) / 180;
        const haversineKm = (lat1, lon1, lat2, lon2) => {
            const R = 6371;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        for (const cartItem of cart.items) {
            const product = cartItem.product;

            // Get sellerId safely (only ObjectId)
            const sellerId = product.seller._id ? product.seller._id : product.seller;

            // Check stock availability
            if (product.stock < cartItem.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${product.name}`
                });
            }

            // Calculate price based on tier
            const tier = product.price[cartItem.selectedTier];
            if (!tier) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid price tier for ${product.name}`
                });
            }

            const itemPrice = tier.price * cartItem.quantity;
            totalAmount += itemPrice;

            const orderItem = {
                product: product._id,
                quantity: cartItem.quantity,
                selectedTier: cartItem.selectedTier,
                price: itemPrice,
                seller: sellerId // ✅ only ObjectId
            };

            orderItems.push(orderItem);

            // Group items by seller
            if (!sellerOrders.has(sellerId.toString())) {
                sellerOrders.set(sellerId.toString(), {
                    seller: sellerId, // ✅ only ObjectId
                    items: [],
                    subtotal: 0
                });
            }

            const sellerOrder = sellerOrders.get(sellerId.toString());
            sellerOrder.items.push(orderItem);
            sellerOrder.subtotal += itemPrice;
        }

        // Compute delivery charge per seller based on buyer shippingAddress lat/lng
        if (resolvedShippingAddress?.latitude != null && resolvedShippingAddress?.longitude != null) {
            for (const [sellerId, so] of sellerOrders.entries()) {
                try {
                    // Resolve seller coordinates from default address
                    const sellerDoc = await User.findById(sellerId).select('addresses').session(session);
                    const defAddr = sellerDoc?.addresses?.find?.(a => a.isDefault) || sellerDoc?.addresses?.[0];
                    let sLat = defAddr?.latitude;
                    let sLng = defAddr?.longitude;
                    if (sLat == null || sLng == null) {
                        try {
                            const { geocodeAddress, buildFullAddress } = require('../utils/geocode');
                            const full = buildFullAddress(defAddr);
                            const geo = await geocodeAddress(full);
                            sLat = geo?.latitude;
                            sLng = geo?.longitude;
                        } catch (e) {
                            console.warn('Seller geocode failed in order create:', e?.message);
                        }
                    }
                    if (sLat == null || sLng == null) continue;
                    const distanceKm = haversineKm(sLat, sLng, resolvedShippingAddress.latitude, resolvedShippingAddress.longitude);

                    // Find all cart items that belong to this seller with their product delivery tiers
                    const itemsForSeller = (cart.items || []).filter(ci => {
                        const sid = ci.product?.seller?._id?.toString?.() || ci.product?.seller?.toString?.() || ci.product?.seller;
                        return sid?.toString?.() === sellerId.toString();
                    });

                    let sellerCharge = 0;
                    for (const ci of itemsForSeller) {
                        const tiers = Array.isArray(ci.product?.deliveryCharges) ? [...ci.product.deliveryCharges] : [];
                        if (tiers.length === 0) continue;
                        tiers.sort((a, b) => (a.min || 0) - (b.min || 0));
                        let chosen = tiers.find(t => (t.min == null || distanceKm >= t.min) && (t.max == null || distanceKm <= t.max));
                        if (!chosen) {
                            chosen = tiers.find(t => t.max != null && distanceKm <= t.max) || tiers.reduce((prev, cur) => {
                                const prevDelta = Math.abs(distanceKm - (prev.max ?? prev.min ?? 0));
                                const curDelta = Math.abs(distanceKm - (cur.max ?? cur.min ?? 0));
                                return curDelta < prevDelta ? cur : prev;
                            }, tiers[0]);
                        }
                        if (chosen?.price && chosen.price > sellerCharge) sellerCharge = chosen.price;
                    }

                    so.deliveryCharge = sellerCharge;
                    totalAmount += sellerCharge;
                } catch (e) {
                    console.warn('Delivery charge compute failed for seller', sellerId?.toString?.(), e?.message);
                }
            }
        }

        const order = new Order({
            user: userId,
            items: orderItems,
            totalAmount,
            shippingAddress: resolvedShippingAddress,
            contactInfo,
            deliveryNotes,
            paymentMethod: 'stripe_escrow',
            paymentStatus: 'pending',
            escrowDetails: {
                releaseDate,
                disputeRaised: false,
                disputeResolved: false
            },
            sellerOrders: Array.from(sellerOrders.values())
        });

        await order.save({ session });

        // Ensure buyer has a Stripe Customer so the same card can be reused across multiple intents
        if (!user.stripeCustomerId) {
            const createdCustomer = await stripe.customers.create({
                email: user.email,
                name: user.name,
                metadata: { user_id: userId.toString() }
            });
            user.stripeCustomerId = createdCustomer.id;
            await user.save({ session });
        }

        const paymentIntents = [];

        for (const [sellerId, sellerOrder] of sellerOrders) {
            const seller = await User.findById(sellerId).session(session);
            if (!seller || !seller.stripeAccountId) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    success: false,
                    message: `Seller ${sellerId} does not have a valid Stripe account`
                });
            }

            // Create payment intent for this seller's portion of the order
            const amount = sellerOrder.subtotal + (sellerOrder.deliveryCharge || 0);
            const result = await StripeService.createEscrowCharge(
                amount,
                'pkr',
                user.stripeCustomerId,
                seller.stripeAccountId,
                `Payment for order #${order._id}`,
                {
                    order_id: order._id.toString(),
                    seller_id: sellerId.toString(),
                    user_id: userId.toString(),
                    delivery_charge: (sellerOrder.deliveryCharge || 0).toString(),
                    items: JSON.stringify(sellerOrder.items.map(item => ({
                        product: item.product.toString(),
                        quantity: item.quantity,
                        price: item.price
                    })))
                }
            );

            if (!result || !result.id) {
                throw new Error('Failed to create payment intent');
            }
            
            // Store payment intent details
            order.paymentIntents = order.paymentIntents || [];
            order.paymentIntents.push({
                paymentIntentId: result.id,
                sellerId: sellerId,
                amount: amount,
                currency: 'pkr',
                status: 'requires_payment_method', // Will be updated after confirmation
                clientSecret: result.clientSecret,
                requiresAction: result.requiresAction
            });

            paymentIntents.push({
                sellerId,
                paymentIntentId: result.id,
                clientSecret: result.clientSecret,
                amount: result.amount,
                transferMetadata: result.transferMetadata
            });

            // Store transfer details in the order
            order.stripeTransferIds.push({
                sellerId,
                transferId: result.id, // This will be updated later with the actual transfer ID
                paymentIntentId: result.id, // Add the payment intent ID
                amount: sellerOrder.subtotal + (sellerOrder.deliveryCharge || 0),
                currency: 'pkr', // Ensure currency is set
                status: 'pending',
                metadata: {
                    payment_intent: result.id,
                    client_secret: result.clientSecret,
                    transfer_pending: 'true',
                    transfer_metadata: JSON.stringify(result.transferMetadata || {}),
                    delivery_charge: (sellerOrder.deliveryCharge || 0).toString()
                },
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        await order.save({ session });

        cart.items = [];
        await cart.save({ session });

        await session.commitTransaction();
        session.endSession();

        // Create notification for buyer
        await createNotification(
            userId,
            'Order Placed',
            `Your order #${order._id} has been placed and is pending payment.`,
            'order',
            `/orders/${order._id}`,
            { orderId: order._id, status: 'pending_payment' }
        );

        // Create notifications for sellers
        for (const sellerOrder of order.sellerOrders) {
            await createNotification(
                sellerOrder.seller,
                'New Order',
                `You have a new order #${order._id} to fulfill.`,
                'order',
                `/seller/orders/${order._id}`,
                { orderId: order._id, isSeller: true }
            );
        }

        // Get the first payment intent's client secret for the frontend
        const clientSecret = paymentIntents.length > 0 ? paymentIntents[0].clientSecret : null;
        
        res.status(201).json({
            success: true,
            message: 'Order created successfully. Please complete the payment to confirm your order.',
            order: {
                _id: order._id,
                status: order.status,
                paymentStatus: order.paymentStatus,
                totalAmount: order.totalAmount,
                paymentIntents,
                escrowDetails: order.escrowDetails
            },
            // Add the payment intent client secret for the frontend
            paymentIntent: clientSecret ? {
                clientSecret: clientSecret
            } : null
        });

    } catch (error) {
        console.error('Error in createEscrowOrder:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
            type: error.type,
            raw: error.raw,
            request: error.request,
            response: error.response?.data,
            statusCode: error.statusCode,
            timestamp: new Date().toISOString()
        });

        await session.abortTransaction();
        session.endSession();
        
        // Provide more detailed error information in development
        const errorResponse = {
            success: false,
            message: 'Error creating order',
            error: {
                name: error.name,
                message: error.message,
                ...(process.env.NODE_ENV === 'development' && {
                    stack: error.stack,
                    details: error
                })
            }
        };
        
        res.status(500).json(errorResponse);
    }
};


// Confirm payment and mark order as paid (do NOT transfer to sellers here)
const confirmPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { orderId, paymentIntentId } = req.body;
        const userId = req.user.id;

        // Get order
        const order = await Order.findOne({ _id: orderId, user: userId })
            .populate({
                path: 'items.product',
                select: 'name stock seller'
            })
            .session(session);

        if (!order) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Verify and handle payment intent status
        let paymentIntent;
        try {
            // First retrieve the payment intent to check its status
            paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            
            // Handle different payment intent statuses
            switch (paymentIntent.status) {
                case 'succeeded':
                    // Payment is already succeeded, no action needed
                    break;
                    
                case 'requires_capture':
                    // Capture the payment intent
                    paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
                    break;
                    
                case 'requires_payment_method':
                    // Try to confirm the payment with the saved payment method
                    paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
                        payment_method: paymentIntent.payment_method,
                        off_session: true
                    });
                    
                    // If still requires capture after confirmation, capture it
                    if (paymentIntent.status === 'requires_capture') {
                        paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
                    }
                    break;
                    
                case 'processing':
                    // Payment is processing, we'll consider this as success
                    break;
                    
                case 'canceled':
                case 'requires_action':
                case 'requires_confirmation':
                default:
                    throw new Error(`Payment cannot be processed. Status: ${paymentIntent.status}`);
            }
            
            // Final status check
            if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
                throw new Error(`Payment status is ${paymentIntent.status}. Expected 'succeeded' or 'processing'`);
            }
            
        } catch (error) {
            console.error('Error processing payment intent:', error);
            throw new Error(`Payment processing failed: ${error.message}`);
        }

        // Update order status
        order.status = 'confirmed';
        order.paymentStatus = 'paid';
        await order.save();

        // Send payment confirmation notification to buyer
        await createNotification(
            order.user,
            'Payment Confirmed',
            `Your payment for order #${order._id} has been confirmed.`,
            'payment',
            `/my-orders`,
            { orderId: order._id, status: 'paid' }
        );

        // Send payment received notifications to sellers
        await Promise.all(
            order.sellerOrders.map(async (sellerOrder) => {
                await createNotification(
                    sellerOrder.seller,
                    'Payment Received',
                    `Payment confirmed for order #${order._id}.`,
                    'payment',
                    `/seller-dashboard/orders`,
                    { orderId: order._id, status: 'paid' }
                );
            })
        );

        // Update product stock
        for (const item of order.items) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { stock: -item.quantity } }
            );
        }

        // Clear cart
        await Cart.findOneAndDelete({ user: userId });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            success: true,
            message: 'Payment confirmed and order processed successfully',
            data: order
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error confirming payment:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ...existing code...

// Get user's orders
const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 10, status } = req.query;

        const query = { user: userId };
        if (status) {
            query.status = status;
        }

        const orders = await Order.find(query)
            .populate({
                path: 'items.product',
                select: 'name image category'
            })
            .populate({
                path: 'sellerOrders.seller',
                select: 'name email'
            })
            .populate({
                path: 'sellerOrders.items.product',
                select: 'name image category'
            })
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Order.countDocuments(query);

        res.status(200).json({
            success: true,
            data: {
                orders,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                total
            }
        });

    } catch (error) {
        console.error('Error getting user orders:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving orders'
        });
    }
};

// Get order details
const getOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({ _id: orderId, user: userId })
            .populate({
                path: 'items.product',
                select: 'name image category price'
            })
            .populate({
                path: 'sellerOrders.seller',
                select: 'name email'
            });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        res.status(200).json({
            success: true,
            data: order
        });

    } catch (error) {
        console.error('Error getting order details:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving order details'
        });
    }
};

// Cancel order
const cancelOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({ _id: orderId, user: userId });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (order.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Order cannot be cancelled'
            });
        }

        order.status = 'cancelled';
        await order.save();

        res.status(200).json({
            success: true,
            message: 'Order cancelled successfully',
            data: order
        });

    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({
            success: false,
            message: 'Error cancelling order'
        });
    }
};

// Get orders for a seller (products they sold)
const getSellerOrders = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const { page = 1, limit = 10, status } = req.query;

        const matchCriteria = {
            'sellerOrders.seller': sellerId
        };
        if (status) {
            matchCriteria['sellerOrders.status'] = status;
        }

        const orders = await Order.find(matchCriteria)
            .populate({
                path: 'sellerOrders.items.product',
                select: 'name image category'
            })
            .populate({
                path: 'user',
                select: 'name email'
            })
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        // Filter sellerOrders to only include the logged-in seller
        const filteredOrders = orders.map(order => {
            const sellerOrder = order.sellerOrders.find(so => so.seller.toString() === sellerId);
            return {
                _id: order._id,
                createdAt: order.createdAt,
                user: order.user,
                status: sellerOrder?.status,
                items: sellerOrder?.items || [],
                subtotal: sellerOrder?.subtotal || 0,
                shippingAddress:  order.shippingAddress,
        contactInfo:  order.contactInfo,
            };
        });

        const total = await Order.countDocuments(matchCriteria);

        res.status(200).json({
            success: true,
            data: {
                orders: filteredOrders,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                total
            }
        });
    } catch (error) {
        console.error('Error getting seller orders:', error);
        res.status(500).json({ success: false, message: 'Error retrieving seller orders' });
    }
};

// Update status of seller's part of an order
const updateSellerOrderStatus = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { orderId } = req.params;
        const { status, notes } = req.body; // expected new status and optional notes
        const sellerId = req.user.id;

        // Define valid status transitions
        const statusFlow = {
            'pending': ['processing', 'cancelled'],
            'processing': ['shipped', 'cancelled'],
            'shipped': ['delivered', 'cancelled'],
            'delivered': [], // final state
            'cancelled': [] // final state
        };

        // Find the order with the seller's items
        const order = await Order.findOne({ _id: orderId, 'sellerOrders.seller': sellerId })
            .populate('user', 'email name')
            .session(session);

        if (!order) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Find the specific seller's order
        const sellerOrder = order.sellerOrders.find(so => so.seller.toString() === sellerId);
        if (!sellerOrder) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Seller order not found' });
        }

        // Validate status transition (default to 'pending' if missing)
        const currentStatus = sellerOrder.status || 'pending';
        const allowedTransitions = statusFlow[currentStatus] || [];
        
        if (!allowedTransitions.includes(status)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ 
                success: false, 
                message: `Invalid status transition from ${currentStatus} to ${status}` 
            });
        }

        // Update status and add to history
        const statusUpdate = {
            status,
            changedAt: new Date(),
            changedBy: req.user._id,
            notes: notes || ''
        };

        sellerOrder.status = status;
        sellerOrder.statusHistory = sellerOrder.statusHistory || [];
        sellerOrder.statusHistory.push(statusUpdate);

        // Update order's overall status if needed
        if (status === 'delivered') {
            sellerOrder.deliveredAt = new Date();
            
            // Check if all seller orders are delivered
            const allDelivered = order.sellerOrders.every(so => 
                so.status === 'delivered' || so._id.toString() === sellerOrder._id.toString()
            );

            if (allDelivered) {
                order.status = 'completed';
                order.completedAt = new Date();
            }
        }

        await order.save({ session });

        // Create notification for buyer
        const statusMessages = {
            'processing': 'is now being processed',
            'shipped': 'has been shipped',
            'delivered': 'has been delivered',
            'cancelled': 'has been cancelled'
        };

        if (status in statusMessages) {
            await createNotification(
                order.user._id,
                `Order ${statusMessages[status]}`,
                `Your order #${order._id} from ${req.user.businessName || 'seller'} ${statusMessages[status]}.`,
                'order_update',
                `/orders/${order._id}`,
                { orderId: order._id, status }
            );
        }

        // Emit real-time update via WebSocket if available
        if (req.app.get('io')) {
            const io = req.app.get('io');
            io.to(`order_${order._id}`).emit('order_updated', {
                orderId: order._id,
                sellerOrderId: sellerOrder._id,
                status,
                updatedAt: new Date(),
                seller: {
                    _id: sellerId,
                    name: req.user.businessName || `${req.user.firstName} ${req.user.lastName}`
                }
            });
        }

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ 
            success: true, 
            message: 'Status updated successfully',
            data: {
                status: sellerOrder.status,
                updatedAt: statusUpdate.changedAt,
                history: sellerOrder.statusHistory
            }
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error updating seller order status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating order status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Release funds from escrow to seller
const releaseEscrowFunds = async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user._id;
    
    try {
        const order = await Order.findById(orderId).populate('user', 'stripeCustomerId');
        
        if (!order) {
            console.error('Order not found:', orderId);
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        // Verify user has permission to release funds (admin or buyer)
        if (order.user._id.toString() !== userId.toString() && !req.user.isAdmin) {
            console.error('Unauthorized release attempt:', { userId, orderUser: order.user._id });
            return res.status(403).json({
                success: false,
                message: 'Not authorized to release these funds'
            });
        }
        
        // Check if funds are already released
        if (order.paymentStatus === 'released') {
            console.log('Funds already released for order:', orderId);
            return res.status(400).json({
                success: false,
                message: 'Funds have already been released'
            });
        }
        
        // Process each seller's payment
        const results = [];
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            const onlySellerId = req.body?.sellerId ? req.body.sellerId.toString() : null;
            const transfersToProcess = onlySellerId
                ? order.stripeTransferIds.filter(t => t.sellerId.toString() === onlySellerId)
                : order.stripeTransferIds;
            
            for (const transfer of transfersToProcess) {
                try {
                    // Skip if already released
                    if (transfer.status === 'released') {
                        console.log(`Skipping already released transfer ${transfer._id} for seller ${transfer.sellerId}`);
                        results.push({
                            sellerId: transfer.sellerId,
                            success: true,
                            message: 'Funds already released',
                            transferId: transfer.transferId,
                            paymentIntentId: transfer.paymentIntentId
                        });
                        continue;
                    }

                    // Get the seller's Stripe account ID
                    const seller = await User.findById(transfer.sellerId).session(session);
                    if (!seller || !seller.stripeAccountId) {
                        throw new Error('Seller Stripe account not found');
                    }

                    console.log('Releasing funds to seller:', {
                        sellerId: seller._id,
                        stripeAccountId: seller.stripeAccountId,
                        transferAmount: transfer.amount,
                        currency: transfer.currency || order.currency || 'pkr',
                        paymentIntentId: transfer.paymentIntentId
                    });

                    if (!transfer.paymentIntentId) {
                        throw new Error('Payment intent ID is missing for this transfer');
                    }

                    // Use the StripeService to handle the escrow release
                    const result = await StripeService.releaseEscrowFunds(
                        transfer.paymentIntentId,
                        seller.stripeAccountId,
                        transfer.amount,
                        transfer.currency || order.currency || 'pkr',
                        {
                            orderId: order._id.toString(),
                            sellerId: seller._id.toString(),
                            buyerId: order.user._id.toString(),
                            transferId: transfer._id.toString(),
                            originalTransferId: transfer.transferId
                        }
                    );

                    // Update transfer status in our database
                    transfer.status = 'released';
                    transfer.updatedAt = new Date();
                    transfer.transferId = result.transferId;
                    transfer.metadata = transfer.metadata || {};
                    transfer.metadata.releasedAt = new Date();
                    transfer.metadata.stripeTransferId = result.transferId;
                    
                    results.push({
                        sellerId: transfer.sellerId,
                        success: true,
                        paymentIntentId: transfer.paymentIntentId,
                        transferId: result.transferId,
                        amount: transfer.amount,
                        status: result.status
                    });
                    
                    console.log('Successfully released funds:', {
                        transferId: result.transferId,
                        amount: transfer.amount,
                        status: result.status
                    });
                } catch (error) {
                    console.error(`Error releasing funds for seller ${transfer.sellerId}:`, {
                        error: error.message,
                        stack: error.stack,
                        orderId: order._id,
                        paymentIntentId: transfer.paymentIntentId
                    });
                    
                    results.push({
                        sellerId: transfer.sellerId,
                        success: false,
                        error: error.message,
                        paymentIntentId: transfer.paymentIntentId,
                        details: error.raw || null
                    });
                }
            }
            
            // Only update order status if all transfers were successful
            const allSuccessful = results.every(r => r.success);
            if (!allSuccessful && !onlySellerId) {
                const failedTransfers = results.filter(r => !r.success);
                console.error('Failed to release all funds:', { failedTransfers });
                throw new Error(`Failed to release funds for ${failedTransfers.length} sellers`);
            }
            
            // Update order status
            if (!onlySellerId) {
                order.paymentStatus = 'released';
                order.escrowDetails = order.escrowDetails || {};
                order.escrowDetails.releasedAt = new Date();
                order.escrowDetails.releasedBy = userId;
            }
            
            await order.save({ session });
            await session.commitTransaction();
            
            console.log('Successfully updated order status:', {
                orderId: order._id,
                paymentStatus: order.paymentStatus,
                releasedAt: order.escrowDetails?.releasedAt
            });
            
            res.json({
                success: true,
                message: onlySellerId ? 'Seller funds released successfully' : 'Funds released successfully',
                results
            });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
        
    } catch (error) {
        console.error('Error in releaseEscrowFunds:', {
            error: error.message,
            stack: error.stack,
            orderId,
            userId
        });
        
        res.status(500).json({
            success: false,
            message: 'Failed to release escrow funds',
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Raise a dispute on an escrow payment
const raiseDispute = async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;
    
    try {
        const order = await Order.findById(orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        // Verify user has permission to raise a dispute (buyer or seller)
        const isBuyer = order.user.toString() === userId.toString();
        const isSeller = order.stripeTransferIds.some(
            t => t.sellerId.toString() === userId.toString()
        );
        
        if (!isBuyer && !isSeller) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to raise a dispute for this order'
            });
        }
        
        // Update order status
        order.paymentStatus = 'disputed';
        order.escrowDetails.disputeRaised = true;
        order.escrowDetails.disputeReason = reason || 'No reason provided';
        order.escrowDetails.raisedBy = userId;
        order.escrowDetails.raisedAt = new Date();
        
        await order.save();
        
        // Notify all parties
        const notificationPromises = [
            createNotification(
                order.user,
                'Dispute Raised',
                `A dispute has been raised for order #${order._id}.`,
                'dispute_raised',
                `/orders/${order._id}`,
                { orderId: order._id }
            )
        ];
        
        // Notify all sellers
        for (const transfer of order.stripeTransferIds) {
            notificationPromises.push(
                createNotification(
                    transfer.sellerId,
                    'Order Disputed',
                    `A dispute has been raised for order #${order._id}.`,
                    'dispute_raised',
                    `/seller/orders/${order._id}`,
                    { orderId: order._id }
                )
            );
        }
        
        await Promise.all(notificationPromises);
        
        // In a real app, you might want to notify admins as well
        
        res.json({
            success: true,
            message: 'Dispute raised successfully',
            order: {
                _id: order._id,
                status: order.status,
                paymentStatus: order.paymentStatus,
                disputeDetails: order.escrowDetails
            }
        });
        
    } catch (error) {
        console.error('Error raising dispute:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to raise dispute',
            error: error.message
        });
    }
};

// Resolve a dispute (admin only)
const resolveDispute = async (req, res) => {
    const { orderId } = req.params;
    const { resolution, refundBuyer = false, releaseToSeller = false } = req.body;
    
    if (!req.user.isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Only administrators can resolve disputes'
        });
    }
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const order = await Order.findById(orderId).session(session);
        
        if (!order) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.paymentStatus !== 'disputed') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'This order is not in a disputed state'
            });
        }
        
        // Process resolution
        if (refundBuyer) {
            // Refund the buyer
            for (const transfer of order.stripeTransferIds) {
                if (transfer.status !== 'refunded') {
                    await StripeService.refundEscrowPayment(
                        transfer.paymentIntentId,
                        'dispute_resolved_refund_buyer'
                    );
                    transfer.status = 'refunded';
                }
            }
            order.paymentStatus = 'refunded';
            
        } else if (releaseToSeller) {
            // Release to seller
            for (const transfer of order.stripeTransferIds) {
                if (transfer.status === 'pending') {
                    const seller = await User.findById(transfer.sellerId).select('stripeAccountId');
                    if (!seller || !seller.stripeAccountId) {
                        throw new Error('Seller Stripe account not found for release');
                    }
                    await StripeService.releaseEscrowFunds(
                        transfer.paymentIntentId,
                        seller.stripeAccountId,
                        transfer.amount,
                        transfer.currency || 'pkr',
                        { orderId: order._id.toString(), sellerId: transfer.sellerId?.toString?.() || '' }
                    );
                    transfer.status = 'released';
                }
            }
            order.paymentStatus = 'released';
        }
        
        // Update order details
        order.escrowDetails.disputeResolved = true;
        order.escrowDetails.resolution = resolution || 'Dispute resolved by administrator';
        order.escrowDetails.resolvedBy = req.user._id;
        order.escrowDetails.resolvedAt = new Date();
        
        await order.save({ session });
        await session.commitTransaction();
        session.endSession();
        
        // Notify all parties
        const notificationPromises = [];
        
        // Notify buyer
        notificationPromises.push(
            createNotification(
                order.user,
                'Dispute Resolved',
                `The dispute for order #${order._id} has been resolved.`,
                'dispute_resolved',
                `/orders/${order._id}`,
                { orderId: order._id }
            )
        );
        
        // Notify sellers
        for (const transfer of order.stripeTransferIds) {
            notificationPromises.push(
                createNotification(
                    transfer.sellerId,
                    'Dispute Resolved',
                    `The dispute for order #${order._id} has been resolved.`,
                    'dispute_resolved',
                    `/seller/orders/${order._id}`,
                    { orderId: order._id }
                )
            );
        }
        
        await Promise.all(notificationPromises);
        
        res.json({
            success: true,
            message: 'Dispute resolved successfully',
            order: {
                _id: order._id,
                status: order.status,
                paymentStatus: order.paymentStatus,
                resolution: order.escrowDetails.resolution
            }
        });
        
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        
        console.error('Error resolving dispute:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resolve dispute',
            error: error.message
        });
    }
};

// Automatic escrow release job (to be called by a scheduled task)
const processEscrowReleases = async () => {
    try {
        const now = new Date();
        
        // Find orders where escrow should be released
        const ordersToRelease = await Order.find({
            'paymentStatus': 'held_in_escrow',
            'escrowDetails.releaseDate': { $lte: now },
            'escrowDetails.disputeRaised': false
        });
        
        const results = [];
        
        for (const order of ordersToRelease) {
            try {
                // Process each seller's payment
                for (const transfer of order.stripeTransferIds) {
                    if (transfer.status === 'pending') {
                        const seller = await User.findById(transfer.sellerId).select('stripeAccountId');
                        if (!seller || !seller.stripeAccountId) {
                            throw new Error('Seller Stripe account not found for release');
                        }
                        await StripeService.releaseEscrowFunds(
                            transfer.paymentIntentId,
                            seller.stripeAccountId,
                            transfer.amount,
                            transfer.currency || 'pkr',
                            { orderId: order._id.toString(), sellerId: transfer.sellerId?.toString?.() || '' }
                        );
                        transfer.status = 'released';
                        transfer.metadata.releasedAt = new Date();
                    }
                }
                
                // Update order status
                order.paymentStatus = 'released';
                order.escrowDetails.releasedAt = new Date();
                await order.save();
                
                // Notify buyer and seller
                await Promise.all([
                    createNotification(
                        order.user,
                        'Funds Released Automatically',
                        `Funds for order #${order._id} have been automatically released to the seller.`,
                        'escrow_released_auto',
                        `/orders/${order._id}`,
                        { orderId: order._id }
                    ),
                    ...order.stripeTransferIds.map(transfer => 
                        createNotification(
                            transfer.sellerId,
                            'Escrow Funds Released',
                            `Funds for order #${order._id} have been released to your account.`,
                            'escrow_received',
                            `/seller/orders/${order._id}`,
                            { orderId: order._id }
                        )
                    )
                ]);
                
                results.push({
                    orderId: order._id,
                    status: 'released',
                    releasedAt: new Date()
                });
                
            } catch (error) {
                console.error(`Error processing escrow release for order ${order._id}:`, error);
                results.push({
                    orderId: order._id,
                    status: 'error',
                    error: error.message
                });
            }
        }
        
        return {
            success: true,
            processed: results.length,
            results
        };
        
    } catch (error) {
        console.error('Error in processEscrowReleases:', error);
        throw error;
    }
};

module.exports = {
    createEscrowOrder,
    confirmPayment,
    getUserOrders,
    getOrderDetails,
    cancelOrder,
    getSellerOrders,
    updateSellerOrderStatus,
    releaseEscrowFunds,
    raiseDispute,
    resolveDispute,
    processEscrowReleases
};