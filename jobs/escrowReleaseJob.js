const cron = require('node-cron');
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Schedule the escrow release job to run daily at 1 AM
 */
const scheduleEscrowRelease = () => {
    // Run every day at 1 AM
    cron.schedule('0 1 * * *', async () => {
        try {
            logger.info('Running scheduled escrow release job...');
            
            // Call our internal API endpoint to process escrow releases
            const response = await axios.post(
                `${process.env.API_BASE_URL}/api/escrow/process-releases`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 300000 // 5 minute timeout
                }
            );
            
            logger.info('Escrow release job completed', {
                success: response.data.success,
                processed: response.data.processed,
                results: response.data.results
            });
            
        } catch (error) {
            logger.error('Error in escrow release job:', {
                message: error.message,
                stack: error.stack,
                response: error.response?.data
            });
        }
    }, {
        timezone: 'Asia/Kolkata' // Adjust to your server's timezone
    });
    
    logger.info('Escrow release job scheduled to run daily at 1 AM');
};

module.exports = {
    scheduleEscrowRelease
};
