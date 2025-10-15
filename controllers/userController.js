const User = require('../model/userModel');
const { generateToken } = require('../utils/generateToken');
const axios = require('axios');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

// Generate email verification token
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

exports.signup = async (req, res) => {
  const { email, name, username, phone, password, role, address } = req.body;
  
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [
        { email },
        { username }
      ] 
    });
    
    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ 
          success: false,
          message: 'Email already exists' 
        });
      }
      if (existingUser.username === username) {
        return res.status(400).json({ 
          success: false,
          message: 'Username already taken' 
        });
      }
    }

    // Generate verification token
    const verificationToken = generateVerificationToken();
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24); // Token expires in 24 hours

    // Optional geocoding for initial address
    let addresses = [];
    if (address) {
      const { geocodeAddress, buildFullAddress } = require('../utils/geocode');
      const full = typeof address === 'string' ? address : buildFullAddress(address);
      const geo = await geocodeAddress(full);
      const baseAddr = typeof address === 'string' ? { street: address } : address;
      addresses.push({
        ...baseAddr,
        street: baseAddr.street || '',
        addressLine2: baseAddr.addressLine2 || '',
        area: baseAddr.area || '',
        city: baseAddr.city || '',
        state: baseAddr.state || '',
        postalCode: baseAddr.postalCode || '',
        country: baseAddr.country || 'Pakistan',
        latitude: geo?.latitude,
        longitude: geo?.longitude,
        isDefault: true
      });
    }

    // Create user with verification token
    const user = await User.create({ 
      email, 
      name, 
      username, 
      phone, 
      password, 
      role, 
      addresses,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires
    });

    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, verificationToken);
    
    if (!emailSent) {
      logger.error(`Failed to send verification email to ${email}`);
      // Continue anyway, we'll handle this gracefully
    }

    // Generate token for immediate login (but require email verification for full access)
    const token = generateToken(user._id);
    
    res.status(201).json({ 
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      user: { 
        id: user._id,
        email: user.email, 
        name: user.name,
        username: user.username,  
        phone: user.phone, 
        role: user.role,
        isEmailVerified: user.isEmailVerified
      }, 
      token 
    });
  } catch (err) {       
    logger.error('Error in signup:', err);
    res.status(500).json({ 
      success: false,
      message: 'Error during registration',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  } 
};

// Update user profile (for Google users to add additional info)
exports.updateProfile = async (req, res) => {
  try {
    const { username, phone, role, address, setDefaultAddressId } = req.body;
    const userId = req.user.id; // This will come from auth middleware

    // Check if username is already taken by another user
    if (username) {
      const existingUser = await User.findOne({ username, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken' });
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user fields
    if (username) user.username = username;
    if (phone !== undefined) user.phone = phone;
    if (role) user.role = role;

    // Handle address update/addition
    if (address) {
      const { geocodeAddress, buildFullAddress } = require('../utils/geocode');
      const full = typeof address === 'string' ? address : buildFullAddress(address);
      const geo = await geocodeAddress(full);
      const baseAddr = typeof address === 'string' ? { street: address } : address;

      const newAddr = {
        label: baseAddr.label || 'Default',
        street: baseAddr.street || baseAddr.addressLine1 || full,
        addressLine2: baseAddr.addressLine2 || '',
        area: baseAddr.area || '',
        city: baseAddr.city || '',
        state: baseAddr.state || '',
        postalCode: baseAddr.postalCode || '',
        country: baseAddr.country || 'Pakistan',
        latitude: geo?.latitude,
        longitude: geo?.longitude,
      };

      // If no addresses, set as default
      if (!Array.isArray(user.addresses) || user.addresses.length === 0) {
        user.addresses = [{ ...newAddr, isDefault: true }];
      } else {
        user.addresses.push({ ...newAddr, isDefault: false });
      }
    }

    if (setDefaultAddressId) {
      if (Array.isArray(user.addresses)) {
        user.addresses = user.addresses.map(a => ({ ...a.toObject?.() || a, isDefault: a._id?.toString() === setDefaultAddressId }));
      }
    }

    await user.save();

    res.status(200).json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
        phone: user.phone,
        role: user.role,
        profilePicture: user.profilePicture,
        authProvider: user.authProvider,
        addresses: user.addresses
      }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
};;

exports.googleAuth = async (req, res) => {
  const { googleToken } = req.body;
  
  console.log('Received Google auth request with token:', googleToken ? 'Token present' : 'No token');
  
  if (!googleToken) {
    return res.status(400).json({ message: 'Google token is required' });
  }
  
  try {
    // Verify the Google token with Google's API
    console.log('Verifying token with Google API...');
    const googleResponse = await axios.get(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${googleToken}`);
    console.log('Google API response:', googleResponse.data);
    
    const { email, name, picture } = googleResponse.data;

    if (!email) {
      return res.status(400).json({ message: 'Invalid Google token - no email found' });
    }

    // Check if user exists
    let user = await User.findOne({ email });
    
    if (!user) {
      // Create new user if doesn't exist
      console.log('Creating new user for email:', email);
      user = await User.create({
        email,
        name: name || email.split('@')[0],
        username: email.split('@')[0], // Use email prefix as username
        phone: '', // Will be updated later
        role: 'buyer', // Default role
        profilePicture: picture || '',
        authProvider: 'google',
        isEmailVerified: true, // Google-verified emails are already verified
        emailVerificationToken: undefined,
        emailVerificationExpires: undefined
      });
    } else {
      console.log('User found for email:', email);
      // Update profile picture if it's a Google user
      if (picture && user.authProvider === 'google') {
        user.profilePicture = picture;
        await user.save();
      }
      
      // Check if this is a Google user who needs to complete their profile
      const needsProfileSetup = user.authProvider === 'google' && (!user.phone || !user.username);
      if (needsProfileSetup) {
        console.log('Google user needs profile setup');
      }
    }

    const token = generateToken(user._id);
    
    // Check if user needs profile setup
    const needsProfileSetup = user.authProvider === 'google' && (!user.phone || !user.username);
    
    res.status(200).json({ 
      user: { 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        username: user.username, 
        phone: user.phone, 
        role: user.role,
        profilePicture: user.profilePicture,
        authProvider: user.authProvider
      }, 
      token,
      needsProfileSetup
    });
  } catch (err) {
    console.error('Google auth error details:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status
    });
    res.status(500).json({ 
      message: 'Google authentication failed',
      error: err.message,
      details: err.response?.data
    });
  }
};;

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });     
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password' 
      });
    }
    
    // Check if user is a Google OAuth user
    if (user.authProvider === 'google') {
      return res.status(400).json({ 
        success: false,
        message: 'This account was created with Google. Please use "Sign in with Google" instead.' 
      });
    }
    
    // Check password
    if (user.password !== password) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password' 
      });
    }
    
    // Check if email is verified
    if (!user.isEmailVerified) {
      // If token is expired, generate a new one
      let verificationToken = user.emailVerificationToken;
      let needsNewToken = false;
      
      if (!verificationToken || (user.emailVerificationExpires && user.emailVerificationExpires < new Date())) {
        verificationToken = generateVerificationToken();
        const verificationExpires = new Date();
        verificationExpires.setHours(verificationExpires.getHours() + 24);
        
        user.emailVerificationToken = verificationToken;
        user.emailVerificationExpires = verificationExpires;
        await user.save();
        needsNewToken = true;
      }
      
      // Resend verification email if needed
      if (needsNewToken) {
        await emailService.sendVerificationEmail(user.email, verificationToken);
      }
      
      return res.status(403).json({
        success: false,
        message: 'Please verify your email address. A new verification link has been sent to your email.',
        requiresVerification: true
      });
    }
    
    // Generate token for authenticated user
    const token = generateToken(user._id);
    
    res.status(200).json({ 
      success: true,
      user: { 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        username: user.username, 
        phone: user.phone, 
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        authProvider: user.authProvider
      }, 
      token 
    });
  } catch (err) {       
    logger.error('Login error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Error during login',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  } 
};

// Verify email with token
exports.verifyEmail = async (req, res) => {
  const { token } = req.params;
  
  try {
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }
    
    // Mark email as verified and clear verification token
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Email verified successfully!',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isEmailVerified: true
      }
    });
  } catch (err) {
    logger.error('Email verification error:', err);
    res.status(500).json({
      success: false,
      message: 'Error verifying email',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  }
};

// Resend verification email
exports.resendVerificationEmail = async (req, res) => {
  const { email } = req.body;
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address'
      });
    }
    
    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }
    
    // Generate new verification token
    const verificationToken = generateVerificationToken();
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);
    
    // Save token to user
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = verificationExpires;
    await user.save();
    
    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, verificationToken);
    
    if (!emailSent) {
      logger.error(`Failed to send verification email to ${email}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again later.'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Verification email sent. Please check your inbox.'
    });
  } catch (err) {
    logger.error('Resend verification email error:', err);
    res.status(500).json({
      success: false,
      message: 'Error sending verification email',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  }
};

// Get current authenticated user's profile
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
        phone: user.phone,
        role: user.role,
        profilePicture: user.profilePicture,
        authProvider: user.authProvider,
        addresses: user.addresses || []
      }
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
};

// Add or update an address explicitly
exports.saveAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId, address } = req.body; // if addressId provided, update; else add
    if (!address) return res.status(400).json({ message: 'Address is required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { geocodeAddress, buildFullAddress } = require('../utils/geocode');
    const full = typeof address === 'string' ? address : buildFullAddress(address);
    const geo = await geocodeAddress(full);
    const baseAddr = typeof address === 'string' ? { street: address } : address;
    const patch = {
      label: baseAddr.label || 'Address',
      street: baseAddr.street || baseAddr.addressLine1 || full,
      addressLine2: baseAddr.addressLine2 || '',
      area: baseAddr.area || '',
      city: baseAddr.city || '',
      state: baseAddr.state || '',
      postalCode: baseAddr.postalCode || '',
      country: baseAddr.country || 'Pakistan',
      latitude: geo?.latitude,
      longitude: geo?.longitude,
    };

    if (addressId) {
      const idx = Array.isArray(user.addresses) ? user.addresses.findIndex(a => a._id?.toString() === addressId) : -1;
      if (idx === -1) return res.status(404).json({ message: 'Address not found' });
      user.addresses[idx] = { ...user.addresses[idx].toObject?.() || user.addresses[idx], ...patch };
    } else {
      if (!Array.isArray(user.addresses)) user.addresses = [];
      user.addresses.push({ ...patch, isDefault: user.addresses.length === 0 });
    }

    await user.save();
    res.status(200).json({ addresses: user.addresses });
  } catch (err) {
    console.error('Save address error:', err);
    res.status(500).json({ message: 'Failed to save address' });
  }
};