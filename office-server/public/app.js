// FRT Office Server — Frontend Application Logic
// Redesigned with Complaint & Phone History Modals, Dual View Modes & Enhanced Filtering

let activeAudio = null;
let activePlayBtn = null;
let activeScrubber = null;

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
  viewMode: 'cards', // 'cards' | 'table'
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

// -------------------------------------------------------------
// EVENT LISTENERS & FILTER CONTROLS
// -------------------------------------------------------------
function setupEventListeners() {
  // Search input debounce & clear button
  let searchTimeout;
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');

  searchInput?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (searchClearBtn) {
      if (val) searchClearBtn.classList.remove('hidden');
      else searchClearBtn.classList.add('hidden');
    }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      loadComplaints();
    }, 300);
  });

  searchClearBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      searchClearBtn.classList.add('hidden');
      state.search = '';
      state.page = 1;
      loadComplaints();
    }
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

  // Feedback Satisfaction Filter Pills (All / Satisfied / Unsatisfied)
  document.querySelectorAll('.feedback-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.satisfaction = btn.dataset.satisfaction || '';
      state.page = 1;

      document.querySelectorAll('.feedback-filter-btn').forEach((b) => {
        if ((b.dataset.satisfaction || '') === state.satisfaction) {
          b.className = 'feedback-filter-btn px-2.5 py-1.5 rounded-lg bg-slate-800 text-white font-semibold transition';
        } else {
          if (b.dataset.satisfaction === 'SATISFIED') {
            b.className = 'feedback-filter-btn px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 font-semibold transition flex items-center gap-1';
          } else if (b.dataset.satisfaction === 'UNSATISFIED') {
            b.className = 'feedback-filter-btn px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 font-semibold transition flex items-center gap-1';
          } else {
            b.className = 'feedback-filter-btn px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-semibold transition';
          }
        }
      });
      loadComplaints();
    });
  });

  // Target Filter Pills (All / Consumer / Crew)
  document.querySelectorAll('.target-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.target = btn.dataset.target || '';
      state.page = 1;

      document.querySelectorAll('.target-btn').forEach((b) => {
        if (b.dataset.target === state.target) {
          b.className = 'target-btn px-2.5 py-1.5 rounded-lg bg-blue-600 text-white font-semibold transition';
        } else {
          b.className = 'target-btn px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
        }
      });
      loadComplaints();
    });
  });

  // View Mode Switcher: Cards vs Table
  const btnCards = document.getElementById('view-mode-cards');
  const btnTable = document.getElementById('view-mode-table');
  const cardsContainer = document.getElementById('complaints-container');
  const tableContainer = document.getElementById('complaints-table-container');

  btnCards?.addEventListener('click', () => {
    state.viewMode = 'cards';
    btnCards.className = 'px-2.5 py-1 rounded-md bg-white text-slate-800 font-bold shadow-xs transition';
    btnTable.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-800 font-medium transition';
    cardsContainer?.classList.remove('hidden');
    tableContainer?.classList.add('hidden');
  });

  btnTable?.addEventListener('click', () => {
    state.viewMode = 'table';
    btnTable.className = 'px-2.5 py-1 rounded-md bg-white text-slate-800 font-bold shadow-xs transition';
    btnCards.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-800 font-medium transition';
    cardsContainer?.classList.add('hidden');
    tableContainer?.classList.remove('hidden');
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

  // Top Navbar Direct Lookup Buttons
  document.getElementById('btn-open-phone-search')?.addEventListener('click', () => {
    openLookupModal('phone');
  });
  document.getElementById('btn-open-comp-search')?.addEventListener('click', () => {
    openLookupModal('complaint');
  });

  // Quick Lookup Modal form submission
  document.getElementById('lookup-modal-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = document.getElementById('lookup-modal-input').value.trim();
    if (!val) return;
    closeLookupModal();
    const digitsOnly = val.replace(/\D/g, '');
    if (digitsOnly.length === 10) {
      openPhoneModal(digitsOnly);
    } else {
      openComplaintModal(val);
    }
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
      btn.className = 'quick-date-btn px-2.5 py-1.5 rounded-lg bg-blue-600 text-white font-semibold transition';
    } else {
      btn.className = 'quick-date-btn px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
    }
  });
}

