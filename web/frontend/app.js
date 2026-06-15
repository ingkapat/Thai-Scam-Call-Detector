/* Thai Scam Call Detection — front-end
 * Real upload: backend precomputes overlap sliding-window predictions (exp2_2),
 * then the uploaded audio PLAYS and predictions are revealed in sync with playback.
 * Demo button: canned overlap-window data revealed on a timer (no audio).
 *
 * Backend endpoint via window.API_URL (config.js). "" => demo fallback.
 */

const API_URL = window.API_URL || "";
const SCAM_THRESHOLD = 0.7;
const ROUND_MS = 700;          // demo reveal speed per window
const CHUNK_SEC = 5;

// ---- demo data: overlap sliding windows (0-5, 0-10, 0-15, 5-20, ...) ----------
const DEMO_ROUNDS = [
  { window: "0-5s",   window_end: 5,  prob: 0.05, transcript: "สวัสดีครับ" },
  { window: "0-10s",  window_end: 10, prob: 0.04, transcript: "ผมโทรจากธนาคารนะครับ" },
  { window: "0-15s",  window_end: 15, prob: 0.12, transcript: "มีเรื่องด่วนเกี่ยวกับบัญชีของคุณ" },
  { window: "5-20s",  window_end: 20, prob: 0.28, transcript: "ตอนนี้บัญชีคุณถูกอายัดชั่วคราว" },
  { window: "10-25s", window_end: 25, prob: 0.55, transcript: "ต้องยืนยันตัวตนด่วน ไม่งั้นเงินจะหาย" },
  { window: "15-30s", window_end: 30, prob: 0.78, transcript: "กรุณาแจ้งเลขบัตรประชาชนและรหัส OTP" },
  { window: "20-35s", window_end: 35, prob: 0.93, transcript: "โอนเงินมาที่บัญชีปลอดภัยนี้ก่อนนะครับ" },
  { window: "25-40s", window_end: 40, prob: 0.97, transcript: "รีบทำเลย ห้ามบอกใครเด็ดขาด" },
  { window: "30-45s", window_end: 45, prob: 0.95, transcript: "ไม่งั้นคุณจะมีความผิดทางกฎหมาย" },
  { window: "35-50s", window_end: 50, prob: 0.88, transcript: "ทำตามที่ผมบอกแล้วจะปลอดภัย" },
  { window: "40-55s", window_end: 55, prob: 0.52, transcript: "ขอบคุณที่ให้ความร่วมมือครับ" },
  { window: "45-60s", window_end: 60, prob: 0.18, transcript: "สวัสดีครับ" },
];

// ---- elements --------------------------------------------------------------
const player    = document.getElementById("player");
const phone     = document.getElementById("phone");
const frames = {
  ringing: document.getElementById("frame-ringing"),
  sliding: document.getElementById("frame-sliding"),
  incall:  document.getElementById("frame-incall"),
};
const screenSleep = document.getElementById("screen-sleep");
const callTimer   = document.getElementById("call-timer");
const noti        = document.getElementById("noti");
const notiBody    = document.getElementById("noti-body");
const caption     = document.getElementById("phone-caption");

const bigProb   = document.getElementById("big-prob");
const bigTag    = document.getElementById("big-tag");
const bigBar    = document.getElementById("big-bar");
const logEl     = document.getElementById("log");
const logStatus = document.getElementById("log-status");
const apiState  = document.getElementById("api-state");

const fileInput = document.getElementById("file-input");
const btnDemo   = document.getElementById("btn-demo");
const btnClear  = document.getElementById("btn-clear");

let timers = [];
let demoTimer = null;
let maxP = 0, notiShown = false;
let awaitingTap = false, pendingRounds = null, currentURL = null;

if (API_URL) apiState.innerHTML = `connected: <span class="live">${API_URL}</span>`;

// ---- helpers ---------------------------------------------------------------
function clearTimers() {
  timers.forEach(clearTimeout); timers = [];
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
}
function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

function showFrame(name) {
  screenSleep.hidden = name !== "sleep";
  Object.entries(frames).forEach(([k, el]) => { el.hidden = k !== name; });
  callTimer.hidden = name !== "incall";
}
function setCaption(t) { caption.textContent = t; }

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
function updateTimer(sec) { callTimer.textContent = fmtTime(sec); }

function bar(prob) {
  const total = 20;
  const filled = Math.round(prob * total);
  const cls = prob > SCAM_THRESHOLD ? "log-bar-hi" : prob > 0.3 ? "log-bar-mid" : "log-bar-lo";
  return `<span class="${cls}">${"█".repeat(filled)}</span>` +
         `<span class="log-bar-empty">${"░".repeat(total - filled)}</span>`;
}
function pad(s, n) { return (s + " ".repeat(n)).slice(0, n); }

