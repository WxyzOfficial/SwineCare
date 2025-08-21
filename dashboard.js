// dashboard.js
const auth = firebase.auth();
const rdb = firebase.database();
const db = firebase.firestore();
const messaging = firebase.messaging ? firebase.messaging() : null;

// UI elements
const q = sel => document.querySelector(sel);
const showSection = id => {
  document.querySelectorAll('.container').forEach(s=>s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach(a=>a.classList.remove('active'));
  document.querySelector(`[href="#${id}"]`)?.classList.add('active');
};

document.querySelectorAll('.nav-link').forEach(a=>{
  a.onclick = (e) => {
    const href = a.getAttribute('href');
    if (!href) return;
    const id = href.replace('#','');
    if (id) showSection(id);
  };
});

// Auth guard
auth.onAuthStateChanged(async user => {
  if (!user) {
    location.href = 'index.html';
    return;
  }
  q('#user-name').textContent = user.displayName || user.email;
  initApp();
});

q('#btn-logout').onclick = async () => { await auth.signOut(); location.href='index.html'; };

// Main init
async function initApp() {
  // Listen to camera config
  rdb.ref('cameras/defaultCam').on('value', snap => {
    const cam = snap.val();
    if (!cam) return;
    const video = q('#live-video');
    if (cam.streamUrl) {
      video.src = cam.streamUrl;
      video.load();
      video.play().catch(()=> {});
      q('#snapshot').classList.add('hidden');
      video.classList.remove('hidden');
    } else if (cam.snapshotUrl) {
      q('#snapshot img').src = cam.snapshotUrl + '?t=' + Date.now();
      q('#snapshot').classList.remove('hidden');
      video.classList.add('hidden');
    }
  });

  // Pig count & list (Firestore)
  db.collection('pigs').onSnapshot(snap => {
    const count = snap.size;
    q('#stat-pigcount').textContent = String(count);
    const listEl = q('#pig-list');
    listEl.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const el = document.createElement('div');
      el.className = 'row item';
      el.innerHTML = `
        <div><strong>${d.tag}</strong> - ${d.breed} (${d.ageMonths} mo)</div>
        <div>
          <button class="btn small detail" data-id="${doc.id}">Details</button>
          <button class="btn small sell" data-id="${doc.id}">Sell</button>
        </div>
      `;
      listEl.appendChild(el);
    });

    // attach handlers
    document.querySelectorAll('.detail').forEach(b => b.onclick = (ev) => {
      const id = b.dataset.id; viewPigDetail(id);
    });
    document.querySelectorAll('.sell').forEach(b => b.onclick = async (ev) => {
      const id = b.dataset.id;
      const amount = prompt('Enter sell amount (PHP):');
      if (!amount) return;
      await db.collection('pigs').doc(id).update({ status: 'Sold', soldAt: new Date().toISOString(), soldPrice: Number(amount) });
      alert('Marked as sold.');
    });
  });

  // Realtime sensors
  rdb.ref('sensors/ambient').on('value', snap => {
    const v = snap.val() || {};
    q('#stat-temp').textContent = (v.temperature !== undefined ? v.temperature + ' °C' : '-- °C');
    q('#stat-hum').textContent = (v.humidity !== undefined ? v.humidity + ' %' : '-- %');
  });

  // Multiple pig body temps (RTDB)
  rdb.ref('sensors/pigs').on('value', snap => {
    const obj = snap.val() || {};
    const wrap = q('#pig-temps');
    wrap.innerHTML = '';
    for (const pigId in obj) {
      const p = obj[pigId];
      const row = document.createElement('div');
      row.className = 'row item';
      const danger = (p.bodyTemp && p.bodyTemp >= 40.0) ? 'danger' : '';
      row.innerHTML = `<div><strong>${pigId}</strong> <small>${p.sensorId||''}</small></div><div class="${danger}">${p.bodyTemp ? p.bodyTemp + ' °C' : '--'}</div>`;
      wrap.appendChild(row);
    }
  });

  // Feeder
  rdb.ref('feeder').on('value', snap => {
    const f = snap.val() || {};
    q('#stat-feeder').textContent = (f.level !== undefined ? f.level + '%' : '--%');
  });

  // Alerts
  rdb.ref('alerts').limitToLast(50).on('value', snap => {
    const alerts = snap.val() || {};
    const list = q('#alerts-list');
    list.innerHTML = '';
    Object.keys(alerts).sort((a,b)=>b-a).forEach(k => {
      const a = alerts[k];
      const item = document.createElement('div');
      item.className = 'row item';
      item.innerHTML = `<div><strong>${a.type}</strong><div class="muted">${a.message}</div></div><div><small>${a.timestamp||''}</small></div>`;
      list.appendChild(item);
    });
  });

  // Scheduler load
  const schedSnap = await db.collection('config').doc('schedules').get();
  const schedules = (schedSnap.exists && schedSnap.data().feeder) ? schedSnap.data().feeder : [];
  renderSchedule(schedules);

  // Shower schedule load
  const showerSnap = await db.collection('config').doc('schedules').get();
  const showerSchedules = (showerSnap.exists && showerSnap.data().shower) ? showerSnap.data().shower : [];
  renderShower(showerSchedules);

  // FCM subscribe
  if (messaging) {
    try {
      await messaging.requestPermission();
      const token = await messaging.getToken();
      if (token) {
        await db.collection('fcmTokens').doc(token).set({ uid: auth.currentUser.uid, token, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      messaging.onMessage(payload => {
        console.log('FCM message foreground', payload);
        alert(payload.notification?.title + '\n' + payload.notification?.body);
      });
    } catch(e) { console.warn('FCM not available', e); }
  }

  // Chart init (temperature timeline)
  initCharts();

  // Hook UI handlers
  q('#btn-add-pig').onclick = async () => {
    const tag = prompt('Tag # (e.g. CRB-001)');
    if (!tag) return;
    const breed = prompt('Breed:');
    const age = Number(prompt('Age (months):')) || 0;
    const weight = Number(prompt('Weight (kg):')) || 0;
    const gender = prompt('Gender (Male/Female)') || 'Female';
    await db.collection('pigs').add({ tag, breed, ageMonths: age, weightKg: weight, gender, registrationDate: new Date().toISOString(), status: 'Active' });
    alert('Pig registered.');
  };

  q('#btn-add-schedule').onclick = () => {
    const t = q('#new-schedule-time').value;
    if (!t) return alert('Pick time');
    addScheduleTime(t);
  };
  q('#btn-save-schedule').onclick = saveSchedule;

  q('#btn-add-shower').onclick = () => {
    const t = q('#new-shower-time').value;
    if (!t) return alert('Pick time');
    addShowerTime(t);
  };
  q('#btn-save-shower').onclick = saveShower;
  q('#btn-shower-now').onclick = async () => {
    // write to commands node; ESP will react
    await rdb.ref('commands').update({ showerNow: true, requestedAt: new Date().toISOString() });
    alert('Shower command sent');
  };

  q('#btn-filter').onclick = loadFilteredData;
  q('#btn-export-pdf').onclick = exportStatsPdf;
  q('#btn-generate-report').onclick = async() => {
    // re-use export
    await exportSummaryReport();
  };

  q('#btn-refresh').onclick = () => location.reload();
}

// Pig detail (simple)
async function viewPigDetail(id) {
  const doc = await db.collection('pigs').doc(id).get();
  if (!doc.exists) return alert('Not found');
  const d = doc.data();
  alert(`Tag: ${d.tag}\nBreed: ${d.breed}\nAge: ${d.ageMonths}\nWeight: ${d.weightKg}\nStatus: ${d.status}`);
}

/* ---------------- Scheduler helper ---------------- */
let currentSchedules = [];
function renderSchedule(times=[]) {
  currentSchedules = times;
  const el = q('#schedule-list'); el.innerHTML = '';
  times.forEach(t => {
    const div = document.createElement('div'); div.className='row item';
    div.innerHTML = `<div>${t}</div><div><button class="btn small remove" data-time="${t}">Remove</button></div>`;
    el.appendChild(div);
  });
  document.querySelectorAll('#schedule-list .remove').forEach(b => b.onclick = async (e) => {
    const t = b.dataset.time;
    currentSchedules = currentSchedules.filter(x=>x!==t);
    renderSchedule(currentSchedules);
  });
}
function addScheduleTime(t) { if (!currentSchedules.includes(t)) currentSchedules.push(t); renderSchedule(currentSchedules); }
async function saveSchedule() {
  await db.collection('config').doc('schedules').set({ feeder: currentSchedules }, { merge: true });
  // Also mirror to RTDB for ESP32 to read quickly
  await rdb.ref('scheduler').set({ times: currentSchedules });
  alert('Schedule saved');
}

/* ---------------- Shower helper ---------------- */
let currentShowers = [];
function renderShower(times=[]) {
  currentShowers = times;
  const el = q('#shower-list'); el.innerHTML = '';
  times.forEach(t => {
    const div = document.createElement('div'); div.className='row item';
    div.innerHTML = `<div>${t}</div><div><button class="btn small rm" data-time="${t}">Remove</button></div>`;
    el.appendChild(div);
  });
  document.querySelectorAll('#shower-list .rm').forEach(b => b.onclick = (e)=>{ currentShowers = currentShowers.filter(x=>x!==b.dataset.time); renderShower(currentShowers); });
}
function addShowerTime(t) { if (!currentShowers.includes(t)) currentShowers.push(t); renderShower(currentShowers); }
async function saveShower() {
  await db.collection('config').doc('schedules').set({ shower: currentShowers }, { merge: true });
  await rdb.ref('showerScheduler').set({ times: currentShowers });
  alert('Shower schedule saved');
}

/* ---------------- Charts & Stats ---------------- */
let tempChart = null;
function initCharts() {
  const ctx = document.getElementById('chart-temp').getContext('2d');
  tempChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Ambient Temp', data: [], tension: 0.3 }] },
    options: { responsive:true, maintainAspectRatio:false }
  });
}