// -------------------------------------------------------------
// DATA LOADERS
// -------------------------------------------------------------
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('stat-today-calls').textContent = data.today.calls || 0;
    document.getElementById('stat-today-complaints').textContent = data.today.complaints || 0;
    document.getElementById('stat-today-satisfied').textContent = data.today.satisfied || 0;
    document.getElementById('stat-today-unsatisfied').textContent = data.today.unsatisfied || 0;
    document.getElementById('stat-today-time').textContent = `${data.today.durationMinutes || 0} min`;
    document.getElementById('stat-storage').textContent = `${data.today.storageMB || 0} MB`;
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

    const currentMonth = new Date().toISOString().slice(0, 7);
    const allMonths = Array.from(new Set([currentMonth, ...months]));

    allMonths.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
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
  const cardsContainer = document.getElementById('complaints-container');
  const tableBody = document.getElementById('complaints-table-body');
  const spinner = document.getElementById('loading-spinner');
  const emptyState = document.getElementById('empty-state');
  const totalCountSpan = document.getElementById('total-count');

  if (!cardsContainer || !tableBody) return;

  spinner?.classList.remove('hidden');
  emptyState?.classList.add('hidden');
  cardsContainer.innerHTML = '';
  tableBody.innerHTML = '';

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
      limit: 100,
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
      cardsContainer.appendChild(renderComplaintCard(comp));
      tableBody.appendChild(renderComplaintTableRow(comp));
    });
  } catch (err) {
    spinner?.classList.add('hidden');
    console.error('Error fetching complaints:', err);
    cardsContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-200">Failed to load recordings: ${err.message}</div>`;
  }
}

// -------------------------------------------------------------
// RENDER COMPLAINT CARD (Cards View)
// -------------------------------------------------------------
function renderComplaintCard(comp) {
  const card = document.createElement('div');
  card.className = 'bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition hover:shadow-md';

  const recordings = comp.recordings || [];
  const recordingsCount = recordings.length;

  // Compute total duration
  const totalSeconds = recordings.reduce((acc, r) => acc + (r.duration_seconds || 0), 0);
  const totalMins = Math.floor(totalSeconds / 60);
  const totalSecs = totalSeconds % 60;
  const totalDurFormatted = totalSeconds > 0 ? `${totalMins > 0 ? totalMins + 'm ' : ''}${totalSecs}s` : '0s';

  // Compute overall complaint satisfaction badge
  const hasSatisfied = recordings.some((r) => (r.consumer_satisfaction || '').toUpperCase() === 'SATISFIED');
  const hasUnsatisfied = recordings.some((r) => (r.consumer_satisfaction || '').toUpperCase() === 'UNSATISFIED');

  let overallSatBadge = '';
  if (hasSatisfied) {
    overallSatBadge = `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg font-bold text-xs flex items-center gap-1 shadow-xs"><i class="fa-solid fa-face-smile text-emerald-600"></i> SATISFIED (संतुष्ट)</span>`;
  } else if (hasUnsatisfied) {
    overallSatBadge = `<span class="px-2.5 py-1 bg-rose-100 text-rose-800 border border-rose-300 rounded-lg font-bold text-xs flex items-center gap-1 shadow-xs"><i class="fa-solid fa-face-frown text-rose-600"></i> UNSATISFIED (असंतुष्ट)</span>`;
  } else {
    overallSatBadge = `<span class="px-2.5 py-1 bg-slate-100 text-slate-600 border border-slate-300 rounded-lg font-medium text-xs flex items-center gap-1">PENDING (लंबित)</span>`;
  }

  const phone = comp.consumer_phone || '';

  card.innerHTML = `
    <div class="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center space-x-3">
        <!-- Clickable Complaint Number Badge -->
        <button 
          class="comp-no-badge px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
          data-no="${comp.complaint_no}"
          title="Click to view complete Complaint Call History"
        >
          <i class="fa-solid fa-file-invoice text-[11px] opacity-80"></i>
          #${comp.complaint_no}
        </button>

        <div>
          <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>${comp.consumer_name || 'Consumer Name Unavailable'}</span>
            ${
              phone
                ? `<button 
                    class="phone-link-btn text-xs font-mono text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 transition"
                    data-phone="${phone}"
                    title="Click to view all call recordings for this Phone Number"
                  >
                    <i class="fa-solid fa-phone text-[10px]"></i> ${phone}
                  </button>`
                : '<span class="text-xs text-slate-400 font-normal">(No phone)</span>'
            }
          </h3>
          <p class="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            <i class="fa-solid fa-location-dot text-slate-400 text-[10px]"></i>
            <span>${[comp.substation, comp.feeder, comp.area].filter(Boolean).join(' • ') || 'Area Info N/A'}</span>
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-2.5">
        ${overallSatBadge}

        ${comp.complaint_type ? `<span class="px-2.5 py-1 bg-slate-200 text-slate-700 text-xs rounded-lg font-medium">${comp.complaint_type}</span>` : ''}

        <button 
          class="comp-history-btn px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition"
          data-no="${comp.complaint_no}"
          title="Open complete call timeline modal"
        >
          <i class="fa-solid fa-timeline text-blue-600"></i> ${recordingsCount} ${recordingsCount === 1 ? 'Call' : 'Calls'} (${totalDurFormatted})
        </button>

        <!-- Delete Entire Complaint Button -->
        <button 
          class="delete-complaint-btn text-slate-300 hover:text-red-600 p-1.5 rounded-lg transition" 
          title="Delete Complaint and all its calls"
          data-no="${comp.complaint_no}"
        >
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>
    </div>

    <!-- Calls Timeline Container -->
    <div class="p-4 space-y-3" id="timeline-${comp.complaint_no}">
      <!-- Call rows inserted below -->
    </div>
  `;

  // Attach Complaint Click events
  card.querySelectorAll('.comp-no-badge, .comp-history-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openComplaintModal(comp.complaint_no);
    });
  });

  // Attach Phone Click events
  card.querySelectorAll('.phone-link-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openPhoneModal(b.dataset.phone);
    });
  });

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
  recordings.forEach((rec, idx) => {
    timelineContainer.appendChild(renderCallRow(rec, idx + 1, comp.complaint_no));
  });

  return card;
}

