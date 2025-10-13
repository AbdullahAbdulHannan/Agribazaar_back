const  mongoose = require('mongoose');  

const tierSchema = new mongoose.Schema({
    min: {
        type: Number,
        required: true,
    },
    max: {
        type: Number,
    },
    price: {
        type: Number,
        required: true,
    }
});

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
    comment: {
        type: String,
        required: true
    }
})

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true, 
    },
    averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    numOfReviews: {
        type: Number,
        default: 0
    },
    type: {
        type: String,
        enum: ['marketplace', 'emandi', 'auction'],
        required: true,
        default: 'marketplace'
    },
    price: [tierSchema],
    category: { 
        type: String,
        required: true,
    },
    image: {
        type: String,
        required: true,
    },
    seller:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    stock: {
        type: Number,
        required: true,
        default: 0
    },
    deliveryCharges:[tierSchema],
    // Auction specific fields
    auctionEndTime: {
        type: Date,
        required: function() { return this.type === 'auction'; }
    },
    startingBid: {
        type: Number,
        required: function() { return this.type === 'auction'; }
    },
    currentBid: {
        type: Number,
        default: 0
    },
    minIncrement: {
        type: Number,
        default: 1
    },
    // reviews: [reviewSchema]
}, {
    timestamps: true
})

const Product = mongoose.model('Product', productSchema);
module.exports = Product;