const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    comment: {
        type: String,
        required: true,
        trim: true
    },
    name: {
        type: String,
        required: true
    },
    avatar: {
        type: String,
        default: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=40&h=40&fit=crop&crop=face'
    }
}, {
    timestamps: true
});

// Prevent user from submitting more than one review per product
reviewSchema.index({ user: 1, product: 1 }, { unique: true });

// Static method to get average rating of a product
reviewSchema.statics.getAverageRating = async function(productId) {
    const obj = await this.aggregate([
        {
            $match: { product: productId }
        },
        {
            $group: {
                _id: '$product',
                averageRating: { $avg: '$rating' },
                numOfReviews: { $sum: 1 }
            }
        }
    ]);

    try {
        await this.model('Product').findByIdAndUpdate(productId, {
            averageRating: obj[0] ? Math.round(obj[0].averageRating * 10) / 10 : 0,
            numOfReviews: obj[0] ? obj[0].numOfReviews : 0
        });
    } catch (err) {
        console.error(err);
    }
};

// Call getAverageRating after save
reviewSchema.post('save', function() {
    this.constructor.getAverageRating(this.product);
});

// Call getAverageRating before remove
reviewSchema.post('remove', function() {
    this.constructor.getAverageRating(this.product);
});

const Review = mongoose.model('Review', reviewSchema);
module.exports = Review;