// -------------------------------------------------------------
// RENDER COMPACT TABLE ROW (Table View)
// -------------------------------------------------------------
function renderComplaintTableRow(comp) {
  const tr = document.createElement('tr');
  tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

  const recordings = comp.recordings || [];
  const recordingsCount = recordings.length;
  const lastRec = recordings.length > 0 ? recordings[recordings.length - 1] : null;

  const hasSatisfied = recordings.some((r) => (r.consumer_satisfaction || '').toUpperCase() === 'SATISFIED');
  const hasUnsatisfied = recordings.some((r) => (r.consumer_satisfaction || '').toUpperCase() === 'UNSATISFIED');

  let satTag = '<span class="text-slate-400 font-medium">Pending</span>';
  if (hasSatisfied) {
    satTag = '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[11px]">😊 Satisfied</span>';
  } else if (hasUnsatisfied) {
    satTag = '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[11px]">🙁 Unsatisfied</span>';
  }

  const lastCallTime = lastRec ? formatTimeShort(lastRec.call_time) : '—';
  const lastOp = lastRec ? lastRec.operator_name : '—';
  const phone = comp.consumer_phone || '';

  tr.innerHTML = `
    <td class="p-3 pl-4">
      <button class="comp-no-btn font-mono font-bold text-blue-600 hover:text-blue-800 hover:underline" data-no="${comp.complaint_no}">
        #${comp.complaint_no}
      </button>
    </td>
    <td class="p-3">
      <div class="font-bold text-slate-800">${comp.consumer_name || 'Consumer'}</div>
      ${phone ? `<button class="phone-link-btn text-xs font-mono text-emerald-700 hover:underline flex items-center gap-1" data-phone="${phone}"><i class="fa-solid fa-phone text-[9px]"></i> ${phone}</button>` : ''}
    </td>
    <td class="p-3 text-slate-600">
      ${[comp.substation, comp.feeder].filter(Boolean).join(' • ') || comp.area || '—'}
    </td>
    <td class="p-3 text-center">
      ${satTag}
    </td>
    <td class="p-3 text-center font-bold text-slate-700">
      ${recordingsCount}
    </td>
    <td class="p-3 text-slate-600">
      ${lastCallTime}
    </td>
    <td class="p-3 text-slate-600">
      ${lastOp}
    </td>
    <td class="p-3 text-right pr-4">
      <button class="view-history-btn px-2.5 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-semibold text-slate-700 transition" data-no="${comp.complaint_no}">
        View Calls
      </button>
    </td>
  `;

  tr.querySelectorAll('.comp-no-btn, .view-history-btn').forEach((b) => {
    b.addEventListener('click', () => openComplaintModal(comp.complaint_no));
  });

  tr.querySelectorAll('.phone-link-btn').forEach((b) => {
    b.addEventListener('click', () => openPhoneModal(b.dataset.phone));
  });

  return tr;
}

