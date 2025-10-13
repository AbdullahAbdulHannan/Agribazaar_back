const mongoose = require('mongoose');

const auctionSchema = new mongoose.Schema({
  // Basic Information
  title: {
    type: String,
    required: [true, 'Auction title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true,
    maxlength: [100, 'Location cannot exceed 100 characters']
  },
  area: {
    type: Number,
    required: [true, 'Area is required'],
    min: [0.1, 'Area must be greater than 0'],
    max: [10000, 'Area cannot exceed 10,000 acres']
  },
  landType: {
    type: String,
    required: [true, 'Land type is required'],
    enum: {
      values: ['agricultural', 'irrigated', 'rainfed', 'mixed'],
      message: 'Land type must be one of: agricultural, irrigated, rainfed, mixed'
    }
  },
  leaseType: {
    type: String,
    required: [true, 'Lease type is required'],
    enum: {
      values: ['long-term', 'medium-term', 'short-term', 'seasonal'],
      message: 'Lease type must be one of: long-term, medium-term, short-term, seasonal'
    }
  },

  // Farm Details
  cropType: {
    type: String,
    required: [true, 'Crop type is required'],
    trim: true,
    maxlength: [50, 'Crop type cannot exceed 50 characters']
  },
  plantAge: {
    type: Number,
    min: [0, 'Plant age cannot be negative'],
    max: [120, 'Plant age cannot exceed 120 months']
  },
  waterSource: {
    type: String,
    required: [true, 'Water source is required'],
    trim: true,
    maxlength: [100, 'Water source cannot exceed 100 characters']
  },
  soilType: {
    type: String,
    required: [true, 'Soil type is required'],
    trim: true,
    maxlength: [50, 'Soil type cannot exceed 50 characters']
  },
  yield: {
    type: String,
    trim: true,
    maxlength: [100, 'Yield information cannot exceed 100 characters']
  },

  // Auction Details
  startingBid: {
    type: Number,
    required: [true, 'Starting bid is required'],
    min: [1000, 'Starting bid must be at least Rs.1,000'],
    max: [1000000000, 'Starting bid cannot exceed Rs.1,000,000,000']
  },
  bidIncrement: {
    type: Number,
    required: [true, 'Bid increment is required'],
    min: [1000, 'Bid increment must be at least Rs.1,000'],
    max: [10000000, 'Bid increment cannot exceed Rs.10,000,000']
  },
  reservePrice: {
    type: Number,
    min: [0, 'Reserve price cannot be negative'],
    max: [1000000000, 'Reserve price cannot exceed Rs.1,000,000,000']
  },
  startTime: {
    type: Date,
    required: [true, 'Start time is required'],
    validate: {
      validator: function(value) {
        // Skip validation if this is an update and the value hasn't changed
        if (this.isModified && !this.isModified('startTime')) {
          return true;
        }
        return value > new Date();
      },
      message: 'Start time must be in the future'
    }
  },
  endTime: {
    type: Date,
    required: [true, 'End time is required'],
    validate: {
      validator: function(value) {
        // Skip validation if this is an update and neither time has changed
        if (this.isModified && !this.isModified('startTime') && !this.isModified('endTime')) {
          return true;
        }
        return value > this.startTime;
      },
      message: 'End time must be after start time'
    }
  },
  leaseDuration: {
    type: Number,
    required: [true, 'Lease duration is required'],
    min: [1, 'Lease duration must be at least 1 month'],
    max: [120, 'Lease duration cannot exceed 120 months']
  },
  paymentTerms: {
    type: String,
    trim: true,
    maxlength: [500, 'Payment terms cannot exceed 500 characters']
  },
  securityDeposit: {
    type: Number,
    min: [0, 'Security deposit cannot be negative'],
    max: [100000000, 'Security deposit cannot exceed Rs.100,000,000']
  },

  // Owner and Verification
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Owner ID is required']
  },
  verified: {
    type: Boolean,
    default: false
  },

  // Files
  images: {
    type: [String],
    validate: {
      validator: function(v) {
        return v.length <= 10;
      },
      message: 'Cannot upload more than 10 images'
    }
  },
  documents: {
    type: [String],
    validate: {
      validator: function(v) {
        return v.length <= 5;
      },
      message: 'Cannot upload more than 5 documents'
    }
  },

  // Additional fields for auction management
  status: {
    type: String,
    enum: ['draft', 'active', 'ended', 'cancelled'],
    default: 'draft'
  },
  currentBid: {
    type: Number,
    default: function() {
      return this.startingBid;
    }
  },
  totalBids: {
    type: Number,
    default: 0
  },
  views: {
    type: Number,
    default: 0
  },
  watchlistCount: {
    type: Number,
    default: 0
  },
  // Bids array to store bid history
  bids: [{
    bidder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'Bid amount cannot be negative']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['active', 'outbid', 'won', 'lost'],
      default: 'active'
    }
  }],
  // Reference to current highest bidder
  currentBidder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for auction status based on time
