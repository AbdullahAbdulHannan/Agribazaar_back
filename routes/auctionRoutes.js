const express = require('express');
const router = express.Router();
const {
  createAuction,
  getAllAuctions,
  getAuctionById,
  getAuctionsByOwner,
  updateAuction,
  deleteAuction,
  placeBid,
  getAuctionBids,
  getUserBidForAuction,
  searchAuctions,
  verifyAuction,
  upload
} = require('../controllers/auctionController');
const { authenticate } = require('../middleware/authMiddleware');

// Public routes (no authentication required)
router.get('/', getAllAuctions); // Get all auctions with filters
router.get('/search', searchAuctions); // Search auctions - MUST come before /:id

// Protected routes (authentication required)
router.use(authenticate);

// Auction management routes
router.post('/', 
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'documents', maxCount: 5 }
  ]), 
  createAuction
); // Create new auction

router.get('/owner/me', getAuctionsByOwner); // Get user's own auctions

router.put('/:id', 
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'documents', maxCount: 5 }
  ]), 
  updateAuction
); // Update auction

router.delete('/:id', deleteAuction); // Delete auction

// Bidding routes
router.post('/:id/bid', authenticate, placeBid); // Place a bid
router.get('/:id/bids', getAuctionBids); // Get auction bids
router.patch('/:id/verify', verifyAuction); // Verify auction (admin only)
router.get('/:auctionId/user-bid', authenticate, getUserBidForAuction); // Get user's latest bid for this auction

router.get('/:id', getAuctionById); // Get auction by ID
// Admin routes (you may want to add admin middleware)

module.exports = router; 