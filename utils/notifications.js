/**
 * @fileoverview Notification utilities for real-time updates
 * @description Helper functions to create, emit, and track notifications via Socket.io
 * @module utils/notifications
 */

const Notification = require('../models/Notification');

/**
 * Emit notification via Socket.io to a specific user
 * @param {Object} notification - Notification object to emit
 * @param {string} event - Event name (default: 'notification:new')
 */
const emitNotification = (notification, event = 'notification:new') => {
  if (global.io) {
    global.io.to(`user:${notification.recipient}`).emit(event, notification);
  }
};

/**
 * Create a notification and emit it via Socket.io
 * @param {Object} data - Notification data
 * @param {string} data.recipient - User ID of the recipient
 * @param {string} data.sender - User ID of the sender
 * @param {string} data.type - Notification type (order, message, etc.)
 * @param {string} data.title - Notification title
 * @param {string} data.message - Notification message
 * @param {Object} data.data - Additional data
 * @returns {Promise<Object>} Created notification
 */
const createNotification = async (data) => {
  const notification = await Notification.create(data);
  const populated = await Notification.findById(notification._id)
    .populate('sender', 'name avatar');

  // Get unread count for the recipient
  const unreadCount = await Notification.countDocuments({
    recipient: data.recipient,
    isRead: false
  });

  // Emit via Socket.io
  emitNotification({
    ...populated.toObject(),
    unreadCount
  });

  return notification;
};

/**
 * Get unread count for notifications
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
const getNotificationUnreadCount = async (userId) => {
  return await Notification.countDocuments({
    recipient: userId,
    isRead: false
  });
};

/**
 * Emit unread count update via Socket.io
 * @param {string} userId - User ID to emit to
 * @param {number} count - Unread count
 * @param {string} event - Event name (default: 'notification:unread-count')
 */
const emitUnreadCount = (userId, count, event = 'notification:unread-count') => {
  if (global.io) {
    global.io.to(`user:${userId}`).emit(event, { count });
  }
};

module.exports = {
  emitNotification,
  createNotification,
  getNotificationUnreadCount,
  emitUnreadCount
};
