const { environment } = require('../config/environment');

async function sendSms(phone, message) {
  const { username, apiKey, senderId } = environment.sms;
  if (!username || !apiKey) {
    throw new Error('SMS_USERNAME and SMS_API_KEY must be configured before sending SMS.');
  }

  const body = new URLSearchParams({ username, to: phone, message });
  if (senderId) {
    body.set('from', senderId);
  }
  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Africa's Talking request failed with HTTP ${response.status}.`);
  }
  const recipient = result.SMSMessageData?.Recipients?.[0];
  if (!recipient || String(recipient.statusCode) !== '100') {
    throw new Error(recipient?.status || 'Africa\'s Talking did not accept the SMS.');
  }
  return recipient.messageId || null;
}

module.exports = { sendSms };