// -------------------------------------------------------------
// RENDER CALL ROW WITH AUDIO PLAYER & SATISFACTION TAGS
// -------------------------------------------------------------
function renderCallRow(rec, callSeq, complaintNo) {
  const row = document.createElement('div');
  row.className = 'p-3.5 bg-slate-50/70 rounded-xl border border-slate-200/80 space-y-2.5 transition hover:bg-slate-50';

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

  // Format Satisfaction Badge with Tags
  let satisfactionBadgeHtml = '';
  const sat = (rec.consumer_satisfaction || '').toUpperCase();
  if (sat === 'SATISFIED') {
    satisfactionBadgeHtml = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md font-bold text-[11px] flex items-center gap-1 shadow-2xs"><i class="fa-solid fa-face-smile text-emerald-600"></i> सैटिस्फाइड (SATISFIED)</span>`;
  } else if (sat === 'UNSATISFIED') {
    satisfactionBadgeHtml = `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-md font-bold text-[11px] flex items-center gap-1 shadow-2xs"><i class="fa-solid fa-face-frown text-rose-600"></i> अनसैटिस्फाइड (UNSATISFIED)</span>`;
  }

  row.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div class="flex items-center space-x-2">
        <span class="font-bold text-slate-500">Call ${callSeq}:</span>
        <span class="px-2 py-0.5 rounded-md border text-[11px] font-semibold flex items-center gap-1 ${targetBadge}">
          <i class="fa-solid ${targetIcon}"></i> ${rec.call_target}
        </span>
        ${satisfactionBadgeHtml}
        ${
          rec.phone_number
            ? `<button class="phone-link-btn font-mono font-semibold text-emerald-700 hover:underline flex items-center gap-1" data-phone="${rec.phone_number}">
                 <i class="fa-solid fa-phone text-[10px]"></i> ${rec.phone_number}
               </button>`
            : '<span class="text-slate-400">No phone</span>'
        }
      </div>
      <div class="flex items-center space-x-3 text-slate-400">
        <span class="text-slate-700 font-medium"><i class="fa-solid fa-user-gear mr-1 text-slate-400"></i> ${rec.operator_name}</span>
        <span>•</span>
        <span><i class="fa-regular fa-clock mr-1"></i> ${timeFormatted} (${durFormatted})</span>
      </div>
    </div>

    <!-- Notes & Ground Reality Tags -->
    ${
      rec.call_outcome || rec.actual_problem || rec.operator_notes
        ? `
      <div class="flex flex-wrap items-center gap-1.5 text-xs pt-1">
        ${rec.call_outcome ? `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md font-medium">${rec.call_outcome}</span>` : ''}
        ${rec.actual_problem ? `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md font-medium border border-amber-200"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${rec.actual_problem}</span>` : ''}
        ${rec.operator_notes ? `<span class="text-slate-600 italic">"${rec.operator_notes}"</span>` : ''}
      </div>
    `
        : ''
    }

    <!-- Audio Player Row -->
    <div class="pt-2 flex items-center space-x-2 sm:space-x-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
      <button 
        class="play-btn w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow transition shrink-0" 
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
        class="speed-btn px-2 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
        data-speed="1"
      >
        1x
      </button>

      <!-- Download Button -->
      <a 
        href="/api/recordings/${rec.id}/download" 
        class="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
        title="Download MP3"
      >
        <i class="fa-solid fa-download text-xs"></i>
      </a>

      <!-- Delete Single Recording Button -->
      <button 
        class="delete-btn p-2 text-slate-300 hover:text-red-600 rounded-lg hover:bg-red-50 transition" 
        title="Delete this recording"
        data-id="${rec.id}"
      >
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>
  `;

  // Attach Phone click inside call row
  row.querySelector('.phone-link-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPhoneModal(rec.phone_number);
  });

  // Attach Audio player logic
  setupAudioPlayer(row, rec);

  return row;
}

