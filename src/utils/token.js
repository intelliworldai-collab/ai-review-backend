const { randomBytes } = require('crypto');

function generateApprovalToken() {
  return randomBytes(32).toString('hex');
}

function tokenExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7); // expires in 7 days
  return d;
}

module.exports = { generateApprovalToken, tokenExpiryDate };
