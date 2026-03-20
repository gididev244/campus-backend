const User = require('../models/User');
const Product = require('../models/Product');
const { validateExists, validatePassword } = require('../utils/validation');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const { formatPaginationResponse, getPagination } = require('../utils/helpers');
const { findManyAndPopulate, POPULATE_FIELDS } = require('../utils/populate');

/**
 * Simple in-memory cache for dashboard stats
 * Cache TTL: 30 seconds
 */
const dashboardCache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds

/**
 * Get cached dashboard stats or return null if expired/not found
 * @param {string} userId - User ID to fetch cache for
 * @returns {Object|null} Cached data or null
 */
function getCachedDashboardStats(userId) {
  const cached = dashboardCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Set dashboard stats in cache
 * @param {string} userId - User ID to cache for
 * @param {Object} data - Data to cache
 */
function setCachedDashboardStats(userId, data) {
  dashboardCache.set(userId, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Clear dashboard stats cache for a specific user
 * @param {string} userId - User ID to clear cache for
 */
function clearDashboardCache(userId) {
  dashboardCache.delete(userId);
}

/**
 * @desc    Get all users with filtering and pagination (admin only)
 * @route   GET /api/users
 * @access  Private (Admin)
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number for pagination
 * @param   {number} [req.query.limit=20] - Number of items per page
 * @param   {string} [req.query.role] - Filter by user role
 * @param   {string} [req.query.search] - Search term for name or email
 * @returns {Promise<Object>} Paginated response with users array and metadata
 */
exports.getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const { skip, limit: limitNum, page: pageNum } = getPagination(page, limit);

    const query = {};
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Use lean() for better read performance
    const users = await User.find(query)
      .select('-password -resetPasswordToken -resetPasswordExpire')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await User.countDocuments(query);

    res.json(formatPaginationResponse(users, total, pageNum, limitNum));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single user by ID with their products
 * @route   GET /api/users/:id
 * @access  Public
 * @param   {string} req.params.id - User ID
 * @returns {Promise<Object>} Response with success status and user data including products
 */
exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpire')
      .lean();

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Get user's products with lean() for better performance
    const products = await Product.find({ seller: req.params.id })
      .select('title price images status condition createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      user: {
        ...user,
        products
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user details (admin only)
 * @route   PUT /api/users/:id
 * @access  Private (Admin)
 * @param   {string} req.params.id - User ID
 * @param   {Object} req.body - Request body
 * @param   {string} [req.body.role] - User role (buyer, seller, admin)
 * @param   {boolean} [req.body.isVerified] - Verification status
 * @param   {boolean} [req.body.isActive] - Active status
 * @returns {Promise<Object>} Response with success status and updated user data
 */
exports.updateUser = async (req, res, next) => {
  try {
    const { role, isVerified, isActive } = req.body;

    const user = await validateExists(User, req.params.id, 'User not found');

    // Prevent admin from modifying themselves
    if (user._id.toString() === req.user.id) {
      return next(new ErrorResponse('Cannot modify your own account through this endpoint', 400));
    }

    user.role = role || user.role;
    user.isVerified = isVerified !== undefined ? isVerified : user.isVerified;
    user.isActive = isActive !== undefined ? isActive : user.isActive;

    await user.save();

    // Remove password from response object instead of making another query
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpire;

    res.json({
      success: true,
      message: 'User updated successfully',
      user: userResponse
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a user (admin only)
 * @route   DELETE /api/users/:id
 * @access  Private (Admin)
 * @param   {string} req.params.id - User ID
 * @returns {Promise<Object>} Response with success status and message
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await validateExists(User, req.params.id, 'User not found');

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user.id) {
      return next(new ErrorResponse('Cannot delete your own account', 400));
    }

    await user.deleteOne();

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get dashboard statistics for seller
 * @route   GET /api/users/dashboard/stats
 * @access  Private (Seller)
 * @returns {Promise<Object>} Response with success status, stats, recent products, and recent orders
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const mongoose = require('mongoose');
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Check cache first
    const cached = getCachedDashboardStats(userId);
    if (cached) {
      return res.json(cached);
    }

    const Product = require('../models/Product');
    const Order = require('../models/Order');

    // Run all independent queries in parallel for better performance
    const [
      productStats,
      orderStats,
      recentProducts,
      recentOrders
    ] = await Promise.all([
      // Product stats aggregation
      Product.aggregate([
        { $match: { seller: userObjectId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            available: {
              $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
            },
            sold: {
              $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
            },
            pending: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
            }
          }
        }
      ]),
      // Order stats aggregation
      Order.aggregate([
        { $match: { seller: userObjectId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
            },
            delivered: {
              $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
            },
            totalRevenue: {
              $sum: {
                $cond: [
                  { $eq: ['$paymentStatus', 'completed'] },
                  '$totalPrice',
                  0
                ]
              }
            }
          }
        }
      ]),
      // Recent products - lean() for better performance
      Product.find({ seller: userObjectId })
        .select('title price images status views createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      // Recent orders - only select needed fields to reduce data transfer
      Order.find({ seller: userObjectId })
        .select('orderNumber status totalPrice paymentStatus createdAt product buyer')
        .populate('product', POPULATE_FIELDS.PRODUCT_BASIC)
        .populate('buyer', POPULATE_FIELDS.USER_BASIC)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

    const stats = productStats[0] || { total: 0, available: 0, sold: 0, pending: 0 };
    const orderStatsData = orderStats[0] || { total: 0, pending: 0, delivered: 0, totalRevenue: 0 };

    const responseData = {
      success: true,
      stats: {
        products: {
          total: stats.total,
          available: stats.available,
          sold: stats.sold,
          pending: stats.pending
        },
        orders: {
          total: orderStatsData.total,
          pending: orderStatsData.pending,
          completed: orderStatsData.delivered
        },
        revenue: orderStatsData.totalRevenue
      },
      recentProducts,
      recentOrders
    };

    // Cache the response
    setCachedDashboardStats(userId, responseData);

    res.json(responseData);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin reset user password with auto-generated secure password
 * @route   POST /api/users/:id/reset-password
 * @access  Private (Admin only)
 * @param   {string} req.params.id - User ID
 * @returns {Promise<Object>} Response with success status and new password
 */
exports.resetUserPassword = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const crypto = require('crypto');

    // Prevent admins from resetting their own password
    if (userId === req.user.id) {
      return next(new ErrorResponse('Cannot reset your own password. Use change password instead.', 400));
    }

    const user = await User.findById(userId);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Generate secure random password that meets validation requirements
    // Must be at least 12 chars with uppercase, lowercase, number, and special character
    const generateSecurePassword = () => {
      const lowercase = 'abcdefghijklmnopqrstuvwxyz';
      const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const numbers = '0123456789';
      const special = '@$!%*?&';
      const all = lowercase + uppercase + numbers + special;

      // Ensure at least one of each required type
      let password = '';
      password += lowercase[Math.floor(crypto.randomInt(lowercase.length))];
      password += uppercase[Math.floor(crypto.randomInt(uppercase.length))];
      password += numbers[Math.floor(crypto.randomInt(numbers.length))];
      password += special[Math.floor(crypto.randomInt(special.length))];

      // Fill remaining length (aim for 16 chars total, so 12 more)
      for (let i = 0; i < 12; i++) {
        password += all[Math.floor(crypto.randomInt(all.length))];
      }

      // Shuffle the password
      return password.split('').sort(() => crypto.randomInt(3) - 1).join('');
    };

    const newPassword = generateSecurePassword();

    user.password = newPassword;
    user.forcePasswordChange = true; // Force user to change password on next login
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successful',
      data: {
        userId: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        newPassword: newPassword  // Show to admin to communicate to user
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change current user's password
 * @route   PUT /api/users/change-password
 * @access  Private
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.currentPassword - Current password for verification
 * @param   {string} req.body.newPassword - New password (min 6 characters)
 * @returns {Promise<Object>} Response with success status and message
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(new ErrorResponse('Please provide current and new password', 400));
    }

    // Validate password strength
    validatePassword(newPassword, 6);

    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(new ErrorResponse('Current password is incorrect', 401));
    }

    // Update password and clear forcePasswordChange flag
    user.password = newPassword;
    user.forcePasswordChange = false;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Export cache clearing functions for use in other controllers
exports.clearDashboardCache = clearDashboardCache;

module.exports = exports;