auctionSchema.virtual('auctionStatus').get(function() {
  const now = new Date();
  
  if (this.status === 'cancelled') return 'cancelled';
  if (this.status === 'draft') return 'draft';
  
  if (now < this.startTime) return 'upcoming';
  if (now >= this.startTime && now <= this.endTime) return 'active';
  return 'ended';
});

// Virtual for time remaining
auctionSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  const end = new Date(this.endTime);
  const diff = end - now;
  
  if (diff <= 0) return 'ended';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
});

// Virtual for minimum next bid
auctionSchema.virtual('minNextBid').get(function() {
  return this.currentBid + this.bidIncrement;
});

// Indexes for better query performance
auctionSchema.index({ ownerId: 1 });
auctionSchema.index({ status: 1 });
auctionSchema.index({ startTime: 1 });
auctionSchema.index({ endTime: 1 });
auctionSchema.index({ location: 1 });
auctionSchema.index({ cropType: 1 });
auctionSchema.index({ verified: 1 });
auctionSchema.index({ currentBid: 1 });
auctionSchema.index({ createdAt: -1 });

// Compound indexes for common queries
auctionSchema.index({ status: 1, startTime: 1 });
auctionSchema.index({ status: 1, endTime: 1 });
auctionSchema.index({ location: 1, cropType: 1 });
auctionSchema.index({ verified: 1, status: 1 });

// Pre-save middleware to update current bid if not set
auctionSchema.pre('save', function(next) {
  if (!this.currentBid) {
    this.currentBid = this.startingBid;
  }
  next();
});

// Static method to find active auctions
auctionSchema.statics.findActive = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    startTime: { $lte: now },
    endTime: { $gte: now }
  });
};

// Static method to find upcoming auctions
auctionSchema.statics.findUpcoming = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    startTime: { $gt: now }
  });
};

// Static method to find ended auctions
auctionSchema.statics.findEnded = function() {
  const now = new Date();
  return this.find({
    $or: [
      { status: 'ended' },
      { endTime: { $lt: now } }
    ]
  });
};

// Instance method to check if auction is active
auctionSchema.methods.isActive = function() {
  const now = new Date();
  return this.status === 'active' && 
         now >= this.startTime && 
         now <= this.endTime;
};

// Instance method to check if auction has ended
auctionSchema.methods.hasEnded = function() {
  const now = new Date();
  return this.status === 'ended' || now > this.endTime;
};

// Instance method to get auction duration in days
auctionSchema.methods.getDurationInDays = function() {
  const start = new Date(this.startTime);
  const end = new Date(this.endTime);
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Instance method to increment view count
auctionSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

// Instance method to increment watchlist count
auctionSchema.methods.incrementWatchlist = function() {
  this.watchlistCount += 1;
  return this.save();
};

// Instance method to decrement watchlist count
auctionSchema.methods.decrementWatchlist = function() {
  if (this.watchlistCount > 0) {
    this.watchlistCount -= 1;
  }
  return this.save();
};

const Auction = mongoose.model('Auction', auctionSchema);

module.exports = Auction; 