function appendLog(r) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML =
    `<span class="log-ts">[${pad(r.window, 8)}]</span> ` +
    `<span class="log-prob">${r.prob.toFixed(2)}</span> ${bar(r.prob)}`;
  logEl.appendChild(line);
  if (r.transcript) {
    const tx = document.createElement("div");
    tx.className = "log-tx";
    tx.textContent = `"${r.transcript}"`;
    logEl.appendChild(tx);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function setOverall(p) {
  bigProb.textContent = p.toFixed(2);
  bigBar.style.width = (p * 100) + "%";
  bigProb.style.color = p > SCAM_THRESHOLD ? "var(--danger)" : p > 0.3 ? "var(--warn)" : "var(--ink)";
  bigTag.className = "big-tag" + (p > SCAM_THRESHOLD ? " scam" : p > 0.3 ? " warn" : "");
  bigTag.textContent = p > SCAM_THRESHOLD ? "SCAM" : p > 0.3 ? "suspicious" : "analyzing";
}

function fireNoti(prob) {
  notiBody.textContent = `Confidence ${prob.toFixed(2)} — high-risk keywords detected`;
  noti.hidden = false;
  requestAnimationFrame(() => noti.classList.add("show"));
  phone.classList.add("buzz");
  later(() => phone.classList.remove("buzz"), 900);
}

function startReveal() {
  logEl.innerHTML = "";
  maxP = 0; notiShown = false;
  logStatus.textContent = "streaming";
  logStatus.className = "log-status running";
}

function revealRound(r) {
  appendLog(r);
  if (r.prob > maxP) { maxP = r.prob; setOverall(maxP); }
  if (r.prob > SCAM_THRESHOLD && !notiShown) { notiShown = true; fireNoti(r.prob); }
}

function startRinging(text) {
  showFrame("ringing");
  phone.classList.add("ringing");
  setCaption(text || "Incoming call…");
}

function enterInCall(text) {
  showFrame("sliding");
  later(() => {
    phone.classList.remove("ringing");
    showFrame("incall");
    setCaption(text || "On call — analyzing audio");
  }, 500);
}

// ---- real: play uploaded audio + reveal predictions in sync -----------------
function playSynced(rounds) {
  if (!rounds.length) { hangUp(); return; }
  startReveal();
  let nextIdx = 0;

  player.ontimeupdate = () => {
    updateTimer(player.currentTime);
    while (nextIdx < rounds.length && player.currentTime >= rounds[nextIdx].window_end) {
      revealRound(rounds[nextIdx]); nextIdx++;
    }
  };
  player.onended = () => {
    while (nextIdx < rounds.length) { revealRound(rounds[nextIdx]); nextIdx++; }
    logStatus.textContent = "done"; logStatus.className = "log-status done";
    later(() => setCaption("Call ended — analysis complete"), 150);
    later(hangUp, 1600);
  };

  tryAnswer(rounds);
}

function tryAnswer(rounds) {
  player.currentTime = 0;
  player.play().then(() => {
    awaitingTap = false;
    enterInCall("On call — analyzing live audio");
  }).catch(() => {
    // autoplay blocked — wait for a tap on the phone
    awaitingTap = true;
    pendingRounds = rounds;
    setCaption("📞 Tap the phone to answer");
  });
}

phone.addEventListener("click", () => {
  if (awaitingTap && pendingRounds) {
    awaitingTap = false;
    const r = pendingRounds; pendingRounds = null;
    tryAnswer(r);
  }
});

// ---- demo: timed reveal, no audio ------------------------------------------
function playDemo(rounds) {
  startRinging("Incoming call — auto-answering…");
  later(() => enterInCall("On call — analyzing audio"), 1400);
  later(() => {
    startReveal();
    let i = 0;
    demoTimer = setInterval(() => {
      if (i >= rounds.length) {
        clearInterval(demoTimer); demoTimer = null;
        logStatus.textContent = "done"; logStatus.className = "log-status done";
        later(() => setCaption("Call ended — analysis complete"), 150);
        later(hangUp, 1600);
        return;
      }
      const r = rounds[i];
      revealRound(r);
      updateTimer(r.window_end);
      i++;
    }, ROUND_MS);
  }, 2000);
}

function hangUp() {
  player.pause();
  showFrame("sleep");
  setCaption("Phone is sleeping — analysis complete");
}

function reset() {
  clearTimers();
  player.pause();
  player.ontimeupdate = null; player.onended = null;
  if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }
  player.removeAttribute("src"); player.load();
  awaitingTap = false; pendingRounds = null;
  phone.classList.remove("ringing", "buzz");
  showFrame("sleep");
  noti.hidden = true; noti.classList.remove("show");
  setCaption("Phone is sleeping — upload an mp3 to simulate a call");
  bigProb.textContent = "—"; bigProb.style.color = "var(--ink)";
  bigBar.style.width = "0%";
  bigTag.className = "big-tag"; bigTag.textContent = "awaiting";
  updateTimer(0);
  logEl.innerHTML = `<div class="log-hint">// predictions will stream here once a call starts</div>`;
  logStatus.textContent = "idle"; logStatus.className = "log-status";
}

// ---- backend call ----------------------------------------------------------
async function analyze(file) {
  const fd = new FormData();
  fd.append("file", file);
  logStatus.textContent = "analyzing…"; logStatus.className = "log-status running";
  const res = await fetch(`${API_URL}/analyze`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.rounds || data;
}

// ---- events ----------------------------------------------------------------
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  reset();

  if (!API_URL) {                       // no backend (e.g. plain Vercel) — show demo
    setCaption("No backend connected — showing demo");
    playDemo(DEMO_ROUNDS);
    fileInput.value = "";
    return;
  }

  currentURL = URL.createObjectURL(file);
  player.src = currentURL;
  startRinging("Incoming call — analyzing audio…");
  try {
    const rounds = await analyze(file);
    playSynced(rounds);
  } catch (err) {
    setCaption(`Backend error: ${err.message} — showing demo`);
    playDemo(DEMO_ROUNDS);
  }
  fileInput.value = "";
});

btnDemo.addEventListener("click", () => { reset(); playDemo(DEMO_ROUNDS); });
btnClear.addEventListener("click", reset);

reset();
