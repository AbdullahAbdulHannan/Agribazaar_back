const express = require('express');
const router = express.Router();    
const productController = require('../controllers/productController');
const { authenticateSeller, authenticate } = require('../middleware/authMiddleware');

// Create a new product
router.post('/create', authenticate,authenticateSeller, productController.createProduct);

// Get all products with optional filtering
router.get('/', productController.getProducts);

// Get products by type (marketplace, emandi, auction)
router.get('/type/:type', productController.getProductsByType);

// Get a specific product by ID
router.get('/:id', productController.getProductById);

// Update a product
router.put('/:id', authenticateSeller, productController.updateProduct);

// Delete a product
router.delete('/:id', authenticateSeller, productController.deleteProduct);

module.exports = router;