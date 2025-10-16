const Auction = require('../models/auctionModel');

const updateAuctionStatuses = async () => {
  try {
    const now = new Date();
    
    // Update active auctions that have ended
    await Auction.updateMany(
      {
        endTime: { $lte: now },
        status: { $ne: 'ended' }
      },
      { $set: { status: 'ended' } }
    );

    // Update upcoming auctions that have started
    await Auction.updateMany(
      {
        startTime: { $lte: now },
        endTime: { $gt: now },
        status: { $ne: 'active' }
      },
      { $set: { status: 'active' } }
    );

    console.log('Auction statuses updated successfully');
  } catch (error) {
    console.error('Error updating auction statuses:', error);
  }
};

// Run every 5 minutes
setInterval(updateAuctionStatuses, 5 * 60 * 1000);

// Initial run
updateAuctionStatuses();

module.exports = { updateAuctionStatuses };
