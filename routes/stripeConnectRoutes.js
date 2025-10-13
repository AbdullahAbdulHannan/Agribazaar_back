const express = require('express');
const router = express.Router();
const {authenticate} = require('../middleware/authMiddleware');
const User = require('../model/userModel');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// @route   GET /api/stripe/connect
// @desc    Initiate Stripe Connect onboarding
// @access  Private (Seller)
router.get('/connect', authenticate, async (req, res) => {
    try {
        console.log('Stripe Connect - Start', { userId: req.user.id, email: req.user.email });
        
        // Check if user is a seller
        if (req.user.role !== 'seller') {
            const error = 'Only sellers can connect Stripe accounts';
            console.error('Stripe Connect - Error:', error);
            return res.status(403).json({ 
                success: false, 
                message: error
            });
        }

        // Check if already connected
        if (req.user.stripeAccountId) {
            const message = 'Stripe account already connected';
            console.log('Stripe Connect - Already connected:', { accountId: req.user.stripeAccountId });
            return res.status(400).json({
                success: false,
                message: message,
                accountId: req.user.stripeAccountId
            });
        }

        console.log('Stripe Connect - Creating Stripe account...');
        
        // Create account link for onboarding
        let account;
        try {
            account = await stripe.accounts.create({
                type: 'express',
                country: 'US',
                email: req.user.email,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
            });
            console.log('Stripe Connect - Account created:', { accountId: account.id });
        } catch (accountError) {
            console.error('Stripe Connect - Error creating account:', accountError);
            throw new Error(`Failed to create Stripe account: ${accountError.message}`);
        }

        // Create account link for onboarding
        let accountLink;
        try {
            console.log('Stripe Connect - Creating account link...', process.env.FRONTEND_URL);
            if (!process.env.FRONTEND_URL) {
                throw new Error('FRONTEND_URL environment variable is not set');
            }
            
            const refreshUrl = `${process.env.FRONTEND_URL}/seller/dashboard?stripe_refresh=true`;
            const returnUrl = `${process.env.FRONTEND_URL}/seller/dashboard?stripe_success=true`;
            
            console.log('Stripe Connect - Creating account link:', { refreshUrl, returnUrl });
            
            accountLink = await stripe.accountLinks.create({
                account: account.id,
                refresh_url: refreshUrl,
                return_url: returnUrl,
                type: 'account_onboarding',
            });
            
            console.log('Stripe Connect - Account link created:', accountLink);
        } catch (linkError) {
            console.error('Stripe Connect - Error creating account link:', linkError);
            throw new Error(`Failed to create account link: ${linkError.message}`);
        }

        // Update user with new account ID (not yet fully onboarded)
        await User.findByIdAndUpdate(req.user.id, {
            stripeAccountId: account.id,
            stripeAccountStatus: 'pending'
        });

        res.json({
            success: true,
            url: accountLink.url
        });

    } catch (error) {
        console.error('Stripe Connect Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error connecting Stripe account',
            error: error.message
        });
    }
});

// @route   GET /api/stripe/account/status
// @desc    Check Stripe Connect account status
// @access  Private (Seller)
router.get('/account/status', authenticate, async (req, res) => {
    try {
        if (!req.user.stripeAccountId) {
            return res.json({
                connected: false,
                status: 'not_connected'
            });
        }

        const account = await stripe.accounts.retrieve(req.user.stripeAccountId);
        
        // Update account status in our database
        const status = account.details_submitted && account.charges_enabled ? 'active' : 'pending';
        if (req.user.stripeAccountStatus !== status) {
            await User.findByIdAndUpdate(req.user.id, {
                stripeAccountStatus: status
            });
        }

        res.json({
            connected: true,
            status: status,
            account: {
                id: account.id,
                charges_enabled: account.charges_enabled,
                payouts_enabled: account.payouts_enabled,
                details_submitted: account.details_submitted,
                email: account.email,
                requirements: account.requirements
            }
        });

    } catch (error) {
        console.error('Stripe Account Status Error:', error);
        
        // If account doesn't exist or access was revoked
        if (error.code === 'resource_missing' || error.code === 'account_invalid') {
            await User.findByIdAndUpdate(req.user.id, {
                stripeAccountId: null,
                stripeAccountStatus: 'disconnected'
            });
            
            return res.json({
                connected: false,
                status: 'disconnected',
                message: 'Stripe account connection was removed or invalidated'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error checking account status',
            error: error.message
        });
    }
});

module.exports = router;
