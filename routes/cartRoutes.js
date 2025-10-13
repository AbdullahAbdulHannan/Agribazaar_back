const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    getCartSummary
} = require('../controllers/cartController');

// All cart routes require authentication
router.use(authenticate);

// Get user's cart
router.get('/', getCart);

// Get cart summary (count and total)
router.get('/summary', getCartSummary);

// Add item to cart
router.post('/add', addToCart);

// Update cart item quantity
router.put('/item/:productId', updateCartItem);

// Remove item from cart
router.delete('/item/:productId', removeFromCart);

// Clear entire cart
router.delete('/clear', clearCart);

module.exports = router; 