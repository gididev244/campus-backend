/**
 * @fileoverview Product model schema for Campus Market
 * @description Defines the structure and behavior of product listings created by sellers
 * @module models/Product
 */

const mongoose = require('mongoose');

/**
 * Product Schema
 * @typedef {Object} Product
 * @property {string} title - Product title (required, max 100 chars)
 * @property {string} description - Detailed product description (required, max 2000 chars)
 * @property {number} price - Product price in KES (required, non-negative)
 * @property {mongoose.Types.ObjectId} category - Reference to Category model (required)
 * @property {'new'|'like-new'|'good'|'fair'} condition - Product condition (default: 'good')
 * @property {string[]} images - Array of product image URLs
 * @property {mongoose.Types.ObjectId} seller - Reference to User model (required)
 * @property {string} location - Product location (required)
 * @property {'available'|'sold'|'pending'} status - Product availability status (default: 'available')
 * @property {boolean} isNegotiable - Whether price is negotiable (default: false)
 * @property {number} views - Number of times product has been viewed (default: 0)
 * @property {mongoose.Types.ObjectId[]} likes - Array of user IDs who liked this product
 * @property {number} averageRating - Average rating from reviews (0-5, default: 0)
 * @property {number} totalReviews - Total number of reviews
 * @property {string[]} tags - Product tags for searchability
 * @property {Date} createdAt - Timestamp of product creation
 * @property {Date} updatedAt - Timestamp of last update
 */
const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide a description'],
    maxlength: [2000, 'Description cannot be more than 2000 characters']
  },
  price: {
    type: Number,
    required: [true, 'Please provide a price'],
    min: [0, 'Price cannot be negative']
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Please provide a category']
  },
  condition: {
    type: String,
    enum: ['new', 'like-new', 'good', 'fair'],
    default: 'good'
  },
  images: [{
    type: String
  }],
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  location: {
    type: String,
    required: [true, 'Please provide a location']
  },
  status: {
    type: String,
    enum: ['available', 'sold', 'pending'],
    default: 'available'
  },
  soldAt: {
    type: Date,
    default: null
  },
  isNegotiable: {
    type: Boolean,
    default: false
  },
  views: {
    type: Number,
    default: 0
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
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
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true
});

// Database indexes for performance optimization

/**
 * Text search index for full-text search functionality
 * Searches across title, description, and tags fields
 */
productSchema.index({ title: 'text', description: 'text', tags: 'text' });

/**
 * Compound index: Seller's products with status and date sorting
 * Used in seller dashboard for listing seller's products
 */
productSchema.index({ seller: 1, status: 1, createdAt: -1 });

/**
 * Compound index: Category filtering with status and price sorting
 * Used in product listing page for category filtering
 */
productSchema.index({ category: 1, status: 1, price: 1 });

/**
 * Compound index: General product listing with status and date sorting
 * Used for homepage and browse pages
 */
productSchema.index({ status: 1, createdAt: -1 });

/**
 * Single field indexes for common queries
 */
productSchema.index({ seller: 1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ price: 1 });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);
