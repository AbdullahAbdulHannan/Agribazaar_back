require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./db/database');
const logger = require('./utils/logger');

// Import routes
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const auctionRoutes = require('./routes/auctionRoutes');
const fileRoutes = require('./routes/fileRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const orderRoutes = require('./routes/orderRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const escrowRoutes = require('./routes/escrowRoutes');
const notificationRouter = require('./routes/notificationRoutes').router;
const reviewRoutes = require('./routes/reviewRoutes');
const stripeConnectRoutes = require('./routes/stripeConnectRoutes');

// Import jobs
const { scheduleEscrowRelease } = require('./jobs/escrowReleaseJob');

// Initialize express app
const app = express();

// Global error handler
process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', {
        error: err.message,
        stack: err.stack
    });    
    // Consider whether to crash the app here based on your needs
    // process.exit(1);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', {
        error: err.message,
        stack: err.stack
    });
    // Consider whether to crash the app here based on your needs
    // process.exit(1);
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
const corsOptions = {
    origin: [
        'https://agribazaar-frontend-pgv6.vercel.app', 
        'https://agri-frontend-five.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Raw body parsing for Stripe webhooks (must be before express.json())
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.originalUrl}`, {
        query: req.query,
        body: req.body,
        headers: req.headers
    });
    next();
});

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to database
connectDB();

// Initialize scheduled jobs
if (process.env.NODE_ENV !== 'test') {
    try {
        scheduleEscrowRelease();
        logger.info('Scheduled jobs initialized');
    } catch (error) {
        logger.error('Failed to initialize scheduled jobs:', error);
    }
}
app.get('/', (req, res) => {
    res.send('Hello World');
});

// API Routes
app.use('/api/auth', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/auctions', auctionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/notifications', notificationRouter);
app.use('/api/reviews', reviewRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/upload', fileRoutes);
app.use('/api/stripe', stripeConnectRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl
    });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Global error handler:', {
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.originalUrl,
        method: req.method
    });

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    
    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    logger.info(`Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', {
        error: err.message,
        stack: err.stack
    });
    
    // Close server & exit process
    server.close(() => process.exit(1));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully');
    server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
    });
});

module.exports = server;