const Auction = require('../model/auctionModel');
const User = require('../model/userModel');
const { uploadToLocal } = require('../utils/localUpload');
const multer = require('multer');
const { createBidNotification, createNotification } = require('./notificationController');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'), false);
    }
  }
});

// Create new auction
const createAuction = async (req, res) => {
  try {
    const {
      title,
      location,
      area,
      landType,
      leaseType,
      cropType,
      plantAge,
      waterSource,
      soilType,
      yield: yieldInfo,
      startingBid,
      bidIncrement,
      reservePrice,
      startTime,
      endTime,
      leaseDuration,
      paymentTerms,
      securityDeposit
    } = req.body;

    // Upload images
    const imageUrls = [];
    if (req.files && req.files.images) {
      const imageFiles = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
      
             for (const file of imageFiles) {
         const result = await uploadToLocal(file.buffer, 'uploads/auction-images', file.originalname);
         imageUrls.push(result.url);
       }
    }

    // Upload documents
    const documentUrls = [];
    if (req.files && req.files.documents) {
      const documentFiles = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];
      
             for (const file of documentFiles) {
         const result = await uploadToLocal(file.buffer, 'uploads/auction-documents', file.originalname);
         documentUrls.push(result.url);
       }
    }

    // Convert and validate numeric fields
    const numericFields = {
      area: parseFloat(area),
      startingBid: parseFloat(startingBid),
      bidIncrement: parseFloat(bidIncrement),
      leaseDuration: parseInt(leaseDuration, 10),
      plantAge: plantAge ? parseInt(plantAge, 10) : undefined,
      reservePrice: reservePrice ? parseFloat(reservePrice) : undefined,
      securityDeposit: securityDeposit ? parseFloat(securityDeposit) : undefined
    };

    // Validate required fields
    const requiredFields = {
      title,
      location,
      landType,
      leaseType,
      cropType,
      waterSource,
      soilType,
      startTime,
      endTime
    };

    // Check for missing required fields
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Check for invalid numeric fields
    const invalidNumericFields = Object.entries(numericFields)
      .filter(([key, value]) => isNaN(value) && value !== undefined)
      .map(([key]) => key);

    if (invalidNumericFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid numeric values for: ${invalidNumericFields.join(', ')}`
      });
    }

    // Parse dates
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use a valid date format.'
      });
    }

    // Create auction with validated and converted data
    const auction = new Auction({
      title: title.trim(),
      location: location.trim(),
      area: numericFields.area,
      landType,
      leaseType,
      cropType: cropType.trim(),
      plantAge: numericFields.plantAge,
      waterSource,
      soilType,
      yield: yieldInfo ? yieldInfo.trim() : '',
      startingBid: numericFields.startingBid,
      bidIncrement: numericFields.bidIncrement,
      reservePrice: numericFields.reservePrice,
      startTime: startDate,
      endTime: endDate,
      leaseDuration: numericFields.leaseDuration,
      paymentTerms: paymentTerms || '',
      securityDeposit: numericFields.securityDeposit,
      ownerId: req.user._id,
      images: imageUrls,
      documents: documentUrls,
      status: 'active'
    });

    await auction.save();

    // Send notification to auction creator
    await createNotification(
      req.user._id,
      'Auction Created',
      `Your auction "${title}" has been created successfully.`,
      'auction',
      `/auctions/${auction._id}`,
      { auctionId: auction._id, status: 'created' }
    );

    res.status(201).json({
      success: true,
      message: 'Auction created successfully',
      data: auction
    });

  } catch (error) {
    console.error('Error creating auction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create auction'
    });
  }
};

// Get all auctions with filters
const getAllAuctions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      location,
      cropType,
      minBid,
      maxBid,
      verified,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    // Status filter
    if (status) {
      if (status === 'active') {
        const now = new Date();
        filter.status = 'active';
        filter.startTime = { $lte: now };
        filter.endTime = { $gte: now };
      } else if (status === 'upcoming') {
        const now = new Date();
        filter.status = 'active';
        filter.startTime = { $gt: now };
      } else if (status === 'ended') {
        const now = new Date();
        filter.$or = [
          { status: 'ended' },
          { endTime: { $lt: now } }
        ];
      } else {
        filter.status = status;
      }
    }

    // Location filter
    if (location) {
      filter.location = { $regex: location, $options: 'i' };
    }

    // Crop type filter
    if (cropType) {
      filter.cropType = { $regex: cropType, $options: 'i' };
    }

    // Bid range filter
    if (minBid || maxBid) {
      filter.currentBid = {};
      if (minBid) filter.currentBid.$gte = parseInt(minBid);
      if (maxBid) filter.currentBid.$lte = parseInt(maxBid);
    }

    // Verification filter
    if (verified !== undefined) {
      filter.verified = verified === 'true';
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const auctions = await Auction.find(filter)
      .populate('ownerId', 'name email phone')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Auction.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: auctions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auctions'
    });
  }
};

// Get auction by ID
const getAuctionById = async (req, res) => {
  try {
    const { id } = req.params;

    const auction = await Auction.findById(id)
      .populate('ownerId', 'name email phone');

    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Increment view count
    await auction.incrementViews();

    res.status(200).json({
      success: true,
      data: auction
    });

  } catch (error) {
    console.error('Error fetching auction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auction'
    });
  }
};

// Get auctions by owner (seller)
const getAuctionsByOwner = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const ownerId = req.user._id;

    const filter = { ownerId };

    if (status) {
      filter.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const auctions = await Auction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Auction.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: auctions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching owner auctions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auctions'
    });
  }
};

// Update auction
const updateAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const auction = await Auction.findById(id);

    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Check if user is the owner
    if (auction.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own auctions'
      });
    }

    // Prevent updates if auction has bids
    if (auction.totalBids > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update auction that has bids'
      });
    }

    // Normalize repeated fields from multipart (string or array)
    if (updateData.existingImages && !Array.isArray(updateData.existingImages)) {
      updateData.existingImages = [updateData.existingImages];
    }
    if (updateData.existingDocuments && !Array.isArray(updateData.existingDocuments)) {
      updateData.existingDocuments = [updateData.existingDocuments];
    }

    // Coerce empty strings to undefined so we don't overwrite with blanks
    Object.keys(updateData).forEach((k) => {
      if (typeof updateData[k] === 'string' && updateData[k].trim() === '') {
        updateData[k] = undefined;
      }
    });

    // Handle existing images and documents
    let finalImages = [...auction.images];
    let finalDocuments = [...auction.documents];

    // Handle existing images removal
    if (updateData.existingImages) {
      finalImages = updateData.existingImages;
    }

    // Handle existing documents removal
    if (updateData.existingDocuments) {
      finalDocuments = updateData.existingDocuments;
    }

    // Handle new file uploads if provided
    if (req.files) {
      if (req.files.images) {
        const imageFiles = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
        const imageUrls = [];
        
        for (const file of imageFiles) {
          const result = await uploadToLocal(file.buffer, 'uploads/auction-images', file.originalname);
          imageUrls.push(result.url);
        }
        
        finalImages = [...finalImages, ...imageUrls];
      }

      if (req.files.documents) {
        const documentFiles = Array.isArray(req.files.documents) ? req.files.documents : [req.files.documents];
        const documentUrls = [];
        
        for (const file of documentFiles) {
          const result = await uploadToLocal(file.buffer, 'uploads/auction-documents', file.originalname);
          documentUrls.push(result.url);
        }
        
        finalDocuments = [...finalDocuments, ...documentUrls];
      }
    }

    // Update the data with final file arrays
    updateData.images = finalImages;
    updateData.documents = finalDocuments;

    // Remove the temporary fields
    delete updateData.existingImages;
    delete updateData.existingDocuments;

    // Parse dates if provided
    if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
    if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);

    // Check if startTime or endTime have been modified
    const startTimeChanged = updateData.startTime && auction.startTime && 
      new Date(updateData.startTime).getTime() !== auction.startTime.getTime();
    const endTimeChanged = updateData.endTime && auction.endTime && 
      new Date(updateData.endTime).getTime() !== auction.endTime.getTime();

    console.log('Update debug:', {
      originalStartTime: auction.startTime,
      newStartTime: updateData.startTime,
      startTimeChanged,
      originalEndTime: auction.endTime,
      newEndTime: updateData.endTime,
      endTimeChanged,
      updateDataKeys: Object.keys(updateData)
    });

    // If times haven't been changed, remove them from updateData to avoid validation
    if (!startTimeChanged && !endTimeChanged) {
      delete updateData.startTime;
      delete updateData.endTime;
      console.log('Removed unchanged date fields from update');
    }

    // Additional validation for changed dates
    if (startTimeChanged || endTimeChanged) {
      const now = new Date();
      
      // Validate start time is in the future (only if changed)
      if (startTimeChanged && new Date(updateData.startTime) <= now) {
        return res.status(400).json({
          success: false,
          message: 'Start time must be in the future'
        });
      }
      
      // Validate end time is after start time (only if either changed)
      if ((startTimeChanged || endTimeChanged) && 
          new Date(updateData.endTime) <= new Date(updateData.startTime)) {
        return res.status(400).json({
          success: false,
          message: 'End time must be after start time'
        });
      }
    }

    const updatedAuction = await Auction.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: false } // Temporarily disable validators
    ).populate('ownerId', 'name email phone');

    res.status(200).json({
      success: true,
      message: 'Auction updated successfully',
      data: updatedAuction
    });

  } catch (error) {
    console.error('Error updating auction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update auction'
    });
  }
};

// Delete auction
const deleteAuction = async (req, res) => {
  try {
    const { id } = req.params;

    const auction = await Auction.findById(id);

    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Check if user is the owner
    if (auction.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own auctions'
      });
    }

    // Prevent deletion if auction has bids
    if (auction.totalBids > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete auction that has bids'
      });
    }

    await Auction.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Auction deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting auction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete auction'
    });
  }
};

// Place a bid
const placeBid = async (req, res) => {
  try {
    const { id } = req.params;
    const { bidAmount } = req.body;

    const auction = await Auction.findById(id);

    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Check if auction is active
    if (!auction.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'Auction is not active'
      });
    }

    // Check if user is not the owner
    if (auction.ownerId.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot bid on your own auction'
      });
    }

    // Validate bid amount
    const minBid = auction.currentBid + auction.bidIncrement;
    if (bidAmount < minBid) {
      return res.status(400).json({
        success: false,
        message: `Bid must be at least Rs.${minBid.toLocaleString()}`
      });
    }

    // Add new bid
    auction.bids.push({
      bidder: req.user._id,
      amount: bidAmount,
      timestamp: new Date()
    });

    // Update current bid and bidder
    auction.currentBid = bidAmount;
    auction.currentBidder = req.user._id;
    auction.totalBids += 1;

    // Save the auction first
    await auction.save();

    // Notify the bidder
    await createBidNotification(
      req.user._id,
      auction._id,
      bidAmount,
      false // isAuctionOwner = false
    );

    // Notify auction owner
    await createBidNotification(
      auction.ownerId,
      auction._id,
      bidAmount,
      true // isAuctionOwner = true
    );

    // Notify previous bidder if exists
    const previousBidder = auction.bids[auction.bids.length - 2]?.bidder;
    if (previousBidder && previousBidder.toString() !== req.user._id.toString()) {
      await createNotification(
        previousBidder,
        'Outbid',
        `Your bid of ₹${auction.currentBid} on "${auction.title}" has been outbid.`,
        'auction',
        `/auctions/${auction._id}`,
        { 
          auctionId: auction._id,
          status: 'outbid',
          bidAmount: auction.currentBid,
          newBidAmount: bidAmount
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Bid placed successfully',
      data: {
        auctionId: auction._id,
        currentBid: auction.currentBid,
        totalBids: auction.totalBids
      }
    });

  } catch (error) {
    console.error('Error placing bid:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get user's latest bid for an auction
const getUserBidForAuction = async (req, res) => {
  try {
    console.log('getUserBidForAuction called with params:', req.params);
    console.log('Authenticated user ID:', req.user?._id);
    
    const { auctionId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      console.error('No user ID found in request');
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    console.log('Looking up auction:', auctionId);
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      console.error('Auction not found:', auctionId);
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Find the user's latest bid
    const userBid = auction.bids
      .filter(bid => {
        // Convert both to string for comparison to handle both ObjectId and string cases
        const bidderId = bid.bidder._id ? bid.bidder._id.toString() : bid.bidder.toString();
        return bidderId === userId.toString();
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    res.status(200).json({
      success: true,
      data: {
        userBid: userBid ? userBid.amount : null,
        userBidTimestamp: userBid ? userBid.timestamp : null
      }
    });
  } catch (error) {
    console.error('Error getting user bid:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get auction bids
const getAuctionBids = async (req, res) => {
  try {
    const { id } = req.params;

    const auction = await Auction.findById(id);

    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // In a real application, you would have a separate Bid model
    // For now, we'll return basic bid information
    const bids = [
      {
        _id: 'bid-1',
        bidAmount: auction.currentBid,
        bidder: { name: 'Anonymous Bidder' },
        createdAt: auction.updatedAt
      }
    ];

    res.status(200).json({
      success: true,
      data: bids
    });

  } catch (error) {
    console.error('Error fetching auction bids:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bids'
    });
  }
};

// Search auctions
const searchAuctions = async (req, res) => {
  try {
    const { q, location, cropType, minBid, maxBid } = req.query;

    const filter = {};

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } },
        { cropType: { $regex: q, $options: 'i' } }
      ];
    }

    if (location) {
      filter.location = { $regex: location, $options: 'i' };
    }

    if (cropType) {
      filter.cropType = { $regex: cropType, $options: 'i' };
    }

    if (minBid || maxBid) {
      filter.currentBid = {};
      if (minBid) filter.currentBid.$gte = parseInt(minBid);
      if (maxBid) filter.currentBid.$lte = parseInt(maxBid);
    }

    const auctions = await Auction.find(filter)
      .populate('ownerId', 'name')
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      data: auctions
    });

  } catch (error) {
    console.error('Error searching auctions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search auctions'
    });
  }
};

// Verify auction (admin only)
const verifyAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const { verified } = req.body;

    // Check if user is admin (you'll need to implement admin check)
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can verify auctions'
      });
    }

    const auction = await Auction.findByIdAndUpdate(
      id,
      { verified },
      { new: true }
    ).populate('ownerId', 'name email');

    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    res.status(200).json({
      success: true,
      message: `Auction ${verified ? 'verified' : 'unverified'} successfully`,
      data: auction
    });

  } catch (error) {
    console.error('Error verifying auction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify auction'
    });
  }
};

module.exports = {
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
}; 