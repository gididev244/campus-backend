const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const SellerBalance = require('../models/SellerBalance');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const logger = require('../utils/logger');
const mpesa = require('../utils/mpesa');

/**
 * @desc    Get revenue analytics with trends
 * @route   GET /api/admin/analytics/revenue
 * @access  Private (Admin only)
 * @param   {Object} req.query - Query parameters
 * @param   {string} [req.query.period=7d] - Time period: 7d, 30d, 90d, 1y, all
 * @returns {Promise<Object>} Revenue analytics with daily breakdown
 */
exports.getRevenueAnalytics = async (req, res, next) => {
  try {
    const { period = '7d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get completed orders in date range
    const orders = await Order.find({
      paymentStatus: 'completed',
      createdAt: { $gte: startDate, $lte: now }
    }).select('totalPrice createdAt');

    // Calculate total revenue
    const totalRevenue = orders.reduce((sum, order) => sum + order.totalPrice, 0);

    // Group by date for trend chart
    const revenueByDate = {};
    orders.forEach(order => {
      const date = new Date(order.createdAt).toISOString().split('T')[0];
      revenueByDate[date] = (revenueByDate[date] || 0) + order.totalPrice;
    });

    // Fill in missing dates with 0
    const dailyRevenue = [];
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
      const dateStr = currentDate.toISOString().split('T')[0];
      dailyRevenue.push({
        date: dateStr,
        revenue: revenueByDate[dateStr] || 0
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate growth
    const previousRevenue = orders
      .filter(o => new Date(o.createdAt) < new Date(now.getTime() - 24 * 60 * 60 * 1000))
      .reduce((sum, o) => sum + o.totalPrice, 0);

    const todayRevenue = orders
      .filter(o => {
        const orderDate = new Date(o.createdAt).toDateString();
        const today = new Date().toDateString();
        return orderDate === today;
      })
      .reduce((sum, o) => sum + o.totalPrice, 0);

    res.json({
      success: true,
      data: {
        totalRevenue,
        todayRevenue,
        dailyRevenue,
        period,
        startDate,
        endDate: now
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user analytics with growth trends
 * @route   GET /api/admin/analytics/users
 * @access  Private (Admin only)
 * @param   {Object} req.query - Query parameters
 * @param   {string} [req.query.period=7d] - Time period: 7d, 30d, 90d, 1y, all
 * @returns {Promise<Object>} User analytics with registration trends
 */
exports.getUserAnalytics = async (req, res, next) => {
  try {
    const { period = '7d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get total users
    const totalUsers = await User.countDocuments();

    // Get users registered in date range
    const users = await User.find({
      createdAt: { $gte: startDate, $lte: now }
    }).select('createdAt role');

    // Group by date for trend chart
    const usersByDate = {};
    users.forEach(user => {
      const date = new Date(user.createdAt).toISOString().split('T')[0];
      usersByDate[date] = (usersByDate[date] || 0) + 1;
    });

    // Fill in missing dates with 0
    const dailyRegistrations = [];
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
      const dateStr = currentDate.toISOString().split('T')[0];
      dailyRegistrations.push({
        date: dateStr,
        count: usersByDate[dateStr] || 0
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Count by role
    const usersByRole = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    const roleCounts = {
      admin: 0,
      seller: 0,
      buyer: 0
    };

    usersByRole.forEach(item => {
      roleCounts[item._id] = item.count;
    });

    // Today's registrations
    const todayRegistrations = users.filter(user => {
      const userDate = new Date(user.createdAt).toDateString();
      const today = new Date().toDateString();
      return userDate === today;
    }).length;

    res.json({
      success: true,
      data: {
        totalUsers,
        todayRegistrations,
        newUsers: users.length,
        dailyRegistrations,
        usersByRole: roleCounts,
        period,
        startDate,
        endDate: now
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get order analytics with status breakdown
 * @route   GET /api/admin/analytics/orders
 * @access  Private (Admin only)
 * @param   {Object} req.query - Query parameters
 * @param   {string} [req.query.period=7d] - Time period: 7d, 30d, 90d, 1y, all
 * @returns {Promise<Object>} Order analytics with status distribution
 */
exports.getOrderAnalytics = async (req, res, next) => {
  try {
    const { period = '7d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get total orders
    const totalOrders = await Order.countDocuments();

    // Get orders in date range
    const orders = await Order.find({
      createdAt: { $gte: startDate, $lte: now }
    }).select('status paymentStatus totalPrice createdAt');

    // Group by status
    const ordersByStatus = {
      pending: 0,
      confirmed: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      refunded: 0
    };

    orders.forEach(order => {
      if (ordersByStatus.hasOwnProperty(order.status)) {
        ordersByStatus[order.status]++;
      }
    });

    // Group by payment status
    const paymentStats = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now }
        }
      },
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalPrice' }
        }
      }
    ]);

    const paymentStatusCounts = {
      pending: 0,
      completed: 0,
      failed: 0,
      refunded: 0
    };

    paymentStats.forEach(stat => {
      paymentStatusCounts[stat._id] = {
        count: stat.count,
        amount: stat.totalAmount
      };
    });

    // Daily order volume
    const ordersByDate = {};
    orders.forEach(order => {
      const date = new Date(order.createdAt).toISOString().split('T')[0];
      ordersByDate[date] = (ordersByDate[date] || 0) + 1;
    });

    const dailyOrders = [];
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
      const dateStr = currentDate.toISOString().split('T')[0];
      dailyOrders.push({
        date: dateStr,
        count: ordersByDate[dateStr] || 0
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Today's orders
    const todayOrders = orders.filter(order => {
      const orderDate = new Date(order.createdAt).toDateString();
      const today = new Date().toDateString();
      return orderDate === today;
    }).length;

    // Calculate completion rate
    const completionRate = totalOrders > 0
      ? ((ordersByStatus.delivered / totalOrders) * 100).toFixed(2)
      : 0;

    // Calculate cancellation rate
    const cancellationRate = totalOrders > 0
      ? ((ordersByStatus.cancelled / totalOrders) * 100).toFixed(2)
      : 0;

    // Average order value
    const paidOrders = orders.filter(o => o.paymentStatus === 'completed');
    const averageOrderValue = paidOrders.length > 0
      ? paidOrders.reduce((sum, o) => sum + o.totalPrice, 0) / paidOrders.length
      : 0;

    res.json({
      success: true,
      data: {
        totalOrders,
        todayOrders,
        newOrders: orders.length,
        ordersByStatus,
        paymentStatusCounts,
        dailyOrders,
        completionRate: parseFloat(completionRate),
        cancellationRate: parseFloat(cancellationRate),
        averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
        period,
        startDate,
        endDate: now
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get product analytics
 * @route   GET /api/admin/analytics/products
 * @access  Private (Admin only)
 * @returns {Promise<Object>} Product analytics with status breakdown
 */
exports.getProductAnalytics = async (req, res, next) => {
  try {
    // Get total products
    const totalProducts = await Product.countDocuments();

    // Products by status
    const productsByStatus = await Product.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusCounts = {
      available: 0,
      sold: 0,
      pending: 0
    };

    productsByStatus.forEach(item => {
      if (statusCounts.hasOwnProperty(item._id)) {
        statusCounts[item._id] = item.count;
      }
    });

    // Products by condition
    const productsByCondition = await Product.aggregate([
      {
        $group: {
          _id: '$condition',
          count: { $sum: 1 }
        }
      }
    ]);

    const conditionCounts = {};
    productsByCondition.forEach(item => {
      conditionCounts[item._id] = item.count;
    });

    // Top categories
    const topCategories = await Product.aggregate([
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      {
        $unwind: '$category'
      },
      {
        $group: {
          _id: '$category.name',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Recent products (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recentProducts = await Product.countDocuments({
      createdAt: { $gte: weekAgo }
    });

    // Total product value
    const totalProductValue = await Product.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$price' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        totalProducts,
        recentProducts,
        productsByStatus: statusCounts,
        productsByCondition: conditionCounts,
        topCategories,
        totalProductValue: totalProductValue[0]?.total || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all reviews for moderation
 * @route   GET /api/admin/reviews
 * @access  Private (Admin only)
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number
 * @param   {number} [req.query.limit=20] - Items per page
 * @param   {string} [req.query.rating] - Filter by rating
 * @param   {string} [req.query.productId] - Filter by product
 * @returns {Promise<Object>} Paginated reviews
 */
exports.getAllReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, rating, productId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (rating) query.rating = parseInt(rating);
    if (productId) query.product = productId;

    const reviews = await Review.find(query)
      .populate('reviewer', 'name email')
      .populate('reviewedUser', 'name email')
      .populate('product', 'title')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Review.countDocuments(query);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a review (admin only)
 * @route   DELETE /api/admin/reviews/:id
 * @access  Private (Admin only)
 * @param   {string} req.params.id - Review ID
 * @returns {Promise<Object>} Success message
 */
exports.deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return next(new ErrorResponse('Review not found', 404));
    }

    await Review.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all messages for moderation
 * @route   GET /api/admin/messages
 * @access  Private (Admin only)
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number
 * @param   {number} [req.query.limit=20] - Items per page
 * @param   {string} [req.query.search] - Search by content or user
 * @returns {Promise<Object>} Paginated messages
 */
exports.getAllMessages = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (search) {
      query.$or = [
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    const messages = await Message.find(query)
      .populate('sender', 'name email')
      .populate('receiver', 'name email')
      .populate('product', 'title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Message.countDocuments(query);

    res.json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Flag a message as inappropriate
 * @route   POST /api/admin/messages/:id/flag
 * @access  Private (Admin only)
 * @param   {string} req.params.id - Message ID
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.reason - Reason for flagging
 * @returns {Promise<Object>} Success message
 */
/**
 * @desc    Get all withdrawal requests
 * @route   GET /api/admin/withdrawals
 * @access  Private (Admin only)
 */
exports.getWithdrawalRequests = async (req, res, next) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const balances = await SellerBalance.find({
      'withdrawalRequests.status': status
    }).populate('seller', 'name email phone').lean();

    const withdrawalRequests = [];
    balances.forEach(balance => {
      balance.withdrawalRequests.forEach(request => {
        if (request.status === status) {
          withdrawalRequests.push({
            ...request,
            sellerId: balance.seller._id,
            sellerName: balance.seller.name,
            sellerEmail: balance.seller.email,
            sellerPhone: balance.seller.phone,
            currentBalance: balance.currentBalance
          });
        }
      });
    });

    withdrawalRequests.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

    const total = withdrawalRequests.length;
    const paginated = withdrawalRequests.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: paginated,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process withdrawal request
 * @route   PUT /api/admin/withdrawals/:requestId
 * @access  Private (Admin only)
 */
exports.processWithdrawalRequest = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { status, notes } = req.body;

    const balance = await SellerBalance.findOne({
      'withdrawalRequests._id': requestId
    });

    if (!balance) {
      return next(new ErrorResponse('Withdrawal request not found', 404));
    }

    const withdrawalRequest = balance.withdrawalRequests.id(requestId);

    if (!withdrawalRequest) {
      return next(new ErrorResponse('Withdrawal request not found', 404));
    }

    withdrawalRequest.status = status;

    if (status === 'processing') {
      withdrawalRequest.processedAt = new Date();
      withdrawalRequest.metadata = {
        ...withdrawalRequest.metadata,
        processedBy: req.user.id,
        adminNotes: notes
      };
    } else if (status === 'completed') {
      const seller = await User.findById(balance.seller);

      if (!seller || !seller.phone) {
        return next(new ErrorResponse('Seller phone number not found', 400));
      }

      try {
        const b2cResult = await mpesa.initiateB2CPayment(
          seller.phone,
          withdrawalRequest.amount,
          requestId,
          `Payout for withdrawal ${requestId}`
        );

        withdrawalRequest.metadata = {
          ...withdrawalRequest.metadata,
          b2cConversationID: b2cResult.conversationID,
          b2cOriginatorConversationID: b2cResult.originatorConversationID,
          b2cResponseCode: b2cResult.responseCode,
          completedBy: req.user.id,
          completionNotes: notes
        };
        withdrawalRequest.b2cTransactionId = b2cResult.conversationID;
        withdrawalRequest.b2cStatus = 'processing';

        logger.payment('b2c_initiated_for_withdrawal', {
          withdrawalId: requestId,
          sellerId: balance.seller,
          amount: withdrawalRequest.amount,
          phone: seller.phone,
          conversationID: b2cResult.conversationID
        });
      } catch (b2cError) {
        logger.error('B2C payment failed for withdrawal', {
          withdrawalId: requestId,
          sellerId: balance.seller,
          amount: withdrawalRequest.amount,
          error: b2cError.message
        });

        withdrawalRequest.status = 'failed';
        withdrawalRequest.metadata = {
          ...withdrawalRequest.metadata,
          b2cError: b2cError.message,
          failedAt: new Date(),
          failedBy: req.user.id
        };

        await balance.save();

        return next(new ErrorResponse(`B2C payment failed: ${b2cError.message}`, 400));
      }

      withdrawalRequest.completedAt = new Date();

      balance.pendingWithdrawals -= withdrawalRequest.amount;

      const ledgerEntry = balance.ledger.find(
        e => e.withdrawalId && e.withdrawalId.toString() === requestId.toString()
      );

      if (ledgerEntry) {
        ledgerEntry.status = 'completed';
        ledgerEntry.description = 'Withdrawal completed via M-Pesa B2C';
        ledgerEntry.metadata = {
          ...ledgerEntry.metadata,
          completedAt: new Date(),
          completedBy: req.user.id
        };
      }

      if (global.io) {
        global.io.to(`user:${balance.seller}`).emit('withdrawal:completed', {
          withdrawalId: requestId,
          amount: withdrawalRequest.amount,
          notes,
          completedAt: new Date().toISOString(),
          b2cTransactionId: withdrawalRequest.b2cTransactionId
        });

        logger.info('Withdrawal completed - Socket event emitted', {
          sellerId: balance.seller,
          withdrawalId: requestId,
          amount: withdrawalRequest.amount
        });
      }
    }

    await balance.save();

    res.json({
      success: true,
      message: `Withdrawal request marked as ${status}`,
      data: {
        withdrawalId: requestId,
        status: withdrawalRequest.status,
        amount: withdrawalRequest.amount
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
