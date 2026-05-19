const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseKey = supabaseServiceRoleKey || process.env.SUPABASE_ANON_KEY;
const adminPassword = process.env.ADMIN_PASSWORD;
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || supabaseKey;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Slip image is too large. Please upload an image under 10 MB.'
    });
  }

  return next(error);
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const adminCookieName = 'gdsq_admin_session';
const sessionSelect = 'id, title, max_players, court_count, event_date, start_time, end_time, price_thb, payment_mode, deposit_amount_thb, estimated_total_thb, final_amount_thb, payment_note_public, payment_qr_url, payment_bank_name, payment_account_name, payment_account_number, payment_promptpay_id, location, address, skill_level, description, poster_url, created_by_user_id, status, created_at';
const userSelect = 'id, line_uid, display_name, phone, profile_image_url, created_at';
const paymentSlipBucket = process.env.PAYMENT_SLIP_BUCKET || 'payment-slips';
const defaultHomeBannerUrl = '/assets/gdsq-home-banner.png';
const hasDefaultHomeBannerAsset = fs.existsSync(path.join(__dirname, 'public', 'assets', 'gdsq-home-banner.png'));
const adminActivityUserSelect = 'id, line_uid, display_name, profile_image_url, last_seen_at, app_open_count, created_at';
const VOTING_CATEGORIES = [
  { key: 'mvp_match', label: 'MVP of the Match', badgeKey: 'mvp' },
  { key: 'best_vibe', label: 'Best Vibe Player', badgeKey: 'goodVibes' },
  { key: 'most_improved', label: 'Most Improved', badgeKey: 'mostImproved' },
  { key: 'best_partner', label: 'Best Partner', badgeKey: 'bestPartner' },
  { key: 'dink_master', label: 'Dink Master', badgeKey: 'dinkMaster' },
  { key: 'power_shot', label: 'Power Shot', badgeKey: 'powerShot' },
  { key: 'aggressive_player', label: 'Aggressive Player', badgeKey: 'aggressive' },
  { key: 'fair_play', label: 'Fair Play', badgeKey: 'fairPlay' },
  { key: 'style_on_court', label: 'Style on Court', badgeKey: 'style' },
  { key: 'social_star', label: 'Social Star', badgeKey: 'socialStar' },
  { key: 'rookie_of_the_day', label: 'Rookie of the Day', badgeKey: 'rookie' }
];
const VOTING_CATEGORY_KEYS = new Set(VOTING_CATEGORIES.map((category) => category.key));
const VOTING_CATEGORY_MAP = Object.fromEntries(VOTING_CATEGORIES.map((category) => [category.key, category]));
const DEFAULT_RANKING_CATEGORY = 'overall';

function serializeHomeBanner(row) {
  return {
    id: row.id,
    title: row.title || '',
    imageUrl: row.image_url || '',
    linkUrl: row.link_url || '',
    displayOrder: Number(row.display_order || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex === -1) return [cookie, ''];
        return [
          decodeURIComponent(cookie.slice(0, separatorIndex)),
          decodeURIComponent(cookie.slice(separatorIndex + 1))
        ];
      })
  );
}

function createAdminToken() {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', adminSessionSecret)
    .update(timestamp)
    .digest('hex');
  return `${timestamp}.${signature}`;
}

function isValidAdminToken(token) {
  if (!token || !token.includes('.')) return false;

  const [timestamp, signature] = token.split('.');
  const issuedAt = Number(timestamp);
  const maxAgeMs = 1000 * 60 * 60 * 12;

  if (!issuedAt || Date.now() - issuedAt > maxAgeMs) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', adminSessionSecret)
    .update(timestamp)
    .digest('hex');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

function requireAdmin(req, res, next) {
  if (!adminPassword) {
    return res.status(503).json({
      success: false,
      message: 'Admin password is not configured.'
    });
  }

  const cookies = parseCookies(req.headers.cookie);

  if (!isValidAdminToken(cookies[adminCookieName])) {
    return res.status(401).json({
      success: false,
      message: 'Admin login required.'
    });
  }

  return next();
}

function escapeCsvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(req, value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${req.protocol}://${req.get('host')}${value.startsWith('/') ? '' : '/'}${value}`;
}

function publicImageUrl(url) {
  if (!url) return '';
  const text = String(url).trim();
  const driveMatch = text.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([^/?&]+)/);
  if (driveMatch) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}=w1200`;
  }
  return text;
}

function buildMetaTags({ title, description, imageUrl, url }) {
  const safeTitle = escapeHtml(title || 'GDSQ Pickleball');
  const safeDescription = escapeHtml(description || 'GDSQ Good Game. Good People. Join the Fun!');
  const safeImage = escapeHtml(imageUrl || '');
  const safeUrl = escapeHtml(url || '');
  const imageTags = safeImage
    ? `
    <meta property="og:image" content="${safeImage}">
    <meta property="og:image:secure_url" content="${safeImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${safeTitle}">
    <meta name="twitter:image" content="${safeImage}">`
    : '';

  return `
    <link rel="canonical" href="${safeUrl}">
    <meta name="description" content="${safeDescription}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:url" content="${safeUrl}">
    <meta property="og:site_name" content="GDSQ Pickleball">
    <meta property="og:updated_time" content="${new Date().toISOString()}">
    ${imageTags}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:url" content="${safeUrl}">`;
}

function getBangkokDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysToDateString(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isPublicSessionVisible(session) {
  if (!session.event_date) return true;

  if (session.end_time) {
    const eventEnd = new Date(`${session.event_date}T${session.end_time}+07:00`);
    return eventEnd.getTime() >= Date.now();
  }

  // If no end time is set, keep an event visible for the whole event date in Thailand.
  return session.event_date >= getBangkokDateString();
}

function isSessionEnded(session) {
  if (!session || !session.event_date) return false;

  const endTime = session.end_time || '23:59:59';
  const eventEnd = new Date(`${session.event_date}T${endTime}+07:00`);
  return eventEnd.getTime() < Date.now();
}

function voteAverage(vote) {
  const scores = [
    vote.mvp_score,
    vote.sportsmanship_score,
    vote.teamwork_score,
    vote.skill_score,
    vote.vibes_score
  ].map(Number).filter((score) => Number.isFinite(score));

  if (scores.length === 0) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function voteScoreByCategory(vote, category = 'overall') {
  const scoreMap = {
    mvp: vote.mvp_score,
    sportsmanship: vote.sportsmanship_score,
    teamwork: vote.teamwork_score,
    skill: vote.skill_score,
    vibes: vote.vibes_score
  };

  return category === 'overall' ? voteAverage(vote) : Number(scoreMap[category] || 0);
}

function getBangkokPeriodRange(period = 'all') {
  if (period === 'all') return null;

  const now = new Date();
  const bangkokNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  let start = new Date(bangkokNow);
  let end = new Date(bangkokNow);

  if (period === 'week') {
    const day = bangkokNow.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    start.setDate(bangkokNow.getDate() - daysFromMonday);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (period === 'month') {
    start = new Date(bangkokNow.getFullYear(), bangkokNow.getMonth(), 1);
    end = new Date(bangkokNow.getFullYear(), bangkokNow.getMonth() + 1, 0);
  } else {
    return null;
  }

  const toDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    start: toDateString(start),
    end: toDateString(end)
  };
}

function buildPlayerBadges({ joinedCount = 0, hostedCount = 0, rating = {} }) {
  const badges = [];

  const categoryCounts = rating.categoryCounts || {};
  if ((categoryCounts.mvp_match || 0) > 0) badges.push({ key: 'mvp', label: 'MVP' });
  if ((categoryCounts.best_vibe || 0) > 0) badges.push({ key: 'goodVibes', label: 'Good Vibes' });
  if ((categoryCounts.social_star || 0) > 0) badges.push({ key: 'socialStar', label: 'Social Star' });
  if ((categoryCounts.fair_play || 0) > 0) badges.push({ key: 'fairPlay', label: 'Fair Play' });
  if ((categoryCounts.most_improved || 0) > 0) badges.push({ key: 'mostImproved', label: 'Most Improved' });
  if ((categoryCounts.best_partner || 0) > 0) badges.push({ key: 'bestPartner', label: 'Best Partner' });
  if ((categoryCounts.dink_master || 0) > 0) badges.push({ key: 'dinkMaster', label: 'Dink Master' });
  if ((categoryCounts.power_shot || 0) > 0) badges.push({ key: 'powerShot', label: 'Power Shot' });
  if ((categoryCounts.aggressive_player || 0) > 0) badges.push({ key: 'aggressive', label: 'Aggressive Player' });
  if ((categoryCounts.style_on_court || 0) > 0) badges.push({ key: 'style', label: 'Style on Court' });
  if ((categoryCounts.rookie_of_the_day || 0) > 0) badges.push({ key: 'rookie', label: 'Rookie of the Day' });
  if (joinedCount >= 5) badges.push({ key: 'regular', label: 'Regular Player' });
  if (hostedCount > 0) badges.push({ key: 'host', label: 'Host' });

  return badges;
}

function rankingCategoryLabel(categoryKey) {
  if (categoryKey === DEFAULT_RANKING_CATEGORY) return 'Overall';
  return VOTING_CATEGORY_MAP[categoryKey]?.label || categoryKey;
}

function categoryVoteCount(categoryCounts = {}, categoryKey = DEFAULT_RANKING_CATEGORY) {
  if (categoryKey === DEFAULT_RANKING_CATEGORY) {
    return Object.values(categoryCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  return Number(categoryCounts?.[categoryKey] || 0);
}

function bangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function bangkokDateValue(date = new Date()) {
  const values = bangkokDateParts(date);
  return `${values.year}-${values.month}-${values.day}`;
}

function getWeekStartDateString(date = new Date()) {
  const bangkokToday = bangkokDateValue(date);
  const [year, month, day] = bangkokToday.split('-').map(Number);
  const weekDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = weekDate.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekDate.setUTCDate(weekDate.getUTCDate() - daysFromMonday);
  return weekDate.toISOString().slice(0, 10);
}

function getMonthId(date = new Date()) {
  const values = bangkokDateParts(date);
  return `${values.year}-${values.month}`;
}

function normalizeRankingPeriod(period = '') {
  const value = String(period || '').toLowerCase();
  if (value === 'weekly' || value === 'week') return 'weekly';
  if (value === 'monthly' || value === 'month') return 'monthly';
  return 'all-time';
}

function periodLabel(period, id = '') {
  if (period === 'weekly') return `Week of ${id}`;
  if (period === 'monthly') return id;
  return 'All Time';
}

function defaultPeriodIdentifier(period = 'all-time') {
  if (period === 'weekly') return getWeekStartDateString();
  if (period === 'monthly') return getMonthId();
  return '';
}

function periodRangeByIdentifier(period, identifier = '') {
  if (period === 'weekly') {
    const start = identifier || getWeekStartDateString();
    return {
      start,
      end: addDaysToDateString(start, 6),
      id: start
    };
  }

  if (period === 'monthly') {
    const monthId = identifier || getMonthId();
    const [year, month] = monthId.split('-').map(Number);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(Date.UTC(year, month, 0));
    return {
      start,
      end: endDate.toISOString().slice(0, 10),
      id: monthId
    };
  }

  return {
    start: null,
    end: null,
    id: 'all-time'
  };
}

function validateVoteScore(value) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 5;
}

function safeStorageFileName(name = 'slip.jpg') {
  const cleaned = String(name).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
  return cleaned || 'slip.jpg';
}

function getMimeExtension(mimeType = '') {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('heic')) return 'heic';
  if (mimeType.includes('heif')) return 'heif';
  return 'jpg';
}

function decodeJwtPayload(token = '') {
  try {
    const payload = String(token).split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }
}

function isLikelyServiceRoleKey(key = '') {
  const value = String(key || '').trim();
  if (!value) return false;
  if (value.startsWith('sb_secret_')) return true;
  if (value.startsWith('sb_publishable_')) return false;
  const payload = decodeJwtPayload(value);
  return payload?.role === 'service_role';
}

async function buildVoteContext(eventId, lineUid) {
  const { data, error } = await listSessionRsvps(eventId);

  if (error || !data) {
    return { data: null, error: error || new Error('Session not found.') };
  }

  const voter = lineUid ? await getUserByLineUid(lineUid) : null;
  const joinedRows = data.rows.filter((row) => row.kind === 'member' && row.status === 'Joined');
  const voterJoined = Boolean(voter && joinedRows.some((row) => row.user.id === voter.id));
  const eventEnded = isSessionEnded(data.session);
  const eligiblePlayers = joinedRows.map((row) => ({
    id: row.user.id,
    lineUid: row.user.line_uid,
    displayName: row.user.display_name,
    profileImageUrl: row.user.profile_image_url,
    isSelf: voter ? row.user.id === voter.id : false
  }));

  const voteRows = await listRankingVotes({ eventId: data.session.id });
  const myVotes = (voteRows || [])
    .filter((vote) => lineUid && vote.voter_line_uid === lineUid)
    .map((vote) => ({
      category: vote.category,
      nomineeLineUid: vote.nominee_line_uid
    }));

  const summaryByLineUid = {};
  for (const vote of voteRows || []) {
    if (!summaryByLineUid[vote.nominee_line_uid]) {
      summaryByLineUid[vote.nominee_line_uid] = {
        nomineeLineUid: vote.nominee_line_uid,
        totalVotes: 0,
        categoryCounts: {}
      };
    }
    summaryByLineUid[vote.nominee_line_uid].totalVotes += 1;
    summaryByLineUid[vote.nominee_line_uid].categoryCounts[vote.category] = (summaryByLineUid[vote.nominee_line_uid].categoryCounts[vote.category] || 0) + 1;
  }

  const categoryWinners = VOTING_CATEGORIES.map((category) => {
    const nomineeRows = Object.values(summaryByLineUid)
      .map((entry) => ({
        nomineeLineUid: entry.nomineeLineUid,
        totalVotes: Number(entry.categoryCounts[category.key] || 0)
      }))
      .filter((entry) => entry.totalVotes > 0)
      .sort((a, b) => b.totalVotes - a.totalVotes);
    return {
      category: category.key,
      categoryLabel: category.label,
      winnerLineUid: nomineeRows[0]?.nomineeLineUid || '',
      totalVotes: nomineeRows[0]?.totalVotes || 0
    };
  });

  return {
    data: {
      session: serializeSession(data.session),
      rawSession: data.session,
      eventEnded,
      voter,
      voterJoined,
      eligiblePlayers,
      myVotes,
      voteProgress: myVotes.length,
      canVote: Boolean(voter && voterJoined),
      categoryWinners,
      voteSummary: Object.values(summaryByLineUid)
    },
    error: null
  };
}

function serializeVoteContextPayload(context) {
  return {
    success: true,
    session: context.session,
    eventEnded: context.eventEnded,
    canVote: Boolean(context.canVote && context.eventEnded),
    voteProgress: context.voteProgress || 0,
    totalCategories: VOTING_CATEGORIES.length,
    categories: VOTING_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label
    })),
    players: (context.eligiblePlayers || []).map((player) => ({
      id: player.id,
      lineUid: player.lineUid,
      displayName: player.displayName,
      profileImageUrl: player.profileImageUrl,
      isSelf: player.isSelf
    })),
    myVotes: context.myVotes || [],
    voteSummary: (context.voteSummary || [])
      .map((entry) => ({
        nomineeLineUid: entry.nomineeLineUid,
        totalVotes: entry.totalVotes,
        categoryCounts: entry.categoryCounts || {}
      }))
      .sort((a, b) => b.totalVotes - a.totalVotes),
    categoryWinners: context.categoryWinners || []
  };
}

function findEligiblePlayer(context, lineUid) {
  return (context.eligiblePlayers || []).find((player) => player.lineUid === lineUid) || null;
}