// -------------------------------------------------------------
// CENTRAL AUDIO PLAYER CONTROLLER
// -------------------------------------------------------------
function setupAudioPlayer(container, rec) {
  const playBtn = container.querySelector('.play-btn');
  const scrubber = container.querySelector('.audio-scrubber');
  const currentSpan = container.querySelector('.current-time');
  const speedBtn = container.querySelector('.speed-btn');
  const deleteBtn = container.querySelector('.delete-btn');

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

  playBtn?.addEventListener('click', () => {
    if (activeAudio && activeAudio !== audio) {
      activeAudio.pause();
      if (activePlayBtn) activePlayBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
    }

    if (!audio) {
      audio = new Audio(`/api/recordings/${rec.id}/stream`);

      audio.addEventListener('loadedmetadata', () => {
        if (scrubber && audio.duration) scrubber.max = Math.floor(audio.duration);
      });

      audio.addEventListener('timeupdate', () => {
        if (scrubber) scrubber.value = Math.floor(audio.currentTime);
        if (currentSpan) currentSpan.textContent = formatTime(Math.floor(audio.currentTime));
      });

      audio.addEventListener('ended', () => {
        playBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
        if (scrubber) scrubber.value = 0;
        if (currentSpan) currentSpan.textContent = '00:00';
      });
    }

    if (audio.paused) {
      audio.play();
      playBtn.innerHTML = '<i class="fa-solid fa-pause text-xs"></i>';
      activeAudio = audio;
      activePlayBtn = playBtn;
      activeScrubber = scrubber;
    } else {
      audio.pause();
      playBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
    }
  });

  scrubber?.addEventListener('input', () => {
    if (audio) {
      audio.currentTime = scrubber.value;
      if (currentSpan) currentSpan.textContent = formatTime(scrubber.value);
    }
  });

  const speeds = [1, 1.25, 1.5, 2];
  speedBtn?.addEventListener('click', () => {
    let currentSpeed = parseFloat(speedBtn.dataset.speed) || 1;
    let nextIdx = (speeds.indexOf(currentSpeed) + 1) % speeds.length;
    let nextSpeed = speeds[nextIdx];
    speedBtn.dataset.speed = nextSpeed;
    speedBtn.textContent = `${nextSpeed}x`;
    if (audio) audio.playbackRate = nextSpeed;
  });
}

