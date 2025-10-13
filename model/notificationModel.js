const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // short heading/msg
    title: {
      type: String,
      required: true,
    },
    // optional longer text
    message: {
      type: String,
    },
    // URL to navigate when notification is clicked
    link: {
      type: String,
    },
    // Additional metadata for the notification
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    // Type of notification (order, bid, product, etc.)
    type: {
      type: String,
      enum: ['order', 'bid', 'auction', 'product', 'payment', 'other'],
      default: 'other',
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
