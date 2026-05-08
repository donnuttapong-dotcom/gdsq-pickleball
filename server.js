const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeCsvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function findSession(sessionId) {
  const sessionIdText = String(sessionId);

  if (uuidPattern.test(sessionIdText)) {
    return supabase
      .from('sessions')
      .select('id, title, max_players, created_at')
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
      .select('id, title, max_players, created_at')
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
      id: session.id,
      title: session.title,
      maxPlayers: session.max_players,
      joinedCount: joinedCount || 0,
      waitlistCount: waitlistCount || 0,
      spotsLeft: Math.max(session.max_players - (joinedCount || 0), 0),
      userStatus
    },
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

app.get('/api/sessions', async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('id, title, max_players, created_at')
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

app.post('/api/sessions', async (req, res) => {
  try {
    const { title, maxPlayers } = req.body;
    const parsedMaxPlayers = Number(maxPlayers);

    if (!title || !Number.isInteger(parsedMaxPlayers) || parsedMaxPlayers <= 0) {
      return res.status(400).json({
        success: false,
        message: 'title and a positive maxPlayers value are required.'
      });
    }

    const { data: session, error } = await supabase
      .from('sessions')
      .insert({
        title,
        max_players: parsedMaxPlayers
      })
      .select('id, title, max_players, created_at')
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      session,
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

app.get('/api/session/:sessionId/rsvps', async (req, res) => {
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
      session: {
        id: data.session.id,
        title: data.session.title,
        maxPlayers: data.session.max_players
      },
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

app.get('/api/session/:sessionId/export.csv', async (req, res) => {
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