async function renderRankingSharePage(req, {
  title,
  subtitle = '',
  winner = null,
  top = [],
  awards = [],
  sharePath = ''
}) {
  const shareUrl = `${req.protocol}://${req.get('host')}${sharePath || req.originalUrl}`;
  const resolvedWinner = winner || (top || [])[0] || null;
  const winnerName = resolvedWinner?.displayName || 'TBA';
  const winnerImage = publicImageUrl(resolvedWinner?.profileImageUrl) || '/assets/gdsq-logo.png';
  const heroImage = absoluteUrl(req, winnerImage);
  const shareImage = hasDefaultHomeBannerAsset
    ? absoluteUrl(req, publicImageUrl(defaultHomeBannerUrl) || winnerImage)
    : heroImage;
  const topCards = (top || []).slice(0, 5).map((row, index) => `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:18px;background:#f8fafc;">
      <div style="width:34px;height:34px;border-radius:12px;background:#0b4fd9;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;">${index + 1}</div>
      <img src="${escapeHtml(publicImageUrl(row.profileImageUrl) || '/assets/gdsq-logo.png')}" alt="" style="width:48px;height:48px;border-radius:999px;object-fit:cover;border:2px solid #dbeafe;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.displayName || 'Player')}</div>
        <div style="font-size:12px;color:#64748b;">${Number(row.totalVotes || row.voteCount || 0)} votes</div>
      </div>
    </div>
  `).join('');
  const awardCards = (awards || []).filter((award) => award.winner).map((award) => `
    <div style="padding:14px 16px;border-radius:18px;background:#ffffff;border:1px solid #e5e7eb;">
      <div style="font-size:12px;font-weight:800;color:#64748b;text-transform:uppercase;">${escapeHtml(award.categoryLabel)}</div>
      <div style="margin-top:6px;font-size:16px;font-weight:900;color:#0f172a;">${escapeHtml(award.winner.displayName || 'Player')}</div>
      <div style="font-size:13px;color:#0b4fd9;font-weight:800;">${Number(award.winner.totalVotes || 0)} votes</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} | GDSQ Pickleball</title>
    ${buildMetaTags({
      title,
      description: subtitle || `${winnerName} wins on GDSQ Pickleball.`,
      imageUrl: shareImage,
      url: shareUrl
    })}
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body style="margin:0;background:#f8fafc;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
    <main style="max-width:720px;margin:0 auto;padding:24px 16px 48px;">
      <section style="background:white;border-radius:28px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-size:12px;font-weight:900;color:#0b4fd9;text-transform:uppercase;letter-spacing:.08em;">GDSQ Pickleball</div>
            <h1 style="margin:8px 0 0;font-size:30px;line-height:1.1;font-weight:900;">${escapeHtml(title)}</h1>
            <p style="margin:8px 0 0;color:#64748b;font-size:14px;font-weight:600;">${escapeHtml(subtitle)}</p>
          </div>
          <button onclick="shareCard()" style="border:none;background:#0b4fd9;color:#fff;border-radius:16px;padding:12px 16px;font-weight:900;">Share</button>
        </div>
        <div style="margin-top:20px;border-radius:24px;background:linear-gradient(135deg,#0b4fd9,#2563eb);padding:20px;color:white;">
          <div style="font-size:12px;font-weight:900;text-transform:uppercase;opacity:.9;">Winner</div>
          <div style="display:flex;align-items:center;gap:16px;margin-top:12px;">
            <img src="${heroImage}" alt="" style="width:96px;height:96px;border-radius:999px;object-fit:cover;border:4px solid rgba(255,255,255,.4);background:#fff;">
            <div>
              <div style="font-size:28px;font-weight:900;">${escapeHtml(winnerName)}</div>
              <div style="font-size:15px;font-weight:700;opacity:.92;">${Number(resolvedWinner?.totalVotes || resolvedWinner?.voteCount || 0)} votes</div>
            </div>
          </div>
        </div>
        ${topCards ? `<div style="margin-top:20px;"><div style="font-size:18px;font-weight:900;margin-bottom:12px;">Top Rankings</div><div style="display:grid;gap:12px;">${topCards}</div></div>` : ''}
        ${awardCards ? `<div style="margin-top:20px;"><div style="font-size:18px;font-weight:900;margin-bottom:12px;">Category Awards</div><div style="display:grid;gap:12px;">${awardCards}</div></div>` : ''}
        <button onclick="copyLink()" style="margin-top:20px;width:100%;border:none;background:#e0e7ff;color:#0b4fd9;border-radius:16px;padding:14px 16px;font-weight:900;">Copy Link</button>
      </section>
    </main>
    <script>
      async function copyLink() {
        try {
          await navigator.clipboard.writeText(${JSON.stringify(shareUrl)});
          alert('Link copied');
        } catch (error) {
          alert(${JSON.stringify(shareUrl)});
        }
      }
      async function shareCard() {
        if (navigator.share) {
          try {
            await navigator.share({ title: ${JSON.stringify(title)}, text: ${JSON.stringify(subtitle)}, url: ${JSON.stringify(shareUrl)} });
            return;
          } catch (error) {}
        }
        copyLink();
      }
    </script>
  </body>
  </html>`;
}

function publicPaymentError(error) {
  const rawMessage = String(error?.message || '').toLowerCase();
  const rawCode = String(error?.code || '').toLowerCase();

  if (error?.statusCode) {
    return error.message;
  }

  if (
    rawMessage.includes('row-level security')
    || rawMessage.includes('violates row-level security')
    || rawMessage.includes('permission denied')
    || rawMessage.includes('not authorized')
    || rawCode === '42501'
  ) {
    return 'Payment slip upload is blocked by Supabase permissions. Please check that Render has the real SUPABASE_SERVICE_ROLE_KEY secret key.';
  }

  if (rawMessage.includes('bucket') || rawMessage.includes('storage')) {
    return 'Payment slip storage is not ready. Please run the payment slip storage SQL and check the payment-slips bucket.';
  }

  if (
    rawMessage.includes('schema cache')
    || rawMessage.includes('column')
    || rawCode === '42703'
    || rawCode === '42p01'
  ) {
    return 'Payment database setup is missing. Please run all payment migration SQL files in Supabase.';
  }

  if (rawMessage.includes('reserve_session_rsvp') || rawCode === '42883') {
    return 'Booking protection is not installed. Please run migration-rsvp-duplicate-capacity.sql in Supabase.';
  }

  return 'Unable to submit payment and RSVP. Please check Render logs for the exact server error.';
}

function normalizePaymentMode(mode) {
  return ['none', 'deposit_then_final', 'final_only'].includes(mode) ? mode : 'deposit_then_final';
}

function joinedSeatCountForRsvp(rsvp, guests = []) {
  return (rsvp.status === 'Joined' ? 1 : 0)
    + (guests || []).filter((guest) => guest.status === 'Joined').length;
}

function depositAmountPerSeat(session) {
  const mode = normalizePaymentMode(session.payment_mode);
  if (mode !== 'deposit_then_final') return 0;
  const amount = session.deposit_amount_thb === null || session.deposit_amount_thb === undefined
    ? session.price_thb
    : session.deposit_amount_thb;
  return Math.max(Number(amount || 0), 0);
}

function finalAmountPerSeat(session) {
  const mode = normalizePaymentMode(session.payment_mode);
  if (session.final_amount_thb === null || session.final_amount_thb === undefined) return 0;
  const finalAmount = Math.max(Number(session.final_amount_thb || 0), 0);
  if (mode === 'deposit_then_final') {
    return Math.max(finalAmount - depositAmountPerSeat(session), 0);
  }
  if (mode === 'final_only') return finalAmount;
  return 0;
}

function calculatePaymentDue(session, joinedSeatCount, phase = 'deposit') {
  const seats = Math.max(Number(joinedSeatCount || 0), 0);
  if (phase === 'final') return finalAmountPerSeat(session) * seats;
  return depositAmountPerSeat(session) * seats;
}

async function uploadPaymentSlip({ sessionId, rsvpId, slipBase64, slipMimeType, slipFileName, previousSlipPath }) {
  if (!isLikelyServiceRoleKey(supabaseServiceRoleKey)) {
    const error = new Error('Payment slip storage requires the real Supabase service_role/secret key in SUPABASE_SERVICE_ROLE_KEY on Render.');
    error.statusCode = 503;
    throw error;
  }

  const base64Text = String(slipBase64 || '').includes(',')
    ? String(slipBase64).split(',').pop()
    : String(slipBase64 || '');
  const buffer = Buffer.from(base64Text, 'base64');
  const maxBytes = 10 * 1024 * 1024;

  if (!buffer.length || buffer.length > maxBytes) {
    const error = new Error('Slip image must be under 10 MB.');
    error.statusCode = 400;
    throw error;
  }

  const mimeType = slipMimeType || 'image/jpeg';
  const filename = safeStorageFileName(slipFileName || `slip.${getMimeExtension(mimeType)}`);
  const storagePath = `${sessionId}/${rsvpId}/${Date.now()}-${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(paymentSlipBucket)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true
    });

  if (uploadError) {
    const error = new Error(publicPaymentError(uploadError));
    error.statusCode = uploadError.statusCode || uploadError.status || 502;
    throw error;
  }

  if (previousSlipPath) {
    await supabase.storage.from(paymentSlipBucket).remove([previousSlipPath]);
  }

  return {
    storagePath
  };
}

async function createSignedSlipUrl(storagePath, expiresInSeconds = 60 * 60) {
  if (!storagePath) return '';
  if (!supabaseServiceRoleKey) return '';

  try {
    const { data, error } = await supabase.storage
      .from(paymentSlipBucket)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error) throw error;
    return data?.signedUrl || '';
  } catch (error) {
    console.error('Signed slip URL error:', error);
    return '';
  }
}

async function hydrateSlipUrlsForRsvp(rsvp) {
  if (!rsvp) return rsvp;

  return {
    ...rsvp,
    payment_slip_url: rsvp.payment_slip_path ? await createSignedSlipUrl(rsvp.payment_slip_path) : '',
    final_payment_slip_url: rsvp.final_payment_slip_path ? await createSignedSlipUrl(rsvp.final_payment_slip_path) : ''
  };
}

async function hydrateSlipUrlsForRsvps(rsvps) {
  return Promise.all((rsvps || []).map((rsvp) => hydrateSlipUrlsForRsvp(rsvp)));
}

async function updatePaymentStatus({ sessionId, rsvpId, status, amountPaid }) {
  const allowedStatuses = ['Pending', 'Submitted', 'Paid'];

  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid payment status.');
    error.statusCode = 400;
    throw error;
  }

  const { data: existingRsvp, error: existingRsvpError } = await supabase
    .from('rsvps')
    .select('id, payment_amount_due, payment_amount_paid')
    .eq('id', rsvpId)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existingRsvpError) throw existingRsvpError;
  if (!existingRsvp) {
    const error = new Error('RSVP not found.');
    error.statusCode = 404;
    throw error;
  }

  const parsedAmountPaid = amountPaid === '' || amountPaid === null || amountPaid === undefined
    ? null
    : Number(amountPaid);
  const nextAmountPaid = status === 'Paid'
    ? (Number.isFinite(parsedAmountPaid) ? parsedAmountPaid : Number(existingRsvp.payment_amount_paid || existingRsvp.payment_amount_due || 0))
    : (Number.isFinite(parsedAmountPaid) ? parsedAmountPaid : existingRsvp.payment_amount_paid);

  const { data: rsvp, error } = await supabase
    .from('rsvps')
    .update({
      payment_status: status,
      payment_amount_paid: nextAmountPaid,
      payment_paid_at: status === 'Paid' ? new Date().toISOString() : null
    })
    .eq('id', rsvpId)
    .eq('session_id', sessionId)
    .select('id, payment_status, payment_amount_due, payment_amount_paid, payment_paid_at')
    .maybeSingle();

  if (error) throw error;
  if (!rsvp) {
    const error = new Error('RSVP not found.');
    error.statusCode = 404;
    throw error;
  }

  return rsvp;
}

async function updateFinalPaymentStatus({ sessionId, rsvpId, status, amountPaid }) {
  const allowedStatuses = ['NotOpened', 'Pending', 'Submitted', 'Paid'];

  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid final payment status.');
    error.statusCode = 400;
    throw error;
  }

  const { data: existingRsvp, error: existingRsvpError } = await supabase
    .from('rsvps')
    .select('id, final_payment_amount_due, final_payment_amount_paid')
    .eq('id', rsvpId)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existingRsvpError) throw existingRsvpError;
  if (!existingRsvp) {
    const error = new Error('RSVP not found.');
    error.statusCode = 404;
    throw error;
  }

  const parsedAmountPaid = amountPaid === '' || amountPaid === null || amountPaid === undefined
    ? null
    : Number(amountPaid);
  const nextAmountPaid = status === 'Paid'
    ? (Number.isFinite(parsedAmountPaid) ? parsedAmountPaid : Number(existingRsvp.final_payment_amount_paid || existingRsvp.final_payment_amount_due || 0))
    : (Number.isFinite(parsedAmountPaid) ? parsedAmountPaid : existingRsvp.final_payment_amount_paid);

  const { data: rsvp, error } = await supabase
    .from('rsvps')
    .update({
      final_payment_status: status,
      final_payment_amount_paid: nextAmountPaid,
      final_payment_paid_at: status === 'Paid' ? new Date().toISOString() : null
    })
    .eq('id', rsvpId)
    .eq('session_id', sessionId)
    .select('id, final_payment_status, final_payment_amount_due, final_payment_amount_paid, final_payment_paid_at')
    .maybeSingle();

  if (error) throw error;
  if (!rsvp) {
    const error = new Error('RSVP not found.');
    error.statusCode = 404;
    throw error;
  }

  return rsvp;
}

async function getUserByLineUid(lineUid) {
  if (!lineUid) return null;

  const { data: user, error } = await supabase
    .from('users')
    .select(userSelect)
    .eq('line_uid', lineUid)
    .maybeSingle();

  if (error) throw error;
  return user || null;
}

async function requireSessionHost({ lineUid, sessionId }) {
  const user = await getUserByLineUid(lineUid);

  if (!user) {
    const error = new Error('Host login required.');
    error.statusCode = 401;
    throw error;
  }

  const { data: session, error: sessionError } = await findSession(sessionId);

  if (sessionError || !session) {
    const error = sessionError || new Error('Session not found.');
    error.statusCode = sessionError ? 500 : 404;
    throw error;
  }

  if (session.created_by_user_id !== user.id) {
    const error = new Error('Only the event host can manage this event.');
    error.statusCode = 403;
    throw error;
  }

  return { user, session };
}

async function listRankingVotes({
  eventId = null,
  voterLineUid = null,
  nomineeLineUid = null,
  period = 'all-time',
  identifier = ''
} = {}) {
  let query = supabase
    .from('ranking_votes')
    .select('id, event_id, voter_line_uid, nominee_line_uid, category, created_at');

  if (eventId) query = query.eq('event_id', eventId);
  if (voterLineUid) query = query.eq('voter_line_uid', voterLineUid);
  if (nomineeLineUid) query = query.eq('nominee_line_uid', nomineeLineUid);

  const normalizedPeriod = normalizeRankingPeriod(period);
  if (normalizedPeriod !== 'all-time') {
    const range = periodRangeByIdentifier(normalizedPeriod, identifier);
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('id')
      .gte('event_date', range.start)
      .lte('event_date', range.end);

    if (sessionsError) throw sessionsError;

    const sessionIds = (sessions || []).map((session) => session.id);
    if (sessionIds.length === 0) {
      return [];
    }

    query = query.in('event_id', sessionIds);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }

  return data || [];
}

async function findLatestRankingPeriodIdentifier(period = 'all-time') {
  const normalizedPeriod = normalizeRankingPeriod(period);
  if (normalizedPeriod === 'all-time') return '';

  const { data: votes, error: votesError } = await supabase
    .from('ranking_votes')
    .select('event_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (votesError) {
    if (votesError.code === '42P01') return '';
    throw votesError;
  }

  const eventIds = [...new Set((votes || []).map((vote) => vote.event_id).filter(Boolean))];
  if (eventIds.length === 0) return '';

  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, event_date')
    .in('id', eventIds)
    .not('event_date', 'is', null);

  if (sessionsError) throw sessionsError;

  const identifiers = (sessions || [])
    .map((session) => {
      if (!session.event_date) return '';
      if (normalizedPeriod === 'weekly') return normalizeWeekIdentifier(session.event_date);
      if (normalizedPeriod === 'monthly') return String(session.event_date).slice(0, 7);
      return '';
    })
    .filter(Boolean)
    .sort();

  return identifiers.length ? identifiers[identifiers.length - 1] : '';
}

function topCategoryEntries(categoryCounts = {}, limit = 5) {
  return Object.entries(categoryCounts || {})
    .map(([categoryKey, votes]) => ({
      categoryKey,
      label: rankingCategoryLabel(categoryKey),
      votes: Number(votes || 0)
    }))
    .filter((item) => item.votes > 0)
    .sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildRankingRows({ users = [], joinedByUserId = {}, votes = [], category = DEFAULT_RANKING_CATEGORY }) {
  const tallyByLineUid = {};

  for (const vote of votes || []) {
    if (!tallyByLineUid[vote.nominee_line_uid]) {
      tallyByLineUid[vote.nominee_line_uid] = {
        totalVotes: 0,
        categoryCounts: {}
      };
    }

    tallyByLineUid[vote.nominee_line_uid].totalVotes += 1;
    tallyByLineUid[vote.nominee_line_uid].categoryCounts[vote.category] = (tallyByLineUid[vote.nominee_line_uid].categoryCounts[vote.category] || 0) + 1;
  }

  return users
    .map((user) => {
      const tally = tallyByLineUid[user.line_uid] || { totalVotes: 0, categoryCounts: {} };
      return {
        ...serializeUser(user),
        joinedCount: joinedByUserId[user.id] || 0,
        voteCount: tally.totalVotes,
        categoryVoteCount: categoryVoteCount(tally.categoryCounts, category),
        categoryCounts: tally.categoryCounts,
        topCategories: topCategoryEntries(tally.categoryCounts),
        ratingAverage: tally.totalVotes || null
      };
    })
    .filter((user) => {
      if (category === DEFAULT_RANKING_CATEGORY) return user.voteCount > 0;
      return user.categoryVoteCount > 0;
    })
    .sort((a, b) => (b.categoryVoteCount || 0) - (a.categoryVoteCount || 0) || (b.voteCount || 0) - (a.voteCount || 0) || (b.joinedCount || 0) - (a.joinedCount || 0) || String(a.displayName || '').localeCompare(String(b.displayName || '')));
}

function buildAwardWinners(rankings = [], limit = 5) {
  return VOTING_CATEGORIES.map((category) => {
    const ranked = rankings
      .filter((row) => Number(row.categoryCounts?.[category.key] || 0) > 0)
      .map((row) => ({
        id: row.id,
        lineUid: row.lineUid,
        displayName: row.displayName,
        profileImageUrl: row.profileImageUrl,
        totalVotes: Number(row.categoryCounts?.[category.key] || 0),
        voteCount: Number(row.categoryCounts?.[category.key] || 0),
        joinedCount: Number(row.joinedCount || 0),
        topCategories: [{ label: category.label, votes: Number(row.categoryCounts?.[category.key] || 0) }]
      }))
      .sort((a, b) => b.totalVotes - a.totalVotes || String(a.displayName || '').localeCompare(String(b.displayName || '')));

    return {
      categoryKey: category.key,
      categoryLabel: category.label,
      winner: ranked[0] || null,
      top: ranked.slice(0, limit)
    };
  });
}

async function loadRankingUsersAndJoinedCounts() {
  const { data: joinedRsvps, error: rsvpError } = await supabase
    .from('rsvps')
    .select('user_id, status')
    .eq('status', 'Joined');

  if (rsvpError) throw rsvpError;

  const joinedByUserId = {};
  for (const rsvp of joinedRsvps || []) {
    joinedByUserId[rsvp.user_id] = (joinedByUserId[rsvp.user_id] || 0) + 1;
  }

  const userIds = Object.keys(joinedByUserId);
  if (userIds.length === 0) {
    return { users: [], joinedByUserId };
  }

  const { data: users, error: userError } = await supabase
    .from('users')
    .select(userSelect)
    .in('id', userIds);

  if (userError) throw userError;
  return { users: users || [], joinedByUserId };
}

async function buildRankingPayload({ period = 'all-time', identifier = '', category = DEFAULT_RANKING_CATEGORY }) {
  const normalizedPeriod = normalizeRankingPeriod(period);
  const normalizedCategory = VOTING_CATEGORY_KEYS.has(category) ? category : DEFAULT_RANKING_CATEGORY;
  const resolvedIdentifier = identifier || defaultPeriodIdentifier(normalizedPeriod);
  const { users, joinedByUserId } = await loadRankingUsersAndJoinedCounts();
  let effectiveIdentifier = resolvedIdentifier;
  let votes = await listRankingVotes({ period: normalizedPeriod, identifier: resolvedIdentifier });
  let isFallback = false;

  if (normalizedPeriod !== 'all-time' && votes.length === 0) {
    const latestIdentifier = await findLatestRankingPeriodIdentifier(normalizedPeriod);
    if (latestIdentifier && latestIdentifier !== resolvedIdentifier) {
      const fallbackVotes = await listRankingVotes({ period: normalizedPeriod, identifier: latestIdentifier });
      if (fallbackVotes.length > 0) {
        votes = fallbackVotes;
        effectiveIdentifier = latestIdentifier;
        isFallback = true;
      }
    }
  }

  const rankings = buildRankingRows({ users, joinedByUserId, votes, category: normalizedCategory });
  const awards = buildAwardWinners(rankings);
  const range = periodRangeByIdentifier(normalizedPeriod, effectiveIdentifier);
  const requestedRange = periodRangeByIdentifier(normalizedPeriod, resolvedIdentifier);

  return {
    period: normalizedPeriod,
    periodId: range.id,
    periodLabel: periodLabel(normalizedPeriod, range.id),
    requestedPeriodId: requestedRange.id,
    requestedPeriodLabel: periodLabel(normalizedPeriod, requestedRange.id),
    category: normalizedCategory,
    rankings,
    awards,
    mvpWinner: awards.find((award) => award.categoryKey === 'mvp_match')?.winner || null,
    isFallback,
    hasVotes: votes.length > 0
  };
}

function serializeSession(session) {
  return {
    id: session.id,
    title: session.title,
    maxPlayers: session.max_players,
    courtCount: session.court_count || 1,
    eventDate: session.event_date,
    startTime: session.start_time,
    endTime: session.end_time,
    priceThb: session.price_thb,
    paymentMode: normalizePaymentMode(session.payment_mode),
    depositAmountThb: session.deposit_amount_thb,
    estimatedTotalThb: session.estimated_total_thb,
    finalAmountThb: session.final_amount_thb,
    paymentNotePublic: session.payment_note_public,
    paymentQrUrl: session.payment_qr_url,
    paymentBankName: session.payment_bank_name,
    paymentAccountName: session.payment_account_name,
    paymentAccountNumber: session.payment_account_number,
    paymentPromptPayId: session.payment_promptpay_id,
    location: session.location,
    address: session.address,
    skillLevel: session.skill_level,
    description: session.description,
    posterUrl: session.poster_url,
    createdByUserId: session.created_by_user_id,
    status: session.status || 'Published',
    createdAt: session.created_at
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    lineUid: user.line_uid,
    displayName: user.display_name,
    phone: user.phone,
    profileImageUrl: user.profile_image_url,
    createdAt: user.created_at
  };
}

function serializeAdminActivityUser(user) {
  return {
    id: user.id,
    lineUid: user.line_uid,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    lastSeenAt: user.last_seen_at || null,
    appOpenCount: Number(user.app_open_count || 0),
    createdAt: user.created_at || null
  };
}

async function upsertLineUser({ lineUid, displayName, profileImageUrl, phone }) {
  const { data: existingUser, error: findUserError } = await supabase
    .from('users')
    .select(userSelect)
    .eq('line_uid', lineUid)
    .maybeSingle();

  if (findUserError) {
    throw findUserError;
  }

  if (existingUser) {
    const updates = {};

    if (displayName && displayName !== existingUser.display_name) {
      updates.display_name = displayName;
    }

    if (profileImageUrl && profileImageUrl !== existingUser.profile_image_url) {
      updates.profile_image_url = profileImageUrl;
    }

    if (phone !== undefined) {
      updates.phone = phone || null;
    }

    if (Object.keys(updates).length === 0) {
      return existingUser;
    }

    const { data: updatedUser, error: updateUserError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', existingUser.id)
      .select(userSelect)
      .single();

    if (updateUserError) {
      throw updateUserError;
    }

    return updatedUser;
  }

  const { data: newUser, error: createUserError } = await supabase
    .from('users')
    .insert({
      line_uid: lineUid,
      display_name: displayName || 'LINE User',
      phone: phone || null,
      profile_image_url: profileImageUrl || null
    })
    .select(userSelect)
    .single();

  if (createUserError) {
    throw createUserError;
  }

  return newUser;
}

async function recordUserAppOpen({ lineUid, displayName, profileImageUrl, phone }) {
  const user = await upsertLineUser({
    lineUid,
    displayName,
    profileImageUrl,
    phone
  });

  const { data: currentUser, error: currentUserError } = await supabase
    .from('users')
    .select('id, last_seen_at, app_open_count')
    .eq('id', user.id)
    .single();

  if (currentUserError) throw currentUserError;

  const { data: updatedUser, error: updateUserError } = await supabase
    .from('users')
    .update({
      last_seen_at: new Date().toISOString(),
      app_open_count: Number(currentUser?.app_open_count || 0) + 1
    })
    .eq('id', user.id)
    .select(adminActivityUserSelect)
    .single();

  if (updateUserError) throw updateUserError;
  return updatedUser;
}

function parseSessionPayload(body) {
  const parsedMaxPlayers = Number(body.maxPlayers);
  const parsedPriceThb = body.priceThb === '' || body.priceThb === null || body.priceThb === undefined
    ? null
    : Number(body.priceThb);
  const parsedDepositAmountThb = body.depositAmountThb === '' || body.depositAmountThb === null || body.depositAmountThb === undefined
    ? null
    : Number(body.depositAmountThb);
  const parsedEstimatedTotalThb = body.estimatedTotalThb === '' || body.estimatedTotalThb === null || body.estimatedTotalThb === undefined
    ? null
    : Number(body.estimatedTotalThb);
  const parsedFinalAmountThb = body.finalAmountThb === '' || body.finalAmountThb === null || body.finalAmountThb === undefined
    ? null
    : Number(body.finalAmountThb);
  const parsedCourtCount = body.courtCount === '' || body.courtCount === null || body.courtCount === undefined
    ? 1
    : Number(body.courtCount);

  if (!body.title || !Number.isInteger(parsedMaxPlayers) || parsedMaxPlayers <= 0) {
    return {
      data: null,
      error: 'title and a positive maxPlayers value are required.'
    };
  }

  if (parsedPriceThb !== null && (!Number.isInteger(parsedPriceThb) || parsedPriceThb < 0)) {
    return {
      data: null,
      error: 'priceThb must be zero or a positive number.'
    };
  }

  for (const [label, value] of [
    ['depositAmountThb', parsedDepositAmountThb],
    ['estimatedTotalThb', parsedEstimatedTotalThb],
    ['finalAmountThb', parsedFinalAmountThb]
  ]) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      return {
        data: null,
        error: `${label} must be zero or a positive number.`
      };
    }
  }

  if (!Number.isInteger(parsedCourtCount) || parsedCourtCount <= 0) {
    return {
      data: null,
      error: 'courtCount must be a positive number.'
    };
  }

  return {
    data: {
      title: body.title,
      max_players: parsedMaxPlayers,
      court_count: parsedCourtCount,
      event_date: body.eventDate || null,
      start_time: body.startTime || null,
      end_time: body.endTime || null,
      price_thb: parsedPriceThb,
      payment_mode: normalizePaymentMode(body.paymentMode),
      deposit_amount_thb: parsedDepositAmountThb,
      estimated_total_thb: parsedEstimatedTotalThb,
      final_amount_thb: parsedFinalAmountThb,
      payment_note_public: body.paymentNotePublic || null,
      payment_qr_url: body.paymentQrUrl || null,
      payment_bank_name: body.paymentBankName || null,
      payment_account_name: body.paymentAccountName || null,
      payment_account_number: body.paymentAccountNumber || null,
      payment_promptpay_id: body.paymentPromptPayId || null,
      location: body.location || null,
      address: body.address || null,
      skill_level: body.skillLevel || null,
      description: body.description || null,
      poster_url: body.posterUrl || null,
      status: body.status || 'Published'
    },
    error: null
  };
}

async function findSession(sessionId) {
  const sessionIdText = String(sessionId);

  if (uuidPattern.test(sessionIdText)) {
    return supabase
      .from('sessions')
      .select(sessionSelect)
      .eq('id', sessionIdText)
      .single();
  }

  if (/^\d+$/.test(sessionIdText)) {
    const rowIndex = Number(sessionIdText) - 1;

    if (rowIndex < 0) {
      return { data: null, error: null };
    }

    return supabase
      .from('sessions')
      .select(sessionSelect)
      .order('created_at', { ascending: true })
      .range(rowIndex, rowIndex)
      .maybeSingle();
  }

  return { data: null, error: null };
}

async function listSessionRsvps(sessionId) {
  const { data: session, error: sessionError } = await findSession(sessionId);

  if (sessionError || !session) {
    return {
      data: null,
      error: sessionError || new Error('Session not found.')
    };
  }

  const { data: rsvps, error: rsvpError } = await supabase
    .from('rsvps')
    .select('id, user_id, status, payment_status, payment_amount_due, payment_amount_paid, payment_slip_url, payment_slip_path, payment_note, payment_payer_name, payment_submitted_at, payment_paid_at, final_payment_status, final_payment_amount_due, final_payment_amount_paid, final_payment_slip_url, final_payment_slip_path, final_payment_note, final_payment_payer_name, final_payment_submitted_at, final_payment_paid_at, admin_payment_note, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });

  if (rsvpError) {
    return { data: null, error: rsvpError };
  }

  const signedRsvps = await hydrateSlipUrlsForRsvps(rsvps || []);

  const userIds = [...new Set(signedRsvps.map((rsvp) => rsvp.user_id))];
  let usersById = {};

  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(userSelect)
      .in('id', userIds);

    if (usersError) {
      return { data: null, error: usersError };
    }

    usersById = Object.fromEntries((users || []).map((user) => [user.id, user]));
  }

  const parentRsvpIds = signedRsvps.map((rsvp) => rsvp.id);
  let guestsByRsvpId = {};

  if (parentRsvpIds.length > 0) {
    const { data: guests, error: guestsError } = await supabase
      .from('rsvp_guests')
      .select('id, rsvp_id, display_name, status, created_at')
      .in('rsvp_id', parentRsvpIds)
      .order('created_at', { ascending: true });

    if (guestsError) {
      return { data: null, error: guestsError };
    }

    for (const guest of guests || []) {
      if (!guestsByRsvpId[guest.rsvp_id]) {
        guestsByRsvpId[guest.rsvp_id] = [];
      }
      guestsByRsvpId[guest.rsvp_id].push(guest);
    }
  }

  for (const rsvp of signedRsvps) {
    const joinedSeatCount = joinedSeatCountForRsvp(rsvp, guestsByRsvpId[rsvp.id] || []);
    const nextAmountDue = calculatePaymentDue(session, joinedSeatCount, 'deposit');
    const nextFinalAmountDue = calculatePaymentDue(session, joinedSeatCount, 'final');

    if (Number(rsvp.payment_amount_due || 0) !== nextAmountDue || Number(rsvp.final_payment_amount_due || 0) !== nextFinalAmountDue) {
      const paidAmount = rsvp.payment_amount_paid === null || rsvp.payment_amount_paid === undefined
        ? null
        : Number(rsvp.payment_amount_paid);
      let nextPaymentStatus = rsvp.payment_status || 'Pending';
      let nextFinalPaymentStatus = rsvp.final_payment_status || 'NotOpened';

      if (nextAmountDue > 0) {
        if (nextPaymentStatus === 'Paid' && Number(paidAmount || 0) < nextAmountDue) {
          nextPaymentStatus = rsvp.payment_slip_path ? 'Submitted' : 'Pending';
        }
      } else if (nextPaymentStatus === 'Paid') {
        nextPaymentStatus = 'Pending';
      }

      if (nextFinalAmountDue > 0 && ['NotOpened', 'Paid'].includes(nextFinalPaymentStatus)) {
        const finalPaidAmount = Number(rsvp.final_payment_amount_paid || 0);
        nextFinalPaymentStatus = finalPaidAmount >= nextFinalAmountDue ? 'Paid' : 'Pending';
      }

      const { error: syncPaymentError } = await supabase
        .from('rsvps')
        .update({
          payment_amount_due: nextAmountDue,
          payment_status: nextPaymentStatus,
          payment_paid_at: nextPaymentStatus === 'Paid' ? rsvp.payment_paid_at : null,
          final_payment_amount_due: nextFinalAmountDue,
          final_payment_status: nextFinalPaymentStatus,
          final_payment_paid_at: nextFinalPaymentStatus === 'Paid' ? rsvp.final_payment_paid_at : null
        })
        .eq('id', rsvp.id);

      if (syncPaymentError) {
        return { data: null, error: syncPaymentError };
      }

      rsvp.payment_amount_due = nextAmountDue;
      rsvp.payment_status = nextPaymentStatus;
      if (nextPaymentStatus !== 'Paid') rsvp.payment_paid_at = null;
      rsvp.final_payment_amount_due = nextFinalAmountDue;
      rsvp.final_payment_status = nextFinalPaymentStatus;
      if (nextFinalPaymentStatus !== 'Paid') rsvp.final_payment_paid_at = null;
    }
  }

  const rows = [];

  for (const rsvp of signedRsvps) {
    const owner = usersById[rsvp.user_id] || {
      id: rsvp.user_id,
      line_uid: '',
      display_name: 'Unknown user',
      phone: '',
      profile_image_url: ''
    };

    rows.push({
      id: rsvp.id,
      kind: 'member',
      parentRsvpId: rsvp.id,
      status: rsvp.status,
      paymentStatus: rsvp.payment_status || 'Pending',
      paymentAmountDue: rsvp.payment_amount_due || 0,
      paymentAmountPaid: rsvp.payment_amount_paid || null,
      paymentSlipUrl: rsvp.payment_slip_url || '',
      paymentSlipPath: rsvp.payment_slip_path || '',
      paymentNote: rsvp.payment_note || '',
      paymentPayerName: rsvp.payment_payer_name || '',
      paymentSubmittedAt: rsvp.payment_submitted_at || null,
      paymentPaidAt: rsvp.payment_paid_at || null,
      finalPaymentStatus: rsvp.final_payment_status || 'NotOpened',
      finalPaymentAmountDue: rsvp.final_payment_amount_due || 0,
      finalPaymentAmountPaid: rsvp.final_payment_amount_paid || null,
      finalPaymentSlipUrl: rsvp.final_payment_slip_url || '',
      finalPaymentSlipPath: rsvp.final_payment_slip_path || '',
      finalPaymentNote: rsvp.final_payment_note || '',
      finalPaymentPayerName: rsvp.final_payment_payer_name || '',
      finalPaymentSubmittedAt: rsvp.final_payment_submitted_at || null,
      finalPaymentPaidAt: rsvp.final_payment_paid_at || null,
      adminPaymentNote: rsvp.admin_payment_note || '',
      createdAt: rsvp.created_at,
      addedBy: null,
      user: owner
    });

    for (const guest of guestsByRsvpId[rsvp.id] || []) {
      rows.push({
        id: guest.id,
        kind: 'guest',
        parentRsvpId: rsvp.id,
        status: guest.status,
        paymentStatus: rsvp.payment_status || 'Pending',
        paymentAmountDue: rsvp.payment_amount_due || 0,
        paymentAmountPaid: rsvp.payment_amount_paid || null,
        paymentSlipUrl: rsvp.payment_slip_url || '',
        paymentSlipPath: rsvp.payment_slip_path || '',
        paymentNote: rsvp.payment_note || '',
        paymentPayerName: rsvp.payment_payer_name || '',
        paymentSubmittedAt: rsvp.payment_submitted_at || null,
        paymentPaidAt: rsvp.payment_paid_at || null,
        finalPaymentStatus: rsvp.final_payment_status || 'NotOpened',
        finalPaymentAmountDue: rsvp.final_payment_amount_due || 0,
        finalPaymentAmountPaid: rsvp.final_payment_amount_paid || null,
        finalPaymentSlipUrl: rsvp.final_payment_slip_url || '',
        finalPaymentSlipPath: rsvp.final_payment_slip_path || '',
        finalPaymentNote: rsvp.final_payment_note || '',
        finalPaymentPayerName: rsvp.final_payment_payer_name || '',
        finalPaymentSubmittedAt: rsvp.final_payment_submitted_at || null,
        finalPaymentPaidAt: rsvp.final_payment_paid_at || null,
        adminPaymentNote: rsvp.admin_payment_note || '',
        createdAt: guest.created_at,
        addedBy: owner,
        user: {
          id: guest.id,
          line_uid: '',
          display_name: guest.display_name,
          phone: '',
          profile_image_url: ''
        }
      });
    }
  }

  return {
    data: {
      session,
      rows
    },
    error: null
  };
}

async function countSessionSeats(sessionId, status) {
  const { count: memberCount, error: memberCountError } = await supabase
    .from('rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', status);

  if (memberCountError) {
    return { count: 0, error: memberCountError };
  }

  const { count: guestCount, error: guestCountError } = await supabase
    .from('rsvp_guests')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', status);

  if (guestCountError) {
    return { count: 0, error: guestCountError };
  }

  return {
    count: (memberCount || 0) + (guestCount || 0),
    error: null
  };
}

async function reserveSessionRsvp({ sessionId, userId, guestNames = [] }) {
  const normalizedGuestNames = Array.isArray(guestNames)
    ? guestNames.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 10)
    : [];

  const { data, error } = await supabase.rpc('reserve_session_rsvp', {
    p_session_id: sessionId,
    p_user_id: userId,
    p_guest_names: normalizedGuestNames
  });

  if (error) {
    if (error.code === '42883' || String(error.message || '').includes('reserve_session_rsvp')) {
      const migrationError = new Error('Database booking protection is not installed. Please run migration-rsvp-duplicate-capacity.sql in Supabase SQL Editor.');
      migrationError.statusCode = 503;
      throw migrationError;
    }

    throw error;
  }

  const reservation = Array.isArray(data) ? data[0] : data;

  if (!reservation?.rsvp_id) {
    throw new Error('Unable to reserve RSVP.');
  }

  return {
    id: reservation.rsvp_id,
    status: reservation.status,
    totalJoined: Number(reservation.reservation_joined_count || 0),
    totalWaitlist: Number(reservation.reservation_waitlist_count || 0),
    guestCount: Number(reservation.guest_count || 0),
    alreadyExists: Boolean(reservation.already_exists)
  };
}

async function promoteWaitlist(sessionId) {
  const { data: session, error: sessionError } = await findSession(sessionId);

  if (sessionError || !session) {
    return { promoted: [], error: sessionError || new Error('Session not found.') };
  }

  const promoted = [];

  while (true) {
    const { count: joinedSeats, error: joinedError } = await countSessionSeats(session.id, 'Joined');
    if (joinedError) return { promoted, error: joinedError };
    if ((joinedSeats || 0) >= session.max_players) break;

    const { data: waitlistMembers, error: memberError } = await supabase
      .from('rsvps')
      .select('id, user_id, created_at')
      .eq('session_id', session.id)
      .eq('status', 'Waitlist')
      .order('created_at', { ascending: true })
      .limit(1);

    if (memberError) return { promoted, error: memberError };

    const { data: waitlistGuests, error: guestError } = await supabase
      .from('rsvp_guests')
      .select('id, rsvp_id, display_name, created_at')
      .eq('session_id', session.id)
      .eq('status', 'Waitlist')
      .order('created_at', { ascending: true })
      .limit(1);

    if (guestError) return { promoted, error: guestError };

    const candidates = [
      ...(waitlistMembers || []).map((item) => ({ ...item, kind: 'member' })),
      ...(waitlistGuests || []).map((item) => ({ ...item, kind: 'guest' }))
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    const next = candidates[0];
    if (!next) break;

    if (next.kind === 'member') {
      const { error: updateError } = await supabase
        .from('rsvps')
        .update({ status: 'Joined' })
        .eq('id', next.id);

      if (updateError) return { promoted, error: updateError };
      const { error: paymentError } = await addJoinedPaymentDue(next.id, depositAmountPerSeat(session));
      if (paymentError) return { promoted, error: paymentError };
    } else {
      const { error: updateError } = await supabase
        .from('rsvp_guests')
        .update({ status: 'Joined' })
        .eq('id', next.id);

      if (updateError) return { promoted, error: updateError };
      const { error: paymentError } = await addJoinedPaymentDue(next.rsvp_id, depositAmountPerSeat(session));
      if (paymentError) return { promoted, error: paymentError };
    }

    promoted.push({
      id: next.id,
      kind: next.kind,
      displayName: next.display_name || ''
    });
  }

  return { promoted, error: null };
}

async function addJoinedPaymentDue(rsvpId, priceThb) {
  const amountToAdd = Number(priceThb || 0);
  if (!amountToAdd) return { error: null };

  const { data: rsvp, error: rsvpError } = await supabase
    .from('rsvps')
    .select('payment_status, payment_amount_due, payment_amount_paid')
    .eq('id', rsvpId)
    .maybeSingle();

  if (rsvpError || !rsvp) return { error: rsvpError || new Error('RSVP not found.') };

  const nextAmountDue = Number(rsvp.payment_amount_due || 0) + amountToAdd;
  const amountPaid = Number(rsvp.payment_amount_paid || 0);
  const nextStatus = amountPaid >= nextAmountDue ? 'Paid' : 'Pending';

  const { error } = await supabase
    .from('rsvps')
    .update({
      payment_amount_due: nextAmountDue,
      payment_status: nextStatus,
      payment_paid_at: nextStatus === 'Paid' ? new Date().toISOString() : null
    })
    .eq('id', rsvpId);

  return { error };
}

async function getSessionSummary(sessionId, lineUid) {
  const { data: session, error: sessionError } = await findSession(sessionId);

  if (sessionError || !session) {
    return {
      data: null,
      error: sessionError || new Error('Session not found.')
    };
  }

  const { count: joinedCount, error: joinedCountError } = await countSessionSeats(session.id, 'Joined');

  if (joinedCountError) {
    return { data: null, error: joinedCountError };
  }

  const { count: waitlistCount, error: waitlistCountError } = await countSessionSeats(session.id, 'Waitlist');

  if (waitlistCountError) {
    return { data: null, error: waitlistCountError };
  }

  let userStatus = null;
  let host = null;

  if (lineUid) {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (userError) {
      return { data: null, error: userError };
    }

    if (user) {
      const { data: rsvp, error: rsvpError } = await supabase
        .from('rsvps')
        .select('status')
        .eq('session_id', session.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (rsvpError) {
        return { data: null, error: rsvpError };
      }

      userStatus = rsvp ? rsvp.status : null;
    }
  }

  if (session.created_by_user_id) {
    const { data: hostUser, error: hostError } = await supabase
      .from('users')
      .select(userSelect)
      .eq('id', session.created_by_user_id)
      .maybeSingle();

    if (hostError) {
      return { data: null, error: hostError };
    }

    host = hostUser ? serializeUser(hostUser) : null;
  }

  return {
    data: {
      ...serializeSession(session),
      host,
      joinedCount: joinedCount || 0,
      waitlistCount: waitlistCount || 0,
      spotsLeft: Math.max(session.max_players - (joinedCount || 0), 0),
      userStatus
    },
    error: null
  };
}

async function listPublicSessions(lineUid) {
  await cleanupOldPaymentSlips();

  const { data: sessions, error } = await supabase
    .from('sessions')
    .select(sessionSelect)
    .neq('status', 'Cancelled')
    .order('event_date', { ascending: true, nullsFirst: false })
    .order('start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  const visibleSessions = (sessions || []).filter(isPublicSessionVisible);
  const summaries = await Promise.all(
    visibleSessions.map((session, index) => getSessionSummary(session.id, lineUid).then((summary) => ({
      index: index + 1,
      ...summary.data
    })))
  );

  return {
    data: summaries,
    error: null
  };
}

async function cleanupOldPaymentSlips() {
  try {
    const cutoffDate = addDaysToDateString(getBangkokDateString(), -7);
    const { data: oldSessions, error: sessionError } = await supabase
      .from('sessions')
      .select('id')
      .not('event_date', 'is', null)
      .lt('event_date', cutoffDate);

    if (sessionError || !oldSessions || oldSessions.length === 0) return;

    const sessionIds = oldSessions.map((session) => session.id);
    const { data: rsvps, error: rsvpError } = await supabase
      .from('rsvps')
      .select('id, payment_slip_path')
      .in('session_id', sessionIds)
      .not('payment_slip_path', 'is', null)
      .eq('payment_slip_deleted', false);

    if (rsvpError || !rsvps || rsvps.length === 0) return;

    const paths = rsvps.map((rsvp) => rsvp.payment_slip_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from(paymentSlipBucket).remove(paths);
    }

    await supabase
      .from('rsvps')
      .update({
        payment_slip_url: null,
        payment_slip_path: null,
        payment_slip_deleted: true
      })
      .in('id', rsvps.map((rsvp) => rsvp.id));
  } catch (error) {
    console.error('Payment slip cleanup error:', error);
  }
}

async function getAppSettings() {
  const fallbackSettings = {
    homeBannerUrl: defaultHomeBannerUrl,
    defaultEventSettings: {
      maxPlayers: 24,
      courtCount: 1,
      priceThb: 250,
      location: '',
      address: '',
      skillLevel: '',
      paymentQrUrl: '',
      paymentBankName: '',
      paymentAccountName: '',
      paymentAccountNumber: '',
      paymentPromptPayId: '',
      paymentMode: 'deposit_then_final',
      depositAmountThb: 100,
      estimatedTotalThb: 250,
      finalAmountThb: '',
      paymentNotePublic: 'มัดจำเพื่อกัน no-show ส่วนต่างชำระหลังจบกิจกรรม'
    }
  };

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value');

    if (error) {
      if (error.code === '42P01') return fallbackSettings;
      throw error;
    }

    const settings = { ...fallbackSettings };
    for (const row of data || []) {
      if (row.key === 'home_banner_url') {
        settings.homeBannerUrl = row.value || defaultHomeBannerUrl;
      } else if (row.key === 'default_event_settings') {
        try {
          settings.defaultEventSettings = {
            ...fallbackSettings.defaultEventSettings,
            ...(JSON.parse(row.value || '{}') || {})
          };
        } catch (parseError) {
          settings.defaultEventSettings = fallbackSettings.defaultEventSettings;
        }
      }
    }

    return settings;
  } catch (error) {
    console.error('App settings load error:', error);
    return fallbackSettings;
  }
}

async function listHomeBanners({ activeOnly = false, limit = null } = {}) {
  try {
    let query = supabase
      .from('home_banners')
      .select('id, title, image_url, link_url, display_order, is_active, created_at, updated_at')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01') return { data: [], error: null };
      throw error;
    }

    return {
      data: (data || []).map(serializeHomeBanner),
      error: null
    };
  } catch (error) {
    return { data: null, error };
  }
}

async function saveAppSettings(settings) {
  const homeBannerUrl = settings.homeBannerUrl || defaultHomeBannerUrl;
  const defaultEventSettings = {
    maxPlayers: Number(settings.defaultEventSettings?.maxPlayers || 24),
    courtCount: Number(settings.defaultEventSettings?.courtCount || 1),
    priceThb: Number(settings.defaultEventSettings?.priceThb || 0),
    location: settings.defaultEventSettings?.location || '',
    address: settings.defaultEventSettings?.address || '',
    skillLevel: settings.defaultEventSettings?.skillLevel || '',
    paymentQrUrl: settings.defaultEventSettings?.paymentQrUrl || '',
    paymentBankName: settings.defaultEventSettings?.paymentBankName || '',
    paymentAccountName: settings.defaultEventSettings?.paymentAccountName || '',
    paymentAccountNumber: settings.defaultEventSettings?.paymentAccountNumber || '',
    paymentPromptPayId: settings.defaultEventSettings?.paymentPromptPayId || '',
    paymentMode: normalizePaymentMode(settings.defaultEventSettings?.paymentMode),
    depositAmountThb: Number(settings.defaultEventSettings?.depositAmountThb || 0),
    estimatedTotalThb: Number(settings.defaultEventSettings?.estimatedTotalThb || settings.defaultEventSettings?.priceThb || 0),
    finalAmountThb: settings.defaultEventSettings?.finalAmountThb === '' || settings.defaultEventSettings?.finalAmountThb === null || settings.defaultEventSettings?.finalAmountThb === undefined
      ? ''
      : Number(settings.defaultEventSettings?.finalAmountThb || 0),
    paymentNotePublic: settings.defaultEventSettings?.paymentNotePublic || ''
  };

  const { error } = await supabase
    .from('app_settings')
    .upsert([
      {
        key: 'home_banner_url',
        value: homeBannerUrl,
        updated_at: new Date().toISOString()
      },
      {
        key: 'default_event_settings',
        value: JSON.stringify(defaultEventSettings),
        updated_at: new Date().toISOString()
      }
    ], {
      onConflict: 'key'
    });

  if (error) throw error;

  return {
    homeBannerUrl,
    defaultEventSettings
  };
}

app.get('/api/config', async (req, res) => {
  const settings = await getAppSettings();

  res.json({
    liffId: process.env.LINE_LIFF_ID || '',
    settings
  });
});

app.get('/api/public/home-banners', async (req, res) => {
  try {
    const { data, error } = await listHomeBanners({ activeOnly: true, limit: 6 });

    if (error) throw error;

    let banners = data || [];
    if (banners.length === 0) {
      const settings = await getAppSettings();
      const legacyBannerUrl = settings.homeBannerUrl || defaultHomeBannerUrl;

      if (legacyBannerUrl) {
        banners = [{
          id: 'legacy-home-banner',
          title: '',
          imageUrl: legacyBannerUrl,
          linkUrl: '',
          displayOrder: 0,
          isActive: true,
          createdAt: null,
          updatedAt: null
        }];
      }
    }

    return res.json({
      success: true,
      banners
    });
  } catch (error) {
    console.error('Public home banners load error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load home banners.'
    });
  }
});

app.get('/api/admin/home-banners', requireAdmin, async (req, res) => {
  try {
    const settings = await getAppSettings();
    const { data, error } = await listHomeBanners();

    if (error) throw error;

    return res.json({
      success: true,
      banners: data || [],
      legacyBannerUrl: settings.homeBannerUrl || defaultHomeBannerUrl
    });
  } catch (error) {
    console.error('Admin home banners load error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load home banners.'
    });
  }
});

app.post('/api/admin/home-banners', requireAdmin, async (req, res) => {
  try {
    const {
      title,
      imageUrl,
      linkUrl,
      displayOrder,
      isActive
    } = req.body;

    if (!String(imageUrl || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'imageUrl is required.'
      });
    }

    const payload = {
      title: String(title || '').trim() || null,
      image_url: String(imageUrl || '').trim(),
      link_url: String(linkUrl || '').trim() || null,
      display_order: Number(displayOrder || 0),
      is_active: isActive !== false,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('home_banners')
      .insert(payload)
      .select('id, title, image_url, link_url, display_order, is_active, created_at, updated_at')
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      banner: serializeHomeBanner(data),
      message: 'Banner created.'
    });
  } catch (error) {
    console.error('Create home banner error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to create home banner.'
    });
  }
});

app.patch('/api/admin/home-banners/:bannerId', requireAdmin, async (req, res) => {
  try {
    const { bannerId } = req.params;
    const {
      title,
      imageUrl,
      linkUrl,
      displayOrder,
      isActive
    } = req.body;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) updatePayload.title = String(title || '').trim() || null;
    if (imageUrl !== undefined) updatePayload.image_url = String(imageUrl || '').trim();
    if (linkUrl !== undefined) updatePayload.link_url = String(linkUrl || '').trim() || null;
    if (displayOrder !== undefined) updatePayload.display_order = Number(displayOrder || 0);
    if (isActive !== undefined) updatePayload.is_active = Boolean(isActive);

    if (updatePayload.image_url !== undefined && !updatePayload.image_url) {
      return res.status(400).json({
        success: false,
        message: 'imageUrl is required.'
      });
    }

    const { data, error } = await supabase
      .from('home_banners')
      .update(updatePayload)
      .eq('id', bannerId)
      .select('id, title, image_url, link_url, display_order, is_active, created_at, updated_at')
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      banner: serializeHomeBanner(data),
      message: 'Banner updated.'
    });
  } catch (error) {
    console.error('Update home banner error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to update home banner.'
    });
  }
});

app.delete('/api/admin/home-banners/:bannerId', requireAdmin, async (req, res) => {
  try {
    const { bannerId } = req.params;

    const { error } = await supabase
      .from('home_banners')
      .delete()
      .eq('id', bannerId);

    if (error) throw error;

    return res.json({
      success: true,
      message: 'Banner deleted.'
    });
  } catch (error) {
    console.error('Delete home banner error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to delete home banner.'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'gdsq-pickleball',
    status: 'ok'
  });
});

app.get('/', async (req, res) => {
  try {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    const html = await require('fs').promises.readFile(htmlPath, 'utf8');
    const sessionId = req.query.sessionId;
    const appSettings = await getAppSettings();
    let meta = buildMetaTags({
      title: 'GDSQ Pickleball',
      description: 'GDSQ Good Game. Good People. Join the Fun!',
      imageUrl: absoluteUrl(req, publicImageUrl(appSettings.homeBannerUrl) || defaultHomeBannerUrl),
      url: `${req.protocol}://${req.get('host')}${req.originalUrl}`
    });

    if (sessionId) {
      const { data: session } = await findSession(sessionId);

      if (session) {
        const { data: sessionSummary } = await getSessionSummary(session.id);
        const title = `${session.title} | GDSQ Pickleball`;
        const dateText = session.event_date || '';
        const timeText = session.start_time ? session.start_time.slice(0, 5) : '';
        const priceText = session.price_thb === null || session.price_thb === undefined ? '' : `THB ${session.price_thb}`;
        const spotsText = sessionSummary
          ? `${sessionSummary.spotsLeft}/${session.max_players || 0} spots left`
          : `${session.max_players || 0} spots`;
        const description = [
          dateText,
          timeText,
          session.location,
          priceText,
          spotsText
        ].filter(Boolean).join(' · ');
        const imageUrl = absoluteUrl(req, publicImageUrl(session.poster_url) || '/assets/gdsq-logo.png');

        meta = buildMetaTags({
          title,
          description: description || session.description || 'Join this GDSQ Pickleball event.',
          imageUrl,
          url: `${req.protocol}://${req.get('host')}${req.originalUrl}`
        });
      }
    }

    return res.send(html.replace('</head>', `${meta}\n</head>`));
  } catch (error) {
    console.error('Index render error:', error);
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/public/sessions', async (req, res) => {
  try {
    const { lineUid } = req.query;
    const { data, error } = await listPublicSessions(lineUid);

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      sessions: data
    });
  } catch (error) {
    console.error('Public sessions list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load sessions.'
    });
  }
});

