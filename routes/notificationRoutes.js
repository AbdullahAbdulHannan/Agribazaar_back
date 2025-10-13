const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const {
  getUserNotifications,
  deleteNotification,
  markAsRead,
  createOrderNotification,
  createBidNotification,
  createProductNotification
} = require('../controllers/notificationController');

const router = express.Router();

// Get all notifications for authenticated user
router.get('/', authenticate, getUserNotifications);

// Delete a notification
router.delete('/:id', authenticate, deleteNotification);

// Mark notification as read
router.patch('/:id/read', authenticate, markAsRead);

module.exports = {
  router,
  createOrderNotification,
  createBidNotification,
  createProductNotification
};