// -------------------------------------------------------------
// MODAL 1: COMPLAINT HISTORY TIMELINE MODAL
// -------------------------------------------------------------
async function openComplaintModal(complaintNo) {
  const modal = document.getElementById('complaint-history-modal');
  if (!modal) return;

  modal.classList.remove('hidden');

  const compNoSpan = document.getElementById('modal-comp-no');
  const nameHeader = document.getElementById('modal-comp-name');
  const metaSpan = document.getElementById('modal-comp-meta');
  const satPill = document.getElementById('modal-comp-satisfaction-pill');
  const callCountSpan = document.getElementById('modal-call-count');
  const timelineContainer = document.getElementById('modal-recordings-timeline');

  compNoSpan.textContent = `#${complaintNo}`;
  nameHeader.textContent = 'Loading complaint details...';
  timelineContainer.innerHTML = '<div class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-blue-600 mb-2"></i><p>Loading history...</p></div>';

  try {
    const res = await fetch(`/api/complaints/${encodeURIComponent(complaintNo)}`);
    if (!res.ok) throw new Error('Complaint not found');
    const data = await res.json();

    const comp = data.complaint || {};
    const recordings = data.recordings || [];

    nameHeader.innerHTML = `
      <span>${comp.consumer_name || 'Consumer'}</span>
      ${
        comp.consumer_phone
          ? `<button class="phone-link-btn text-xs font-mono text-emerald-400 hover:text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 rounded-lg flex items-center gap-1 font-semibold" data-phone="${comp.consumer_phone}">
               <i class="fa-solid fa-phone text-[10px]"></i> ${comp.consumer_phone}
             </button>`
          : ''
      }
    `;

    // Click phone inside modal header
    nameHeader.querySelector('.phone-link-btn')?.addEventListener('click', () => {
      openPhoneModal(comp.consumer_phone);
    });

    metaSpan.innerHTML = `
      <span><i class="fa-solid fa-location-dot mr-1"></i> ${[comp.substation, comp.feeder, comp.area].filter(Boolean).join(' • ') || 'Area Info N/A'}</span>
      ${comp.complaint_type ? `<span>• <i class="fa-solid fa-tag mr-1"></i> ${comp.complaint_type}</span>` : ''}
    `;

    callCountSpan.textContent = recordings.length;

    // Check satisfaction
    const hasSatisfied = recordings.some((r) => (r.consumer_satisfaction || '').toUpperCase() === 'SATISFIED');
    const hasUnsatisfied = recordings.some((r) => (r.consumer_satisfaction || '').toUpperCase() === 'UNSATISFIED');

    if (hasSatisfied) {
      satPill.className = 'px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-xs font-bold flex items-center gap-1';
      satPill.innerHTML = '<i class="fa-solid fa-face-smile"></i> SATISFIED (संतुष्ट)';
    } else if (hasUnsatisfied) {
      satPill.className = 'px-3 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full text-xs font-bold flex items-center gap-1';
      satPill.innerHTML = '<i class="fa-solid fa-face-frown"></i> UNSATISFIED (असंतुष्ट)';
    } else {
      satPill.className = 'px-3 py-1 bg-slate-700 text-slate-300 border border-slate-600 rounded-full text-xs font-medium';
      satPill.textContent = 'PENDING (लंबित)';
    }

    // Direct Satisfaction Update Buttons in Modal
    document.getElementById('modal-mark-satisfied-btn').onclick = async () => {
      await updateSatisfactionFromDashboard(complaintNo, 'SATISFIED');
      openComplaintModal(complaintNo);
    };
    document.getElementById('modal-mark-unsatisfied-btn').onclick = async () => {
      await updateSatisfactionFromDashboard(complaintNo, 'UNSATISFIED');
      openComplaintModal(complaintNo);
    };

    // Delete button in modal
    document.getElementById('modal-delete-entire-comp-btn').onclick = async () => {
      if (!confirm(`Delete Complaint #${complaintNo} and all recordings?`)) return;
      await fetch(`/api/complaints/${encodeURIComponent(complaintNo)}`, { method: 'DELETE' });
      closeComplaintModal();
      loadStats();
      loadComplaints();
    };

    // Render Timeline
    timelineContainer.innerHTML = '';
    if (recordings.length === 0) {
      timelineContainer.innerHTML = '<div class="p-6 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300 text-xs">No call recordings found for this complaint yet.</div>';
    } else {
      recordings.forEach((rec, idx) => {
        timelineContainer.appendChild(renderCallRow(rec, idx + 1, complaintNo));
      });
    }
  } catch (err) {
    timelineContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-xl text-xs">${err.message}</div>`;
  }
}

function closeComplaintModal() {
  document.getElementById('complaint-history-modal')?.classList.add('hidden');
  if (activeAudio) {
    activeAudio.pause();
    if (activePlayBtn) activePlayBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
  }
}

