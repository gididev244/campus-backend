/**
 * @fileoverview User model schema for Campus Market
 * @description Defines the structure and behavior of user accounts including buyers, sellers, and admins
 * @module models/User
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User Schema
 * @typedef {Object} User
 * @property {string} name - User's full name (required, max 50 chars)
 * @property {string} email - User's email address (required, unique, valid format)
 * @property {string} password - Hashed password (required, min 6 chars, must contain uppercase, lowercase, number, special char)
 * @property {'buyer'|'seller'|'admin'} role - User's role for authorization (default: 'buyer')
 * @property {string} phone - User's phone number (required, valid format)
 * @property {string|null} avatar - Profile avatar image URL
 * @property {string} location - User's location
 * @property {boolean} isVerified - Verification status (default: false)
 * @property {boolean} isActive - Account active status (default: true)
 * @property {number} averageRating - Average rating from reviews (0-5, default: 0)
 * @property {number} totalReviews - Total number of reviews received
 * @property {boolean} isOnline - Online status for real-time features (default: false)
 * @property {Date|null} lastSeen - Last timestamp user was online
 * @property {string} resetPasswordToken - Token for password reset
 * @property {Date} resetPasswordExpire - Expiration date for reset token
 * @property {boolean} forcePasswordChange - Force user to change password on next login (default: false)
 * @property {Date} createdAt - Timestamp of account creation
 * @property {Date} updatedAt - Timestamp of last update
 */
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [6, 'Password must be at least 6 characters long'],
    validate: {
      validator: function(value) {
        // At least one uppercase, one lowercase, one number, one special character
        // And must be at least 6 characters (enforced by regex too)
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
        return passwordRegex.test(value);
      },
      message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
    },
    select: false
  },
  role: {
    type: String,
    enum: ['buyer', 'seller', 'admin'],
    default: 'buyer'
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number'],
    match: [/^\+?\d{10,15}$/, 'Please provide a valid phone number']
  },
  avatar: {
    type: String,
    default: null
  },
  location: {
    type: String,
    trim: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: null
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  forcePasswordChange: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

/**
 * Pre-save middleware to hash password before saving
 * @async
 * @function
 * @memberof User
 * @param {Function} next - Express next middleware function
 */
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * Compare candidate password with hashed password
 * @async
 * @function
 * @memberof User
 * @param {string} candidatePassword - Password to verify
 * @returns {Promise<boolean>} True if passwords match, false otherwise
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Indexes for common queries
// Note: Email unique index is already defined in schema above, no need to redefine

// Compound index for role-based queries with status filtering
userSchema.index({ role: 1, isActive: 1 });

// Additional useful indexes
userSchema.index({ isOnline: 1 });
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);
