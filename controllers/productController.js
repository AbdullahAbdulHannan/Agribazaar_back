const Product = require('../model/productModel');
const { createProductNotification } = require('../routes/notificationRoutes');

exports.createProduct = async (req, res) => {
  const { name, price, category, image, stock, deliveryCharges, type, grade, harvestDate, expiryDate, auctionEndTime, startingBid, minIncrement } = req.body;
  try {
    const productData = {
      name,
      price,  
      category,
      image,
      seller: req.user.id, // Use authenticated user's ID
      stock,
      deliveryCharges,
      type: type || 'marketplace'
    };

    // Add auction specific fields if type is auction
    if (type === 'auction') {
      productData.auctionEndTime = auctionEndTime;
      productData.startingBid = startingBid;
      productData.currentBid = startingBid;
      productData.minIncrement = minIncrement;
    }

    const product = await Product.create(productData);
    
    // Send notification to seller about product creation
    await createProductNotification(
      req.user.id,
      product._id,
      type === 'auction' ? 'Auction' : 'Marketplace'
    );
    
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message }); 
  }
}

exports.getProducts = async (req, res) => {
  try {
    const { type, category, seller } = req.query;
    let filter = {};

    // Filter by product type
    if (type) {
      filter.type = type;
    }

    // Filter by category
    if (category) {
      filter.category = category;
    }

    // Filter by seller
    if (seller) {
      filter.seller = seller;
    }

    const products = await Product.find(filter).populate('seller', 'name email');
    res.status(200).json(products);
    
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

exports.getProductsByType = async (req, res) => {
  try {
    const { type } = req.params;
    const products = await Product.find({ type }).populate('seller', 'name email');
    res.status(200).json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

// Search products by name or category
exports.searchProducts = async (req, res) => {
  try {
    const { q: searchQuery, type } = req.query;
    
    if (!searchQuery) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const query = {
      $or: [
        { name: { $regex: searchQuery, $options: 'i' } },
        { category: { $regex: searchQuery, $options: 'i' } }
      ]
    };

    // Filter by product type if provided
    if (type) {
      query.type = type;
    }

    const products = await Product.find(query)
      .populate('seller', 'name email')
      .limit(10); // Limit to 10 results for performance

    res.status(200).json({ products });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ message: 'Error performing search', error: err.message });
  }
}

exports.getProductById = async (req, res) => {
  const { id } = req.params;
  try {
    const product = await Product.findById(id).populate('seller', 'name email');
     if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    } 
    res.status(200).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } 
}

exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, price, category, image, stock, deliveryCharges, type, grade, harvestDate, expiryDate, auctionEndTime, startingBid, minIncrement } = req.body;
  try {
    const updateData = { name, price, category, image, stock, deliveryCharges, type };

    // Add auction specific fields if type is auction
    if (type === 'auction') {
      updateData.auctionEndTime = auctionEndTime;
      updateData.startingBid = startingBid;
      updateData.minIncrement = minIncrement;
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}            
