const Notification = require('../model/notificationModel');

// GET /api/notifications - current user's notifications
const getUserNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    
    // Add human readable time
    const formattedNotifications = notifications.map(notif => ({
      ...notif,
      timeAgo: formatTimeAgo(notif.createdAt)
    }));
    
    res.json({ notifications: formattedNotifications });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
};

// DELETE /api/notifications/:id - delete a notification
const deleteNotification = async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    if (notif.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await notif.deleteOne();
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ message: 'Failed to delete notification' });
  }
};

// Mark notification as read
const markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    if (notif.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    notif.isRead = true;
    await notif.save();
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('Mark as read error:', err);
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
};

// Base notification creator
const createNotification = async (userId, title, message = '', type = 'other', link = null, meta = {}) => {
  try {
    return await Notification.create({ 
      user: userId, 
      title, 
      message,
      type,
      link,
      meta,
      isRead: false
    });
  } catch (err) {
    console.error('Create notification error:', err);
    return null;
  }
};

// Notification creators for specific types
const createOrderNotification = async (userId, orderId, isSeller = false) => {
  const type = 'order';
  const link = isSeller 
    ? `/seller-dashboard/orders/${orderId}`
    : `/my-orders/${orderId}`;
  const title = isSeller 
    ? 'New Order Received' 
    : 'Order Placed Successfully';
  const message = isSeller 
    ? `New order #${orderId} has been placed.`
    : `Your order #${orderId} has been placed successfully.`;
    
  return createNotification(userId, title, message, type, link, { orderId });
};

const createBidNotification = async (userId, auctionId, bidAmount, isAuctionOwner = false) => {
  const type = 'bid';
  // Redirect to auctions page, frontend will handle opening the modal
  const link = '/auctions';
  const title = isAuctionOwner 
    ? 'New Bid Placed' 
    : 'Your Bid is Placed';
  const message = isAuctionOwner
    ? `A new bid of Rs.${bidAmount} has been placed on your auction.`
    : `Your bid of Rs.${bidAmount} has been placed successfully.`;
    
  return createNotification(userId, title, message, type, link, { 
    auctionId, 
    bidAmount,
    isAuctionOwner,
    shouldOpenAuctionModal: true  // Frontend will use this to open the modal
  });
};

const createProductNotification = async (userId, productId, productType) => {
  const type = 'product';
  const link = `/${productType.toLowerCase()}/${productId}`;
  const title = `Product Created in ${productType}`;
  const message = `Your product has been successfully created in ${productType}.`;
  
  return createNotification(userId, title, message, type, link, {
    productId,
    productType
  });
};

// Helper function to format time ago
function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = Math.floor(seconds / 31536000);
  
  if (interval > 1) return `${interval} years ago`;
  if (interval === 1) return '1 year ago';
  
  interval = Math.floor(seconds / 2592000);
  if (interval > 1) return `${interval} months ago`;
  if (interval === 1) return '1 month ago';
  
  interval = Math.floor(seconds / 86400);
  if (interval > 1) return `${interval} days ago`;
  if (interval === 1) return 'yesterday';
  
  interval = Math.floor(seconds / 3600);
  if (interval > 1) return `${interval} hours ago`;
  if (interval === 1) return '1 hour ago';
  
  interval = Math.floor(seconds / 60);
  if (interval > 1) return `${interval} minutes ago`;
  
  return 'just now';
}

module.exports = {
  getUserNotifications,
  deleteNotification,
  markAsRead,
  createNotification,
  createOrderNotification,
  createBidNotification,
  createProductNotification
};
