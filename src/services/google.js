const { google } = require('googleapis');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/business.manage',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });
}

async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

async function getUserInfo(accessToken) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

function buildAuthClient(user, db = null) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token:  user.access_token,
    refresh_token: user.refresh_token,
    expiry_date:   user.token_expiry ? new Date(user.token_expiry).getTime() : undefined
  });

  // Persist new tokens whenever googleapis auto-refreshes them
  if (db && user.user_id) {
    oauth2Client.on('tokens', async (tokens) => {
      try {
        await db.query(
          `UPDATE users SET
             access_token = $1,
             token_expiry = $2
             ${tokens.refresh_token ? ', refresh_token = $3' : ''}
           WHERE id = ${tokens.refresh_token ? '$4' : '$3'}`,
          tokens.refresh_token
            ? [tokens.access_token, new Date(tokens.expiry_date), tokens.refresh_token, user.user_id]
            : [tokens.access_token, new Date(tokens.expiry_date), user.user_id]
        );
      } catch (err) {
        console.error('[Google] Failed to persist refreshed token:', err.message);
      }
    });
  }

  return oauth2Client;
}

// Fetch all Google Business accounts for a user
async function getAccounts(authClient) {
  const res = await fetch(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    { headers: { Authorization: `Bearer ${(await authClient.getAccessToken()).token}` } }
  );
  if (!res.ok) throw new Error(`Failed to get accounts: ${res.status}`);
  const data = await res.json();
  return data.accounts || [];
}

// Fetch all locations for an account
async function getLocations(authClient, accountId) {
  const token = (await authClient.getAccessToken()).token;
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title,storefrontAddress`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Failed to get locations: ${res.status}`);
  const data = await res.json();
  return data.locations || [];
}

// Fetch reviews that have no reply yet
async function getUnansweredReviews(authClient, accountId, locationId) {
  const token = (await authClient.getAccessToken()).token;
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/reviews?pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Failed to get reviews: ${res.status}`);
  const data = await res.json();
  const reviews = data.reviews || [];
  // Only return reviews without an existing reply
  return reviews.filter(r => !r.reviewReply);
}

// Post a reply to a review
async function postReply(authClient, accountId, locationId, reviewId, replyText) {
  const token = (await authClient.getAccessToken()).token;
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/reviews/${reviewId}/reply`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ comment: replyText })
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Failed to post reply: ${res.status}`);
  }
  return true;
}

// Convert Google star enum to number
function starToNumber(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] || 3;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getUserInfo,
  buildAuthClient,
  getAccounts,
  getLocations,
  getUnansweredReviews,
  postReply,
  starToNumber
};
