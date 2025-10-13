const Review = require('../model/reviewModel');
const Product = require('../model/productModel');
const asyncHandler = require('express-async-handler');

// @desc    Add a review
// @route   POST /api/reviews
// @access  Private
const addReview = asyncHandler(async (req, res) => {
    const { product: productId, rating, title, comment } = req.body;

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
        res.status(404);
        throw new Error('Product not found');
    }

    // Check if user already reviewed this product
    const alreadyReviewed = await Review.findOne({
        user: req.user.id,
        product: productId
    });

    if (alreadyReviewed) {
        res.status(400);
        throw new Error('Product already reviewed');
    }

    // Create review
    const review = await Review.create({
        user: req.user.id,
        name: req.user.name,
        product: productId,
        rating: Number(rating),
        title,
        comment,
        avatar: req.user.avatar
    });

    res.status(201).json({
        success: true,
        data: review
    });
});

// @desc    Get reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
    const reviews = await Review.find({ product: req.params.productId })
        .sort({ createdAt: -1 });
    
    res.status(200).json({
        success: true,
        count: reviews.length,
        data: reviews
    });
});

// @desc    Update review
// @route   PUT /api/reviews/:id
// @access  Private
const updateReview = asyncHandler(async (req, res) => {
    const { rating, title, comment } = req.body;
    const review = await Review.findById(req.params.id);

    if (!review) {
        res.status(404);
        throw new Error('Review not found');
    }

    // Make sure review belongs to user or user is admin
    if (review.user.toString() !== req.user.id && req.user.role !== 'admin') {
        res.status(401);
        throw new Error('Not authorized to update this review');
    }

    review.rating = rating || review.rating;
    review.title = title || review.title;
    review.comment = comment || review.comment;

    const updatedReview = await review.save();
    
    res.status(200).json({
        success: true,
        data: updatedReview
    });
});

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private
const deleteReview = asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.id);

    if (!review) {
        res.status(404);
        throw new Error('Review not found');
    }

    // Make sure review belongs to user or user is admin
    if (review.user.toString() !== req.user.id && req.user.role !== 'admin') {
        res.status(401);
        throw new Error('Not authorized to delete this review');
    }

    await review.remove();
    
    res.status(200).json({
        success: true,
        data: {}
    });
});

module.exports = {
    addReview,
    getProductReviews,
    updateReview,
    deleteReview
};