async function updateSatisfactionFromDashboard(complaintNo, satisfaction) {
  try {
    const res = await fetch(`/api/complaints/${encodeURIComponent(complaintNo)}/satisfaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        satisfaction,
        notes: `Marked ${satisfaction} via Office Dashboard`,
        operator_name: 'Dashboard Admin',
      }),
    });
    const d = await res.json();
    if (d.success) {
      loadStats();
      loadComplaints();
    } else {
      alert('Error: ' + (d.error || 'Failed'));
    }
  } catch (err) {
    alert('Request failed: ' + err.message);
  }
}

// -------------------------------------------------------------
// MODAL 2: PHONE NUMBER CALL HISTORY MODAL
// -------------------------------------------------------------
async function openPhoneModal(phoneNumber) {
  const modal = document.getElementById('phone-history-modal');
  if (!modal) return;

  const cleanPhone = (phoneNumber || '').replace(/\D/g, '').slice(-10);
  if (!cleanPhone) return;

  modal.classList.remove('hidden');

  const phoneHeader = document.getElementById('phone-modal-number');
  const namesSpan = document.getElementById('phone-modal-consumer-names');
  const totalCallsSpan = document.getElementById('phone-modal-total-calls');
  const satCountSpan = document.getElementById('phone-modal-satisfied-count');
  const unsatCountSpan = document.getElementById('phone-modal-unsatisfied-count');
  const linkedComplaintsContainer = document.getElementById('phone-modal-linked-complaints');
  const recordingsList = document.getElementById('phone-modal-recordings-list');

  phoneHeader.textContent = `+91 ${cleanPhone}`;
  namesSpan.textContent = 'Searching call recordings...';
  recordingsList.innerHTML = '<div class="py-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-600 mb-2"></i><p>Loading phone history...</p></div>';

  try {
    const res = await fetch(`/api/phone/${encodeURIComponent(cleanPhone)}/recordings`);
    if (!res.ok) throw new Error('No recordings found for this phone number');
    const data = await res.json();

    const recordings = data.recordings || [];
    const names = data.names || [];

    namesSpan.textContent = names.length > 0 ? `Associated: ${names.join(', ')}` : 'Consumer Name Not Available';
    totalCallsSpan.textContent = data.totalCalls || 0;
    satCountSpan.textContent = data.satisfiedCalls || 0;
    unsatCountSpan.textContent = data.unsatisfiedCalls || 0;

    // Linked complaints chips
    linkedComplaintsContainer.innerHTML = '<span class="text-slate-400">Linked Complaints:</span>';
    (data.uniqueComplaints || []).forEach((cNo) => {
      const chip = document.createElement('button');
      chip.className = 'px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md font-mono font-bold text-[11px] transition';
      chip.textContent = `#${cNo}`;
      chip.title = `Click to view history for Complaint #${cNo}`;
      chip.addEventListener('click', () => {
        closePhoneModal();
        openComplaintModal(cNo);
      });
      linkedComplaintsContainer.appendChild(chip);
    });

    // Render Recordings
    recordingsList.innerHTML = '';
    if (recordings.length === 0) {
      recordingsList.innerHTML = '<div class="p-6 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300 text-xs">No recordings found for this phone number.</div>';
    } else {
      recordings.forEach((rec, idx) => {
        const item = renderPhoneHistoryItem(rec, idx + 1);
        recordingsList.appendChild(item);
      });
    }
  } catch (err) {
    recordingsList.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-xl text-xs">${err.message}</div>`;
  }
}