app.get('/api/public/past-sessions', async (req, res) => {
  try {
    const { lineUid } = req.query;
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(sessionSelect)
      .neq('status', 'Cancelled')
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('start_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    const pastSessions = (sessions || []).filter(isSessionEnded);
    const summaries = await Promise.all(
      pastSessions.map((session, index) => getSessionSummary(session.id, lineUid).then((summary) => ({
        index: index + 1,
        ...summary.data,
        isEnded: true
      })))
    );

    return res.json({
      success: true,
      sessions: summaries
    });
  } catch (error) {
    console.error('Past sessions list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load past sessions.'
    });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const { lineUid } = req.query;

    if (!lineUid) {
      return res.status(400).json({
        success: false,
        message: 'lineUid is required.'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select(userSelect)
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      user: user ? serializeUser(user) : null
    });
  } catch (error) {
    console.error('Profile load error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load profile.'
    });
  }
});

app.put('/api/profile', async (req, res) => {
  try {
    const { lineUid, displayName, phone, profileImageUrl } = req.body;

    if (!lineUid) {
      return res.status(400).json({
        success: false,
        message: 'lineUid is required.'
      });
    }

    const user = await upsertLineUser({
      lineUid,
      displayName,
      phone,
      profileImageUrl
    });

    return res.json({
      success: true,
      user: serializeUser(user),
      message: 'Profile saved.'
    });
  } catch (error) {
    console.error('Profile save error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to save profile.'
    });
  }
});

