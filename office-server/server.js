const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { run, get, all, RECORDINGS_BASE_DIR } = require('./db');
const { startDiscoveryServer, getLocalIpAddresses } = require('./discovery');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Server-Sent Events (SSE) clients for real-time dashboard updates
const sseClients = new Set();
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastEvent(type, data) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// Multer storage: upload to temp dir first, then move to structured complaint directory
const uploadDir = path.join(RECORDINGS_BASE_DIR, '_temp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e5);
    cb(null, `${unique}-${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// 1. Health check & Server Info
app.get('/api/ping', (req, res) => {
  res.json({
    status: 'ok',
    server: 'FRT Office Server',
    version: '1.0.0',
    localIps: getLocalIpAddresses(),
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// 2. Upload Recording + Metadata
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const {
      complaint_no,
      call_target = 'CONSUMER',
      phone_number,
      contact_name = '',
      operator_name = 'Unknown Operator',
      operator_id = '',
      call_time = new Date().toISOString(),
      duration_seconds = 0,
      call_outcome = '',
      actual_problem = '',
      operator_notes = '',
      consumer_satisfaction = '',
      consumer_name = '',
      area = '',
      substation = '',
      feeder = '',
      complaint_type = '',
      complaint_date = '',
    } = req.body;

    if (!complaint_no || !phone_number) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'complaint_no and phone_number are required' });
    }

    const cleanPhone = phone_number.replace(/\D/g, '').slice(-10);
    const durSec = parseInt(duration_seconds, 10) || 0;

    // Check for duplicate upload (same complaint_no, same phone, same file size or close duration)
    const existingDuplicate = await get(
      `SELECT * FROM call_recordings 
       WHERE complaint_no = ? 
         AND (phone_number = ? OR phone_number LIKE ?)
         AND file_size_bytes = ? 
         AND (ABS(duration_seconds - ?) <= 2 OR duration_seconds = ?)
       ORDER BY id DESC LIMIT 1`,
      [complaint_no, phone_number, `%${cleanPhone}`, file.size, durSec, durSec]
    );

    if (existingDuplicate) {
      console.log(`[Upload] Duplicate recording ignored for complaint ${complaint_no} (existing recording id: ${existingDuplicate.id}, size: ${file.size} bytes)`);
      if (fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (_) {}
      }

      // If new upload carries satisfaction or notes that the existing record lacked, update it!
      const newSat = (consumer_satisfaction || '').trim().toUpperCase();
      const newNotes = (operator_notes || '').trim();
      let updated = false;

      if (newSat && (!existingDuplicate.consumer_satisfaction || existingDuplicate.consumer_satisfaction === '')) {
        await run(`UPDATE call_recordings SET consumer_satisfaction = ? WHERE id = ?`, [newSat, existingDuplicate.id]);
        existingDuplicate.consumer_satisfaction = newSat;
        updated = true;
      }
      if (newNotes && (!existingDuplicate.operator_notes || existingDuplicate.operator_notes === '')) {
        await run(`UPDATE call_recordings SET operator_notes = ? WHERE id = ?`, [newNotes, existingDuplicate.id]);
        existingDuplicate.operator_notes = newNotes;
        updated = true;
      }

      if (updated) {
        broadcastEvent('update_recording', existingDuplicate);
      }

      return res.status(200).json({
        success: true,
        message: 'Recording already received (duplicate ignored)',
        isDuplicate: true,
        recording: existingDuplicate,
      });
    }

    // Determine target directory: D:\FRT_Recordings\YYYY-MM-DD\Complaint_<complaint_no>\
    const dateObj = new Date(call_time);
    const dateFolder = isNaN(dateObj.getTime())
      ? new Date().toISOString().slice(0, 10)
      : dateObj.toISOString().slice(0, 10);

    const safeComplaint = complaint_no.replace(/[^a-zA-Z0-9_-]/g, '_');
    const complaintDir = path.join(RECORDINGS_BASE_DIR, dateFolder, `Complaint_${safeComplaint}`);
    if (!fs.existsSync(complaintDir)) {
      fs.mkdirSync(complaintDir, { recursive: true });
    }

    // Determine sequence index for multiple calls in the same complaint
    const existingCalls = await all(
      'SELECT COUNT(*) as count FROM call_recordings WHERE complaint_no = ?',
      [complaint_no]
    );
    const callIndex = (existingCalls[0]?.count || 0) + 1;

    // Clean destination filename
    const cleanOp = operator_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timeTag = dateObj.toTimeString().slice(0, 8).replace(/:/g, '');
    const finalFileName = `${String(callIndex).padStart(2, '0')}_${call_target}_${cleanPhone}_${timeTag}_${cleanOp}.mp3`;
    const finalFilePath = path.join(complaintDir, finalFileName);

    // Move file from temp to final destination
    fs.renameSync(file.path, finalFilePath);

    // Upsert complaint metadata
    await run(
      `
      INSERT INTO complaints_meta (
        complaint_no, consumer_name, consumer_phone, area, substation, feeder, complaint_type, complaint_date, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(complaint_no) DO UPDATE SET
        consumer_name = COALESCE(NULLIF(excluded.consumer_name, ''), complaints_meta.consumer_name),
        area = COALESCE(NULLIF(excluded.area, ''), complaints_meta.area),
        substation = COALESCE(NULLIF(excluded.substation, ''), complaints_meta.substation),
        feeder = COALESCE(NULLIF(excluded.feeder, ''), complaints_meta.feeder),
        complaint_type = COALESCE(NULLIF(excluded.complaint_type, ''), complaints_meta.complaint_type),
        last_activity_at = CURRENT_TIMESTAMP
    `,
      [
        complaint_no,
        consumer_name || contact_name,
        phone_number,
        area,
        substation,
        feeder,
        complaint_type,
        complaint_date || dateFolder,
      ]
    );

    // Insert call recording entry
    const insertRes = await run(
      `
      INSERT INTO call_recordings (
        complaint_no, call_target, phone_number, contact_name, operator_name, operator_id,
        call_time, duration_seconds, file_path, file_name, file_size_bytes,
        call_outcome, actual_problem, operator_notes, consumer_satisfaction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        complaint_no,
        call_target.toUpperCase(),
        phone_number,
        contact_name || consumer_name,
        operator_name,
        operator_id,
        call_time,
        parseInt(duration_seconds, 10) || 0,
        finalFilePath,
        finalFileName,
        file.size,
        call_outcome,
        actual_problem,
        operator_notes,
        (consumer_satisfaction || '').toUpperCase(),
      ]
    );

    const recordingRecord = {
      id: insertRes.lastID,
      complaint_no,
      call_target,
      phone_number,
      contact_name,
      operator_name,
      call_time,
      duration_seconds: parseInt(duration_seconds, 10) || 0,
      file_name: finalFileName,
      call_outcome,
      actual_problem,
      operator_notes,
      consumer_satisfaction: (consumer_satisfaction || '').toUpperCase(),
    };

    console.log(`[Upload] Recording saved: ${finalFilePath} by ${operator_name}`);

    // Notify UI via SSE
    broadcastEvent('new_recording', recordingRecord);

    return res.status(200).json({
      success: true,
      message: 'Recording saved successfully',
      recording: recordingRecord,
    });
  } catch (err) {
    console.error('[Upload] Error processing recording upload:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Audio Stream with HTTP 206 Partial Content (Supports seeking in browser)
app.get('/api/recordings/:id/stream', async (req, res) => {
  try {
    const row = await get('SELECT file_path, file_name, file_size_bytes FROM call_recordings WHERE id = ?', [
      req.params.id,
    ]);
    if (!row || !fs.existsSync(row.file_path)) {
      return res.status(404).send('Audio file not found on disk');
    }

    const filePath = row.file_path;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[Stream] Error streaming audio:', err);
    res.status(500).send('Error streaming audio');
  }
});

// 4. Download Audio File
app.get('/api/recordings/:id/download', async (req, res) => {
  try {
    const row = await get('SELECT file_path, file_name FROM call_recordings WHERE id = ?', [req.params.id]);
    if (!row || !fs.existsSync(row.file_path)) {
      return res.status(404).send('Audio file not found');
    }
    res.download(row.file_path, row.file_name);
  } catch (err) {
    res.status(500).send('Error downloading audio');
  }
});

// Delete recording from disk and DB
app.delete('/api/recordings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await get('SELECT * FROM call_recordings WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (fs.existsSync(row.file_path)) {
      try {
        fs.unlinkSync(row.file_path);
        const dir = path.dirname(row.file_path);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch (err) {
        console.error('[Delete] Failed to delete file on disk:', err);
      }
    }

    await run('DELETE FROM call_recordings WHERE id = ?', [id]);

    const remaining = await get('SELECT COUNT(*) as count FROM call_recordings WHERE complaint_no = ?', [row.complaint_no]);
    if (!remaining || remaining.count === 0) {
      await run('DELETE FROM complaints_meta WHERE complaint_no = ?', [row.complaint_no]);
    }

    broadcastEvent('deleted_recording', { id, complaint_no: row.complaint_no });
    res.json({ success: true, message: 'Recording deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete entire complaint and its recordings
app.delete('/api/complaints/:complaint_no', async (req, res) => {
  try {
    const { complaint_no } = req.params;
    const records = await all('SELECT file_path FROM call_recordings WHERE complaint_no = ?', [complaint_no]);
    
    for (const r of records) {
      if (fs.existsSync(r.file_path)) {
        try {
          fs.unlinkSync(r.file_path);
          const dir = path.dirname(r.file_path);
          if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
          }
        } catch (_) {}
      }
    }

    await run('DELETE FROM call_recordings WHERE complaint_no = ?', [complaint_no]);
    await run('DELETE FROM complaints_meta WHERE complaint_no = ?', [complaint_no]);

    broadcastEvent('deleted_complaint', { complaint_no });
    res.json({ success: true, message: 'Complaint and all its recordings deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update satisfaction for a complaint (e.g. from Follow-up tab: UNSATISFIED -> SATISFIED)
app.post('/api/complaints/:complaint_no/satisfaction', async (req, res) => {
  try {
    const { complaint_no } = req.params;
    const { satisfaction, notes = '', operator_name = 'Operator' } = req.body;
    if (!satisfaction) {
      return res.status(400).json({ error: 'satisfaction is required' });
    }

    const satUpper = satisfaction.trim().toUpperCase();

    // Update the latest recording for this complaint
    const latestRec = await get(
      'SELECT id, file_path, file_name, consumer_satisfaction, operator_notes FROM call_recordings WHERE complaint_no = ? ORDER BY call_time DESC, id DESC LIMIT 1',
      [complaint_no]
    );

    if (latestRec) {
      const updatedNotes = notes
        ? (latestRec.operator_notes ? `${latestRec.operator_notes} · [Follow-up] ${notes}` : `[Follow-up] ${notes}`)
        : latestRec.operator_notes;
      await run(
        'UPDATE call_recordings SET consumer_satisfaction = ?, operator_notes = ? WHERE id = ?',
        [satUpper, updatedNotes, latestRec.id]
      );
      broadcastEvent('update_recording', {
        id: latestRec.id,
        complaint_no,
        consumer_satisfaction: satUpper,
        operator_notes: updatedNotes,
      });
    }

    await run(
      'UPDATE complaints_meta SET last_activity_at = CURRENT_TIMESTAMP WHERE complaint_no = ?',
      [complaint_no]
    );

    console.log(`[Follow-up] Complaint ${complaint_no} marked as ${satUpper} by ${operator_name}`);
    res.json({ success: true, message: `Complaint marked as ${satUpper}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Query Complaints Thread View (1 Complaint -> All its recordings)
app.get('/api/complaints', async (req, res) => {
  try {
    const { 
      search = '', 
      operator = '', 
      date = '', 
      month = '', 
      substation = '', 
      outcome = '', 
      target = '', 
      satisfaction = '',
      page = 1, 
      limit = 50 
    } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search.trim()) {
      whereClause += ` AND (
        c.complaint_no LIKE ? OR 
        c.consumer_phone LIKE ? OR 
        c.consumer_name LIKE ? OR 
        r.phone_number LIKE ?
      )`;
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    if (operator.trim()) {
      whereClause += ` AND r.operator_name = ?`;
      params.push(operator.trim());
    }

    if (date.trim()) {
      whereClause += ` AND date(r.call_time) = date(?)`;
      params.push(date.trim());
    } else if (month.trim()) {
      whereClause += ` AND strftime('%Y-%m', r.call_time) = ?`;
      params.push(month.trim());
    }

    if (substation.trim()) {
      whereClause += ` AND (c.substation = ? OR c.area = ?)`;
      params.push(substation.trim(), substation.trim());
    }

    if (outcome.trim()) {
      whereClause += ` AND r.call_outcome = ?`;
      params.push(outcome.trim());
    }

    if (target.trim()) {
      whereClause += ` AND r.call_target = ?`;
      params.push(target.trim().toUpperCase());
    }

    if (satisfaction.trim()) {
      whereClause += ` AND r.id = (
        SELECT r2.id FROM call_recordings r2 
        WHERE r2.complaint_no = c.complaint_no 
        ORDER BY r2.call_time DESC, r2.id DESC LIMIT 1
      ) AND r.consumer_satisfaction = ?`;
      params.push(satisfaction.trim().toUpperCase());
    }

    // Get matching complaint numbers
    const complaintsQuery = `
      SELECT DISTINCT c.complaint_no, c.consumer_name, c.consumer_phone, c.area, c.substation, c.feeder, c.complaint_type, c.last_activity_at
      FROM complaints_meta c
      JOIN call_recordings r ON c.complaint_no = r.complaint_no
      ${whereClause}
      ORDER BY c.last_activity_at DESC
      LIMIT ? OFFSET ?
    `;

    const complaintList = await all(complaintsQuery, [...params, parseInt(limit, 10), offset]);

    // For each complaint, attach all its recordings in chronological order
    const result = [];
    for (const comp of complaintList) {
      let recQuery = `SELECT id, call_target, phone_number, contact_name, operator_name, call_time, duration_seconds, file_name, file_size_bytes, call_outcome, actual_problem, operator_notes, consumer_satisfaction
         FROM call_recordings
         WHERE complaint_no = ?`;
      const recParams = [comp.complaint_no];

      if (target.trim()) {
        recQuery += ` AND call_target = ?`;
        recParams.push(target.trim().toUpperCase());
      }
      if (satisfaction.trim()) {
        recQuery += ` AND consumer_satisfaction = ?`;
        recParams.push(satisfaction.trim().toUpperCase());
      }
      recQuery += ` ORDER BY call_time ASC`;

      const recordings = await all(recQuery, recParams);
      if (recordings.length > 0) {
        result.push({
          ...comp,
          recordings,
        });
      }
    }

    // Total count for pagination
    const countRow = await get(
      `SELECT COUNT(DISTINCT c.complaint_no) as total
       FROM complaints_meta c
       JOIN call_recordings r ON c.complaint_no = r.complaint_no
       ${whereClause}`,
      params
    );

    res.json({
      complaints: result,
      total: countRow?.total || 0,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    console.error('[API] Error fetching complaints thread:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Stats & Overview
app.get('/api/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const todayStats = await get(
      `SELECT 
        COUNT(id) as total_calls_today,
        COUNT(DISTINCT complaint_no) as total_complaints_today,
        COALESCE(SUM(duration_seconds), 0) as total_duration_today,
        COALESCE(SUM(file_size_bytes), 0) as total_bytes_today
       FROM call_recordings
       WHERE date(call_time) = date(?)`,
      [today]
    );

    const operatorBreakdown = await all(
      `SELECT operator_name, COUNT(id) as call_count, SUM(duration_seconds) as total_duration
       FROM call_recordings
       WHERE date(call_time) = date(?)
       GROUP BY operator_name`,
      [today]
    );

    const allTimeStats = await get(
      `SELECT COUNT(id) as total_calls, COUNT(DISTINCT complaint_no) as total_complaints, SUM(file_size_bytes) as total_bytes FROM call_recordings`
    );

    res.json({
      today: {
        date: today,
        calls: todayStats.total_calls_today,
        complaints: todayStats.total_complaints_today,
        durationMinutes: Math.round((todayStats.total_duration_today || 0) / 60),
        storageMB: ((todayStats.total_bytes_today || 0) / (1024 * 1024)).toFixed(2),
      },
      allTime: {
        totalCalls: allTimeStats.total_calls,
        totalComplaints: allTimeStats.total_complaints,
        totalStorageMB: ((allTimeStats.total_bytes || 0) / (1024 * 1024)).toFixed(2),
      },
      operators: operatorBreakdown,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Operators list
app.get('/api/operators', async (req, res) => {
  try {
    const rows = await all('SELECT DISTINCT operator_name FROM call_recordings ORDER BY operator_name ASC');
    res.json(rows.map((r) => r.operator_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Substations & Areas list for filtering
app.get('/api/substations', async (req, res) => {
  try {
    const rows = await all(`
      SELECT DISTINCT substation as name FROM complaints_meta WHERE substation IS NOT NULL AND trim(substation) != ''
      UNION
      SELECT DISTINCT area as name FROM complaints_meta WHERE area IS NOT NULL AND trim(area) != ''
      ORDER BY 1 ASC
    `);
    res.json(rows.map((r) => r.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Distinct Months available
app.get('/api/months', async (req, res) => {
  try {
    const rows = await all(`
      SELECT DISTINCT strftime('%Y-%m', call_time) as month
      FROM call_recordings
      WHERE call_time IS NOT NULL
      ORDER BY 1 DESC
    `);
    res.json(rows.map((r) => r.month).filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Export to CSV for Excel Reporting
app.get('/api/export/csv', async (req, res) => {
  try {
    const { date = '', month = '', operator = '', substation = '', satisfaction = '' } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (date.trim()) {
      where += ' AND date(r.call_time) = date(?)';
      params.push(date.trim());
    } else if (month.trim()) {
      where += " AND strftime('%Y-%m', r.call_time) = ?";
      params.push(month.trim());
    }
    if (operator.trim()) {
      where += ' AND r.operator_name = ?';
      params.push(operator.trim());
    }
    if (substation.trim()) {
      where += ' AND (c.substation = ? OR c.area = ?)';
      params.push(substation.trim(), substation.trim());
    }
    if (satisfaction.trim()) {
      where += ' AND r.consumer_satisfaction = ?';
      params.push(satisfaction.trim().toUpperCase());
    }

    const rows = await all(`
      SELECT 
        c.complaint_no, c.consumer_name, c.consumer_phone, c.substation, c.feeder, c.area, c.complaint_type,
        r.call_target, r.phone_number, r.contact_name, r.operator_name, r.call_time, r.duration_seconds,
        r.call_outcome, r.actual_problem, r.operator_notes, r.consumer_satisfaction, r.file_name
      FROM complaints_meta c
      JOIN call_recordings r ON c.complaint_no = r.complaint_no
      ${where}
      ORDER BY r.call_time DESC
    `, params);

    let csv = 'Complaint No,Consumer Name,Consumer Mobile,Substation,Feeder,Area,Complaint Type,Call Target,Dialed Phone,Operator Name,Call Time,Duration (sec),Outcome,Ground Problem,Notes,Consumer Feedback,Audio File\n';

    for (const r of rows) {
      const escape = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
      csv += [
        escape(r.complaint_no),
        escape(r.consumer_name),
        escape(r.consumer_phone),
        escape(r.substation),
        escape(r.feeder),
        escape(r.area),
        escape(r.complaint_type),
        escape(r.call_target),
        escape(r.phone_number),
        escape(r.operator_name),
        escape(r.call_time),
        r.duration_seconds || 0,
        escape(r.call_outcome),
        escape(r.actual_problem),
        escape(r.operator_notes),
        escape(r.consumer_satisfaction || 'NOT MARKED'),
        escape(r.file_name),
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=FRT_Recordings_Export_${date || month || 'all'}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Error exporting CSV: ' + err.message);
  }
});

// Start Server & Auto-Discovery
app.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIpAddresses();
  console.log(`=======================================================`);
  console.log(`  FRT Barabanki - Office Call Recording Server RUNNING `);
  console.log(`=======================================================`);
  console.log(` Local UI URL:      http://localhost:${PORT}`);
  console.log(` Wi-Fi / LAN URL:   http://${localIps[0] || '127.0.0.1'}:${PORT}`);
  console.log(` Storage Path:      ${RECORDINGS_BASE_DIR}`);
  console.log(`=======================================================`);

  // Start the UDP beacon on 41234
  startDiscoveryServer(PORT);
});
