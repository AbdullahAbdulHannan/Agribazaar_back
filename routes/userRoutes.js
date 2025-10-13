const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/authMiddleware');
const express = require('express');
const router = express.Router();

// Public routes
router.post('/signup', userController.signup);
router.post('/login', userController.login);
router.post('/google', userController.googleAuth);
router.post('/resend-verification', userController.resendVerificationEmail);
router.get('/verify-email/:token', userController.verifyEmail);

// Protected routes (require authentication)
router.use(authenticate);
router.put('/update-profile', userController.updateProfile);
router.get('/me', userController.getMe);
router.post('/address', userController.saveAddress);

module.exports = router;