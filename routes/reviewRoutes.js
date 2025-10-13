const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
    addReview,
    getProductReviews,
    updateReview,
    deleteReview
} = require('../controllers/reviewController');

// Public routes
router.get('/product/:productId', getProductReviews);

// Protected routes
router.use(authenticate);
router.post('/', addReview);
router.route('/:id')
    .put(updateReview)
    .delete(deleteReview);

module.exports = router;
