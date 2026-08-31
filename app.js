
const EXERCISES = [
  "Seated Wide Lat Pulldown",
  "Bench Press",
  "Trunk Rotation",
  "Standing Lateral Shoulder Raise",
  "Standing Biceps Curl",
  "Triceps Pushdown",
  "Leg Extension",
  "Standing Leg Curl",
  "Low Back Extension",
  "Seated Resisted Abdominal Crunch"
];

const STORAGE_KEY = "bowflex-progress-v1";
const config = window.BOWFLEX_CONFIG || {};
let supabaseClient = null;
let dbMode = "local";
let currentUser = null;
let state = { workouts: [] };
let calendarCursor = new Date();

const $ = (id) => document.getElementById(id);

function localDateISO(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}
function prettyDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
}
function shortDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

async function initDataLayer() {
  loadLocal();

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    updateSyncBadge();
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );

    const { data } = await supabaseClient.auth.getSession();

    if (data?.session?.user) {
      currentUser = data.session.user;
      dbMode = "supabase";
      await loadFromSupabase();
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      currentUser = session?.user || null;

      if (currentUser) {
        dbMode = "supabase";
        await loadFromSupabase();
        renderHome();
        toast("Cloud sync active.");
      } else {
        dbMode = "local";
        loadLocal();
        renderHome();
      }

      updateSyncBadge();
    });

  } catch (e) {
    console.warn("Supabase unavailable. Using local storage.", e);
    dbMode = "local";
  }

  updateSyncBadge();
}

function loadLocal() {
  try {
    state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { workouts: [] };
    if (!Array.isArray(state.workouts)) state.workouts = [];
  } catch {
    state = { workouts: [] };
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadFromSupabase() {
  const { data: userData } = await supabaseClient.auth.getUser();
  const user = userData?.user;
  if (!user) return loadLocal();

  const { data, error } = await supabaseClient
    .from("workouts")
    .select("id, workout_date, notes, workout_items(exercise_name, weight, completed)")
    .eq("user_id", user.id)
    .order("workout_date", { ascending: true });

  if (error) throw error;

  state.workouts = (data || []).map(w => ({
    id: w.id,
    date: w.workout_date,
    notes: w.notes || "",
    items: (w.workout_items || []).map(i => ({
      exercise: i.exercise_name,
      weight: Number(i.weight || 0),
      completed: !!i.completed
    }))
  }));
  saveLocal();
}

async function persistWorkout(workout) {
  const existingIndex = state.workouts.findIndex(w => w.date === workout.date);
  if (existingIndex >= 0) state.workouts[existingIndex] = workout;
  else state.workouts.push(workout);
  state.workouts.sort((a,b) => a.date.localeCompare(b.date));
  saveLocal();

  if (dbMode === "supabase" && supabaseClient) {
    try {
      const { data: userData } = await supabaseClient.auth.getUser();
      const user = userData?.user;
      if (!user) return;

      const { data: existing } = await supabaseClient
        .from("workouts")
        .select("id")
        .eq("user_id", user.id)
        .eq("workout_date", workout.date)
        .maybeSingle();

      let workoutId = existing?.id;

      if (workoutId) {
        const { error: updErr } = await supabaseClient
          .from("workouts")
          .update({ notes: workout.notes || "" })
          .eq("id", workoutId)
          .eq("user_id", user.id);
        if (updErr) throw updErr;
        await supabaseClient.from("workout_items").delete().eq("workout_id", workoutId);
      } else {
        const { data: created, error: insErr } = await supabaseClient
          .from("workouts")
          .insert({ user_id: user.id, workout_date: workout.date, notes: workout.notes || "" })
          .select("id")
          .single();
        if (insErr) throw insErr;
        workoutId = created.id;
      }

      const rows = workout.items.map(i => ({
        workout_id: workoutId,
        exercise_name: i.exercise,
        weight: Number(i.weight || 0),
        completed: !!i.completed
      }));

      const { error: itemErr } = await supabaseClient.from("workout_items").insert(rows);
      if (itemErr) throw itemErr;
    } catch (e) {
      console.error(e);
      toast("Saved locally; cloud sync failed.");
    }
  }
}

function updateSyncBadge() {
  if (currentUser) {
    $("syncBadge").textContent = "☁ Cloud";
    $("syncBadge").title = currentUser.email || "Cloud sync active";
  } else {
    $("syncBadge").textContent = "Local";
    $("syncBadge").title = "Tap to sign in and enable cloud sync";
  }
}

async function showAuthDialog() {
  if (!supabaseClient) {
    toast("Supabase is not configured.");
    return;
  }

  if (currentUser) {
    const signOut = confirm(
      `Signed in as ${currentUser.email}\n\nSign out of cloud sync?`
    );

    if (signOut) {
      await supabaseClient.auth.signOut();
      toast("Signed out. Using local storage.");
    }

    return;
  }

  const email = prompt(
    "Enter your email address to receive a secure Bowflex Progress sign-in link:"
  );

  if (!email) return;

  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.href.split("#")[0]
      }
    });

    if (error) throw error;

    alert(
      "Check your email.\n\nSupabase sent you a secure sign-in link. Tap the link and you'll return to Bowflex Progress."
    );

  } catch (error) {
    console.error(error);
    alert("Couldn't send the magic link:\n\n" + error.message);
  }
}
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id === "homeView") renderHome();
  if (id === "trendsView") renderTrends();
}

