const Cart = require('../model/cartModel');
const Product = require('../model/productModel');
const User = require('../model/userModel');
const { geocodeAddress, buildFullAddress } = require('../utils/geocode');

// Get user's cart
const getCart = async (req, res) => {
    try {
        const userId = req.user.id;
        
        let cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price category image stock seller type'
        });

        if (!cart) {
            cart = new Cart({ user: userId, items: [] });
            await cart.save();
        }

        res.status(200).json({
            success: true,
            data: cart
        });
    } catch (error) {
        // console.error('Error getting cart:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving cart'
        });
    }
};

// Add item to cart
const addToCart = async (req, res) => {
    try {
        const { productId, quantity = 1, selectedTier = 0 } = req.body;
        const userId = req.user.id;

        // Validate product exists
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Check stock availability
        if (product.stock < quantity) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient stock'
            });
        }

        let cart = await Cart.findOne({ user: userId });
        
        if (!cart) {
            cart = new Cart({ user: userId, items: [] });
        }

        // Check if product already exists in cart
        const existingItemIndex = cart.items.findIndex(
            item => item.product.toString() === productId
        );

        if (existingItemIndex > -1) {
            // Update existing item
            cart.items[existingItemIndex].quantity += quantity;
            cart.items[existingItemIndex].selectedTier = selectedTier;
        } else {
            // Add new item
            cart.items.push({
                product: productId,
                quantity,
                selectedTier
            });
        }

        await cart.save();
        
        // Populate product details for response
        await cart.populate({
            path: 'items.product',
            select: 'name price category image stock seller type'
        });

        res.status(200).json({
            success: true,
            message: 'Item added to cart successfully',
            data: cart
        });
    } catch (error) {
        // console.error('Error adding to cart:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding item to cart'
        });
    }
};

// Update cart item quantity
const updateCartItem = async (req, res) => {
    try {
        const { productId } = req.params;
        const { quantity, selectedTier } = req.body;
        const userId = req.user.id;

        if (quantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be at least 1'
            });
        }

        const cart = await Cart.findOne({ user: userId });
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        const itemIndex = cart.items.findIndex(
            item => item.product.toString() === productId
        );

        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in cart'
            });
        }

        // Check stock availability
        const product = await Product.findById(productId);
        if (product.stock < quantity) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient stock'
            });
        }

        cart.items[itemIndex].quantity = quantity;
        if (selectedTier !== undefined) {
            cart.items[itemIndex].selectedTier = selectedTier;
        }

        await cart.save();
        
        await cart.populate({
            path: 'items.product',
            select: 'name price category image stock seller type'
        });

        res.status(200).json({
            success: true,
            message: 'Cart item updated successfully',
            data: cart
        });
    } catch (error) {
        // console.error('Error updating cart item:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating cart item'
        });
    }
};

// Remove item from cart
const removeFromCart = async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user.id;

        const cart = await Cart.findOne({ user: userId });
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        cart.items = cart.items.filter(
            item => item.product.toString() !== productId
        );

        await cart.save();
        
        await cart.populate({
            path: 'items.product',
            select: 'name price category image stock seller type'
        });

        res.status(200).json({
            success: true,
            message: 'Item removed from cart successfully',
            data: cart
        });
    } catch (error) {
        // console.error('Error removing from cart:', error);
        res.status(500).json({
            success: false,
            message: 'Error removing item from cart'
        });
    }
};

