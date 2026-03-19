const mpesaConfig = {
  baseURL: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  environment: process.env.MPESA_ENV || 'sandbox',
  passkey: process.env.MPESA_PASSKEY,
  shortcode: process.env.MPESA_SHORTCODE,
  // B2C Configuration
  b2cInitiatorName: process.env.MPESA_B2C_INITIATOR_NAME,
  b2cInitiatorPassword: process.env.MPESA_B2C_INITIATOR_PASSWORD,
  b2cShortcode: process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE,
  b2cResultURL: process.env.MPESA_B2C_RESULT_URL,
  b2cQueueTimeoutURL: process.env.MPESA_B2C_QUEUE_TIMEOUT_URL
};

module.exports = mpesaConfig;