function latestWeightFor(exercise, beforeDate = "9999-12-31") {
  const matches = [];
  for (const w of state.workouts) {
    if (w.date > beforeDate) continue;
    const item = w.items?.find(i => i.exercise === exercise && i.completed);
    if (item) matches.push({ date: w.date, weight: Number(item.weight || 0) });
  }
  matches.sort((a,b) => a.date.localeCompare(b.date));
  return matches.at(-1) || null;
}

function renderWorkout(date = localDateISO()) {
  $("workoutDate").value = date;
  const existing = state.workouts.find(w => w.date === date);
  $("workoutNotes").value = existing?.notes || "";
  const container = $("exerciseList");
  container.innerHTML = "";

  EXERCISES.forEach((name, idx) => {
    const existingItem = existing?.items?.find(i => i.exercise === name);
    const last = latestWeightFor(name, date);
    const weight = existingItem?.weight ?? last?.weight ?? 0;
    const completed = !!existingItem?.completed;

    const card = document.createElement("div");
    card.className = `exercise-card ${completed ? "completed" : ""}`;
    card.dataset.exercise = name;
    card.innerHTML = `
      <div class="exercise-top">
        <div>
          <div class="exercise-name">${name}</div>
          <div class="last-used">${last ? `Last: ${last.weight} lb on ${shortDate(last.date)}` : "No prior weight recorded"}</div>
        </div>
        <label class="done-label">
          <input class="done-check" type="checkbox" ${completed ? "checked" : ""}>
          Done
        </label>
      </div>
      <div class="weight-row">
        <label>
          Weight today
          <div class="weight-input-wrap">
            <input class="weight-input" type="number" min="0" step="5" value="${weight}">
            <span class="weight-unit">lb</span>
          </div>
        </label>
        <div class="stepper">
          <button class="minus" type="button">−</button>
          <button class="plus" type="button">+</button>
        </div>
      </div>
    `;
    card.querySelector(".done-check").addEventListener("change", e => {
      card.classList.toggle("completed", e.target.checked);
    });
    card.querySelector(".minus").addEventListener("click", () => {
      const input = card.querySelector(".weight-input");
      input.value = Math.max(0, Number(input.value || 0) - 5);
    });
    card.querySelector(".plus").addEventListener("click", () => {
      const input = card.querySelector(".weight-input");
      input.value = Number(input.value || 0) + 5;
    });
    container.appendChild(card);
  });
}

async function saveWorkout() {
  const date = $("workoutDate").value;
  if (!date) return toast("Choose a workout date.");
  const items = [...document.querySelectorAll(".exercise-card")].map(card => ({
    exercise: card.dataset.exercise,
    weight: Number(card.querySelector(".weight-input").value || 0),
    completed: card.querySelector(".done-check").checked
  }));
  const completed = items.filter(i => i.completed).length;
  if (!completed) return toast("Check at least one completed exercise.");

  await persistWorkout({
    id: state.workouts.find(w => w.date === date)?.id,
    date,
    notes: $("workoutNotes").value.trim(),
    items
  });
  toast(`Workout saved — ${completed} exercise${completed === 1 ? "" : "s"}.`);
  renderHome();
  setTimeout(() => showView("homeView"), 450);
}

