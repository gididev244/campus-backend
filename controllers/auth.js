const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');
const { generateRandomString } = require('../utils/helpers');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const logger = require('../utils/logger');

/**
 * @desc    Generate JWT token for user authentication
 * @param   {string} id - User ID to encode in token
 * @returns {string} JWT token
 */
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

/**
 * @desc    Register a new user (buyer or seller)
 * @route   POST /api/auth/register
 * @access  Public
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.name - User's full name
 * @param   {string} req.body.email - User's email address
 * @param   {string} req.body.password - User's password (min 6 chars, must contain uppercase, lowercase, number, special char)
 * @param   {string} [req.body.role] - User role (buyer or seller, defaults to buyer)
 * @param   {string} [req.body.phone] - User's phone number
 * @param   {string} [req.body.location] - User's location
 * @returns {Promise<Object>} Response with success status, token, and user data
 */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, location } = req.body;

    // Prevent admin registration through public API
    if (role === 'admin') {
      logger.auth('register_failed', {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Admin registration attempted'
      });
      return next(new ErrorResponse('Admin registration is not allowed. Contact system administrator.', 403));
    }

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      logger.auth('register_failed', {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'User already exists'
      });
      return next(new ErrorResponse('User already exists with this email', 400));
    }

    // Validate password strength before creating user
    // Must be at least 6 characters
    if (password.length < 6) {
      logger.auth('register_failed', {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Password too short'
      });
      return next(new ErrorResponse('Password must be at least 6 characters long', 400));
    }

    // Must contain uppercase, lowercase, number, and special character
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
    if (!passwordRegex.test(password)) {
      logger.auth('register_failed', {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Password does not meet complexity requirements'
      });
      return next(new ErrorResponse(
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
        400
      ));
    }

    // Create user (only buyer or seller roles allowed)
    const user = await User.create({
      name,
      email,
      password,
      role: role || 'buyer',
      phone,
      location
    });

    // Generate token
    const token = generateToken(user._id);

    // Log successful registration
    logger.auth('register_success', {
      userId: user._id,
      email: user.email,
      role: user.role,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      success: true
    });

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user.email, user.name).catch(err => {
      logger.error('Welcome email failed', { email: user.email, userId: user._id }, err);
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        location: user.location,
        avatar: user.avatar
      }
    });
  } catch (error) {
    logger.error('Registration error', {
      email: req.body.email,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }, error);
    next(error);
  }
};

/**
 * @desc    Authenticate user and return JWT token
 * @route   POST /api/auth/login
 * @access  Public
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.email - User's email address
 * @param   {string} req.body.password - User's password
 * @returns {Promise<Object>} Response with success status, token, and user data
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      logger.auth('login_failed', {
        email: email || 'not_provided',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Missing credentials'
      });
      return next(new ErrorResponse('Please provide email and password', 400));
    }

    // Check user exists (include password for comparison)
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      logger.auth('login_failed', {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'User not found'
      });
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    // Check if user is active
    if (!user.isActive) {
      logger.auth('login_failed', {
        userId: user._id,
        email: user.email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Account deactivated'
      });
      return next(new ErrorResponse('Your account has been deactivated', 401));
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      logger.auth('login_failed', {
        userId: user._id,
        email: user.email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Invalid password'
      });
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    // Generate token
    const token = generateToken(user._id);

    // Log successful login
    logger.auth('login_success', {
      userId: user._id,
      email: user.email,
      role: user.role,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      success: true
    });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      forcePasswordChange: user.forcePasswordChange || false,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        location: user.location,
        avatar: user.avatar
      }
    });
  } catch (error) {
    logger.error('Login error', {
      email: req.body.email,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }, error);
    next(error);
  }
};

/**
 * @desc    Get current authenticated user's profile
 * @route   GET /api/auth/me
 * @access  Private
 * @returns {Promise<Object>} Response with success status and user data
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        location: user.location,
        avatar: user.avatar,
        isVerified: user.isVerified,
        averageRating: user.averageRating,
        totalReviews: user.totalReviews,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update current user's profile information
 * @route   PUT /api/auth/profile
 * @access  Private
 * @param   {Object} req.body - Request body
 * @param   {string} [req.body.name] - User's full name
 * @param   {string} [req.body.phone] - User's phone number
 * @param   {string} [req.body.location] - User's location
 * @returns {Promise<Object>} Response with success status and updated user data
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, phone, location } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, phone, location },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        location: user.location,
        avatar: user.avatar
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change current user's password
 * @route   PUT /api/auth/change-password
 * @access  Private
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.currentPassword - Current password for verification
 * @param   {string} req.body.newPassword - New password (min 6 chars, must contain uppercase, lowercase, number, special char)
 * @returns {Promise<Object>} Response with success status and message
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(new ErrorResponse('Please provide current and new password', 400));
    }

    if (newPassword.length < 6) {
      return next(new ErrorResponse('New password must be at least 6 characters long', 400));
    }

    // Must contain uppercase, lowercase, number, and special character
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
      return next(new ErrorResponse(
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
        400
      ));
    }

    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(new ErrorResponse('Current password is incorrect', 401));
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send password reset email to user
 * @route   POST /api/auth/forgot-password
 * @access  Public
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.email - User's email address
 * @returns {Promise<Object>} Response with success status and message
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return next(new ErrorResponse('No user found with this email', 404));
    }

    // Generate reset token
    const resetToken = generateRandomString(32);
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Create reset URL
    const resetURL = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Send email
    await sendPasswordResetEmail(user.email, resetURL);

    res.json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset user's password using reset token
 * @route   POST /api/auth/reset-password
 * @access  Public
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.token - Password reset token from email
 * @param   {string} req.body.newPassword - New password to set
 * @returns {Promise<Object>} Response with success status and message
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return next(new ErrorResponse('Please provide token and new password', 400));
    }

    // Validate password length
    if (newPassword.length < 6) {
      logger.auth('password_reset_failed', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Password too short'
      });
      return next(new ErrorResponse('Password must be at least 6 characters long', 400));
    }

    // Validate password complexity
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
      logger.auth('password_reset_failed', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        success: false,
        reason: 'Password does not meet complexity requirements'
      });
      return next(new ErrorResponse(
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
        400
      ));
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return next(new ErrorResponse('Invalid or expired reset token', 400));
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    logger.auth('password_reset_success', {
      userId: user._id,
      email: user.email,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      success: true
    });

    res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refresh JWT token using existing token
 * @route   POST /api/auth/refresh-token
 * @access  Public
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.token - Existing JWT token (may be expired)
 * @returns {Promise<Object>} Response with success status and new token
 */
exports.refreshToken = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return next(new ErrorResponse('No token provided', 400));
    }

    try {
      // Verify the old token (even if expired, we can decode it)
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });

      // Check if user still exists and is active
      const user = await User.findById(decoded.id);

      if (!user) {
        return next(new ErrorResponse('User no longer exists', 401));
      }

      if (!user.isActive) {
        return next(new ErrorResponse('Your account has been deactivated', 401));
      }

      // Generate new token
      const newToken = generateToken(user._id);

      res.json({
        success: true,
        token: newToken
      });
    } catch (err) {
      return next(new ErrorResponse('Invalid token', 401));
    }
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