app.get('/api/profile/history', async (req, res) => {
  try {
    const { lineUid } = req.query;

    if (!lineUid) {
      return res.status(400).json({
        success: false,
        message: 'lineUid is required.'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select(userSelect)
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (userError) throw userError;

    if (!user) {
      return res.json({
        success: true,
        attended: [],
        hosted: [],
        pendingVotes: []
      });
    }

    const { data: rsvps, error: rsvpError } = await supabase
      .from('rsvps')
      .select('session_id, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (rsvpError) throw rsvpError;

    const attendedSessionIds = [...new Set((rsvps || []).map((rsvp) => rsvp.session_id))];
    const rsvpBySessionId = Object.fromEntries((rsvps || []).map((rsvp) => [rsvp.session_id, rsvp]));
    let attendedSessions = [];

    if (attendedSessionIds.length > 0) {
      const { data: sessions, error: sessionsError } = await supabase
        .from('sessions')
        .select(sessionSelect)
        .in('id', attendedSessionIds);

      if (sessionsError) throw sessionsError;
      attendedSessions = sessions || [];
    }

    const { data: hostedSessions, error: hostedError } = await supabase
      .from('sessions')
      .select(sessionSelect)
      .eq('created_by_user_id', user.id)
      .neq('status', 'Cancelled')
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('start_time', { ascending: false, nullsFirst: false });

    if (hostedError) throw hostedError;

    let voteCategoryCountBySessionId = {};
    const votes = await listRankingVotes({ voterLineUid: user.line_uid });
    for (const vote of votes || []) {
      voteCategoryCountBySessionId[vote.event_id] = (voteCategoryCountBySessionId[vote.event_id] || 0) + 1;
    }

    const attended = await Promise.all(attendedSessions.map(async (session) => {
      const summary = await getSessionSummary(session.id, lineUid);
      const isEnded = isSessionEnded(session);
      const completedVotes = Number(voteCategoryCountBySessionId[session.id] || 0);
      const votePending = isEnded
        && rsvpBySessionId[session.id]?.status === 'Joined'
        && completedVotes < VOTING_CATEGORIES.length;

      return {
        ...summary.data,
        rsvpStatus: rsvpBySessionId[session.id]?.status || null,
        isEnded,
        votePending,
        voted: completedVotes >= VOTING_CATEGORIES.length,
        voteProgress: completedVotes
      };
    }));

    const hosted = await Promise.all((hostedSessions || []).map(async (session) => {
      const summary = await getSessionSummary(session.id, lineUid);
      return {
        ...summary.data,
        isEnded: isSessionEnded(session)
      };
    }));

    attended.sort((a, b) => {
      const aTime = `${a.eventDate || '9999-12-31'}T${a.startTime || '00:00:00'}`;
      const bTime = `${b.eventDate || '9999-12-31'}T${b.startTime || '00:00:00'}`;
      return bTime.localeCompare(aTime);
    });

    return res.json({
      success: true,
      attended,
      hosted,
      pendingVotes: attended.filter((session) => session.votePending)
    });
  } catch (error) {
    console.error('Profile history error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load profile history.'
    });
  }
});

app.post('/api/public/sessions', async (req, res) => {
  try {
    const { lineUid, displayName, profileImageUrl, phone } = req.body;

    if (!lineUid) {
      return res.status(400).json({
        success: false,
        message: 'lineUid is required.'
      });
    }

    const user = await upsertLineUser({
      lineUid,
      displayName,
      phone,
      profileImageUrl
    });

    const { data: sessionPayload, error: payloadError } = parseSessionPayload(req.body);

    if (payloadError) {
      return res.status(400).json({
        success: false,
        message: payloadError
      });
    }

    const { data: session, error } = await supabase
      .from('sessions')
      .insert({
        ...sessionPayload,
        created_by_user_id: user.id,
        status: 'Published'
      })
      .select(sessionSelect)
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      session: {
        ...serializeSession(session),
        host: serializeUser(user)
      },
      message: 'Event published.'
    });
  } catch (error) {
    console.error('Public create session error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to publish event.'
    });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select(userSelect)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const { data: rsvps, error: rsvpError } = await supabase
      .from('rsvps')
      .select('user_id, status');

    if (rsvpError) {
      throw rsvpError;
    }

    const statsByUserId = {};
    for (const rsvp of rsvps || []) {
      if (!statsByUserId[rsvp.user_id]) {
        statsByUserId[rsvp.user_id] = { joinedCount: 0, waitlistCount: 0 };
      }

      if (rsvp.status === 'Joined') {
        statsByUserId[rsvp.user_id].joinedCount += 1;
      }

      if (rsvp.status === 'Waitlist') {
        statsByUserId[rsvp.user_id].waitlistCount += 1;
      }
    }

    return res.json({
      success: true,
      players: (users || []).map((user) => ({
        ...serializeUser(user),
        joinedCount: statsByUserId[user.id]?.joinedCount || 0,
        waitlistCount: statsByUserId[user.id]?.waitlistCount || 0
      }))
    });
  } catch (error) {
    console.error('Players list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load players.'
    });
  }
});

