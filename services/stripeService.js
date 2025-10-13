const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PLATFORM_FEE_PERCENT = 0.05; // 5% platform fee
const ESCROW_HOLD_DAYS = 14; // Hold funds in escrow for 14 days

class StripeService {
  // Create a payment intent for the entire order
  static async createPaymentIntent(amount, currency = 'pkr', metadata = {}) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency,
        metadata: metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });
      return paymentIntent;
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw new Error('Failed to create payment intent');
    }
  }

  // Confirm a payment intent
  static async confirmPaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      console.error('Error confirming payment intent:', error);
      throw new Error('Failed to confirm payment intent');
    }
  }

  // Capture a payment intent
  static async capturePaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      console.error('Error capturing payment intent:', error);
      throw new Error('Failed to capture payment intent');
    }
  }

  // Create a charge with destination charge for escrow
  static async createEscrowCharge(amount, currency, customerId, sellerStripeAccountId, description, metadata = {}) {
    try {
      // Convert amount to smallest currency unit (cents/paisa)
      const isZeroDecimalCurrency = ['jpy', 'krw', 'vnd', 'xof', 'xaf', 'xpf', 'clp', 'pyg', 'gnf', 'jod', 'bif', 'djf', 'mga', 'pab', 'khr', 'kmf', 'cve', 'mru', 'mga', 'mnt', 'rwf', 'vuv', 'xaf', 'xof', 'xpf'].includes(currency.toLowerCase());
      
      // Convert amount to smallest currency unit (cents/paisa)
      const amountInSmallestUnit = isZeroDecimalCurrency ? 
        Math.round(amount) : // For zero-decimal currencies
        Math.round(amount * 100); // For standard currencies (USD, EUR, etc.)
      
      // Calculate application fee (platform fee)
      const applicationFeeAmount = Math.round(amountInSmallestUnit * PLATFORM_FEE_PERCENT);
      
      // 1. Create a PaymentIntent on the platform account without confirming it
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInSmallestUnit,
        currency: currency.toLowerCase(),
        customer: customerId,
        payment_method_types: ['card'],
        capture_method: 'automatic',
        metadata: {
          ...metadata,
          is_escrow: 'true',
          seller_account: sellerStripeAccountId,
          platform_fee: applicationFeeAmount.toString(),
          currency: currency.toLowerCase()
        },
        description: description || 'Escrow payment for order',
      });
      
      // Return the client secret for client-side confirmation
      const clientSecret = paymentIntent.client_secret;

      // 2. Create a transfer to the connected account (this will happen after the payment is captured)
      // We'll store this transfer creation in the metadata to be executed after payment confirmation
      const transferMetadata = {
        amount: amountInSmallestUnit - applicationFeeAmount, // Use amountInSmallestUnit which was already calculated
        currency: currency,
        destination: sellerStripeAccountId,
        transfer_group: `ORDER_${metadata.order_id || 'UNKNOWN'}`,
        metadata: {
          ...metadata,
          payment_intent: paymentIntent.id,
          is_escrow_transfer: 'true',
          platform_fee: applicationFeeAmount.toString(),
          seller_amount: (amountInSmallestUnit - applicationFeeAmount).toString()
        }
      };

      return {
        id: paymentIntent.id,
        clientSecret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        transferMetadata, // Store transfer details for later use
        requiresAction: paymentIntent.status === 'requires_action' || 
                       paymentIntent.status === 'requires_payment_method'
      };
    } catch (error) {
      console.error('Error creating escrow charge:', error);
      throw new Error(`Failed to create escrow charge: ${error.message}`);
    }
  }

  // Capture funds held in escrow and transfer to connected account
  static async captureEscrowFunds(paymentIntentId, transferMetadata) {
    try {
      // 1. First, get the payment intent to check currency
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const currency = (paymentIntent.currency || 'usd').toLowerCase();
      
      // 2. Check if the currency is zero-decimal
      const isZeroDecimalCurrency = ['jpy', 'krw', 'vnd', 'xof', 'xaf', 'xpf', 'clp', 'pyg', 'gnf', 'jod', 'bif', 'djf', 'mga', 'pab', 'khr', 'kmf', 'cve', 'mru', 'mga', 'mnt', 'rwf', 'vuv', 'xaf', 'xof', 'xpf'].includes(currency);
      
      // 3. Capture the payment intent
      const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
      
      // 4. Create transfer to connected account if transfer metadata is provided
      let transfer = null;
      if (transferMetadata) {
        try {
          // Convert amount to proper format for the currency
          const transferAmount = isZeroDecimalCurrency ? 
            transferMetadata.amount : 
            Math.round(transferMetadata.amount);
            
          transfer = await stripe.transfers.create({
            amount: transferAmount,
            currency: currency,
            destination: transferMetadata.destination,
            transfer_group: transferMetadata.transfer_group || `ORDER_${paymentIntent.metadata.order_id || 'UNKNOWN'}`,
            metadata: {
              ...transferMetadata.metadata,
              payment_intent: paymentIntentId,
              currency: currency
            },
            description: `Transfer for order ${paymentIntent.metadata.order_id || 'UNKNOWN'}`,
            source_transaction: capturedIntent.charges.data[0].id
          });
          
          console.log(`Created transfer ${transfer.id} to account ${transferMetadata.destination}`);
        } catch (transferError) {
          console.error('Error creating transfer:', transferError);
          // The funds are still captured and can be transferred manually
        }
      }
      
      return {
        id: capturedIntent.id,
        amount: capturedIntent.amount,
        amount_received: capturedIntent.amount_received,
        status: capturedIntent.status,
        transfer_id: transfer?.id,
        currency: currency
      };
    } catch (error) {
      console.error('Error capturing escrow funds:', error);
      throw new Error(`Failed to capture escrow funds: ${error.message}`);
    }
  }

  // Release funds from escrow to seller
  static async releaseEscrowFunds(paymentIntentId, sellerStripeAccountId, amount, currency = 'pkr', metadata = {}) {
    try {
      console.log('=== Starting releaseEscrowFunds ===');
      console.log('Input parameters:', JSON.stringify({
        paymentIntentId,
        sellerStripeAccountId: sellerStripeAccountId ? `${sellerStripeAccountId.substring(0, 8)}...` : 'MISSING',
        amount,
        currency,
        metadata
      }, null, 2));

      // Validate required parameters
      if (!paymentIntentId) throw new Error('Payment intent ID is required');
      if (!sellerStripeAccountId) throw new Error('Seller Stripe account ID is required');
      if (!amount || isNaN(amount) || amount <= 0) throw new Error('Valid amount is required');
      
      // 1. First, retrieve the payment intent to verify it exists and get its status
      console.log('Retrieving payment intent...');
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      console.log('Payment intent retrieved:', {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        latest_charge: paymentIntent.latest_charge
      });
      
      // 2. If the payment intent isn't already captured, capture it
      if (paymentIntent.status === 'requires_capture') {
        console.log('Capturing payment intent...');
        try {
          await stripe.paymentIntents.capture(paymentIntentId);
          console.log('Payment intent captured successfully');
        } catch (captureError) {
          console.error('Error capturing payment intent:', {
            error: captureError.message,
            code: captureError.code,
            type: captureError.type
          });
          throw new Error(`Failed to capture payment: ${captureError.message}`);
        }
      }
      
      // 3. Verify the seller's account is valid
      console.log('Verifying seller account...');
      try {
        const account = await stripe.accounts.retrieve(sellerStripeAccountId);
        console.log('Seller account verified:', {
          id: account.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted
        });
        
        if (!account.charges_enabled || !account.payouts_enabled) {
          throw new Error('Seller account is not fully set up to receive payments');
        }
      } catch (accountError) {
        console.error('Error verifying seller account:', {
          error: accountError.message,
          code: accountError.code,
          type: accountError.type
        });
        throw new Error(`Invalid seller account: ${accountError.message}`);
      }
      
      // 4. Create a transfer to the seller's connected account
      console.log('Creating transfer to seller...');
      
      // Get the charge details to check available balance
      const charge = await stripe.charges.retrieve(paymentIntent.latest_charge, { expand: ['balance_transaction'] });
      
      // Determine correct currency based on the balance transaction to avoid mismatch
      const balanceCurrency = (charge.balance_transaction?.currency || charge.currency || paymentIntent.currency || currency || 'usd').toLowerCase();
      const chargeCurrency = (charge.currency || paymentIntent.currency || currency || 'usd').toLowerCase();
      const isZeroDecimalCharge = ['jpy', 'krw', 'vnd', 'xof', 'xaf', 'xpf', 'clp', 'pyg', 'gnf', 'jod', 'bif', 'djf', 'mga', 'pab', 'khr', 'kmf', 'cve', 'mru', 'mga', 'mnt', 'rwf', 'vuv', 'xaf', 'xof', 'xpf'].includes(chargeCurrency);
      
      // Amount requested by caller, interpreted in the charge/paymentIntent currency, then converted to the balance currency using Stripe's recorded ratio
      const requestedMinorInChargeCurrency = isZeroDecimalCharge ? Math.round(amount) : Math.round(amount * 100);
      const balanceTxnAmount = charge.balance_transaction?.amount || null; // Minor units in balance currency
      const fxRatio = charge.amount && balanceTxnAmount ? (balanceTxnAmount / charge.amount) : 1; // Convert from charge currency minor units to balance currency minor units
      const requestedMinorInBalanceCurrency = Math.max(1, Math.round(requestedMinorInChargeCurrency * fxRatio));
      
      // Available amount in balance currency (gross). If expanded data missing, fall back conservatively
      const availableMinorInBalanceCurrency = balanceTxnAmount || Math.round((charge.amount || 0) * fxRatio);
      
      console.log('Transfer currency resolution:', {
        chargeCurrency: charge.currency,
        balanceCurrency,
        balanceTxnAmount,
        chargeAmount: charge.amount,
        fxRatio,
        requestedMinorInChargeCurrency,
        requestedMinorInBalanceCurrency
      });
      
      // Validate available balance - ensure we don't try to transfer more than available (in balance currency)
      const maxTransferAmount = Math.min(requestedMinorInBalanceCurrency, availableMinorInBalanceCurrency);
      if (maxTransferAmount <= 0) {
        throw new Error('No available funds to transfer for this charge');
      }
      
      console.log('Transfer details:', {
        requestedAmountInput: amount,
        requestedMinorInChargeCurrency,
        requestedMinorInBalanceCurrency,
        availableMinorInBalanceCurrency,
        balanceCurrency,
        chargeId: charge.id,
        chargeStatus: charge.status,
        paymentIntentStatus: paymentIntent.status
      });
      
      try {
        const transfer = await stripe.transfers.create({
          amount: maxTransferAmount, // Amount in balance currency minor units
          currency: balanceCurrency,
          destination: sellerStripeAccountId,
          transfer_group: `ORDER_${metadata.orderId || 'UNKNOWN'}`,
          metadata: {
            ...metadata,
            payment_intent: paymentIntentId,
            is_escrow_transfer: 'true',
            source_transaction: paymentIntent.latest_charge,
            original_amount_input: amount,
            requested_minor_in_charge_currency: requestedMinorInChargeCurrency,
            requested_minor_in_balance_currency: requestedMinorInBalanceCurrency,
            fx_ratio_estimate: fxRatio.toString()
          },
          description: `Transfer for order ${metadata.orderId || 'UNKNOWN'}`,
          source_transaction: paymentIntent.latest_charge // Link to the original charge
        });
        
        console.log('Transfer created successfully:', {
          id: transfer.id,
          amount: transfer.amount,
          currency: transfer.currency,
          status: transfer.status,
          destination: transfer.destination,
          source_transaction: transfer.source_transaction
        });
        
        return {
          success: true,
          transferId: transfer.id,
          amount: transfer.amount,
          currency: transfer.currency,
          status: transfer.status,
          message: 'Funds released from escrow to seller',
          releasedAt: new Date(),
          sourceTransaction: transfer.source_transaction
        };
        
      } catch (transferError) {
        console.error('Error creating transfer:', {
          error: transferError.message,
          code: transferError.code,
          type: transferError.type,
          raw: transferError.raw
        });
        
        // Add more specific error messages for common issues
        if (transferError.code === 'parameter_missing') {
          throw new Error(`Missing required parameter: ${transferError.param}`);
        } else if (transferError.code === 'invalid_request_error') {
          throw new Error(`Invalid transfer request: ${transferError.message}`);
        } else if (transferError.code === 'account_invalid') {
          throw new Error('The seller account is not valid or cannot receive transfers');
        }
        
        throw new Error(`Failed to create transfer: ${transferError.message}`);
      }
      
    } catch (error) {
      console.error('=== Error in releaseEscrowFunds ===', {
        error: {
          message: error.message,
          code: error.code,
          type: error.type,
          stack: error.stack
        },
        context: {
          paymentIntentId,
          sellerStripeAccountId: sellerStripeAccountId ? `${sellerStripeAccountId.substring(0, 8)}...` : 'MISSING',
          amount,
          currency,
          metadata
        },
        timestamp: new Date().toISOString()
      });
      
      // Re-throw with a more descriptive message
      const errorMessage = error.code ? 
        `[${error.code}] ${error.message}` : 
        error.message;
        
      throw new Error(`Failed to release escrow funds: ${errorMessage}`);
    }
  }

  // Refund a payment from escrow
  static async refundEscrowPayment(paymentIntentId, reason = 'requested_by_customer') {
    try {
      // First check if we can void the authorization (if not captured yet)
      try {
        const voided = await stripe.paymentIntents.cancel(paymentIntentId, {
          cancellation_reason: reason
        });
        
        if (voided.status === 'canceled') {
          return {
            id: voided.id,
            status: 'canceled',
            amount: voided.amount,
            refunded: true,
            message: 'Authorization voided successfully'
          };
        }
      } catch (voidError) {
        // If we can't void, proceed with refund
        console.log('Cannot void authorization, processing refund instead:', voidError.message);
      }
      
      // If we get here, we need to process a refund
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: reason
      });
      
      return {
        id: refund.id,
        status: refund.status,
        amount: refund.amount,
        refunded: true,
        message: 'Refund processed successfully'
      };
    } catch (error) {
      console.error('Error refunding escrow payment:', error);
      throw new Error(`Failed to refund escrow payment: ${error.message}`);
    }
  }

  // Get payment intent details
  static async getPaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['charges.data.balance_transaction']
      });
      
      // Add additional details about the payment intent
      const response = {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        amount_received: paymentIntent.amount_received,
        status: paymentIntent.status,
        created: paymentIntent.created,
        currency: paymentIntent.currency,
        customer: paymentIntent.customer,
        metadata: paymentIntent.metadata,
        isEscrow: paymentIntent.metadata?.is_escrow === 'true',
        captured: paymentIntent.amount_received > 0,
        charges: []
      };
      
      // Add charge details if available
      if (paymentIntent.charges?.data?.length > 0) {
        response.charges = paymentIntent.charges.data.map(charge => ({
          id: charge.id,
          amount: charge.amount,
          amount_refunded: charge.amount_refunded,
          captured: charge.captured,
          created: charge.created,
          currency: charge.currency,
          status: charge.status,
          balance_transaction: charge.balance_transaction,
          refunded: charge.refunded,
          refunds: charge.refunds?.data || []
        }));
      }
      
      return response;
    } catch (error) {
      console.error('Error retrieving payment intent:', error);
      throw new Error(`Failed to retrieve payment intent: ${error.message}`);
    }
  }

  // Create a refund
  static async createRefund(paymentIntentId, amount = null, reason = 'requested_by_customer') {
    try {
      const refundData = {
        payment_intent: paymentIntentId,
        reason: reason
      };

      if (amount) {
        refundData.amount = Math.round(amount * 100); // Convert to cents
      }

      const refund = await stripe.refunds.create(refundData);
      return refund;
    } catch (error) {
      console.error('Error creating refund:', error);
      throw new Error('Failed to create refund');
    }
  }

  // Transfer funds to a seller's account
  static async transferToSeller(accountId, amount, currency, metadata = {}) {
    try {
      console.log('Starting transfer to seller:', { accountId, amount, currency });
      
      // Convert amount to smallest currency unit
      const isZeroDecimalCurrency = ['jpy', 'krw', 'vnd', 'xof', 'xaf', 'xpf', 'clp', 'pyg', 'gnf', 'jod', 'bif', 'djf', 'mga', 'pab', 'khr', 'kmf', 'cve', 'mru', 'mga', 'mnt', 'rwf', 'vuv', 'xaf', 'xof', 'xpf'].includes(currency.toLowerCase());
      const amountInCents = isZeroDecimalCurrency ? Math.round(amount) : Math.round(amount * 100);
      
      console.log('Amount in cents:', amountInCents, 'Zero decimal currency:', isZeroDecimalCurrency);
      
      // Calculate platform fee (5%)
      const platformFee = Math.round(amountInCents * 0.05);
      const transferAmount = amountInCents - platformFee;
      
      console.log('Calculated platform fee:', platformFee, 'Transfer amount:', transferAmount);
      
      // Create the transfer
      console.log('Creating transfer with params:', {
        amount: transferAmount,
        currency: currency.toLowerCase(),
        destination: accountId,
        description: 'Payment for order',
        metadata: {
          ...metadata,
          platform_fee: platformFee.toString(),
          transfer_amount: transferAmount.toString()
        }
      });
      
      const transfer = await stripe.transfers.create({
        amount: transferAmount,
        currency: currency.toLowerCase(),
        destination: accountId,
        description: 'Payment for order',
        metadata: {
          ...metadata,
          platform_fee: platformFee.toString(),
          transfer_amount: transferAmount.toString()
        }
      });
      
      console.log('Transfer created successfully:', {
        transferId: transfer.id,
        amount: transfer.amount,
        currency: transfer.currency,
        destination: transfer.destination,
        status: transfer.status
      });
      
      return transfer;
      
    } catch (error) {
      console.error('Error creating transfer:', {
        error: error.message,
        stack: error.stack,
        response: error.raw ? error.raw : 'No raw error response'
      });
      throw new Error(`Failed to transfer to seller: ${error.message}`);
    }
  }

  // Get payment intent details
  static async getPaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      console.error('Error retrieving payment intent:', error);
      throw new Error('Failed to retrieve payment intent');
    }
  }

  // Verify webhook signature
  static verifyWebhookSignature(payload, signature, webhookSecret) {
    try {
      const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      return event;
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      throw new Error('Invalid webhook signature');
    }
  }
}

module.exports = StripeService;

