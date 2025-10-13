const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  selectedTier: {
    type: Number,
    default: 0
  },
  price: {
    type: Number,
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});

const sellerStatusUpdateSchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'held_in_escrow', 'released', 'paid', 'failed', 'refunded', 'disputed'],
    default: 'pending'
  },
  escrowDetails: {
    releaseDate: Date,
    releasedAt: Date,
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    disputeRaised: {
      type: Boolean,
      default: false
    },
    disputeResolved: {
      type: Boolean,
      default: false
    },
    disputeReason: { type: String },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    raisedAt: { type: Date }
  },
  paymentMethod: {
    type: String,
    default: 'stripe'
  },
  stripePaymentIntentId: {
    type: String
  },
  stripeTransferIds: [{
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    transferId: {
      type: String,
      required: true
    },
    paymentIntentId: {
      type: String,
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'usd'
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'released', 'refunded'],
      default: 'pending',
      required: true
    },
    metadata: {
      type: Map,
      of: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  shippingAddress: {
    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    latitude: Number,
    longitude: Number
  },
  contactInfo: {
    name: String,
    phone: String,
    email: String
  },
  orderDate: {
    type: Date,
    default: Date.now
  },
  estimatedDelivery: {
    type: Date
  },
  deliveryNotes: String,
  completedAt: { type: Date },
  sellerOrders: [{
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    items: [orderItemSchema],
    subtotal: Number,
    deliveryCharge: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled'],
      default: 'pending'
    },
    deliveredAt: { type: Date },
    statusHistory: [sellerStatusUpdateSchema]
  }]
}, {
  timestamps: true
});

// Index for better query performance
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ 'sellerOrders.seller': 1 });

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;