app.post('/api/app-open', async (req, res) => {
  try {
    const { lineUid, displayName, profileImageUrl, phone } = req.body || {};

    if (!lineUid) {
      return res.status(400).json({
        success: false,
        message: 'lineUid is required.'
      });
    }

    const user = await recordUserAppOpen({
      lineUid,
      displayName,
      profileImageUrl,
      phone
    });

    return res.json({
      success: true,
      user: serializeAdminActivityUser(user)
    });
  } catch (error) {
    console.error('App open tracking error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to track app open.'
    });
  }
});

app.get('/api/rankings', async (req, res) => {
  try {
    const period = normalizeRankingPeriod(req.query.period);
    const category = VOTING_CATEGORY_KEYS.has(req.query.category) ? req.query.category : DEFAULT_RANKING_CATEGORY;
    const payload = await buildRankingPayload({
      period,
      identifier: req.query.periodId || '',
      category
    });

    return res.json({
      success: true,
      ...payload
    });
  } catch (error) {
    console.error('Rankings list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load rankings.'
    });
  }
});

app.get('/api/admin/app-activity', requireAdmin, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select(adminActivityUserSelect)
      .not('last_seen_at', 'is', null)
      .order('last_seen_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const usersList = (users || []).map(serializeAdminActivityUser);
    const activeLast24Hours = usersList.filter((user) => {
      if (!user.lastSeenAt) return false;
      return now - new Date(user.lastSeenAt).getTime() <= dayMs;
    }).length;

    return res.json({
      success: true,
      users: usersList,
      summary: {
        activeLast24Hours,
        totalTrackedUsers: usersList.length,
        latestUser: usersList[0] || null
      }
    });
  } catch (error) {
    console.error('Admin app activity error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load app activity.'
    });
  }
});

