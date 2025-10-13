# Escrow System Implementation

This document outlines the implementation details of the escrow payment system for AgriBazaar.

## Overview

The escrow system holds funds from buyers for a specified period (default: 14 days) before releasing them to sellers. This provides protection for both buyers and sellers in the marketplace.

## Key Components

1. **Order Model Updates**
   - Added `paymentStatus` with new values: `held_in_escrow`, `released`, `disputed`
   - Added `escrowDetails` subdocument with release date, dispute information, and transfer status
   - Enhanced `stripeTransferIds` array to track transfer status and metadata

2. **Stripe Service**
   - `createEscrowCharge`: Creates a payment intent with manual capture
   - `captureEscrowFunds`: Captures funds held in escrow
   - `releaseEscrowFunds`: Releases funds to sellers after hold period
   - `refundEscrowPayment`: Processes refunds from escrow

3. **API Endpoints**
   - `POST /api/escrow/orders/:orderId/release`: Manually release escrow funds
   - `POST /api/escrow/orders/:orderId/disputes`: Raise a dispute on an escrow payment
   - `POST /api/escrow/orders/:orderId/disputes/resolve`: Resolve a dispute (admin only)
   - `POST /api/escrow/process-releases`: Process automatic escrow releases (internal use)

4. **Scheduled Jobs**
   - Automatic escrow release runs daily at 1 AM
   - Processes all orders where the escrow hold period has expired

## Webhook Events Handled

- `payment_intent.succeeded`: Update order status when payment is captured
- `payment_intent.payment_failed`: Handle failed payments
- `charge.refunded`: Update order status when refunds are processed
- `transfer.paid`: Confirm when funds are transferred to sellers

## Configuration

Required environment variables (see `.env.example` for all):

```
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
INTERNAL_API_SECRET=your_secure_internal_api_secret
ESCROW_HOLD_DAYS=14
PLATFORM_FEE=0.05
```

## Testing

1. **Unit Tests**
   - Test order creation with escrow
   - Test payment capture and release flows
   - Test dispute handling
   - Test automatic release scheduling

2. **Integration Tests**
   - End-to-end order flow with escrow
   - Webhook event handling
   - Scheduled job execution

## Monitoring

- Logs are stored in `logs/` directory
- Key events are logged with appropriate severity levels
- Monitor for failed webhook events and scheduled job failures

## Troubleshooting

### Common Issues

1. **Webhook Verification Failed**
   - Verify `STRIPE_WEBHOOK_SECRET` is set correctly
   - Ensure the webhook URL in Stripe Dashboard is correct
   - Check request headers for `stripe-signature`

2. **Scheduled Job Not Running**
   - Verify the server timezone is set correctly
   - Check logs for job initialization errors
   - Ensure the server is running at the scheduled time

3. **Transfers Failing**
   - Verify seller's Stripe Connect account is properly set up
   - Check for sufficient funds in the platform account
   - Review Stripe logs for transfer failures

## Future Enhancements

1. Partial escrow releases
2. Multiple dispute resolution workflows
3. Automated dispute resolution based on order history
4. Escrow release reminders to buyers
5. Enhanced reporting and analytics

## Security Considerations

- All escrow operations require authentication
- Webhook endpoints verify Stripe signatures
- Sensitive operations are logged
- Database transactions ensure data consistency
- Rate limiting on API endpoints
