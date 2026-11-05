// FRT Office Server — Frontend Application Logic

let activeAudio = null;
let activePlayBtn = null;

const state = {
  search: '',
  date: new Date().toISOString().slice(0, 10), // Default today
  month: '',
  substation: '',
  operator: '',
  outcome: '',
  target: '',
  satisfaction: '',
  page: 1,
};

document.addEventListener('DOMContentLoaded', () => {
  initDateFilter();
  loadStats();
  loadOperators();
  loadSubstations();
  loadMonths();
  loadComplaints();
  initSSE();
  setupEventListeners();
  checkServerInfo();
});

function initDateFilter() {
  const dateInput = document.getElementById('date-filter');
  if (dateInput) dateInput.value = state.date;
}

function checkServerInfo() {
  fetch('/api/ping')
    .then((r) => r.json())
    .then((data) => {
      const ipText = document.getElementById('server-ip-text');
      if (ipText && data.localIps && data.localIps.length > 0) {
        ipText.textContent = `${data.localIps[0]}:${data.port}`;
      }
    })
    .catch(() => {});
}

function setupEventListeners() {
  // Search input debounce
  let searchTimeout;
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      loadComplaints();
    }, 300);
  });

  // Date filter (clears month when specific date picked)
  document.getElementById('date-filter')?.addEventListener('change', (e) => {
    state.date = e.target.value;
    state.month = '';
    const mSelect = document.getElementById('month-filter');
    if (mSelect) mSelect.value = '';
    state.page = 1;
    updateQuickDateActive(state.date);
    loadComplaints();
  });

  // Month filter (clears specific date when month picked)
  document.getElementById('month-filter')?.addEventListener('change', (e) => {
    state.month = e.target.value;
    state.date = '';
    const dInput = document.getElementById('date-filter');
    if (dInput) dInput.value = '';
    state.page = 1;
    updateQuickDateActive('');
    loadComplaints();
  });

  // Substation filter
  document.getElementById('substation-filter')?.addEventListener('change', (e) => {
    state.substation = e.target.value;
    state.page = 1;
    loadComplaints();
  });

  // Operator filter
  document.getElementById('operator-filter')?.addEventListener('change', (e) => {
    state.operator = e.target.value;
    state.page = 1;
    loadComplaints();
  });

  // Outcome filter
  document.getElementById('outcome-filter')?.addEventListener('change', (e) => {
    state.outcome = e.target.value;
    state.page = 1;
    loadComplaints();
  });

  // Satisfaction filter
  document.getElementById('satisfaction-filter')?.addEventListener('change', (e) => {
    state.satisfaction = e.target.value;
    state.page = 1;
    loadComplaints();
  });

  // Target Filter Pills (All / Consumer / Crew)
  document.querySelectorAll('.target-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.target = btn.dataset.target || '';
      state.page = 1;

      document.querySelectorAll('.target-btn').forEach((b) => {
        if (b.dataset.target === state.target) {
          b.className = 'target-btn px-2.5 py-1 rounded-md bg-blue-600 text-white font-semibold transition';
        } else {
          b.className = 'target-btn px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
        }
      });
      loadComplaints();
    });
  });

  // Export to Excel / CSV
  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    const query = new URLSearchParams({
      date: state.date,
      month: state.month,
      operator: state.operator,
      substation: state.substation,
      satisfaction: state.satisfaction,
    });
    window.location.href = `/api/export/csv?${query.toString()}`;
  });

  // Refresh button
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    loadStats();
    loadOperators();
    loadSubstations();
    loadMonths();
    loadComplaints();
  });

  // Quick date buttons
  document.querySelectorAll('.quick-date-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      const today = new Date().toISOString().slice(0, 10);
      const currentMonth = today.slice(0, 7);

      if (range === 'today') {
        state.date = today;
        state.month = '';
      } else if (range === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        state.date = y.toISOString().slice(0, 10);
        state.month = '';
      } else if (range === 'this_month') {
        state.date = '';
        state.month = currentMonth;
      } else if (range === 'all') {
        state.date = '';
        state.month = '';
      }

      document.getElementById('date-filter').value = state.date;
      const mSelect = document.getElementById('month-filter');
      if (mSelect) mSelect.value = state.month;

      updateQuickDateActive(state.date, state.month);
      state.page = 1;
      loadComplaints();
    });
  });
}