// Clear entire cart (idempotent)
const clearCart = async (req, res) => {
    try {
        const userId = req.user.id;

        // Find existing cart, or create a fresh empty cart if none exists.
        let cart = await Cart.findOne({ user: userId });

        if (!cart) {
            // No cart found – create an empty cart so that the operation is idempotent
            cart = new Cart({ user: userId, items: [] });
            await cart.save();
        } else {
            // Clear items of existing cart
            cart.items = [];
            await cart.save();
        }

        return res.status(200).json({
            success: true,
            message: 'Cart cleared successfully',
            data: cart,
        });
    } catch (error) {
        // console.error('Error clearing cart:', error);
        return res.status(500).json({
            success: false,
            message: 'Error clearing cart',
        });
    }
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Get cart summary (count and total)
const getCartSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        // console.log('Starting cart summary for user:', userId);

        let buyerLat = req.query.lat ? parseFloat(req.query.lat) : null;
        let buyerLng = req.query.lng ? parseFloat(req.query.lng) : null;
        
        // console.log('Initial buyer coordinates:', { buyerLat, buyerLng });
        
        if (buyerLat == null || buyerLng == null) {
            // console.log('No coordinates in query, checking user addresses');
            const me = await User.findById(userId).select('addresses');
            const def = me?.addresses?.find?.(a => a.isDefault) || me?.addresses?.[0];
            // console.log('Found default address:', def);
            
            if (def) {
                if (def.latitude != null && def.longitude != null) {
                    buyerLat = def.latitude;
                    buyerLng = def.longitude;
                    // // console.log('Using stored coordinates from address:', { buyerLat, buyerLng });
                } else {
                    try {
                        // // console.log('No stored coordinates, attempting to geocode address');
                        const full = buildFullAddress(def);
                        // // console.log('Geocoding address:', full);
                        const geo = await geocodeAddress(full);
                        // // console.log('Geocode result:', geo);
                        
                        if (geo?.latitude != null && geo?.longitude != null) {
                            buyerLat = geo.latitude;
                            buyerLng = geo.longitude;
                            // // console.log('Using geocoded coordinates:', { buyerLat, buyerLng });
                            
                            // Update the user's address with the geocoded coordinates
                            await User.updateOne(
                                { _id: userId, 'addresses._id': def._id },
                                { 
                                    $set: { 
                                        'addresses.$.latitude': buyerLat,
                                        'addresses.$.longitude': buyerLng
                                    } 
                                }
                            );
                            // // console.log('Updated user address with coordinates');
                        } else {
                            // // console.warn('Geocoding returned no coordinates');
                        }
                    } catch (e) {
                        // // console.error('Geocoding failed:', e);
                        // // console.warn('Buyer address geocode failed in cart summary:', e?.message);
                    }
                }
            }
        }

        const cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price category image stock seller type deliveryCharges',
            populate: { path: 'seller', select: 'addresses' }
        });

        if (!cart || cart.items.length === 0) {
            return res.status(200).json({
                success: true,
                data: {
                    itemCount: 0,
                    totalItems: 0,
                    totalPrice: 0,
                    deliveryCharges: 0,
                    grandTotal: 0
                }
            });
        }

        let totalItems = 0;
        let subtotal = 0;
        let deliveryCharges = 0;

        // Group products by seller to compute distance-based charge per seller
        const sellerToItems = new Map();

        cart.items.forEach(item => {
            totalItems += item.quantity;
            const product = item.product;
            if (product && product.price && product.price[item.selectedTier]) {
                subtotal += product.price[item.selectedTier].price * item.quantity;
            }
            const sid = product?.seller?._id?.toString?.() || product?.seller?.toString?.() || product?.seller;
            if (!sellerToItems.has(sid)) sellerToItems.set(sid, []);
            sellerToItems.get(sid).push(item);
        });

        // Compute delivery per seller if we have buyer location and product has delivery tiers
        if (buyerLat != null && buyerLng != null) {
            // // console.log('Buyer coordinates for delivery calculation:', { buyerLat, buyerLng });
            
            for (const [sid, items] of sellerToItems.entries()) {
                // Resolve seller coordinates from default address
                const seller = items[0]?.product?.seller;
                // // console.log('Processing seller:', seller?._id);
                
                const sellerAddresses = seller?.addresses || [];
                // // console.log('Seller addresses:', JSON.stringify(sellerAddresses, null, 2));
                
                const defAddr = sellerAddresses.find(a => a.isDefault) || sellerAddresses[0];
                // // console.log('Using seller address:', defAddr);
                
                let sellerLat = defAddr?.latitude;
                let sellerLng = defAddr?.longitude;
                
                if (sellerLat == null || sellerLng == null) {
                    try {
                        // // console.log('No coordinates found, attempting to geocode seller address');
                        const full = buildFullAddress(defAddr);
                        // // console.log('Geocoding seller address:', full);
                        const geo = await geocodeAddress(full);
                        // // console.log('Seller geocode result:', geo);
                        
                        sellerLat = geo?.latitude;
                        sellerLng = geo?.longitude;
                        
                        // Update seller's address with geocoded coordinates if we have them
                        if (sellerLat && sellerLng && seller?._id) {
                            await User.updateOne(
                                { _id: seller._id, 'addresses._id': defAddr._id },
                                { 
                                    $set: { 
                                        'addresses.$.latitude': sellerLat,
                                        'addresses.$.longitude': sellerLng
                                    } 
                                }
                            );
                            // // console.log('Updated seller address with coordinates');
                        }
                    } catch (e) {
                        // console.error('Seller address geocode failed:', e);
                        // // console.warn('Seller address geocode failed in cart summary:', e?.message);
                    }
                }
                
                if (sellerLat == null || sellerLng == null) {
                    // console.warn('Skipping seller - no coordinates available');
                    continue;
                }

                const distanceKm = haversineKm(sellerLat, sellerLng, buyerLat, buyerLng);
                // console.log(`Distance between buyer and seller: ${distanceKm.toFixed(2)} km`);

                // For each item, choose tier from its product; then take the max price across items for this seller
                let sellerCharge = 0;
                // console.log('Calculating delivery charges for items:', items.length);
                
                for (const it of items) {
                    const product = it.product;
                    const tiers = Array.isArray(product?.deliveryCharges) ? [...product.deliveryCharges] : [];
                    // console.log(`Product ${product.name} has ${tiers.length} delivery tiers:`, JSON.stringify(tiers));
                    
                    if (tiers.length === 0) {
                        // console.warn(`No delivery tiers found for product: ${product.name}`);
                        continue;
                    }
                    
                    // Sort tiers by min distance
                    tiers.sort((a, b) => (a.min || 0) - (b.min || 0));
                    
                    // Find the first tier that matches the distance
                    let chosen = tiers.find(t => 
                        (t.min == null || distanceKm >= t.min) && 
                        (t.max == null || distanceKm <= t.max)
                    );
                    
                    // console.log('Matching tier before fallback:', chosen);
                    
                    // If no exact match, find the nearest tier
                    if (!chosen) {
                        // console.log('No exact match, finding nearest tier by boundary distance');
                        
                        // First try to find a tier where distance is less than max
                        chosen = tiers.find(t => t.max != null && distanceKm <= t.max);
                        
                        // If still no match, find the tier with the closest boundary
                        if (!chosen) {
                            // console.log('No matching max boundary, finding closest tier');
                            chosen = tiers.reduce((prev, cur) => {
                                const prevDelta = Math.abs(distanceKm - (prev.max ?? prev.min ?? 0));
                                const curDelta = Math.abs(distanceKm - (cur.max ?? cur.min ?? 0));
                                return curDelta < prevDelta ? cur : prev;
                            }, tiers[0]);
                        }
                    }
                    
                    // console.log('Selected tier:', chosen);
                    
                    if (chosen?.price && chosen.price > sellerCharge) {
                        // console.log(`Updating seller charge from ${sellerCharge} to ${chosen.price}`);
                        sellerCharge = chosen.price;
                    }
                }
                deliveryCharges += sellerCharge;
            }
        }

        const grandTotal = subtotal + deliveryCharges;

        res.status(200).json({
            success: true,
            data: {
                itemCount: cart.items.length,
                totalItems,
                totalPrice: subtotal,
                deliveryCharges,
                grandTotal
            }
        });
    } catch (error) {
        // console.error('Error getting cart summary:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting cart summary'
        });
    }
};

module.exports = {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    getCartSummary
}; 