app.get('/api/awards/weekly/:weekId', async (req, res) => {
  try {
    const payload = await buildRankingPayload({
      period: 'weekly',
      identifier: req.params.weekId,
      category: DEFAULT_RANKING_CATEGORY
    });

    return res.json({
      success: true,
      ...payload,
      top: payload.rankings.slice(0, 5)
    });
  } catch (error) {
    console.error('Weekly awards load error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load weekly awards.'
    });
  }
});

app.get('/api/awards/monthly/:monthId', async (req, res) => {
  try {
    const payload = await buildRankingPayload({
      period: 'monthly',
      identifier: req.params.monthId,
      category: DEFAULT_RANKING_CATEGORY
    });

    return res.json({
      success: true,
      ...payload,
      top: payload.rankings.slice(0, 5)
    });
  } catch (error) {
    console.error('Monthly awards load error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load monthly awards.'
    });
  }
});

app.get('/rankings/weekly/:weekId', async (req, res) => {
  try {
    const payload = await buildRankingPayload({
      period: 'weekly',
      identifier: req.params.weekId,
      category: DEFAULT_RANKING_CATEGORY
    });

    return res.send(await renderRankingSharePage(req, {
      title: 'Weekly Rankings',
      subtitle: payload.periodLabel,
      winner: payload.mvpWinner,
      top: payload.rankings.slice(0, 5),
      awards: payload.awards,
      sharePath: req.originalUrl
    }));
  } catch (error) {
    console.error('Weekly rankings page error:', error);
    return res.status(500).send('Unable to load weekly rankings.');
  }
});

app.get('/rankings/monthly/:monthId', async (req, res) => {
  try {
    const payload = await buildRankingPayload({
      period: 'monthly',
      identifier: req.params.monthId,
      category: DEFAULT_RANKING_CATEGORY
    });

    return res.send(await renderRankingSharePage(req, {
      title: 'Monthly Rankings',
      subtitle: payload.periodLabel,
      winner: payload.mvpWinner,
      top: payload.rankings.slice(0, 5),
      awards: payload.awards,
      sharePath: req.originalUrl
    }));
  } catch (error) {
    console.error('Monthly rankings page error:', error);
    return res.status(500).send('Unable to load monthly rankings.');
  }
});

app.get('/awards/weekly/:weekId', async (req, res) => {
  try {
    const payload = await buildRankingPayload({
      period: 'weekly',
      identifier: req.params.weekId,
      category: DEFAULT_RANKING_CATEGORY
    });

    return res.send(await renderRankingSharePage(req, {
      title: 'Weekly Awards',
      subtitle: payload.periodLabel,
      winner: payload.mvpWinner,
      top: payload.rankings.slice(0, 3),
      awards: payload.awards,
      sharePath: req.originalUrl
    }));
  } catch (error) {
    console.error('Weekly awards page error:', error);
    return res.status(500).send('Unable to load weekly awards.');
  }
});

app.get('/awards/monthly/:monthId', async (req, res) => {
  try {
    const payload = await buildRankingPayload({
      period: 'monthly',
      identifier: req.params.monthId,
      category: DEFAULT_RANKING_CATEGORY
    });

    return res.send(await renderRankingSharePage(req, {
      title: 'Monthly Awards',
      subtitle: payload.periodLabel,
      winner: payload.mvpWinner,
      top: payload.rankings.slice(0, 3),
      awards: payload.awards,
      sharePath: req.originalUrl
    }));
  } catch (error) {
    console.error('Monthly awards page error:', error);
    return res.status(500).send('Unable to load monthly awards.');
  }
});

app.get('/api/players/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;

    if (!uuidPattern.test(playerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid player id.'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select(userSelect)
      .eq('id', playerId)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Player not found.'
      });
    }

    const { data: rsvps, error: rsvpError } = await supabase
      .from('rsvps')
      .select('session_id, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (rsvpError) throw rsvpError;

    const joinedRsvps = (rsvps || []).filter((rsvp) => rsvp.status === 'Joined');
    const waitlistRsvps = (rsvps || []).filter((rsvp) => rsvp.status === 'Waitlist');
    const sessionIds = [...new Set(joinedRsvps.map((rsvp) => rsvp.session_id))];
    let attendedSessions = [];

    if (sessionIds.length > 0) {
      const { data: sessions, error: sessionsError } = await supabase
        .from('sessions')
        .select(sessionSelect)
        .in('id', sessionIds);

      if (sessionsError) throw sessionsError;
      attendedSessions = sessions || [];
    }

    const { count: hostedCount, error: hostedError } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('created_by_user_id', user.id)
      .neq('status', 'Cancelled');

    if (hostedError) throw hostedError;

    const rating = {
      voteCount: 0,
      ratingAverage: null,
      categoryCounts: {},
      topCategories: []
    };

    const votes = await listRankingVotes({ nomineeLineUid: user.line_uid });
    if (votes.length > 0) {
      for (const vote of votes) {
        rating.categoryCounts[vote.category] = (rating.categoryCounts[vote.category] || 0) + 1;
      }
      rating.voteCount = votes.length;
      rating.ratingAverage = votes.length;
      rating.topCategories = topCategoryEntries(rating.categoryCounts);
    }

    const history = await Promise.all(
      attendedSessions
        .sort((a, b) => {
          const aTime = `${a.event_date || '9999-12-31'}T${a.start_time || '00:00:00'}`;
          const bTime = `${b.event_date || '9999-12-31'}T${b.start_time || '00:00:00'}`;
          return bTime.localeCompare(aTime);
        })
        .slice(0, 10)
        .map(async (session) => ({
          ...(await getSessionSummary(session.id)).data,
          isEnded: isSessionEnded(session)
        }))
    );

    const upcoming = history
      .filter((session) => !session.isEnded)
      .sort((a, b) => {
        const aTime = `${a.eventDate || '9999-12-31'}T${a.startTime || '00:00:00'}`;
        const bTime = `${b.eventDate || '9999-12-31'}T${b.startTime || '00:00:00'}`;
        return aTime.localeCompare(bTime);
      })
      .slice(0, 5);

    let playedTogether = [];
    if (sessionIds.length > 0) {
      const { data: sharedRsvps, error: sharedRsvpError } = await supabase
        .from('rsvps')
        .select('session_id, user_id')
        .in('session_id', sessionIds)
        .eq('status', 'Joined')
        .neq('user_id', user.id);

      if (sharedRsvpError) throw sharedRsvpError;

      const sharedByUserId = {};
      for (const rsvp of sharedRsvps || []) {
        if (!sharedByUserId[rsvp.user_id]) {
          sharedByUserId[rsvp.user_id] = new Set();
        }
        sharedByUserId[rsvp.user_id].add(rsvp.session_id);
      }

      const sharedUserIds = Object.keys(sharedByUserId);
      if (sharedUserIds.length > 0) {
        const { data: sharedUsers, error: sharedUsersError } = await supabase
          .from('users')
          .select(userSelect)
          .in('id', sharedUserIds);

        if (sharedUsersError) throw sharedUsersError;

        playedTogether = (sharedUsers || [])
          .map((sharedUser) => ({
            ...serializeUser(sharedUser),
            sharedEventCount: sharedByUserId[sharedUser.id]?.size || 0
          }))
          .sort((a, b) => b.sharedEventCount - a.sharedEventCount || a.displayName.localeCompare(b.displayName))
          .slice(0, 8);
      }
    }

    return res.json({
      success: true,
      player: {
        ...serializeUser(user),
        phone: null,
        joinedCount: joinedRsvps.length,
        waitlistCount: waitlistRsvps.length,
        hostedCount: hostedCount || 0,
        ...rating,
        badges: buildPlayerBadges({
          joinedCount: joinedRsvps.length,
          hostedCount: hostedCount || 0,
          rating
        }),
        upcoming,
        playedTogether,
        history
      }
    });
  } catch (error) {
    console.error('Player profile error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load player profile.'
    });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (!adminPassword) {
    return res.status(503).json({
      success: false,
      message: 'Admin password is not configured.'
    });
  }

  if (password !== adminPassword) {
    return res.status(401).json({
      success: false,
      message: 'Incorrect password.'
    });
  }

  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${adminCookieName}=${encodeURIComponent(createAdminToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secureFlag}`
  );

  return res.json({
    success: true,
    message: 'Logged in.'
  });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${adminCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );

  return res.json({
    success: true,
    message: 'Logged out.'
  });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await getAppSettings();

    return res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Admin settings load error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load settings.'
    });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await saveAppSettings({
      homeBannerUrl: req.body.homeBannerUrl
    });

    return res.json({
      success: true,
      settings,
      message: 'Settings saved.'
    });
  } catch (error) {
    console.error('Admin settings save error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to save settings. Please run migration-app-settings.sql first.'
    });
  }
});

app.get('/api/sessions', requireAdmin, async (req, res) => {
  try {
    await cleanupOldPaymentSlips();

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(sessionSelect)
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const summaries = await Promise.all(
      (sessions || []).map((session, index) => getSessionSummary(session.id).then((summary) => ({
        index: index + 1,
        ...summary.data
      })))
    );

    return res.json({
      success: true,
      sessions: summaries
    });
  } catch (error) {
    console.error('Sessions list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load sessions.'
    });
  }
});

app.post('/api/sessions', requireAdmin, async (req, res) => {
  try {
    const { data: sessionPayload, error: payloadError } = parseSessionPayload(req.body);

    if (payloadError) {
      return res.status(400).json({
        success: false,
        message: payloadError
      });
    }

    const { data: session, error } = await supabase
      .from('sessions')
      .insert(sessionPayload)
      .select(sessionSelect)
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      session: serializeSession(session),
      message: 'Session created.'
    });
  } catch (error) {
    console.error('Create session error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create session.'
    });
  }
});

app.post('/api/sessions/:sessionId/duplicate', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data: currentSession, error: sessionError } = await findSession(sessionId);

    if (sessionError || !currentSession) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const copyPayload = {
      title: req.body.title || `${currentSession.title} (Copy)`,
      max_players: Number(req.body.maxPlayers || currentSession.max_players || 24),
      court_count: Number(req.body.courtCount || currentSession.court_count || 1),
      event_date: req.body.eventDate || currentSession.event_date || null,
      start_time: req.body.startTime || currentSession.start_time || null,
      end_time: req.body.endTime || currentSession.end_time || null,
      price_thb: req.body.priceThb === undefined ? currentSession.price_thb : req.body.priceThb,
      payment_qr_url: req.body.paymentQrUrl || currentSession.payment_qr_url || null,
      payment_bank_name: req.body.paymentBankName || currentSession.payment_bank_name || null,
      payment_account_name: req.body.paymentAccountName || currentSession.payment_account_name || null,
      payment_account_number: req.body.paymentAccountNumber || currentSession.payment_account_number || null,
      payment_promptpay_id: req.body.paymentPromptPayId || currentSession.payment_promptpay_id || null,
      location: req.body.location || currentSession.location || null,
      address: req.body.address || currentSession.address || null,
      skill_level: req.body.skillLevel || currentSession.skill_level || null,
      description: req.body.description || currentSession.description || null,
      poster_url: req.body.posterUrl || currentSession.poster_url || null,
      status: 'Published'
    };

    const { data: session, error } = await supabase
      .from('sessions')
      .insert(copyPayload)
      .select(sessionSelect)
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      session: serializeSession(session),
      message: 'Session duplicated.'
    });
  } catch (error) {
    console.error('Duplicate session error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to duplicate session.'
    });
  }
});

app.patch('/api/sessions/:sessionId', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data: currentSession, error: sessionError } = await findSession(sessionId);

    if (sessionError || !currentSession) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: sessionPayload, error: payloadError } = parseSessionPayload(req.body);

    if (payloadError) {
      return res.status(400).json({
        success: false,
        message: payloadError
      });
    }

    const { data: session, error } = await supabase
      .from('sessions')
      .update(sessionPayload)
      .eq('id', currentSession.id)
      .select(sessionSelect)
      .single();

    if (error) {
      throw error;
    }

    await listSessionRsvps(session.id);

    return res.json({
      success: true,
      session: serializeSession(session),
      message: 'Session updated.'
    });
  } catch (error) {
    console.error('Update session error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to update session.'
    });
  }
});

app.delete('/api/sessions/:sessionId', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data: currentSession, error: sessionError } = await findSession(sessionId);

    if (sessionError || !currentSession) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: slipRows, error: slipRowsError } = await supabase
      .from('rsvps')
      .select('payment_slip_path')
      .eq('session_id', currentSession.id)
      .not('payment_slip_path', 'is', null);

    if (slipRowsError) {
      throw slipRowsError;
    }

    const slipPaths = (slipRows || []).map((row) => row.payment_slip_path).filter(Boolean);
    if (slipPaths.length > 0) {
      await supabase.storage.from(paymentSlipBucket).remove(slipPaths);
    }

    const { error: guestDeleteError } = await supabase
      .from('rsvp_guests')
      .delete()
      .eq('session_id', currentSession.id);

    if (guestDeleteError) {
      throw guestDeleteError;
    }

    const { error: rsvpDeleteError } = await supabase
      .from('rsvps')
      .delete()
      .eq('session_id', currentSession.id);

    if (rsvpDeleteError) {
      throw rsvpDeleteError;
    }

    const { error: voteDeleteError } = await supabase
      .from('event_player_votes')
      .delete()
      .eq('session_id', currentSession.id);

    if (voteDeleteError && voteDeleteError.code !== '42P01') {
      throw voteDeleteError;
    }

    const { error: rankingVoteDeleteError } = await supabase
      .from('ranking_votes')
      .delete()
      .eq('event_id', currentSession.id);

    if (rankingVoteDeleteError && rankingVoteDeleteError.code !== '42P01') {
      throw rankingVoteDeleteError;
    }

    const { error: sessionDeleteError } = await supabase
      .from('sessions')
      .delete()
      .eq('id', currentSession.id);

    if (sessionDeleteError) {
      throw sessionDeleteError;
    }

    return res.json({
      success: true,
      message: 'Session deleted.'
    });
  } catch (error) {
    console.error('Delete session error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to delete session.'
    });
  }
});

app.get('/api/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { lineUid } = req.query;
    const { data, error } = await getSessionSummary(sessionId, lineUid);

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    return res.json({
      success: true,
      session: data
    });
  } catch (error) {
    console.error('Session summary error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load session.'
    });
  }
});

app.get('/api/session/:sessionId/rsvps', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data, error } = await listSessionRsvps(sessionId);

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    return res.json({
      success: true,
      session: serializeSession(data.session),
      rsvps: data.rows
    });
  } catch (error) {
    console.error('RSVP list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load RSVPs.'
    });
  }
});

async function handleVoteOptionsRequest(req, res, eventId) {
  try {
    const { lineUid } = req.query;

    if (!lineUid) {
      return res.status(401).json({
        success: false,
        message: 'LINE login required.'
      });
    }

    const context = await buildVoteContext(eventId, lineUid);
    if (context.error || !context.data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    return res.json(serializeVoteContextPayload(context.data));
  } catch (error) {
    console.error('Vote load error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load votes.'
    });
  }
}

async function handleVoteSubmitRequest(req, res, eventId) {
  try {
    const { lineUid, votes, category, nomineeLineUid } = req.body;

    if (!lineUid) {
      return res.status(401).json({
        success: false,
        message: 'LINE login required.'
      });
    }

    const context = await buildVoteContext(eventId, lineUid);
    if (context.error || !context.data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    if (!context.data.voter) {
      return res.status(401).json({
        success: false,
        message: 'Player profile not found.'
      });
    }

    if (!context.data.eventEnded) {
      return res.status(400).json({
        success: false,
        message: 'Voting opens after the event ends.'
      });
    }

    if (!context.data.voterJoined) {
      return res.status(403).json({
        success: false,
        message: 'Only joined players can vote in this event.'
      });
    }

    const submittedVotes = Array.isArray(votes) && votes.length > 0
      ? votes
      : [{ category, nomineeLineUid }];

    if (submittedVotes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please choose at least one category to vote.'
      });
    }

    const existingCategories = new Set((context.data.myVotes || []).map((vote) => vote.category));
    const seenCategories = new Set();
    const rowsToInsert = [];

    for (const vote of submittedVotes) {
      const categoryKey = String(vote?.category || '').trim();
      const nomineeUid = String(vote?.nomineeLineUid || '').trim();

      if (!VOTING_CATEGORY_KEYS.has(categoryKey)) {
        return res.status(400).json({
          success: false,
          message: `Invalid voting category: ${categoryKey || 'unknown'}`
        });
      }

      if (seenCategories.has(categoryKey)) {
        return res.status(400).json({
          success: false,
          message: `You can only submit one vote for ${rankingCategoryLabel(categoryKey)} at a time.`
        });
      }

      if (existingCategories.has(categoryKey)) {
        return res.status(409).json({
          success: false,
          message: `You already voted in ${rankingCategoryLabel(categoryKey)} for this event.`
        });
      }

      if (!nomineeUid) {
        return res.status(400).json({
          success: false,
          message: `Please choose a nominee for ${rankingCategoryLabel(categoryKey)}.`
        });
      }

      if (nomineeUid === lineUid) {
        return res.status(400).json({
          success: false,
          message: 'You cannot vote for yourself.'
        });
      }

      const nominee = findEligiblePlayer(context.data, nomineeUid);
      if (!nominee || nominee.isSelf) {
        return res.status(403).json({
          success: false,
          message: 'You can only vote for players who joined the same event.'
        });
      }

      seenCategories.add(categoryKey);
      rowsToInsert.push({
        event_id: eventId,
        voter_line_uid: lineUid,
        nominee_line_uid: nomineeUid,
        category: categoryKey
      });
    }

    const { error: insertError } = await supabase
      .from('ranking_votes')
      .insert(rowsToInsert);

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'You already voted in one of these categories for this event.'
        });
      }

      if (insertError.code === '42P01') {
        return res.status(500).json({
          success: false,
          message: 'Voting database is not ready yet. Please run the ranking votes migration in Supabase.'
        });
      }

      throw insertError;
    }

    const refreshed = await buildVoteContext(eventId, lineUid);
    return res.json({
      ...serializeVoteContextPayload(refreshed.data),
      message: rowsToInsert.length === 1 ? 'Vote submitted.' : 'Votes submitted.'
    });
  } catch (error) {
    console.error('Vote save error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to save vote.'
    });
  }
}

app.get('/api/public/session/:sessionId/players', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data, error } = await listSessionRsvps(sessionId);

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    return res.json({
      success: true,
      session: serializeSession(data.session),
      players: data.rows.map((rsvp) => ({
        id: rsvp.id,
        kind: rsvp.kind,
        addedBy: rsvp.addedBy ? {
          displayName: rsvp.addedBy.display_name
        } : null,
        status: rsvp.status,
        paymentStatus: rsvp.paymentStatus,
        paymentAmountDue: rsvp.paymentAmountDue,
        paymentAmountPaid: rsvp.paymentAmountPaid,
        finalPaymentStatus: rsvp.finalPaymentStatus,
        finalPaymentAmountDue: rsvp.finalPaymentAmountDue,
        finalPaymentAmountPaid: rsvp.finalPaymentAmountPaid,
        createdAt: rsvp.createdAt,
        user: {
          id: rsvp.kind === 'member' ? rsvp.user.id : null,
          displayName: rsvp.user.display_name,
          profileImageUrl: rsvp.user.profile_image_url
        }
      }))
    });
  } catch (error) {
    console.error('Public players list error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load players.'
    });
  }
});

app.get('/api/session/:sessionId/votes', async (req, res) => {
  return handleVoteOptionsRequest(req, res, req.params.sessionId);
});

app.post('/api/session/:sessionId/votes', async (req, res) => {
  return handleVoteSubmitRequest(req, res, req.params.sessionId);
});

app.get('/api/events/:eventId/vote-options', async (req, res) => {
  return handleVoteOptionsRequest(req, res, req.params.eventId);
});

app.get('/api/events/:eventId/my-votes', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { lineUid } = req.query;

    if (!lineUid) {
      return res.status(401).json({
        success: false,
        message: 'LINE login required.'
      });
    }

    const context = await buildVoteContext(eventId, lineUid);
    if (context.error || !context.data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    return res.json({
      success: true,
      myVotes: context.data.myVotes || [],
      voteProgress: context.data.voteProgress || 0,
      totalCategories: VOTING_CATEGORIES.length
    });
  } catch (error) {
    console.error('My votes load error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load your votes.'
    });
  }
});

app.post('/api/events/:eventId/vote', async (req, res) => {
  return handleVoteSubmitRequest(req, res, req.params.eventId);
});

app.get('/api/session/:sessionId/export.csv', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data, error } = await listSessionRsvps(sessionId);

    if (error || !data) {
      return res.status(404).send('Session not found.');
    }

    const rows = [
      ['Event', 'Type', 'Display Name', 'Added By', 'Phone', 'LINE UID', 'Status', 'Payment Status', 'Amount Due', 'Amount Paid', 'RSVP Time'],
      ...data.rows.map((rsvp) => [
        data.session.title,
        rsvp.kind === 'guest' ? 'Guest' : 'Member',
        rsvp.user.display_name,
        rsvp.addedBy?.display_name || '',
        rsvp.user.phone,
        rsvp.user.line_uid,
        rsvp.status,
        rsvp.paymentStatus,
        rsvp.paymentAmountDue,
        rsvp.paymentAmountPaid,
        rsvp.createdAt
      ])
    ];
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const filename = `${data.session.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'rsvps'}-rsvps.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);

    return res.status(500).send('Unable to export CSV.');
  }
});

