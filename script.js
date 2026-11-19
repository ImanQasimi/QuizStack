const API_BASE = window.location.port === "3000" ? "" : "http://localhost:3000";

async function apiRequest(url, options) {
  const response = await fetch(`${API_BASE}${url}`, options);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The quiz API returned a webpage instead of JSON. Start the app with npm start and open http://localhost:3000.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function apiGetQuizzes() {
  return apiRequest("/api/quizzes");
}

async function apiGetQuiz(id) {
  return apiRequest(`/api/quizzes/${id}`);
}

async function apiSubmit(id, answers) {
  return apiRequest(`/api/quizzes/${id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

/* ---------------- UI ---------------- */
const $ = (s) => document.querySelector(s);
const state = { quizzes: [], quiz: null, answers: {}, index: 0, retry: null };
const TYPE_LABEL = { "multiple-choice": "Multiple choice", "true-false": "True / False", "short-answer": "Short answer" };

function show(view) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  window.scrollTo(0, 0);
}
function setLoading(on, text = "Loading…") {
  $("#loading").hidden = !on; $("#loading-text").textContent = text;
}
function showError(msg, retryFn) {
  $("#error-text").textContent = msg; state.retry = retryFn; $("#error-banner").hidden = false;
}
function clearError() { $("#error-banner").hidden = true; }

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  kids.flat().forEach((k) => n.append(k));
  return n;
}

/* ----- Home ----- */
async function loadHome() {
  clearError(); show("home"); setLoading(true, "Loading quizzes…");
  try {
    state.quizzes = await apiGetQuizzes();
    renderHome();
  } catch (e) { showError(e.message, loadHome); }
  finally { setLoading(false); }
}

function renderHome() {
  const grid = $("#quiz-grid"); grid.replaceChildren();
  state.quizzes.forEach((q) => {
    grid.append(
      el("article", { class: "quiz-card" },
        el("div", { class: "meta" },
          el("span", { class: `chip ${q.difficulty}` }, q.difficulty),
          el("span", { class: "chip" }, `${q.questionCount} questions`)),
        el("h3", {}, q.title),
        el("p", {}, q.description),
        el("button", { class: "btn", type: "button", onclick: () => startQuiz(q.id) }, "Start quiz →"))
    );
  });
}

/* ----- Quiz ----- */
async function startQuiz(id) {
  clearError(); setLoading(true, "Loading quiz…");
  try {
    state.quiz = await apiGetQuiz(id);
    state.answers = {}; state.index = 0;
    $("#quiz-title").textContent = state.quiz.title;
    $("#quiz-subject").textContent = state.quiz.subject;
    show("quiz"); renderQuestion();
  } catch (e) { showError(e.message, () => startQuiz(id)); }
  finally { setLoading(false); }
}

function renderQuestion() {
  const { quiz, index, answers } = state;
  const q = quiz.questions[index];
  const total = quiz.questions.length;
  const card = $("#question-card"); card.replaceChildren();

  card.append(
    el("span", { class: "chip qtype" }, TYPE_LABEL[q.type]),
    el("h3", {}, `${index + 1}. ${q.text}`)
  );

  if (q.type === "short-answer") {
    const input = el("input", { class: "short-answer", type: "text", placeholder: "Type your answer…", autocomplete: "off", "aria-label": "Your answer" });
    input.value = answers[q.id] ?? "";
    input.addEventListener("input", () => { setAnswer(q.id, input.value); updateChrome(); });
    card.append(input, el("p", { class: "hint" }, "Capitalization doesn't matter."));
  } else {
    const wrap = el("div", { class: "options", role: "radiogroup" });
    q.options.forEach((opt, i) => {
      const input = el("input", { type: "radio", name: `q${q.id}`, value: opt });
      input.checked = answers[q.id] === opt;
      input.addEventListener("change", () => { setAnswer(q.id, opt); updateChrome(); });
      wrap.append(el("label", { class: "option" }, input, el("span", { class: "key" }, String.fromCharCode(65 + i)), el("span", {}, opt)));
    });
    card.append(wrap);
  }
  updateChrome();
}

function setAnswer(id, val) {
  if (String(val).trim() === "") delete state.answers[id]; else state.answers[id] = val;
}

function updateChrome() {
  const { quiz, index, answers } = state;
  const total = quiz.questions.length;
  const done = quiz.questions.filter((q) => answers[q.id] !== undefined).length;

  $("#progress-bar").style.width = `${(done / total) * 100}%`;
  $("#progress-label").textContent = `Question ${index + 1} of ${total} · ${done} answered`;

  const nav = $("#qnav"); nav.replaceChildren();
  quiz.questions.forEach((q, i) => {
    const cls = ["qdot", answers[q.id] !== undefined ? "answered" : "", i === index ? "current" : ""].join(" ").trim();
    nav.append(el("button", { class: cls, type: "button", "aria-label": `Go to question ${i + 1}`, onclick: () => { state.index = i; renderQuestion(); } }, String(i + 1)));
  });

  $("#prev-btn").disabled = index === 0;
  $("#next-btn").textContent = index === total - 1 ? "Submit quiz ✓" : "Next →";
}

async function onNext() {
  const total = state.quiz.questions.length;
  if (state.index < total - 1) { state.index++; renderQuestion(); return; }
  const unanswered = state.quiz.questions.filter((q) => state.answers[q.id] === undefined).length;
  if (unanswered > 0) {
    $("#confirm-text").textContent = `You have ${unanswered} unanswered question${unanswered > 1 ? "s" : ""}. They'll be marked incorrect.`;
    const dlg = $("#confirm-dialog");
    dlg.addEventListener("close", () => { if (dlg.returnValue === "ok") submit(); }, { once: true });
    dlg.showModal();
  } else submit();
}

