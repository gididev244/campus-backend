/**
 * @fileoverview Payment controller for M-Pesa B2C callbacks and payouts
 * @description Handles B2C result callbacks, timeout callbacks, and admin-initiated payouts
 * @module controllers/payments
 */

const SellerBalance = require('../models/SellerBalance');
const User = require('../models/User');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const logger = require('../utils/logger');
const mpesa = require('../utils/mpesa');

/**
 * @desc    Handle M-Pesa B2C result callback
 * @route   POST /api/v1/payments/b2c/result
 * @access  Public (M-Pesa callback)
 */
exports.b2cResultCallback = async (req, res, next) => {
  try {
    const { Result } = req.body;

    if (!Result) {
      logger.error('B2C callback missing Result object', { body: req.body });
      return res.status(400).json({ success: false, message: 'Invalid callback format' });
    }

    const {
      ResultType,
      ResultCode,
      ResultDesc,
      OriginatorConversationID,
      ConversationID,
      TransactionID
    } = Result;

    logger.payment('b2c_callback_received', {
      conversationID: ConversationID,
      originatorConversationID: OriginatorConversationID,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
      transactionID: TransactionID
    });

    const balance = await SellerBalance.findOne({
      'withdrawalRequests.b2cConversationID': ConversationID
    });

    if (!balance) {
      logger.error('B2C callback: No matching withdrawal found', {
        conversationID: ConversationID
      });
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    const withdrawalRequest = balance.withdrawalRequests.find(
      wr => wr.b2cConversationID === ConversationID
    );

    if (!withdrawalRequest) {
      logger.error('B2C callback: Withdrawal request not found', {
        conversationID: ConversationID
      });
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    if (ResultCode === 0) {
      withdrawalRequest.status = 'completed';
      withdrawalRequest.b2cStatus = 'completed';
      withdrawalRequest.b2cTransactionId = TransactionID;
      withdrawalRequest.completedAt = new Date();
      withdrawalRequest.metadata = {
        ...withdrawalRequest.metadata,
        b2cResultCode: ResultCode,
        b2cResultDesc: ResultDesc,
        b2cTransactionID: TransactionID,
        completedAt: new Date()
      };

      balance.pendingWithdrawals -= withdrawalRequest.amount;

      const ledgerEntry = balance.ledger.find(
        e => e.withdrawalId && e.withdrawalId.toString() === withdrawalRequest._id.toString()
      );
      if (ledgerEntry) {
        ledgerEntry.status = 'completed';
        ledgerEntry.description = `Withdrawal completed via M-Pesa B2C. Transaction ID: ${TransactionID}`;
        ledgerEntry.metadata = {
          ...ledgerEntry.metadata,
          b2cTransactionID: TransactionID,
          completedAt: new Date()
        };
      }

      await balance.save();

      if (global.io) {
        global.io.to(`user:${balance.seller}`).emit('withdrawal:completed', {
          withdrawalId: withdrawalRequest._id,
          amount: withdrawalRequest.amount,
          transactionId: TransactionID,
          completedAt: new Date().toISOString()
        });
      }

      logger.payment('b2c_payout_completed', {
        withdrawalId: withdrawalRequest._id,
        sellerId: balance.seller,
        amount: withdrawalRequest.amount,
        transactionID: TransactionID
      });
    } else {
      withdrawalRequest.status = 'failed';
      withdrawalRequest.b2cStatus = 'failed';
      withdrawalRequest.metadata = {
        ...withdrawalRequest.metadata,
        b2cResultCode: ResultCode,
        b2cResultDesc: ResultDesc,
        failedAt: new Date()
      };

      await balance.save();

      logger.error('B2C payout failed', {
        withdrawalId: withdrawalRequest._id,
        sellerId: balance.seller,
        amount: withdrawalRequest.amount,
        resultCode: ResultCode,
        resultDesc: ResultDesc
      });

      if (global.io) {
        global.io.to(`user:${balance.seller}`).emit('withdrawal:failed', {
          withdrawalId: withdrawalRequest._id,
          amount: withdrawalRequest.amount,
          reason: ResultDesc
        });
      }
    }

    res.json({ success: true, message: 'Callback processed' });
  } catch (error) {
    logger.error('B2C result callback error', {
      error: error.message,
      stack: error.stack
    }, error);
    res.status(500).json({ success: false, message: 'Callback processing failed' });
  }
};

/**
 * @desc    Handle M-Pesa B2C timeout callback
 * @route   POST /api/v1/payments/b2c/timeout
 * @access  Public (M-Pesa callback)
 */
exports.b2cTimeoutCallback = async (req, res, next) => {
  try {
    const { Result } = req.body;

    logger.payment('b2c_timeout_received', {
      body: req.body
    });

    if (!Result) {
      return res.status(400).json({ success: false, message: 'Invalid timeout format' });
    }

    const { ConversationID } = Result;

    const balance = await SellerBalance.findOne({
      'withdrawalRequests.b2cConversationID': ConversationID
    });

    if (balance) {
      const withdrawalRequest = balance.withdrawalRequests.find(
        wr => wr.b2cConversationID === ConversationID
      );

      if (withdrawalRequest) {
        withdrawalRequest.b2cStatus = 'timeout';
        withdrawalRequest.metadata = {
          ...withdrawalRequest.metadata,
          timeoutAt: new Date(),
          timeoutDetails: Result
        };

        await balance.save();

        logger.payment('b2c_timeout_processed', {
          withdrawalId: withdrawalRequest._id,
          conversationID: ConversationID
        });
      }
    }

    res.json({ success: true, message: 'Timeout processed' });
  } catch (error) {
    logger.error('B2C timeout callback error', {
      error: error.message
    }, error);
    res.status(500).json({ success: false, message: 'Timeout processing failed' });
  }
};

/**
 * @desc    Initiate B2C payout to seller (Admin only)
 * @route   POST /api/v1/payments/b2c/payout
 * @access  Private (Admin only)
 */
exports.initiateB2CPayout = async (req, res, next) => {
  try {
    const { sellerId, amount, notes } = req.body;

    if (!sellerId || !amount) {
      return next(new ErrorResponse('Seller ID and amount are required', 400));
    }

    if (amount < 10) {
      return next(new ErrorResponse('Minimum payout amount is KES 10', 400));
    }

    const seller = await User.findById(sellerId);
    if (!seller) {
      return next(new ErrorResponse('Seller not found', 404));
    }

    if (!seller.phone) {
      return next(new ErrorResponse('Seller does not have a phone number', 400));
    }

    const balance = await SellerBalance.findOne({ seller: sellerId });
    if (!balance) {
      return next(new ErrorResponse('Seller balance not found', 404));
    }

    if (balance.currentBalance < amount) {
      return next(new ErrorResponse(`Insufficient balance. Available: KES ${balance.currentBalance}`, 400));
    }

    const transactionId = `B2C-${Date.now()}-${sellerId.slice(-6)}`;

    const withdrawalRequest = {
      amount,
      status: 'processing',
      requestedAt: new Date(),
      notes: notes || 'Admin-initiated B2C payout',
      metadata: {
        initiatedBy: req.user.id,
        transactionId
      }
    };

    balance.withdrawalRequests.push(withdrawalRequest);
    const savedBalance = await balance.save();

    const newWithdrawal = savedBalance.withdrawalRequests[savedBalance.withdrawalRequests.length - 1];

    try {
      const b2cResult = await mpesa.initiateB2CPayment(
        seller.phone,
        amount,
        transactionId,
        notes || 'Seller payout from Campus Market'
      );

      newWithdrawal.b2cConversationID = b2cResult.conversationID;
      newWithdrawal.b2cOriginatorConversationID = b2cResult.originatorConversationID;
      newWithdrawal.b2cStatus = 'processing';
      newWithdrawal.metadata = {
        ...newWithdrawal.metadata,
        b2cResponseCode: b2cResult.responseCode,
        b2cResponseDescription: b2cResult.responseDescription,
        initiatedAt: new Date()
      };

      balance.pendingWithdrawals += amount;
      await balance.save();

      logger.payment('b2c_payout_initiated', {
        withdrawalId: newWithdrawal._id,
        sellerId,
        amount,
        phone: seller.phone,
        conversationID: b2cResult.conversationID
      });

      res.json({
        success: true,
        message: 'B2C payout initiated successfully',
        data: {
          withdrawalId: newWithdrawal._id,
          amount,
          sellerName: seller.name,
          sellerPhone: seller.phone,
          conversationID: b2cResult.conversationID,
          status: 'processing'
        }
      });
    } catch (b2cError) {
      newWithdrawal.status = 'failed';
      newWithdrawal.b2cStatus = 'failed';
      newWithdrawal.metadata = {
        ...newWithdrawal.metadata,
        b2cError: b2cError.message,
        failedAt: new Date()
      };

      await balance.save();

      logger.error('B2C payout initiation failed', {
        sellerId,
        amount,
        error: b2cError.message
      });

      return next(new ErrorResponse(`B2C payout failed: ${b2cError.message}`, 400));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get B2C payout status
 * @route   GET /api/v1/payments/b2c/status/:conversationId
 * @access  Private (Admin only)
 */
exports.getB2CPayoutStatus = async (req, res, next) => {
  try {
    const { conversationId } = req.params;

    const balance = await SellerBalance.findOne({
      'withdrawalRequests.b2cConversationID': conversationId
    }).populate('seller', 'name email phone');

    if (!balance) {
      return next(new ErrorResponse('B2C transaction not found', 404));
    }

    const withdrawalRequest = balance.withdrawalRequests.find(
      wr => wr.b2cConversationID === conversationId
    );

    if (!withdrawalRequest) {
      return next(new ErrorResponse('Withdrawal request not found', 404));
    }

    res.json({
      success: true,
      data: {
        withdrawalId: withdrawalRequest._id,
        amount: withdrawalRequest.amount,
        status: withdrawalRequest.status,
        b2cStatus: withdrawalRequest.b2cStatus,
        b2cTransactionId: withdrawalRequest.b2cTransactionId,
        seller: balance.seller,
        requestedAt: withdrawalRequest.requestedAt,
        completedAt: withdrawalRequest.completedAt,
        metadata: withdrawalRequest.metadata
      }
    });
  } catch (error) {
    next(error);
  }
};

const triggerAutoPayout = async (orderId) => {
  const Order = require('../models/Order');
  const SellerBalance = require('../models/SellerBalance');
  const User = require('../models/User');

  try {
    const order = await Order.findById(orderId)
      .populate('seller', 'name email phone mpesaNumber');

    if (!order) {
      console.error(`[AutoPayout] Order ${orderId} not found`);
      return;
    }

    if (order.sellerPaid) {
      console.log(`[AutoPayout] Order ${orderId} already paid`);
      return;
    }

    if (order.status !== 'delivered') {
      console.log(`[AutoPayout] Order ${orderId} not delivered yet`);
      return;
    }

    if (order.paymentStatus !== 'completed') {
      console.log(`[AutoPayout] Order ${orderId} payment not completed`);
      return;
    }

    const sellerPhone = order.seller?.mpesaNumber || order.seller?.phone;
    if (!sellerPhone) {
      console.error(`[AutoPayout] Seller ${order.seller._id} has no phone number`);
      return;
    }

    const balance = await SellerBalance.findOne({ seller: order.seller._id });
    if (!balance || balance.currentBalance < order.totalPrice) {
      console.error(`[AutoPayout] Insufficient balance for seller ${order.seller._id}`);
      return;
    }

    const formattedPhone = sellerPhone.toString().replace(/\D/g, '');
    const phoneWithCountryCode = formattedPhone.startsWith('254') 
      ? formattedPhone 
      : '254' + formattedPhone.slice(-9);

    const b2cPayload = {
      InitiatorName: process.env.MPESA_B2C_INITIATOR_NAME || 'CAMPUS_MARKET',
      SecurityCredential: process.env.MPESA_B2C_SECURITY_CREDENTIAL,
      CommandID: process.env.MPESA_B2C_COMMAND_ID || 'BusinessPayment',
      Amount: order.totalPrice,
      PartyA: process.env.MPESA_B2C_SHORTCODE || '600988',
      PartyB: phoneWithCountryCode,
      Remarks: `Payout for order ${order.orderNumber}`,
      QueueTimeOutURL: `${process.env.BACKEND_URL}/api/v1/payments/b2c/timeout`,
      ResultURL: `${process.env.BACKEND_URL}/api/v1/payments/b2c/result`
    };

    console.log(`[AutoPayout] Initiating B2C payout for order ${order.orderNumber}`);

    const b2cResponse = await initiateB2CPayout(b2cPayload);

    order.b2cConversationID = b2cResponse.ConversationID;
    order.b2cStatus = 'processing';
    await order.save();

    const payoutEntry = {
      type: 'withdrawal',
      amount: order.totalPrice,
      balance: balance.currentBalance - order.totalPrice,
      description: `Auto-payout for order ${order.orderNumber}`,
      status: 'pending',
      orderId: order._id,
      b2cConversationID: b2cResponse.ConversationID,
      date: new Date()
    };

    balance.ledger.push(payoutEntry);
    balance.currentBalance -= order.totalPrice;
    balance.withdrawnTotal = (balance.withdrawnTotal || 0) + order.totalPrice;
    await balance.save();

    order.sellerPaid = true;
    order.sellerPaidAt = Date.now();
    order.b2cStatus = 'completed';
    await order.save();

    console.log(`[AutoPayout] Payout completed for order ${order.orderNumber}`);

    if (global.io) {
      global.io.to(`user:${order.seller._id}`).emit('payout:completed', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: order.totalPrice,
        message: 'Payout completed!'
      });
    }

    logger.info('Auto-payout completed', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      sellerId: order.seller._id,
      amount: order.totalPrice
    });

  } catch (error) {
    console.error(`[AutoPayout] Error for order ${orderId}:`, error);
    logger.error('Auto-payout failed', {
      orderId,
      error: error.message
    });
  }
};

module.exports = exports;