function renderHome() {
  const completedWorkouts = state.workouts
    .filter(w => w.items?.some(i => i.completed))
    .sort((a,b) => a.date.localeCompare(b.date));
  const last = completedWorkouts.at(-1);

  $("lastWorkoutDate").textContent = last ? prettyDate(last.date) : "No workouts yet";
  $("lastWorkoutSummary").textContent = last
    ? `${last.items.filter(i => i.completed).length} of ${EXERCISES.length} exercises completed`
    : "Start your first session.";

  const today = new Date(`${localDateISO()}T12:00:00`);
  const weekStart = startOfWeek(today);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  $("weekCount").textContent = completedWorkouts.filter(w => new Date(`${w.date}T12:00:00`) >= weekStart).length;
  $("monthCount").textContent = completedWorkouts.filter(w => new Date(`${w.date}T12:00:00`) >= thirtyDaysAgo).length;
  $("streakCount").textContent = calculateWeeklyStreak(completedWorkouts);
}

function calculateWeeklyStreak(workouts) {
  if (!workouts.length) return 0;
  const weekKeys = new Set(workouts.map(w => {
    const s = startOfWeek(new Date(`${w.date}T12:00:00`));
    return localDateISO(s);
  }));
  let cursor = startOfWeek(new Date());
  let streak = 0;
  while (weekKeys.has(localDateISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  if (streak === 0) {
    cursor = startOfWeek(new Date());
    cursor.setDate(cursor.getDate() - 7);
    while (weekKeys.has(localDateISO(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
  }
  return streak;
}

function renderTrends() {
  renderCalendar();
  populateExerciseSelect();
  renderWeeklyChart();
  renderWeightChart();
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("calendarTitle").textContent = calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const grid = $("calendarGrid");
  grid.innerHTML = "";
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const workoutDates = new Set(state.workouts.filter(w => w.items?.some(i => i.completed)).map(w => w.date));

  for (let i = 0; i < first.getDay(); i++) {
    const blank = document.createElement("div");
    blank.className = "day blank";
    grid.appendChild(blank);
  }

  for (let day = 1; day <= last.getDate(); day++) {
    const d = new Date(year, month, day, 12);
    const iso = localDateISO(d);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day";
    btn.textContent = day;
    if (workoutDates.has(iso)) btn.classList.add("workout-day");
    if (iso === localDateISO()) btn.classList.add("today");
    btn.addEventListener("click", () => showDayDetail(iso));
    grid.appendChild(btn);
  }
}

function showDayDetail(iso) {
  const panel = $("dayDetail");
  const workout = state.workouts.find(w => w.date === iso);
  if (!workout) {
    panel.classList.add("hidden");
    return;
  }
  const done = workout.items.filter(i => i.completed);
  panel.innerHTML = `
    <div class="day-detail-title">${prettyDate(iso)}</div>
    ${done.map(i => `<div class="day-detail-item"><span>${i.exercise}</span><strong>${i.weight} lb</strong></div>`).join("")}
    ${workout.notes ? `<p class="muted" style="margin-top:12px">${escapeHtml(workout.notes)}</p>` : ""}
  `;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function populateExerciseSelect() {
  const select = $("exerciseSelect");
  const prior = select.value;
  select.innerHTML = EXERCISES.map(e => `<option>${e}</option>`).join("");
  if (EXERCISES.includes(prior)) select.value = prior;
}

function weeklyBuckets(count = 8) {
  const result = [];
  const current = startOfWeek(new Date());
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(current);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const value = state.workouts.filter(w => {
      if (!w.items?.some(i => i.completed)) return false;
      const d = new Date(`${w.date}T12:00:00`);
      return d >= start && d <= end;
    }).length;
    result.push({ label: shortDate(localDateISO(start)), value });
  }
  return result;
}

function renderWeeklyChart() {
  drawBarChart($("weeklyChart"), weeklyBuckets());
}

function weightSeries(exercise) {
  return state.workouts
    .map(w => {
      const item = w.items?.find(i => i.exercise === exercise && i.completed);
      return item ? { date: w.date, value: Number(item.weight || 0) } : null;
    })
    .filter(Boolean)
    .sort((a,b) => a.date.localeCompare(b.date));
}

function renderWeightChart() {
  const exercise = $("exerciseSelect").value || EXERCISES[0];
  const series = weightSeries(exercise);
  const values = series.map(p => p.value);
  const current = values.at(-1);
  const start = values[0];
  const best = values.length ? Math.max(...values) : null;
  const change = values.length ? current - start : null;
  const pct = values.length && start ? (change / start) * 100 : null;

  $("metricCurrent").textContent = current != null ? `${current} lb` : "—";
  $("metricStart").textContent = start != null ? `${start} lb` : "—";
  $("metricBest").textContent = best != null ? `${best} lb` : "—";
  $("metricChange").textContent = change != null
    ? `${change >= 0 ? "+" : ""}${change} lb${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}`
    : "—";

  drawLineChart($("weightChart"), series.map(p => ({ label: shortDate(p.date), value: p.value })));
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssHeight = Number(canvas.getAttribute("height")) || 220;
  canvas.width = Math.max(320, rect.width) * ratio;
  canvas.height = cssHeight * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, w: Math.max(320, rect.width), h: cssHeight };
}

function drawBarChart(canvas, data) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  const pad = { l: 34, r: 10, t: 12, b: 42 };
  const max = Math.max(3, ...data.map(d => d.value));
  ctx.strokeStyle = "#e5e7eb";
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui";

  for (let y = 0; y <= max; y++) {
    const py = pad.t + (h - pad.t - pad.b) * (1 - y/max);
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(w-pad.r, py); ctx.stroke();
    ctx.fillText(String(y), 10, py + 4);
  }

  const plotW = w - pad.l - pad.r;
  const gap = 8;
  const bw = (plotW - gap * (data.length - 1)) / data.length;

  data.forEach((d, i) => {
    const bh = (h - pad.t - pad.b) * d.value / max;
    const x = pad.l + i * (bw + gap);
    const y = h - pad.b - bh;
    ctx.fillStyle = "#b91c1c";
    roundRect(ctx, x, y, bw, bh, 7, true, false);
    ctx.save();
    ctx.translate(x + bw/2, h - 10);
    ctx.rotate(-0.45);
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "right";
    ctx.fillText(d.label, 0, 0);
    ctx.restore();
  });
}

function drawLineChart(canvas, data) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  if (!data.length) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Complete this exercise to start a trend line.", w/2, h/2);
    return;
  }

  const pad = { l: 46, r: 14, t: 18, b: 42 };
  const vals = data.map(d => d.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min = Math.max(0, min - 10); max = max + 10; }
  else { min = Math.max(0, min - 5); max += 5; }

  ctx.strokeStyle = "#e5e7eb";
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui";
  ctx.textAlign = "right";

  for (let i = 0; i <= 4; i++) {
    const v = min + (max-min) * i/4;
    const y = h-pad.b - (h-pad.t-pad.b)*i/4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w-pad.r, y); ctx.stroke();
    ctx.fillText(`${Math.round(v)}`, pad.l-8, y+4);
  }

  const xFor = i => data.length === 1 ? pad.l + (w-pad.l-pad.r)/2 : pad.l + (w-pad.l-pad.r) * i/(data.length-1);
  const yFor = v => h-pad.b - (h-pad.t-pad.b) * (v-min)/(max-min);

  ctx.strokeStyle = "#b91c1c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  data.forEach((d,i) => {
    const x=xFor(i), y=yFor(d.value);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  data.forEach((d,i) => {
    const x=xFor(i), y=yFor(d.value);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#b91c1c";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill(); ctx.stroke();
  });

  const labelIndexes = data.length <= 6 ? data.map((_,i)=>i) : [0, Math.floor((data.length-1)/2), data.length-1];
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  labelIndexes.forEach(i => ctx.fillText(data[i].label, xFor(i), h-14));
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  if (height < 0) return;
  const r = Math.min(radius, width/2, height/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+width,y,x+width,y+height,r);
  ctx.arcTo(x+width,y+height,x,y+height,r); ctx.arcTo(x,y+height,x,y,r);
  ctx.arcTo(x,y,x+width,y,r); ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}
$("syncBadge").addEventListener("click", showAuthDialog);
$("startWorkoutBtn").addEventListener("click", () => {
  renderWorkout(localDateISO());
  showView("workoutView");
});
$("trendsBtn").addEventListener("click", () => showView("trendsView"));
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.go)));
$("workoutDate").addEventListener("change", e => renderWorkout(e.target.value));
$("saveWorkoutBtn").addEventListener("click", saveWorkout);
$("prevMonth").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()-1, 1);
  renderCalendar();
});
$("nextMonth").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth()+1, 1);
  renderCalendar();
});
$("exerciseSelect").addEventListener("change", renderWeightChart);
window.addEventListener("resize", () => {
  if ($("trendsView").classList.contains("active")) {
    renderWeeklyChart();
    renderWeightChart();
  }
});

(async function init() {
  $("workoutDate").value = localDateISO();
  await initDataLayer();
  renderHome();
  populateExerciseSelect();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
})();
