const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
    releaseEscrowFunds,
    raiseDispute,
    resolveDispute,
    processEscrowReleases
} = require('../controllers/orderController');

// Protect all routes with authentication
router.use(authenticate);

// @route   POST /api/escrow/orders/:orderId/release
// @desc    Release escrow funds to seller(s)
// @access  Private (Buyer or Admin)
router.post('/orders/:orderId/release', async (req, res, next) => {
    try {
        await releaseEscrowFunds(req, res);
    } catch (error) {
        next(error);
    }
});

// @route   POST /api/escrow/orders/:orderId/disputes
// @desc    Raise a dispute on an escrow payment
// @access  Private (Buyer or Seller)
router.post('/orders/:orderId/disputes', async (req, res, next) => {
    try {
        await raiseDispute(req, res);
    } catch (error) {
        next(error);
    }
});

// @route   POST /api/escrow/orders/:orderId/disputes/resolve
// @desc    Resolve a dispute (admin only)
// @access  Private (Admin)
router.post('/orders/:orderId/disputes/resolve', async (req, res, next) => {
    try {
        // Verify admin role
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized. Admin access required.'
            });
        }
        await resolveDispute(req, res);
    } catch (error) {
        next(error);
    }
});

// @route   POST /api/escrow/process-releases
// @desc    Process automatic escrow releases (cron job)
// @access  Private (System)
router.post('/process-releases', 
    // This should be protected by a secret token or IP whitelisting in production
    async (req, res, next) => {
        try {
            // Verify the request is from our system (e.g., using a secret token)
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            
            if (token !== process.env.INTERNAL_API_SECRET) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized'
                });
            }
            
            const result = await processEscrowReleases();
            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;
