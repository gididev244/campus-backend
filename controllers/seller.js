/**
 * @fileoverview Seller controller for balance and withdrawal management
 * @description Handles seller balance queries and withdrawal requests
 * @module controllers/seller
 */

const SellerBalance = require('../models/SellerBalance');
const Order = require('../models/Order');
const ErrorResponse = require('../utils/appError');
const logger = require('../utils/logger');

/**
 * @desc    Get seller's current balance and transaction history
 * @route   GET /api/sellers/balance
 * @access  Private (Seller only)
 * @param   {Object} req - Express request object
 * @param   {Object} req.user - Authenticated user
 * @returns {Promise<Object>} Response with balance details and ledger
 */
exports.getSellerBalance = async (req, res, next) => {
  try {
    const sellerId = req.user.id;

    logger.info('Fetching seller balance', { sellerId });

    let balance = await SellerBalance.getOrCreate(sellerId);

    const pendingWithdrawals = balance.withdrawalRequests.filter(w => w.status === 'pending');
    const releasedWithdrawals = balance.withdrawalRequests.filter(w => w.status === 'released');
    const processingWithdrawals = balance.withdrawalRequests.filter(w => w.status === 'processing');

    res.json({
      success: true,
      data: {
        sellerId: balance.seller,
        totalEarnings: balance.totalEarnings,
        totalOrders: balance.totalOrders,
        currentBalance: balance.currentBalance,
        pendingWithdrawals: balance.pendingWithdrawals,
        withdrawnTotal: balance.withdrawnTotal,
        lastUpdated: balance.lastUpdated,
        pendingWithdrawalCount: pendingWithdrawals.length,
        releasedWithdrawalCount: releasedWithdrawals.length,
        withdrawalSummary: {
          pending: pendingWithdrawals.map(w => ({
            id: w._id,
            amount: w.amount,
            requestedAt: w.requestedAt,
            status: 'pending',
            message: 'Waiting for buyer to confirm delivery'
          })),
          released: releasedWithdrawals.map(w => ({
            id: w._id,
            amount: w.amount,
            requestedAt: w.requestedAt,
            releasedAt: w.releasedAt,
            status: 'released',
            message: 'Released - ready for processing'
          })),
          processing: processingWithdrawals.map(w => ({
            id: w._id,
            amount: w.amount,
            status: 'processing'
          }))
        },
        ledger: balance.ledger.sort((a, b) => new Date(b.date) - new Date(a.date))
      }
    });

    logger.success('Seller balance fetched successfully', {
      sellerId,
      currentBalance: balance.currentBalance,
      totalEarnings: balance.totalEarnings
    });
  } catch (error) {
    logger.error('Failed to fetch seller balance', {
      error: error.message,
      sellerId: req.user.id
    });
    next(error);
  }
};

/**
 * @desc    Request a withdrawal from seller's available balance
 * @route   POST /api/sellers/withdraw
 * @access  Private (Seller only)
 * @param   {Object} req - Express request object
 * @param   {Object} req.user - Authenticated user
 * @param   {Object} req.body - Request body
 * @param   {number} req.body.amount - Amount to withdraw (required)
 * @param   {string} [req.body.notes] - Optional notes for the withdrawal
 * @returns {Promise<Object>} Response with updated balance and withdrawal details
 */
exports.requestWithdrawal = async (req, res, next) => {
  try {
    const sellerId = req.user.id;
    const { amount, notes } = req.body;

    logger.info('Processing withdrawal request', { sellerId, amount });

    if (!amount || amount <= 0) {
      return next(new ErrorResponse('Please provide a valid withdrawal amount', 400));
    }

    const balance = await SellerBalance.getOrCreate(sellerId);

    if (balance.currentBalance < amount) {
      logger.warn('Insufficient balance for withdrawal', {
        sellerId,
        requested: amount,
        available: balance.currentBalance
      });
      return next(new ErrorResponse(
        `Insufficient balance. Available: ${balance.currentBalance}, Requested: ${amount}`,
        400
      ));
    }

    const paidOrders = await Order.find({
      seller: sellerId,
      paymentStatus: 'completed',
      status: { $ne: 'delivered' }
    }).select('_id orderNumber totalPrice status').sort({ createdAt: -1 });

    const orderIds = paidOrders.map(o => o._id);

    await balance.recordWithdrawal(amount, {
      notes,
      requestedBy: sellerId,
      phoneNumber: req.user.phone,
      orderIds
    });

    if (global.io) {
      global.io.emit('withdrawal:request', {
        sellerId,
        sellerName: req.user.name,
        sellerEmail: req.user.email,
        sellerPhone: req.user.phone,
        amount,
        notes,
        orderCount: orderIds.length,
        requestedAt: new Date().toISOString()
      });

      logger.info('Withdrawal request - Socket event emitted to admins', {
        sellerId,
        amount
      });
    }

    logger.payment('withdrawal_request', {
      success: true,
      sellerId,
      amount,
      orderIds: orderIds.length,
      remainingBalance: balance.currentBalance
    });

    res.json({
      success: true,
      message: 'Withdrawal request submitted. It will be processed after buyer confirms delivery.',
      data: {
        withdrawalAmount: amount,
        currentBalance: balance.currentBalance,
        pendingWithdrawals: balance.pendingWithdrawals,
        linkedOrders: orderIds.length,
        status: 'pending',
        note: 'Withdrawal will be released when buyers confirm delivery of linked orders.'
      }
    });
  } catch (error) {
    logger.error('Failed to process withdrawal request', {
      error: error.message,
      sellerId: req.user.id,
      amount: req.body.amount
    });

    if (error.message === 'Insufficient balance') {
      return next(new ErrorResponse('Insufficient balance for withdrawal', 400));
    }

    next(error);
  }
};

/**
 * @desc    Get seller's detailed transaction history
 * @route   GET /api/sellers/transactions
 * @access  Private (Seller only)
 * @param   {Object} req - Express request object
 * @param   {Object} req.user - Authenticated user
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number
 * @param   {number} [req.query.limit=20] - Items per page
 * @param   {string} [req.query.type] - Filter by transaction type (sale, withdrawal, fee, adjustment)
 * @returns {Promise<Object>} Response with paginated transaction history
 */
exports.getTransactionHistory = async (req, res, next) => {
  try {
    const sellerId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;
    const skip = (page - 1) * limit;

    logger.info('Fetching seller transaction history', { sellerId, page, limit, type });

    const balance = await SellerBalance.getOrCreate(sellerId);

    // Filter by type if specified
    let ledger = balance.ledger;
    if (type) {
      ledger = ledger.filter(entry => entry.type === type);
    }

    // Sort by date descending (newest first)
    ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Paginate
    const total = ledger.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedLedger = ledger.slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        transactions: paginatedLedger,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        summary: {
          totalEarnings: balance.totalEarnings,
          currentBalance: balance.currentBalance,
          pendingWithdrawals: balance.pendingWithdrawals,
          withdrawnTotal: balance.withdrawnTotal
        }
      }
    });

    logger.success('Transaction history fetched successfully', {
      sellerId,
      transactionsReturned: paginatedLedger.length,
      total
    });
  } catch (error) {
    logger.error('Failed to fetch transaction history', {
      error: error.message,
      sellerId: req.user.id
    });
    next(error);
  }
};
