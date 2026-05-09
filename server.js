const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const adminPassword = process.env.ADMIN_PASSWORD;
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || supabaseKey;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const adminCookieName = 'gdsq_admin_session';
const sessionSelect = 'id, title, max_players, event_date, start_time, end_time, price_thb, location, address, skill_level, description, poster_url, created_at';

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

function serializeSession(session) {
  return {
    id: session.id,
    title: session.title,
    maxPlayers: session.max_players,
    eventDate: session.event_date,
    startTime: session.start_time,
    endTime: session.end_time,
    priceThb: session.price_thb,
    location: session.location,
    address: session.address,
    skillLevel: session.skill_level,
    description: session.description,
    posterUrl: session.poster_url,
    createdAt: session.created_at
  };
}

function parseSessionPayload(body) {
  const parsedMaxPlayers = Number(body.maxPlayers);
  const parsedPriceThb = body.priceThb === '' || body.priceThb === null || body.priceThb === undefined
    ? null
    : Number(body.priceThb);

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

  return {
    data: {
      title: body.title,
      max_players: parsedMaxPlayers,
      event_date: body.eventDate || null,
      start_time: body.startTime || null,
      end_time: body.endTime || null,
      price_thb: parsedPriceThb,
      location: body.location || null,
      address: body.address || null,
      skill_level: body.skillLevel || null,
      description: body.description || null,
      poster_url: body.posterUrl || null
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
    .select('id, user_id, status, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });

  if (rsvpError) {
    return { data: null, error: rsvpError };
  }

  const userIds = [...new Set((rsvps || []).map((rsvp) => rsvp.user_id))];
  let usersById = {};

  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, line_uid, display_name')
      .in('id', userIds);

    if (usersError) {
      return { data: null, error: usersError };
    }

    usersById = Object.fromEntries((users || []).map((user) => [user.id, user]));
  }

  const rows = (rsvps || []).map((rsvp) => ({
    id: rsvp.id,
    status: rsvp.status,
    createdAt: rsvp.created_at,
    user: usersById[rsvp.user_id] || {
      id: rsvp.user_id,
      line_uid: '',
      display_name: 'Unknown user'
    }
  }));

  return {
    data: {
      session,
      rows
    },
    error: null
  };
}

async function getSessionSummary(sessionId, lineUid) {
  const { data: session, error: sessionError } = await findSession(sessionId);

  if (sessionError || !session) {
    return {
      data: null,
      error: sessionError || new Error('Session not found.')
    };
  }

  const { count: joinedCount, error: joinedCountError } = await supabase
    .from('rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
    .eq('status', 'Joined');

  if (joinedCountError) {
    return { data: null, error: joinedCountError };
  }

  const { count: waitlistCount, error: waitlistCountError } = await supabase
    .from('rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
    .eq('status', 'Waitlist');

  if (waitlistCountError) {
    return { data: null, error: waitlistCountError };
  }

  let userStatus = null;

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

  return {
    data: {
      ...serializeSession(session),
      joinedCount: joinedCount || 0,
      waitlistCount: waitlistCount || 0,
      spotsLeft: Math.max(session.max_players - (joinedCount || 0), 0),
      userStatus
    },
    error: null
  };
}

async function listPublicSessions(lineUid) {
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select(sessionSelect)
    .order('event_date', { ascending: true, nullsFirst: false })
    .order('start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  const summaries = await Promise.all(
    (sessions || []).map((session, index) => getSessionSummary(session.id, lineUid).then((summary) => ({
      index: index + 1,
      ...summary.data
    })))
  );

  return {
    data: summaries,
    error: null
  };
}

app.get('/api/config', (req, res) => {
  res.json({
    liffId: process.env.LINE_LIFF_ID || ''
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'gdsq-pickleball',
    status: 'ok'
  });
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

app.get('/api/sessions', requireAdmin, async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(sessionSelect)
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

app.get('/api/session/:sessionId/export.csv', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { data, error } = await listSessionRsvps(sessionId);

    if (error || !data) {
      return res.status(404).send('Session not found.');
    }

    const rows = [
      ['Event', 'Display Name', 'LINE UID', 'Status', 'RSVP Time'],
      ...data.rows.map((rsvp) => [
        data.session.title,
        rsvp.user.display_name,
        rsvp.user.line_uid,
        rsvp.status,
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
    const { lineUid, sessionId, displayName } = req.body;

    if (!lineUid || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'lineUid and sessionId are required.'
      });
    }

    const { data: existingUser, error: findUserError } = await supabase
      .from('users')
      .select('id')
      .eq('line_uid', lineUid)
      .maybeSingle();

    if (findUserError) {
      throw findUserError;
    }

    let user = existingUser;

    if (!user) {
      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          line_uid: lineUid,
          display_name: displayName || 'LINE User'
        })
        .select('id')
        .single();

      if (createUserError) {
        throw createUserError;
      }

      user = newUser;
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

    const { count: joinedCount, error: countError } = await supabase
      .from('rsvps')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session.id)
      .eq('status', 'Joined');

    if (countError) {
      throw countError;
    }

    const status = joinedCount < session.max_players ? 'Joined' : 'Waitlist';

    const { error: rsvpError } = await supabase
      .from('rsvps')
      .insert({
        session_id: session.id,
        user_id: user.id,
        status
      });

    if (rsvpError) {
      throw rsvpError;
    }

    return res.status(201).json({
      success: true,
      status,
      message: status === 'Joined'
        ? 'You are confirmed!'
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

    const { data: deletedRsvp, error: deleteError } = await supabase
      .from('rsvps')
      .delete()
      .eq('session_id', session.id)
      .eq('user_id', user.id)
      .select('id, status')
      .maybeSingle();

    if (deleteError) {
      throw deleteError;
    }

    if (!deletedRsvp) {
      return res.status(404).json({
        success: false,
        message: 'RSVP not found.'
      });
    }

    return res.json({
      success: true,
      previousStatus: deletedRsvp.status,
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
