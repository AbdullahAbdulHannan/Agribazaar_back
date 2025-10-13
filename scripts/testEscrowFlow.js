/**
 * Test script to validate the escrow system flow
 * 
 * This script simulates the complete escrow flow:
 * 1. Create a test order with escrow
 * 2. Simulate payment capture
 * 3. Test manual release of escrow
 * 4. Test dispute flow
 * 5. Test automatic release after hold period
 * 
 * Note: This requires a test environment with Stripe test keys
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../model/orderModel');
const User = require('../model/userModel');
const Product = require('../model/productModel');
const Cart = require('../model/cartModel');
const logger = require('../utils/logger');

// Test configuration
const TEST_USER_ID = 'test_user_id'; // Replace with actual test user ID
const TEST_SELLER_ID = 'test_seller_id'; // Replace with actual test seller ID
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

// Test product data
const testProduct = {
    name: 'Test Product for Escrow',
    price: 1000, // $10.00
    category: 'test',
    stock: 10,
    seller: TEST_SELLER_ID,
    description: 'Test product for escrow flow testing'
};

// Test order data
const testOrderData = {
    shippingAddress: {
        street: '123 Test St',
        city: 'Test City',
        state: 'Test State',
        postalCode: '12345',
        country: 'Test Country'
    },
    contactInfo: {
        name: 'Test User',
        email: 'test@example.com',
        phone: '+1234567890'
    },
    deliveryNotes: 'Test order for escrow flow',
    paymentMethod: 'card'
};

// Helper function to make authenticated requests
const makeAuthRequest = async (method, url, data = null, token = 'test_token') => {
    try {
        const config = {
            method,
            url: `${API_BASE_URL}${url}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.data = data;
        }

        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('API Request Error:', error.response?.data || error.message);
        throw error;
    }
};

// Test the complete escrow flow
const testEscrowFlow = async () => {
    console.log('Starting escrow flow test...');
    
    try {
        // 1. Connect to database
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to database');

        // 2. Create a test product
        console.log('Creating test product...');
        const product = await Product.create(testProduct);
        console.log(`Created test product with ID: ${product._id}`);

        // 3. Create a test cart
        console.log('Creating test cart...');
        const cart = await Cart.create({
            user: TEST_USER_ID,
            items: [{
                product: product._id,
                quantity: 1,
                price: product.price
            }]
        });
        console.log(`Created test cart with ID: ${cart._id}`);

        // 4. Create an order with escrow
        console.log('Creating order with escrow...');
        const orderResponse = await makeAuthRequest(
            'POST',
            '/api/orders/escrow',
            testOrderData
        );
        
        if (!orderResponse.success) {
            throw new Error('Failed to create order with escrow');
        }
        
        const orderId = orderResponse.order._id;
        const paymentIntentId = orderResponse.paymentIntent.id;
        console.log(`Created order with escrow - Order ID: ${orderId}, Payment Intent: ${paymentIntentId}`);

        // 5. Simulate successful payment capture
        console.log('Simulating payment capture...');
        const paymentIntent = await Stripe.paymentIntents.capture(paymentIntentId);
        console.log(`Payment captured - Status: ${paymentIntent.status}`);

        // 6. Verify order status is updated
        const updatedOrder = await Order.findById(orderId);
        console.log(`Order status after capture: ${updatedOrder.paymentStatus}`);

        // 7. Test manual release of escrow (after hold period)
        console.log('Testing manual release of escrow...');
        const releaseResponse = await makeAuthRequest(
            'POST',
            `/api/escrow/orders/${orderId}/release`,
            {}
        );
        console.log('Manual release response:', releaseResponse);

        // 8. Test dispute flow
        console.log('Testing dispute flow...');
        const disputeResponse = await makeAuthRequest(
            'POST',
            `/api/escrow/orders/${orderId}/disputes`,
            {
                reason: 'Test dispute',
                description: 'This is a test dispute for the escrow system.'
            }
        );
        console.log('Dispute response:', disputeResponse);

        // 9. Test dispute resolution (admin only)
        console.log('Testing dispute resolution...');
        const resolveResponse = await makeAuthRequest(
            'POST',
            `/api/escrow/orders/${orderId}/disputes/resolve`,
            {
                resolution: 'refund',
                refundAmount: 500, // $5.00 refund
                notes: 'Test resolution - partial refund issued'
            }
        );
        console.log('Dispute resolution response:', resolveResponse);

        // 10. Test automatic release (simulate by calling the endpoint directly)
        console.log('Testing automatic release...');
        const autoReleaseResponse = await axios.post(
            `${API_BASE_URL}/api/escrow/process-releases`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${INTERNAL_API_SECRET}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log('Automatic release response:', autoReleaseResponse.data);

        console.log('Escrow flow test completed successfully!');

    } catch (error) {
        console.error('Error in escrow flow test:', error);
    } finally {
        // Clean up test data
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

// Run the test
testEscrowFlow();
