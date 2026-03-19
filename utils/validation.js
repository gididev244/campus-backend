const ErrorResponse = require('../middleware/error').ErrorResponse;

/**
 * Validation Utilities
 *
 * Helper functions to reduce duplicate validation code across controllers
 */

/**
 * Validate that a document exists by ID
 * @param {Model} Model - Mongoose model
 * @param {string} id - Document ID
 * @param {string} notFoundMessage - Custom error message
 * @returns {Promise<Document>} Found document
 * @throws {ErrorResponse} If document not found
 */
exports.validateExists = async (Model, id, notFoundMessage) => {
  const doc = await Model.findById(id);
  if (!doc) {
    throw new ErrorResponse(notFoundMessage || `${Model.modelName} not found`, 404);
  }
  return doc;
};

/**
 * Validate product is available for purchase
 * Checks: product exists, status is 'available', buyer is not seller
 * @param {Model} ProductModel - Product model
 * @param {string} productId - Product ID
 * @param {string} userId - User ID attempting to purchase
 * @returns {Promise<Document>} Product document
 * @throws {ErrorResponse} If validation fails
 */
exports.validateProductForPurchase = async (ProductModel, productId, userId) => {
  const product = await ProductModel.findById(productId);

  if (!product) {
    throw new ErrorResponse('Product not found', 404);
  }

  if (product.status !== 'available') {
    throw new ErrorResponse('Product is not available', 400);
  }

  if (product.seller.toString() === userId) {
    throw new ErrorResponse('Cannot purchase your own product', 400);
  }

  return product;
};

/**
 * Validate category exists
 * @param {Model} CategoryModel - Category model
 * @param {string} categoryId - Category ID
 * @returns {Promise<Document>} Category document
 * @throws {ErrorResponse} If category not found
 */
exports.validateCategory = async (CategoryModel, categoryId) => {
  const category = await CategoryModel.findById(categoryId);
  if (!category) {
    throw new ErrorResponse('Category not found', 404);
  }
  return category;
};

/**
 * Validate user exists
 * @param {Model} UserModel - User model
 * @param {string} userId - User ID
 * @param {string} notFoundMessage - Custom error message
 * @returns {Promise<Document>} User document
 * @throws {ErrorResponse} If user not found
 */
exports.validateUser = async (UserModel, userId, notFoundMessage) => {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new ErrorResponse(notFoundMessage || 'User not found', 404);
  }
  return user;
};

/**
 * Validate resource ownership
 * @param {Document} resource - Resource document
 * @param {string} ownerId - Owner user ID
 * @param {string} requestUserId - Requesting user ID
 * @param {string} adminRole - Admin role name (default: 'admin')
 * @throws {ErrorResponse} If not authorized
 */
exports.validateOwnership = (resource, ownerId, requestUserId, adminRole = 'admin') => {
  // Check if user is admin
  if (resource.role && resource.role === adminRole) {
    return; // Admin can access
  }

  // Check if user owns the resource
  if (ownerId.toString() !== requestUserId) {
    throw new ErrorResponse('Not authorized to access this resource', 403);
  }
};

/**
 * Validate quantity is positive
 * @param {number} quantity - Quantity to validate
 * @param {string} fieldName - Field name for error message
 * @throws {ErrorResponse} If quantity is invalid
 */
exports.validateQuantity = (quantity, fieldName = 'Quantity') => {
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty < 1) {
    throw new ErrorResponse(`${fieldName} must be at least 1`, 400);
  }
  return qty;
};

/**
 * Validate required fields in request body
 * @param {Object} body - Request body
 * @param {Array<string>} requiredFields - Array of required field names
 * @throws {ErrorResponse} If any required field is missing
 */
exports.validateRequiredFields = (body, requiredFields) => {
  const missingFields = requiredFields.filter(field => !body[field]);

  if (missingFields.length > 0) {
    throw new ErrorResponse(
      `Missing required fields: ${missingFields.join(', ')}`,
      400
    );
  }
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @throws {ErrorResponse} If email is invalid
 */
exports.validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    throw new ErrorResponse('Please provide a valid email address', 400);
  }
  return email;
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @param {number} minLength - Minimum length (default: 6)
 * @throws {ErrorResponse} If password is too weak
 */
exports.validatePassword = (password, minLength = 6) => {
  if (!password || password.length < minLength) {
    throw new ErrorResponse(
      `Password must be at least ${minLength} characters long`,
      400
    );
  }
  return password;
};

/**
 * Validate phone number (basic validation)
 * @param {string} phone - Phone number to validate
 * @throws {ErrorResponse} If phone number is invalid
 */
exports.validatePhoneNumber = (phone) => {
  if (!phone || phone.length < 10) {
    throw new ErrorResponse('Please provide a valid phone number', 400);
  }
  return phone;
};

module.exports = exports;