async function loadFilteredData(){
  const from = new Date(q('#from-date').value || 0).getTime();
  const to = new Date(q('#to-date').value || Date.now()).getTime();
  // Read /logs from RTDB which stores timestamp keys
  const snap = await rdb.ref('logs').orderByKey().startAt(String(from)).endAt(String(to)).once('value');
  const logs = snap.val() || {};
  const labels = [], dataSet = [];
  Object.keys(logs).sort().forEach(k => { const p = logs[k]; labels.push(new Date(Number(k)).toLocaleString()); dataSet.push(p.temperature || null); });
  tempChart.data.labels = labels; tempChart.data.datasets[0].data = dataSet; tempChart.update();
}

async function exportStatsPdf() {
  // Use jsPDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text('SwineCare — Data Export', 14, 20);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
  doc.text('Refer to charts in-app for details', 14, 40);
  doc.save('swinecare_stats.pdf');
}

async function exportSummaryReport() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('SwineCare — Summary Report', 14, 20);
  const pigs = await db.collection('pigs').get();
  let y = 36;
  doc.setFontSize(12);
  pigs.forEach(d => {
    const p = d.data();
    doc.text(`${p.tag} • ${p.breed} • ${p.ageMonths} mo • ${p.weightKg} kg • ${p.status || ''}`, 14, y);
    y += 8;
  });
  doc.save('swinecare_summary.pdf');
}

/* ----------------- Simple Utilities ----------------- */
function parseMap(m){
  if (!m) return {};
  return typeof m === 'object' ? m : {};
}