function renderPhoneHistoryItem(rec, seq) {
  const item = document.createElement('div');
  item.className = 'p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-2';

  // Format satisfaction badge with tags
  let satBadge = '';
  const sat = (rec.consumer_satisfaction || '').toUpperCase();
  if (sat === 'SATISFIED') {
    satBadge = '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md font-bold text-[11px] flex items-center gap-1"><i class="fa-solid fa-face-smile text-emerald-600"></i> सैटिस्फाइड (SATISFIED)</span>';
  } else if (sat === 'UNSATISFIED') {
    satBadge = '<span class="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-md font-bold text-[11px] flex items-center gap-1"><i class="fa-solid fa-face-frown text-rose-600"></i> अनसैटिस्फाइड (UNSATISFIED)</span>';
  } else {
    satBadge = '<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[11px]">Pending</span>';
  }

  // Format date/time
  const callDate = new Date(rec.call_time);
  const timeFormatted = isNaN(callDate.getTime())
    ? rec.call_time
    : callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ', ' +
      callDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  const mins = Math.floor(rec.duration_seconds / 60);
  const secs = rec.duration_seconds % 60;
  const durFormatted = `${mins > 0 ? mins + 'm ' : ''}${secs}s`;

  item.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div class="flex items-center space-x-2">
        <button class="comp-badge-link px-2.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold rounded-lg text-xs transition" data-no="${rec.complaint_no}">
          #${rec.complaint_no}
        </button>
        <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-semibold text-[11px]">
          ${rec.call_target || 'CONSUMER'}
        </span>
        ${satBadge}
      </div>
      <div class="text-slate-400 flex items-center gap-2">
        <span class="font-medium text-slate-700"><i class="fa-solid fa-user-gear mr-1 text-slate-400"></i> ${rec.operator_name}</span>
        <span>•</span>
        <span><i class="fa-regular fa-clock mr-1"></i> ${timeFormatted} (${durFormatted})</span>
      </div>
    </div>

    ${
      rec.call_outcome || rec.actual_problem || rec.operator_notes
        ? `
      <div class="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 pt-0.5">
        ${rec.call_outcome ? `<span class="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-medium">${rec.call_outcome}</span>` : ''}
        ${rec.actual_problem ? `<span class="px-2 py-0.5 bg-amber-50 text-amber-800 rounded border border-amber-200"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${rec.actual_problem}</span>` : ''}
        ${rec.operator_notes ? `<span class="italic text-slate-500">"${rec.operator_notes}"</span>` : ''}
      </div>
    `
        : ''
    }

    <!-- Audio Player Row inside Phone Modal -->
    <div class="pt-1.5 flex items-center space-x-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
      <button 
        class="play-btn w-8 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow transition shrink-0" 
        data-id="${rec.id}"
      >
        <i class="fa-solid fa-play text-xs pl-0.5"></i>
      </button>

      <div class="flex-1 flex flex-col justify-center space-y-0.5">
        <input 
          type="range" 
          min="0" 
          max="${rec.duration_seconds || 100}" 
          value="0" 
          class="audio-scrubber w-full h-1 bg-slate-200 rounded appearance-none cursor-pointer"
        />
        <div class="flex justify-between text-[10px] text-slate-400 font-mono">
          <span class="current-time">00:00</span>
          <span class="total-time">${formatTime(rec.duration_seconds)}</span>
        </div>
      </div>

      <button 
        class="speed-btn px-2 py-0.5 text-[11px] font-semibold rounded bg-white hover:bg-slate-200 text-slate-600 border border-slate-200 transition"
        data-speed="1"
      >
        1x
      </button>

      <a 
        href="/api/recordings/${rec.id}/download" 
        class="p-1.5 text-slate-400 hover:text-slate-700 rounded transition"
        title="Download MP3"
      >
        <i class="fa-solid fa-download text-xs"></i>
      </a>
    </div>
  `;

  // Click on complaint badge inside phone modal
  item.querySelector('.comp-badge-link')?.addEventListener('click', () => {
    closePhoneModal();
    openComplaintModal(rec.complaint_no);
  });

  // Attach audio player logic
  setupAudioPlayer(item, rec);

  return item;
}

function closePhoneModal() {
  document.getElementById('phone-history-modal')?.classList.add('hidden');
  if (activeAudio) {
    activeAudio.pause();
    if (activePlayBtn) activePlayBtn.innerHTML = '<i class="fa-solid fa-play text-xs pl-0.5"></i>';
  }
}

// -------------------------------------------------------------
// MODAL 3: DIRECT LOOKUP MODAL (Quick search)
// -------------------------------------------------------------
function openLookupModal(mode = 'phone') {
  const modal = document.getElementById('quick-lookup-modal');
  const title = document.getElementById('lookup-modal-title');
  const desc = document.getElementById('lookup-modal-desc');
  const input = document.getElementById('lookup-modal-input');

  if (!modal || !input) return;

  modal.classList.remove('hidden');

  if (mode === 'phone') {
    title.innerHTML = '<i class="fa-solid fa-phone text-emerald-600 mr-1.5"></i> Phone Number Lookup';
    desc.textContent = 'Enter a 10-digit Phone Number to view all its call recordings across all complaints:';
    input.placeholder = 'e.g. 9876543210';
  } else {
    title.innerHTML = '<i class="fa-solid fa-file-invoice text-blue-600 mr-1.5"></i> Complaint History';
    desc.textContent = 'Enter the Complaint Number (e.g. MV...) to view its entire call timeline:';
    input.placeholder = 'e.g. MV05112601251';
  }

  input.value = '';
  setTimeout(() => input.focus(), 100);
}

function closeLookupModal() {
  document.getElementById('quick-lookup-modal')?.classList.add('hidden');
}

// -------------------------------------------------------------
// SSE REAL-TIME BROADCASTS
// -------------------------------------------------------------
function initSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'new_recording') {
        const banner = document.getElementById('new-call-banner');
        const bannerMsg = document.getElementById('new-call-message');
        if (banner) {
          if (bannerMsg) {
            bannerMsg.textContent = `New call recording received for Complaint #${msg.data.complaint_no}!`;
          }
          banner.classList.remove('hidden');
        }
        loadStats();
      } else if (msg.type === 'update_recording') {
        loadStats();
        loadComplaints();
      } else if (msg.type === 'deleted_recording' || msg.type === 'deleted_complaint') {
        loadStats();
        loadComplaints();
      }
    } catch (_) {}
  };

  evtSource.onerror = () => {
    // Retry automatically after a few seconds
  };
}

// -------------------------------------------------------------
// TIME & STRING HELPERS
// -------------------------------------------------------------
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatTimeShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