app.post('/api/rsvp', async (req, res) => {
  try {
    const { lineUid, sessionId, displayName, profileImageUrl, phone } = req.body;
    const guestNames = Array.isArray(req.body.guestNames)
      ? req.body.guestNames.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 10)
      : [];

    if (!lineUid || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'lineUid and sessionId are required.'
      });
    }

    const user = await upsertLineUser({
      lineUid,
      displayName,
      phone,
      profileImageUrl
    });

    const { data: session, error: sessionError } = await findSession(sessionId);

    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: existingRsvp, error: existingRsvpError } = await supabase
      .from('rsvps')
      .select('status')
      .eq('session_id', session.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingRsvpError) {
      throw existingRsvpError;
    }

    if (existingRsvp) {
      return res.json({
        success: true,
        status: existingRsvp.status,
        message: existingRsvp.status === 'Joined'
          ? 'You are already confirmed!'
          : 'You are already on the waitlist.'
      });
    }

    if (depositAmountPerSeat(session) > 0) {
      return res.status(402).json({
        success: false,
        paymentRequired: true,
        message: 'Payment slip is required before joining this event.'
      });
    }

    const reservation = await reserveSessionRsvp({
      sessionId: session.id,
      userId: user.id,
      guestNames
    });

    if (reservation.alreadyExists) {
      return res.json({
        success: true,
        status: reservation.status,
        message: reservation.status === 'Joined'
          ? 'You are already confirmed!'
          : 'You are already on the waitlist.'
      });
    }

    const status = reservation.status;
    const totalJoined = reservation.totalJoined;
    const totalWaitlist = reservation.totalWaitlist;
    const amountDue = calculatePaymentDue(session, totalJoined, 'deposit');
    const paymentStatus = amountDue > 0 ? 'Pending' : (totalJoined > 0 ? 'Paid' : 'Pending');

    const { error: paymentUpdateError } = await supabase
      .from('rsvps')
      .update({
        payment_status: paymentStatus,
        payment_amount_due: amountDue,
        payment_amount_paid: amountDue > 0 ? null : 0,
        payment_paid_at: amountDue > 0 ? null : new Date().toISOString()
      })
      .eq('id', reservation.id);

    if (paymentUpdateError) {
      throw paymentUpdateError;
    }

    return res.status(201).json({
      success: true,
      status,
      paymentStatus,
      amountDue,
      guestCount: reservation.guestCount,
      totalJoined,
      totalWaitlist,
      message: status === 'Joined'
        ? (reservation.guestCount > 0
          ? `Confirmed ${totalJoined} spot${totalJoined === 1 ? '' : 's'}${totalWaitlist > 0 ? `, ${totalWaitlist} on waitlist` : ''}.`
          : 'You are confirmed!')
        : 'You are on the waitlist.'
    });
  } catch (error) {
    console.error('RSVP error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to process RSVP.'
    });
  }
});

app.post('/api/rsvp/submit-payment', async (req, res) => {
  try {
    const {
      lineUid,
      sessionId,
      displayName,
      profileImageUrl,
      phone,
      amountPaid,
      payerName,
      note,
      slipFileName,
      slipMimeType,
      slipBase64,
      phase = 'deposit'
    } = req.body;
    const guestNames = Array.isArray(req.body.guestNames)
      ? req.body.guestNames.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 10)
      : [];

    if (!lineUid || !sessionId || !slipBase64) {
      return res.status(400).json({
        success: false,
        message: 'lineUid, sessionId, and slip image are required.'
      });
    }

    const user = await upsertLineUser({
      lineUid,
      displayName,
      phone,
      profileImageUrl
    });

    const { data: session, error: sessionError } = await findSession(sessionId);

    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: existingRsvp, error: existingRsvpError } = await supabase
      .from('rsvps')
      .select('id, status, payment_slip_path, payment_amount_due')
      .eq('session_id', session.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingRsvpError) throw existingRsvpError;

    let createdRsvp = existingRsvp;
    let guestRows = [];
    let status = existingRsvp?.status || null;
    let totalJoined = status === 'Joined' ? 1 : 0;
    let totalWaitlist = status === 'Waitlist' ? 1 : 0;

    if (!createdRsvp) {
      const reservation = await reserveSessionRsvp({
        sessionId: session.id,
        userId: user.id,
        guestNames
      });

      status = reservation.status;
      totalJoined = reservation.totalJoined;
      totalWaitlist = reservation.totalWaitlist;
      createdRsvp = {
        id: reservation.id,
        status: reservation.status,
        payment_slip_path: null
      };

      if (!reservation.alreadyExists) {
        guestRows = Array.from({ length: reservation.guestCount }, () => ({}));
      } else {
        const { count: joinedGuestCount, error: joinedGuestCountError } = await supabase
          .from('rsvp_guests')
          .select('id', { count: 'exact', head: true })
          .eq('rsvp_id', createdRsvp.id)
          .eq('status', 'Joined');

        if (joinedGuestCountError) throw joinedGuestCountError;

        const { count: waitlistGuestCount, error: waitlistGuestCountError } = await supabase
          .from('rsvp_guests')
          .select('id', { count: 'exact', head: true })
          .eq('rsvp_id', createdRsvp.id)
          .eq('status', 'Waitlist');

        if (waitlistGuestCountError) throw waitlistGuestCountError;

        totalJoined = (status === 'Joined' ? 1 : 0) + (joinedGuestCount || 0);
        totalWaitlist = (status === 'Waitlist' ? 1 : 0) + (waitlistGuestCount || 0);
        guestRows = Array.from({ length: (joinedGuestCount || 0) + (waitlistGuestCount || 0) }, () => ({}));
      }
    } else {
      const { count: joinedGuestCount, error: joinedGuestCountError } = await supabase
        .from('rsvp_guests')
        .select('id', { count: 'exact', head: true })
        .eq('rsvp_id', createdRsvp.id)
        .eq('status', 'Joined');

      if (joinedGuestCountError) throw joinedGuestCountError;

      const { count: waitlistGuestCount, error: waitlistGuestCountError } = await supabase
        .from('rsvp_guests')
        .select('id', { count: 'exact', head: true })
        .eq('rsvp_id', createdRsvp.id)
        .eq('status', 'Waitlist');

      if (waitlistGuestCountError) throw waitlistGuestCountError;

      totalJoined = (status === 'Joined' ? 1 : 0) + (joinedGuestCount || 0);
      totalWaitlist = (status === 'Waitlist' ? 1 : 0) + (waitlistGuestCount || 0);
    }

    const slip = await uploadPaymentSlip({
      sessionId: session.id,
      rsvpId: createdRsvp.id,
      slipBase64,
      slipMimeType,
      slipFileName,
      previousSlipPath: createdRsvp.payment_slip_path
    });

    const paidAmount = amountPaid === '' || amountPaid === null || amountPaid === undefined
      ? null
      : Number(amountPaid);
    const amountDue = calculatePaymentDue(session, totalJoined, 'deposit');

    const { data: updatedRsvp, error: updateError } = await supabase
      .from('rsvps')
      .update({
        payment_status: 'Submitted',
        payment_amount_due: amountDue,
        payment_amount_paid: Number.isFinite(paidAmount) ? paidAmount : amountDue,
        payment_slip_url: null,
        payment_slip_path: slip.storagePath,
        payment_slip_deleted: false,
        payment_note: note || null,
        payment_payer_name: payerName || user.display_name || null,
        payment_submitted_at: new Date().toISOString(),
        payment_paid_at: null
      })
      .eq('id', createdRsvp.id)
      .select('id, status, payment_status, payment_amount_due, payment_amount_paid, payment_slip_url, payment_slip_path, payment_submitted_at')
      .single();

    if (updateError) throw updateError;
    return res.status(existingRsvp ? 200 : 201).json({
      success: true,
      status: updatedRsvp.status,
      paymentStatus: updatedRsvp.payment_status,
      amountDue: updatedRsvp.payment_amount_due,
      amountPaid: updatedRsvp.payment_amount_paid,
      slipUrl: '',
      guestCount: guestRows.length,
      totalJoined,
      totalWaitlist,
      message: updatedRsvp.status === 'Joined'
        ? (totalWaitlist > 0
          ? `Payment submitted. Confirmed ${totalJoined} spot${totalJoined === 1 ? '' : 's'}, ${totalWaitlist} on waitlist.`
          : 'Payment submitted. You are confirmed!')
        : 'Payment submitted. You are on the waitlist.'
    });
  } catch (error) {
    console.error('RSVP payment submit error:', error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: publicPaymentError(error)
    });
  }
});

