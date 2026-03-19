/**
 * @fileoverview M-Pesa payment integration utilities
 * @description Handles STK push payment initiation, token generation, and phone validation for Safaricom M-Pesa
 * @module utils/mpesa
 */

const axios = require('axios');
const crypto = require('crypto');
const mpesaConfig = require('../config/mpesa');
const logger = require('./logger');

/**
 * Generate M-Pesa OAuth access token
 * @async
 * @function
 * @returns {Promise<string>} OAuth access token
 * @throws {Error} If token generation fails
 */
exports.generateToken = async () => {
  try {
    const auth = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64');

    const response = await axios.get(
      `${mpesaConfig.baseURL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    logger.debug('M-Pesa token generated successfully');

    return response.data.access_token;
  } catch (error) {
    logger.error('M-Pesa token generation error', {
      error: error.response?.data || error.message
    }, error);
    throw new Error('Failed to generate M-Pesa token');
  }
};

/**
 * Initiate M-Pesa STK Push payment
 * Prompts user to enter M-Pesa PIN on their phone
 * @async
 * @function
 * @param {string} phoneNumber - Phone number to send STK push to (format: 254XXXXXXXXX or 07XXXXXXXX)
 * @param {number} amount - Amount to charge in KES
 * @param {string} orderNumber - Order identifier for reference
 * @param {string} callbackUrl - URL to receive payment callback
 * @returns {Promise<Object>} Response object with checkoutRequestID and merchantRequestID
 * @throws {Error} If STK push initiation fails
 */
exports.initiateSTKPush = async (phoneNumber, amount, orderNumber, callbackUrl) => {
  try {
    const token = await this.generateToken();
    const date = new Date();
    const timestamp = date.getFullYear() +
      ('0' + (date.getMonth() + 1)).slice(-2) +
      ('0' + date.getDate()).slice(-2) +
      ('0' + date.getHours()).slice(-2) +
      ('0' + date.getMinutes()).slice(-2) +
      ('0' + date.getSeconds()).slice(-2);

    const password = Buffer.from(
      mpesaConfig.shortcode + mpesaConfig.passkey + timestamp
    ).toString('base64');

    const payload = {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', // Use CustomerPayBillOnline for paybill numbers
      Amount: Math.round(amount),
      PartyA: phoneNumber.replace(/\D/g, ''), // Remove non-digits
      PartyB: mpesaConfig.shortcode,
      PhoneNumber: phoneNumber.replace(/\D/g, ''),
      CallBackURL: callbackUrl || `${process.env.API_URL}/api/v1/orders/payment/mpesa/callback`,
      AccountReference: orderNumber,
      TransactionDesc: `Payment for order ${orderNumber}`
    };

    const response = await axios.post(
      `${mpesaConfig.baseURL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.payment('stk_push_initiated', {
      orderId: orderNumber,
      amount: Math.round(amount),
      phone: phoneNumber,
      checkoutRequestID: response.data.CheckoutRequestID,
      responseCode: response.data.ResponseCode,
      success: true
    });

    return {
      success: true,
      merchantRequestID: response.data.MerchantRequestID,
      checkoutRequestID: response.data.CheckoutRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseMessage,
      customerMessage: response.data.CustomerMessage
    };
  } catch (error) {
    logger.payment('stk_push_failed', {
      orderId: orderNumber,
      amount: Math.round(amount),
      phone: phoneNumber,
      error: error.response?.data || error.message,
      success: false
    });
    throw new Error(error.response?.data?.errorMessage || 'Failed to initiate M-Pesa payment');
  }
};

/**
 * Query the status of an STK Push transaction
 * @async
 * @function
 * @param {string} checkoutRequestID - Checkout request ID from initiateSTKPush
 * @returns {Promise<Object>} Status response with resultCode and resultDesc
 * @throws {Error} If query fails
 */
exports.querySTKStatus = async (checkoutRequestID) => {
  try {
    const token = await this.generateToken();
    const date = new Date();
    const timestamp = date.getFullYear() +
      ('0' + (date.getMonth() + 1)).slice(-2) +
      ('0' + date.getDate()).slice(-2) +
      ('0' + date.getHours()).slice(-2) +
      ('0' + date.getMinutes()).slice(-2) +
      ('0' + date.getSeconds()).slice(-2);

    const password = Buffer.from(
      mpesaConfig.shortcode + mpesaConfig.passkey + timestamp
    ).toString('base64');

    const payload = {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID
    };

    const response = await axios.post(
      `${mpesaConfig.baseURL}/mpesa/stkpushquery/v1/query`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      resultCode: response.data.ResultCode,
      resultDesc: response.data.ResultDesc
    };
  } catch (error) {
    console.error('M-Pesa query error:', error.response?.data || error.message);
    throw new Error('Failed to query M-Pesa transaction status');
  }
};

/**
 * Validate and normalize phone number for M-Pesa
 * Converts format 07XXXXXXXX to 2547XXXXXXXX
 * @function
 * @param {string} phone - Phone number to validate
 * @returns {string} Normalized phone number in format 254XXXXXXXXX
 * @throws {Error} If phone number format is invalid
 */
exports.validatePhoneNumber = (phone) => {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Add country code if missing (254 for Kenya)
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  }

  // Validate format
  if (!/^254\d{9}$/.test(cleaned)) {
    throw new Error('Invalid phone number format. Use format: 254XXXXXXXXX or 07XXXXXXXX');
  }

  return cleaned;
};

/**
 * Generate security credential for B2C requests
 * This is the encrypted initiator password
 * @function
 * @returns {string} Base64 encoded security credential
 */
exports.generateSecurityCredential = () => {
  const initiatorPassword = mpesaConfig.b2cInitiatorPassword || process.env.MPESA_B2C_INITIATOR_PASSWORD;
  
  if (!initiatorPassword) {
    throw new Error('B2C initiator password not configured');
  }

  // For sandbox, the credential is just base64 encoded
  // For production, it needs to be encrypted with M-Pesa public key
  const env = mpesaConfig.baseURL.includes('sandbox') ? 'sandbox' : 'production';
  
  if (env === 'sandbox') {
    return Buffer.from(initiatorPassword).toString('base64');
  }

  // For production, we would need to encrypt with the M-Pesa public key
  // This requires the certificate file from Safaricom
  // For now, assume the security credential is provided directly
  return mpesaConfig.b2cSecurityCredential || process.env.MPESA_B2C_SECURITY_CREDENTIAL;
};

/**
 * Initiate M-Pesa B2C Payment (Business to Customer)
 * Used for sending money from business to customer (withdrawals/payouts)
 * @async
 * @function
 * @param {string} phoneNumber - Recipient phone number (format: 254XXXXXXXXX or 07XXXXXXXX)
 * @param {number} amount - Amount to send in KES
 * @param {string} transactionId - Unique transaction identifier for reference
 * @param {string} [remarks] - Optional remarks for the transaction
 * @returns {Promise<Object>} Response object with conversationID and originatorConversationID
 * @throws {Error} If B2C payment initiation fails
 */
exports.initiateB2CPayment = async (phoneNumber, amount, transactionId, remarks = 'Seller payout') => {
  try {
    const token = await this.generateToken();
    const securityCredential = this.generateSecurityCredential();
    
    // Normalize phone number
    const normalizedPhone = this.validatePhoneNumber(phoneNumber);
    
    const payload = {
      InitiatorName: mpesaConfig.b2cInitiatorName || process.env.MPESA_B2C_INITIATOR_NAME,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayment', // BusinessPayment for payouts
      Amount: Math.round(amount),
      PartyA: mpesaConfig.shortcode,
      PartyB: normalizedPhone,
      Remarks: remarks,
      QueueTimeOutURL: mpesaConfig.b2cQueueTimeoutURL || `${process.env.API_URL}/api/v1/payments/b2c/timeout`,
      ResultURL: mpesaConfig.b2cResultURL || `${process.env.API_URL}/api/v1/payments/b2c/result`,
      Occassion: transactionId // Using Occassion field to store transaction ID for tracking
    };

    const response = await axios.post(
      `${mpesaConfig.baseURL}/mpesa/b2c/v1/paymentrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.payment('b2c_initiated', {
      transactionId,
      amount: Math.round(amount),
      phone: normalizedPhone,
      conversationID: response.data.ConversationID,
      originatorConversationID: response.data.OriginatorConversationID,
      responseCode: response.data.ResponseCode,
      success: true
    });

    return {
      success: true,
      conversationID: response.data.ConversationID,
      originatorConversationID: response.data.OriginatorConversationID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription
    };
  } catch (error) {
    logger.payment('b2c_failed', {
      transactionId,
      amount: Math.round(amount),
      phone: phoneNumber,
      error: error.response?.data || error.message,
      success: false
    });
    throw new Error(error.response?.data?.errorMessage || 'Failed to initiate B2C payment');
  }
};

/**
 * Query the status of a B2C transaction
 * @async
 * @function
 * @param {string} conversationID - Conversation ID from B2C initiation
 * @returns {Promise<Object>} Status response with transaction details
 * @throws {Error} If query fails
 */
exports.queryB2CStatus = async (conversationID) => {
  try {
    const token = await this.generateToken();
    const securityCredential = this.generateSecurityCredential();

    const payload = {
      Initiator: mpesaConfig.b2cInitiatorName || process.env.MPESA_B2C_INITIATOR_NAME,
      SecurityCredential: securityCredential,
      CommandID: 'TransactionStatusQuery',
      TransactionID: conversationID,
      PartyA: mpesaConfig.shortcode,
      IdentifierType: '4', // Organization shortcode
      ResultURL: mpesaConfig.b2cResultURL || `${process.env.API_URL}/api/v1/payments/b2c/status`,
      QueueTimeOutURL: mpesaConfig.b2cQueueTimeoutURL || `${process.env.API_URL}/api/v1/payments/b2c/timeout`,
      Remarks: 'Transaction status query',
      Occassion: 'Query'
    };

    const response = await axios.post(
      `${mpesaConfig.baseURL}/mpesa/transactionstatus/v1/query`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      conversationID: response.data.ConversationID,
      originatorConversationID: response.data.OriginatorConversationID,
      responseCode: response.data.ResponseCode
    };
  } catch (error) {
    console.error('B2C status query error:', error.response?.data || error.message);
    throw new Error('Failed to query B2C transaction status');
  }
};

module.exports = exports;
