const jwt = require('jsonwebtoken');
const User = require('../model/userModel');

// General authentication middleware for all users
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ 
    success: false,
    message: "No authentication token provided" 
  });

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password -emailVerificationToken -emailVerificationExpires');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "User not found" 
      });
    }

    // Check if email is verified (except for email verification routes)
    if (!user.isEmailVerified && !req.path.includes('verify-email') && !req.path.includes('resend-verification')) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address to access this resource",
        requiresVerification: true
      });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: "Session expired. Please log in again."
      });
    }
    
    res.status(401).json({ 
      success: false,
      message: "Invalid or expired token" 
    });
  }
};

// Middleware to check if user is a seller
const authenticateSeller = async (req, res, next) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ 
      success: false,
      message: 'Access denied. Seller account required.' 
    });
  }
  next();
};

// Middleware to check if email is verified
const ensureEmailVerified = async (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Please verify your email address to access this resource',
      requiresVerification: true
    });
  }
  next();
};

module.exports = { 
  authenticate, 
  authenticateSeller, 
  ensureEmailVerified 
};
