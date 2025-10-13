const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
    createEscrowOrder,
    confirmPayment,
    getUserOrders,
    getOrderDetails,
    cancelOrder,
    getSellerOrders,
    updateSellerOrderStatus
} = require('../controllers/orderController');

// All routes are authenticateed
router.use(authenticate);

// Create order from cart with escrow
router.post('/create', createEscrowOrder);

// Confirm payment
router.post('/confirm-payment', confirmPayment);

// Get user's orders
router.get('/user-orders', getUserOrders);

// Seller: get their orders
router.get('/seller-orders', getSellerOrders);

// Seller: update status of their part of order
router.put('/:orderId/seller-status', updateSellerOrderStatus);

// Get order details
router.get('/:orderId', getOrderDetails);

// Cancel order
router.put('/:orderId/cancel', cancelOrder);

module.exports = router;