app.get('/api/payment', async (req, res) => {
  try {
    const { lineUid, sessionId } = req.query;

    if (!lineUid || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'lineUid and sessionId are required.'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) {
      return res.json({ success: true, payment: null });
    }

    const { data: session, error: sessionError } = await findSession(sessionId);
    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: rsvp, error: rsvpError } = await supabase
      .from('rsvps')
      .select('id, status, payment_status, payment_amount_due, payment_amount_paid, payment_slip_url, payment_slip_path, payment_note, payment_payer_name, payment_submitted_at, payment_paid_at, final_payment_status, final_payment_amount_due, final_payment_amount_paid, final_payment_slip_url, final_payment_slip_path, final_payment_note, final_payment_payer_name, final_payment_submitted_at, final_payment_paid_at')
      .eq('session_id', session.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (rsvpError) throw rsvpError;

    if (rsvp) {
      const { count: joinedGuestCount, error: guestCountError } = await supabase
        .from('rsvp_guests')
        .select('id', { count: 'exact', head: true })
        .eq('rsvp_id', rsvp.id)
        .eq('status', 'Joined');

      if (guestCountError) throw guestCountError;

      const joinedSeatCount = (rsvp.status === 'Joined' ? 1 : 0) + (joinedGuestCount || 0);
      const nextAmountDue = calculatePaymentDue(session, joinedSeatCount, 'deposit');
      const nextFinalAmountDue = calculatePaymentDue(session, joinedSeatCount, 'final');

      if (Number(rsvp.payment_amount_due || 0) !== nextAmountDue || Number(rsvp.final_payment_amount_due || 0) !== nextFinalAmountDue) {
        let nextPaymentStatus = rsvp.payment_status || 'Pending';
        const paidAmount = Number(rsvp.payment_amount_paid || 0);
        let nextFinalPaymentStatus = rsvp.final_payment_status || 'NotOpened';

        if (nextPaymentStatus === 'Paid' && paidAmount < nextAmountDue) {
          nextPaymentStatus = rsvp.payment_slip_path ? 'Submitted' : 'Pending';
        } else if (nextAmountDue <= 0 && nextPaymentStatus === 'Paid') {
          nextPaymentStatus = 'Pending';
        }

        if (nextFinalAmountDue > 0 && ['NotOpened', 'Paid'].includes(nextFinalPaymentStatus)) {
          nextFinalPaymentStatus = Number(rsvp.final_payment_amount_paid || 0) >= nextFinalAmountDue ? 'Paid' : 'Pending';
        }

        const { data: syncedRsvp, error: syncError } = await supabase
          .from('rsvps')
          .update({
            payment_amount_due: nextAmountDue,
            payment_status: nextPaymentStatus,
            payment_paid_at: nextPaymentStatus === 'Paid' ? rsvp.payment_paid_at : null,
            final_payment_amount_due: nextFinalAmountDue,
            final_payment_status: nextFinalPaymentStatus,
            final_payment_paid_at: nextFinalPaymentStatus === 'Paid' ? rsvp.final_payment_paid_at : null
          })
          .eq('id', rsvp.id)
          .select('id, status, payment_status, payment_amount_due, payment_amount_paid, payment_slip_url, payment_slip_path, payment_note, payment_payer_name, payment_submitted_at, payment_paid_at, final_payment_status, final_payment_amount_due, final_payment_amount_paid, final_payment_slip_url, final_payment_slip_path, final_payment_note, final_payment_payer_name, final_payment_submitted_at, final_payment_paid_at')
          .single();

        if (syncError) throw syncError;
        Object.assign(rsvp, syncedRsvp);
      }

    }

    return res.json({
      success: true,
      session: serializeSession(session),
      payment: rsvp ? {
        rsvpId: rsvp.id,
        rsvpStatus: rsvp.status,
        status: rsvp.payment_status || 'Pending',
        amountDue: rsvp.payment_amount_due || 0,
        amountPaid: rsvp.payment_amount_paid || null,
        slipUrl: '',
        note: rsvp.payment_note || '',
        payerName: rsvp.payment_payer_name || '',
        submittedAt: rsvp.payment_submitted_at,
        paidAt: rsvp.payment_paid_at,
        finalStatus: rsvp.final_payment_status || 'NotOpened',
        finalAmountDue: rsvp.final_payment_amount_due || 0,
        finalAmountPaid: rsvp.final_payment_amount_paid || null,
        finalSlipUrl: '',
        finalNote: rsvp.final_payment_note || '',
        finalPayerName: rsvp.final_payment_payer_name || '',
        finalSubmittedAt: rsvp.final_payment_submitted_at,
        finalPaidAt: rsvp.final_payment_paid_at
      } : null
    });
  } catch (error) {
    console.error('Payment load error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load payment.'
    });
  }
});

app.post('/api/payment/submit', async (req, res) => {
  try {
    const {
      lineUid,
      sessionId,
      amountPaid,
      payerName,
      note,
      slipFileName,
      slipMimeType,
      slipBase64,
      phase = 'deposit'
    } = req.body;

    if (!lineUid || !sessionId || !slipBase64) {
      return res.status(400).json({
        success: false,
        message: 'lineUid, sessionId, and slip image are required.'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, display_name')
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const { data: session, error: sessionError } = await findSession(sessionId);
    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: rsvp, error: rsvpError } = await supabase
      .from('rsvps')
      .select('id, payment_slip_path, final_payment_slip_path')
      .eq('session_id', session.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (rsvpError) throw rsvpError;
    if (!rsvp) {
      return res.status(404).json({
        success: false,
        message: 'RSVP not found.'
      });
    }

    const slip = await uploadPaymentSlip({
      sessionId: session.id,
      rsvpId: rsvp.id,
      slipBase64,
      slipMimeType,
      slipFileName,
      previousSlipPath: phase === 'final' ? rsvp.final_payment_slip_path : rsvp.payment_slip_path
    });

    const paidAmount = amountPaid === '' || amountPaid === null || amountPaid === undefined
      ? null
      : Number(amountPaid);

    const updatePayload = phase === 'final'
      ? {
        final_payment_status: 'Submitted',
        final_payment_amount_paid: Number.isFinite(paidAmount) ? paidAmount : null,
        final_payment_slip_url: null,
        final_payment_slip_path: slip.storagePath,
        final_payment_note: note || null,
        final_payment_payer_name: payerName || user.display_name || null,
        final_payment_submitted_at: new Date().toISOString()
      }
      : {
        payment_status: 'Submitted',
        payment_amount_paid: Number.isFinite(paidAmount) ? paidAmount : null,
        payment_slip_url: null,
        payment_slip_path: slip.storagePath,
        payment_slip_deleted: false,
        payment_note: note || null,
        payment_payer_name: payerName || user.display_name || null,
        payment_submitted_at: new Date().toISOString()
      };

    const { data: updatedRsvp, error: updateError } = await supabase
      .from('rsvps')
      .update(updatePayload)
      .eq('id', rsvp.id)
      .select('id, payment_status, payment_amount_due, payment_amount_paid, payment_slip_url, payment_slip_path, payment_submitted_at, final_payment_status, final_payment_amount_due, final_payment_amount_paid, final_payment_slip_url, final_payment_slip_path, final_payment_submitted_at')
      .single();

    if (updateError) throw updateError;
    return res.json({
      success: true,
      payment: {
        rsvpId: updatedRsvp.id,
        phase,
        status: phase === 'final' ? updatedRsvp.final_payment_status : updatedRsvp.payment_status,
        amountDue: phase === 'final' ? updatedRsvp.final_payment_amount_due : updatedRsvp.payment_amount_due,
        amountPaid: phase === 'final' ? updatedRsvp.final_payment_amount_paid : updatedRsvp.payment_amount_paid,
        slipUrl: '',
        submittedAt: phase === 'final' ? updatedRsvp.final_payment_submitted_at : updatedRsvp.payment_submitted_at
      },
      message: 'Payment submitted.'
    });
  } catch (error) {
    console.error('Payment submit error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: publicPaymentError(error)
    });
  }
});

app.patch('/api/session/:sessionId/rsvps/:rsvpId/payment', requireAdmin, async (req, res) => {
  try {
    const { sessionId, rsvpId } = req.params;
    const { status, amountPaid } = req.body;
    const allowedStatuses = ['Pending', 'Submitted', 'Paid'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status.'
      });
    }

    const { data: session, error: sessionError } = await findSession(sessionId);
    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: existingRsvp, error: existingRsvpError } = await supabase
      .from('rsvps')
      .select('id, payment_amount_due, payment_amount_paid')
      .eq('id', rsvpId)
      .eq('session_id', session.id)
      .maybeSingle();

    if (existingRsvpError) throw existingRsvpError;
    if (!existingRsvp) {
      return res.status(404).json({
        success: false,
        message: 'RSVP not found.'
      });
    }

    const parsedAmountPaid = amountPaid === '' || amountPaid === null || amountPaid === undefined
      ? null
      : Number(amountPaid);
    const nextAmountPaid = status === 'Paid'
      ? (Number.isFinite(parsedAmountPaid) ? parsedAmountPaid : Number(existingRsvp.payment_amount_paid || existingRsvp.payment_amount_due || 0))
      : (Number.isFinite(parsedAmountPaid) ? parsedAmountPaid : existingRsvp.payment_amount_paid);

    const { data: rsvp, error } = await supabase
      .from('rsvps')
      .update({
        payment_status: status,
        payment_amount_paid: nextAmountPaid,
        payment_paid_at: status === 'Paid' ? new Date().toISOString() : null
      })
      .eq('id', rsvpId)
      .eq('session_id', session.id)
      .select('id, payment_status, payment_amount_due, payment_amount_paid, payment_paid_at')
      .maybeSingle();

    if (error) throw error;
    if (!rsvp) {
      return res.status(404).json({
        success: false,
        message: 'RSVP not found.'
      });
    }

    return res.json({
      success: true,
      payment: {
        rsvpId: rsvp.id,
        status: rsvp.payment_status,
        amountDue: rsvp.payment_amount_due,
        amountPaid: rsvp.payment_amount_paid,
        paidAt: rsvp.payment_paid_at
      },
      message: 'Payment updated.'
    });
  } catch (error) {
    console.error('Payment status update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to update payment.'
    });
  }
});

app.patch('/api/session/:sessionId/rsvps/:rsvpId/final-payment', requireAdmin, async (req, res) => {
  try {
    const { sessionId, rsvpId } = req.params;
    const { status, amountPaid } = req.body;

    const { data: session, error: sessionError } = await findSession(sessionId);
    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const rsvp = await updateFinalPaymentStatus({
      sessionId: session.id,
      rsvpId,
      status,
      amountPaid
    });

    return res.json({
      success: true,
      payment: {
        rsvpId: rsvp.id,
        status: rsvp.final_payment_status,
        amountDue: rsvp.final_payment_amount_due,
        amountPaid: rsvp.final_payment_amount_paid,
        paidAt: rsvp.final_payment_paid_at
      },
      message: 'Final payment updated.'
    });
  } catch (error) {
    console.error('Final payment status update error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Unable to update final payment.'
    });
  }
});

app.get('/api/host/sessions', async (req, res) => {
  try {
    const { lineUid } = req.query;
    const user = await getUserByLineUid(lineUid);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Host login required.'
      });
    }

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(sessionSelect)
      .eq('created_by_user_id', user.id)
      .neq('status', 'Cancelled')
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    const summaries = await Promise.all(
      (sessions || []).map(async (session) => {
        const summary = await getSessionSummary(session.id, lineUid);
        return {
          ...serializeSession(session),
          ...(summary.data || {}),
          isEnded: isSessionEnded(session)
        };
      })
    );

    return res.json({
      success: true,
      sessions: summaries
    });
  } catch (error) {
    console.error('Host sessions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load hosted events.'
    });
  }
});

app.get('/api/host/session/:sessionId/rsvps', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { lineUid } = req.query;
    const { session } = await requireSessionHost({ lineUid, sessionId });
    const { data, error } = await listSessionRsvps(session.id);

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    return res.json({
      success: true,
      session: {
        ...serializeSession(session),
        joinedCount: data.rows.filter((row) => row.status === 'Joined').length,
        waitlistCount: data.rows.filter((row) => row.status === 'Waitlist').length
      },
      rsvps: data.rows
    });
  } catch (error) {
    console.error('Host RSVP list error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Unable to load event RSVPs.'
    });
  }
});

app.patch('/api/host/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { lineUid } = req.body;
    const { session } = await requireSessionHost({ lineUid, sessionId });
    const { data: sessionPayload, error: payloadError } = parseSessionPayload(req.body);

    if (payloadError) {
      return res.status(400).json({
        success: false,
        message: payloadError
      });
    }

    const { data: updatedSession, error } = await supabase
      .from('sessions')
      .update({
        ...sessionPayload,
        status: session.status || 'Published'
      })
      .eq('id', session.id)
      .select(sessionSelect)
      .single();

    if (error) throw error;

    await listSessionRsvps(updatedSession.id);

    return res.json({
      success: true,
      session: serializeSession(updatedSession),
      message: 'Event updated.'
    });
  } catch (error) {
    console.error('Host session update error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Unable to update event.'
    });
  }
});

app.patch('/api/host/session/:sessionId/rsvps/:rsvpId/payment', async (req, res) => {
  try {
    const { sessionId, rsvpId } = req.params;
    const { lineUid, status, amountPaid } = req.body;
    const { session } = await requireSessionHost({ lineUid, sessionId });
    const rsvp = await updatePaymentStatus({
      sessionId: session.id,
      rsvpId,
      status,
      amountPaid
    });

    return res.json({
      success: true,
      payment: {
        rsvpId: rsvp.id,
        status: rsvp.payment_status,
        amountDue: rsvp.payment_amount_due,
        amountPaid: rsvp.payment_amount_paid,
        paidAt: rsvp.payment_paid_at
      },
      message: 'Payment updated.'
    });
  } catch (error) {
    console.error('Host payment status update error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Unable to update payment.'
    });
  }
});

app.patch('/api/host/session/:sessionId/rsvps/:rsvpId/final-payment', async (req, res) => {
  try {
    const { sessionId, rsvpId } = req.params;
    const { lineUid, status, amountPaid } = req.body;
    const { session } = await requireSessionHost({ lineUid, sessionId });
    const rsvp = await updateFinalPaymentStatus({
      sessionId: session.id,
      rsvpId,
      status,
      amountPaid
    });

    return res.json({
      success: true,
      payment: {
        rsvpId: rsvp.id,
        status: rsvp.final_payment_status,
        amountDue: rsvp.final_payment_amount_due,
        amountPaid: rsvp.final_payment_amount_paid,
        paidAt: rsvp.final_payment_paid_at
      },
      message: 'Final payment updated.'
    });
  } catch (error) {
    console.error('Host final payment status update error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Unable to update final payment.'
    });
  }
});

app.delete('/api/rsvp', async (req, res) => {
  try {
    const { lineUid, sessionId } = req.body;

    if (!lineUid || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'lineUid and sessionId are required.'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'RSVP not found.'
      });
    }

    const { data: session, error: sessionError } = await findSession(sessionId);

    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.'
      });
    }

    const { data: existingRsvp, error: existingRsvpError } = await supabase
      .from('rsvps')
      .select('id, status, payment_slip_path')
      .eq('session_id', session.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingRsvpError) {
      throw existingRsvpError;
    }

    if (!existingRsvp) {
      return res.status(404).json({
        success: false,
        message: 'RSVP not found.'
      });
    }

    const { error: guestDeleteError } = await supabase
      .from('rsvp_guests')
      .delete()
      .eq('rsvp_id', existingRsvp.id);

    if (guestDeleteError) {
      throw guestDeleteError;
    }

    if (existingRsvp.payment_slip_path) {
      await supabase.storage.from(paymentSlipBucket).remove([existingRsvp.payment_slip_path]);
    }

    const { error: voteDeleteError } = await supabase
      .from('event_player_votes')
      .delete()
      .eq('session_id', session.id)
      .or(`voter_user_id.eq.${user.id},voted_user_id.eq.${user.id}`);

    if (voteDeleteError && voteDeleteError.code !== '42P01') {
      throw voteDeleteError;
    }

    const { error: rankingVoteDeleteError } = await supabase
      .from('ranking_votes')
      .delete()
      .eq('event_id', session.id)
      .or(`voter_line_uid.eq.${user.line_uid},nominee_line_uid.eq.${user.line_uid}`);

    if (rankingVoteDeleteError && rankingVoteDeleteError.code !== '42P01') {
      throw rankingVoteDeleteError;
    }

    const { error: deleteError } = await supabase
      .from('rsvps')
      .delete()
      .eq('id', existingRsvp.id);

    if (deleteError) {
      throw deleteError;
    }

    const { promoted, error: promoteError } = await promoteWaitlist(session.id);
    if (promoteError) {
      throw promoteError;
    }

    return res.json({
      success: true,
      previousStatus: existingRsvp.status,
      promoted,
      message: 'Your RSVP has been cancelled.'
    });
  } catch (error) {
    console.error('Cancel RSVP error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to cancel RSVP.'
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`GDSQ Pickleball API running on http://localhost:${PORT}`);
});