function updateQuickDateActive(currentDate, currentMonth = '') {
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  document.querySelectorAll('.quick-date-btn').forEach((btn) => {
    const range = btn.dataset.range;
    let isActive = false;
    if (range === 'today' && currentDate === today) isActive = true;
    else if (range === 'yesterday' && currentDate === yesterday) isActive = true;
    else if (range === 'this_month' && currentMonth === thisMonth) isActive = true;
    else if (range === 'all' && !currentDate && !currentMonth) isActive = true;

    if (isActive) {
      btn.className = 'quick-date-btn px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition';
    } else {
      btn.className = 'quick-date-btn px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
    }
  });
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('stat-today-calls').textContent = data.today.calls;
    document.getElementById('stat-today-complaints').textContent = data.today.complaints;
    document.getElementById('stat-today-time').textContent = `${data.today.durationMinutes} min`;
    document.getElementById('stat-storage').textContent = `${data.today.storageMB} MB`;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadOperators() {
  try {
    const res = await fetch('/api/operators');
    const ops = await res.json();
    const select = document.getElementById('operator-filter');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">All Operators (24/7)</option>';
    ops.forEach((op) => {
      const opt = document.createElement('option');
      opt.value = op;
      opt.textContent = op;
      if (op === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load operators:', err);
  }
}

async function loadSubstations() {
  try {
    const res = await fetch('/api/substations');
    const subs = await res.json();
    const select = document.getElementById('substation-filter');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">All Substations</option>';
    subs.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load substations:', err);
  }
}

async function loadMonths() {
  try {
    const res = await fetch('/api/months');
    const months = await res.json();
    const select = document.getElementById('month-filter');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">Month: All</option>';

    // Add current month if not in list
    const currentMonth = new Date().toISOString().slice(0, 7);
    const allMonths = Array.from(new Set([currentMonth, ...months]));

    allMonths.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      // Format YYYY-MM to readable e.g. "Oct 2026"
      const d = new Date(m + '-01');
      opt.textContent = isNaN(d.getTime()) ? m : d.toLocaleDateString([], { month: 'short', year: 'numeric' });
      if (m === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load months:', err);
  }
}

async function loadComplaints() {
  const container = document.getElementById('complaints-container');
  const spinner = document.getElementById('loading-spinner');
  const emptyState = document.getElementById('empty-state');
  const totalCountSpan = document.getElementById('total-count');

  if (!container) return;

  spinner?.classList.remove('hidden');
  emptyState?.classList.add('hidden');
  container.innerHTML = '';

  try {
    const query = new URLSearchParams({
      search: state.search,
      date: state.date,
      month: state.month,
      substation: state.substation,
      operator: state.operator,
      outcome: state.outcome,
      target: state.target,
      satisfaction: state.satisfaction,
      page: state.page,
      limit: 50,
    });

    const res = await fetch(`/api/complaints?${query.toString()}`);
    const data = await res.json();
    spinner?.classList.add('hidden');

    if (totalCountSpan) totalCountSpan.textContent = data.total || 0;

    if (!data.complaints || data.complaints.length === 0) {
      emptyState?.classList.remove('hidden');
      return;
    }

    data.complaints.forEach((comp) => {
      container.appendChild(renderComplaintCard(comp));
    });
  } catch (err) {
    spinner?.classList.add('hidden');
    console.error('Error fetching complaints:', err);
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-lg text-sm">Failed to load recordings: ${err.message}</div>`;
  }
}

function renderComplaintCard(comp) {
  const card = document.createElement('div');
  card.className = 'bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition hover:shadow-md';

  const recordingsCount = comp.recordings ? comp.recordings.length : 0;

  // Calculate total talk time for this complaint
  const totalSeconds = (comp.recordings || []).reduce((acc, r) => acc + (r.duration_seconds || 0), 0);
  const totalMins = Math.floor(totalSeconds / 60);
  const totalSecs = totalSeconds % 60;
  const totalDurFormatted = totalSeconds > 0 ? `${totalMins > 0 ? totalMins + 'm ' : ''}${totalSecs}s` : '0s';

  card.innerHTML = `
    <div class="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center space-x-3">
        <span class="px-2.5 py-1 bg-blue-600 text-white font-bold text-xs rounded-md shadow-sm">
          #${comp.complaint_no}
        </span>
        <div>
          <h3 class="text-sm font-bold text-slate-800">
            ${comp.consumer_name || 'Consumer Name Unavailable'} 
            <span class="text-slate-400 font-normal text-xs ml-1">(${comp.consumer_phone || 'No phone'})</span>
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">
            ${[comp.substation, comp.feeder, comp.area].filter(Boolean).join(' • ') || 'Area Info N/A'}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-2">
        ${comp.complaint_type ? `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 text-xs rounded font-medium">${comp.complaint_type}</span>` : ''}
        <span class="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
          ${recordingsCount} ${recordingsCount === 1 ? 'Call' : 'Calls'} (${totalDurFormatted})
        </span>

        <!-- Delete Entire Complaint Button -->
        <button 
          class="delete-complaint-btn text-slate-300 hover:text-red-600 p-1 rounded transition" 
          title="Delete Complaint and all its calls"
          data-no="${comp.complaint_no}"
        >
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>
    </div>
    <div class="p-4 space-y-3">
      <!-- Calls Timeline -->
      <div class="space-y-3" id="timeline-${comp.complaint_no}">
      </div>
    </div>
  `;

  // Delete entire complaint listener
  const delComplaintBtn = card.querySelector('.delete-complaint-btn');
  delComplaintBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete Complaint #${comp.complaint_no} and ALL its call recordings?`)) return;
    try {
      const res = await fetch(`/api/complaints/${encodeURIComponent(comp.complaint_no)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        loadStats();
        loadComplaints();
      } else {
        alert('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  const timelineContainer = card.querySelector(`#timeline-${comp.complaint_no}`);

  comp.recordings.forEach((rec, idx) => {
    timelineContainer.appendChild(renderCallRow(rec, idx + 1, comp.complaint_no));
  });

  return card;
}

function renderCallRow(rec, callSeq, complaintNo) {
  const row = document.createElement('div');
  row.className = 'p-3 bg-slate-50/70 rounded-lg border border-slate-200/80 space-y-2';

  // Format call target badge
  let targetBadge = 'bg-blue-100 text-blue-700 border-blue-200';
  let targetIcon = 'fa-user';
  if (rec.call_target === 'CREW') {
    targetBadge = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    targetIcon = 'fa-wrench';
  } else if (rec.call_target === 'VERIFICATION') {
    targetBadge = 'bg-purple-100 text-purple-800 border-purple-200';
    targetIcon = 'fa-check-double';
  }

  // Format date/time
  const callDate = new Date(rec.call_time);
  const timeFormatted = isNaN(callDate.getTime())
    ? rec.call_time
    : callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ', ' +
      callDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

  // Format duration
  const mins = Math.floor(rec.duration_seconds / 60);
  const secs = rec.duration_seconds % 60;
  const durFormatted = `${mins > 0 ? mins + 'm ' : ''}${secs}s`;

  // Format satisfaction badge
  let satisfactionBadgeHtml = '';
  if (rec.consumer_satisfaction === 'SATISFIED') {
    satisfactionBadgeHtml = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded font-semibold text-[11px] flex items-center gap-1 shadow-xs"><i class="fa-solid fa-face-smile text-emerald-600"></i> Satisfied</span>`;
  } else if (rec.consumer_satisfaction === 'UNSATISFIED') {
    satisfactionBadgeHtml = `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded font-semibold text-[11px] flex items-center gap-1 shadow-xs"><i class="fa-solid fa-face-frown text-rose-600"></i> Unsatisfied</span>`;
  }

  row.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div class="flex items-center space-x-2">
        <span class="font-bold text-slate-500">Call ${callSeq}:</span>
        <span class="px-2 py-0.5 rounded border text-[11px] font-semibold flex items-center gap-1 ${targetBadge}">
          <i class="fa-solid ${targetIcon}"></i> ${rec.call_target}
        </span>
        ${satisfactionBadgeHtml}
        <span class="font-medium text-slate-700">${rec.phone_number}</span>
      </div>
      <div class="flex items-center space-x-3 text-slate-400">
        <span class="text-slate-600 font-medium"><i class="fa-solid fa-user-gear mr-1 text-slate-400"></i> ${rec.operator_name}</span>
        <span>•</span>
        <span><i class="fa-regular fa-clock mr-1"></i> ${timeFormatted} (${durFormatted})</span>
      </div>
    </div>

    <!-- Notes & Ground Reality Tags -->
    ${
      rec.call_outcome || rec.actual_problem || rec.operator_notes
        ? `
      <div class="flex flex-wrap items-center gap-1.5 text-xs pt-1">
        ${rec.call_outcome ? `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-medium">${rec.call_outcome}</span>` : ''}
        ${rec.actual_problem ? `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-medium border border-amber-200"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${rec.actual_problem}</span>` : ''}
        ${rec.operator_notes ? `<span class="text-slate-600 italic">"${rec.operator_notes}"</span>` : ''}
      </div>
    `
        : ''
    }

    <!-- Audio Player Row -->
    <div class="pt-2 flex items-center space-x-2 sm:space-x-3 bg-white p-2 rounded-md border border-slate-200">
      <button 
        class="play-btn w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow transition shrink-0" 
        data-id="${rec.id}"
        data-duration="${rec.duration_seconds}"
      >
        <i class="fa-solid fa-play text-xs pl-0.5"></i>
      </button>

      <div class="flex-1 flex flex-col justify-center space-y-1">
        <input 
          type="range" 
          min="0" 
          max="${rec.duration_seconds || 100}" 
          value="0" 
          class="audio-scrubber w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
        />
        <div class="flex justify-between text-[11px] text-slate-400 font-mono">
          <span class="current-time">00:00</span>
          <span class="total-time">${formatTime(rec.duration_seconds)}</span>
        </div>
      </div>

      <!-- Speed Multiplier -->
      <button 
        class="speed-btn px-2 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
        data-speed="1"
      >
        1x
      </button>

      <!-- Download Button -->
      <a 
        href="/api/recordings/${rec.id}/download" 
        class="p-2 text-slate-400 hover:text-slate-700 transition"
        title="Download MP3"
      >
        <i class="fa-solid fa-download text-xs"></i>
      </a>

      <!-- Delete Single Recording Button -->
      <button 
        class="delete-btn p-2 text-slate-300 hover:text-red-600 transition" 
        title="Delete this recording"
        data-id="${rec.id}"
      >
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>
  `;

  // Attach audio player logic
  const playBtn = row.querySelector('.play-btn');
  const scrubber = row.querySelector('.audio-scrubber');
  const currentSpan = row.querySelector('.current-time');
  const speedBtn = row.querySelector('.speed-btn');
  const deleteBtn = row.querySelector('.delete-btn');

  let audio = null;

  deleteBtn?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete this call recording?')) return;
    try {
      const res = await fetch(`/api/recordings/${rec.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        loadStats();
        loadComplaints();
      } else {
        alert('Failed to delete: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  playBtn.addEventListener('click', () => {
    if (activeAudio && activeAudio !== audio) {
      activeAudio.pause();
      if (activePlayBtn) activePlayBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
    }

    if (!audio) {
      audio = new Audio(`/api/recordings/${rec.id}/stream`);

      audio.addEventListener('loadedmetadata', () => {
        if (!isNaN(audio.duration)) {
          scrubber.max = Math.floor(audio.duration);
        }
      });

      audio.addEventListener('timeupdate', () => {
        scrubber.value = Math.floor(audio.currentTime);
        currentSpan.textContent = formatTime(Math.floor(audio.currentTime));
      });

      audio.addEventListener('ended', () => {
        playBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
        scrubber.value = 0;
        currentSpan.textContent = '00:00';
      });

      scrubber.addEventListener('input', () => {
        audio.currentTime = scrubber.value;
      });

      speedBtn.addEventListener('click', () => {
        const currentSpeed = parseFloat(speedBtn.dataset.speed);
        let nextSpeed = 1;
        if (currentSpeed === 1) nextSpeed = 1.25;
        else if (currentSpeed === 1.25) nextSpeed = 1.5;
        else if (currentSpeed === 1.5) nextSpeed = 2;
        else nextSpeed = 1;

        speedBtn.dataset.speed = nextSpeed;
        speedBtn.textContent = `${nextSpeed}x`;
        audio.playbackRate = nextSpeed;
      });
    }

    if (audio.paused) {
      audio.play();
      playBtn.innerHTML = '<i class="fa-solid fa-pause text-xs"></i>';
      activeAudio = audio;
      activePlayBtn = playBtn;
    } else {
      audio.pause();
      playBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
    }
  });

  return row;
}

function formatTime(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds)) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Server-Sent Events (SSE) for Real-Time Arrival
function initSSE() {
  const events = new EventSource('/api/events');

  events.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      if (type === 'new_recording') {
        const banner = document.getElementById('new-call-banner');
        const message = document.getElementById('new-call-message');
        if (banner && message) {
          message.textContent = `New call received for Complaint #${data.complaint_no} by ${data.operator_name}!`;
          banner.classList.remove('hidden');
        }
        loadStats();
        loadComplaints();
      } else if (type === 'deleted_recording' || type === 'deleted_complaint' || type === 'update_recording') {
        loadStats();
        loadComplaints();
      }
    } catch (e) {
      console.error('Error handling SSE message:', e);
    }
  };

  events.onerror = () => {
    // Reconnects automatically by browser
  };
}