async function submit() {
  clearError(); setLoading(true, "Scoring your answers and writing feedback…");
  try {
    const res = await apiSubmit(state.quiz.id, state.answers);
    renderResults(res);
  } catch (e) { showError(e.message, submit); }
  finally { setLoading(false); }
}

/* ----- Results ----- */
function renderResults({ score, total, results, feedback, aiFeedbackAvailable }) {
  const pct = Math.round((score / total) * 100);
  const ring = $("#score-ring");
  ring.className = "score-ring" + (pct < 40 ? " low" : pct < 70 ? " mid" : "");
  ring.style.setProperty("--pct", pct);
  $("#score-pct").textContent = `${pct}%`;
  $("#score-frac").textContent = `${score} / ${total} correct`;
  $("#results-title").textContent = state.quiz.title;
  $("#results-summary").textContent = pct >= 70 ? "Nice work!" : "Keep going, you're learning.";

  const ai = $("#ai-feedback");
  ai.replaceChildren(el("p", {}, feedback.summary));
  if (!aiFeedbackAvailable) {
    ai.append(el("p", { class: "muted" }, "AI feedback is unavailable; short answers used exact-match grading."));
  }
  if (feedback.strengths?.length) {
    ai.append(el("h4", {}, "Strengths"), el("ul", {}, feedback.strengths.map((item) => el("li", {}, item))));
  }
  if (feedback.improvements?.length) {
    ai.append(el("h4", {}, "Areas to improve"), el("ul", {}, feedback.improvements.map((item) => el("li", {}, item))));
  }
  ai.append(el("p", {}, feedback.next));

  const list = $("#breakdown"); list.replaceChildren();
  results.forEach((r, i) => {
    const status = !r.answered ? "skipped" : r.correct ? "right" : "wrong";
    const label = !r.answered ? "Unanswered" : r.correct ? "Correct" : "Incorrect";
    const dl = el("dl", {},
      el("dt", {}, "Your answer"), el("dd", {}, r.yourAnswer ?? "—"));
    if (!r.correct) dl.append(el("dt", {}, "Correct answer"), el("dd", {}, r.correctAnswer));
    list.append(el("article", { class: `result-item ${status}` },
      el("h4", {}, `${i + 1}. ${r.text}`, el("span", { class: "tag" }, label)),
      dl,
      el("p", { class: "why" }, r.explanation)));
  });
  show("results");
}

/* ----- Wiring ----- */
$("#next-btn").addEventListener("click", onNext);
$("#prev-btn").addEventListener("click", () => { if (state.index > 0) { state.index--; renderQuestion(); } });
$("#quit-btn").addEventListener("click", () => { if (confirm("Exit this quiz? Your answers will be lost.")) loadHome(); });
$("#retake-btn").addEventListener("click", () => startQuiz(state.quiz.id));
$("#home-btn").addEventListener("click", loadHome);
$("#brand").addEventListener("click", (e) => { e.preventDefault(); loadHome(); });
$("#error-retry").addEventListener("click", () => { clearError(); state.retry && state.retry(); });

loadHome();