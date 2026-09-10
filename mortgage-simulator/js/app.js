(function () {
  "use strict";

  var STORAGE_KEY = "mortgage-sim-scenarios-v1";
  var PALETTE = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
    "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

  function resolveColor(cssVar) {
    return getComputedStyle(document.body).getPropertyValue(cssVar.replace(/^var\((.*)\)$/, "$1")).trim() || cssVar;
  }

  function defaultLoan(name, principal, rate, term, year, month) {
    return {
      name: name,
      principal: principal,
      rate: rate,
      term: term,
      startYear: year,
      startMonth: month,
      rateChanges: [],
      extraPayments: []
    };
  }

  function sampleState() {
    return {
      scenarioName: "ベースシナリオ",
      loanBEnabled: true,
      loanA: defaultLoan("とも", 26000000, 0.775, 35, 2016, 1),
      loanB: defaultLoan("まい", 12800000, 0.675, 35, 2016, 1)
    };
  }

  var state = sampleState();

  // ---------- ユーティリティ ----------
  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }
  function toNumber(str) {
    if (typeof str === "number") return str;
    var n = parseFloat(String(str).replace(/[,\s円]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function toInt(str) {
    var n = parseInt(String(str).replace(/[,\s円]/g, ""), 10);
    return isNaN(n) ? 0 : n;
  }
  function formatYen(v) { return Math.round(v).toLocaleString("ja-JP") + "円"; }
  function formatMan(v) { return (v / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "万円"; }
  function formatYm(y, m) { return y + "年" + m + "月"; }

  // input[type=month] の値 <-> {year, month}
  function toMonthInputValue(year, month) {
    if (!year || !month) return "";
    return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0");
  }
  function parseMonthInputValue(str, fallback) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(str || ""));
    if (!m) return fallback;
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }

  // 金額入力: フォーカス中は生の数字、フォーカスを外すと桁区切り表示にする
  function bindMoneyField(input, get, set) {
    input.addEventListener("focus", function () {
      var v = get();
      input.value = v ? String(v) : "";
    });
    input.addEventListener("input", function () {
      set(toInt(input.value));
    });
    input.addEventListener("blur", function () {
      input.value = get().toLocaleString("ja-JP");
    });
  }

  // ---------- ローン計算 ----------
  function toEngineConfig(loan) {
    return {
      principal: loan.principal,
      annualRatePercent: loan.rate,
      termYears: loan.term,
      startYear: loan.startYear,
      startMonth: loan.startMonth,
      rateChanges: loan.rateChanges,
      extraPayments: loan.extraPayments
    };
  }

  function computeSchedules() {
    var schedA = Amortization.buildSchedule(toEngineConfig(state.loanA));
    var schedB = state.loanBEnabled ? Amortization.buildSchedule(toEngineConfig(state.loanB)) : null;
    var combined = schedB ? Amortization.combineSchedules(schedA, schedB) : schedA;
    return { schedA: schedA, schedB: schedB, combined: combined };
  }

  // ---------- ローンカードの構築 ----------
  function buildLoanCard(key) {
    var container = document.getElementById(key === "A" ? "loanCardA" : "loanCardB");
    var tpl = document.getElementById("loanCardTemplate");
    container.innerHTML = "";
    container.appendChild(tpl.content.cloneNode(true));
    container.dataset.loanKey = key;
    syncLoanCardFromState(key);
    wireLoanCard(key);
  }

  function syncLoanCardFromState(key) {
    var loan = state[key === "A" ? "loanA" : "loanB"];
    var card = document.getElementById(key === "A" ? "loanCardA" : "loanCardB");
    card.querySelector(".loan-name").value = loan.name;
    card.querySelector(".f-principal").value = loan.principal.toLocaleString("ja-JP");
    card.querySelector(".f-principal-hint").textContent = "(" + formatMan(loan.principal) + ")";
    card.querySelector(".f-rate").value = loan.rate;
    card.querySelector(".f-term").value = loan.term;
    card.querySelector(".f-start-ym").value = toMonthInputValue(loan.startYear, loan.startMonth);
    renderRateChangeRows(key);
    renderExtraPaymentRows(key);
  }

  function renderRateChangeRows(key) {
    var loan = state[key === "A" ? "loanA" : "loanB"];
    var card = document.getElementById(key === "A" ? "loanCardA" : "loanCardB");
    var wrap = card.querySelector(".rate-change-rows");
    var tpl = document.getElementById("rateChangeRowTemplate");
    wrap.innerHTML = "";
    if (!loan.rateChanges.length) {
      wrap.innerHTML = '<p class="event-row-empty">金利変更なし（当初金利のまま）</p>';
      return;
    }
    loan.rateChanges.forEach(function (rc, idx) {
      var node = tpl.content.cloneNode(true);
      var row = node.querySelector(".event-row");
      row.dataset.index = idx;
      row.querySelector(".rc-ym").value = toMonthInputValue(rc.year, rc.month);
      row.querySelector(".rc-rate").value = rc.ratePercent;
      wrap.appendChild(node);
    });
  }

  function renderExtraPaymentRows(key) {
    var loan = state[key === "A" ? "loanA" : "loanB"];
    var card = document.getElementById(key === "A" ? "loanCardA" : "loanCardB");
    var wrap = card.querySelector(".extra-payment-rows");
    var tpl = document.getElementById("extraPaymentRowTemplate");
    wrap.innerHTML = "";
    if (!loan.extraPayments.length) {
      wrap.innerHTML = '<p class="event-row-empty">一部繰上返済なし</p>';
      return;
    }
    loan.extraPayments.forEach(function (ep, idx) {
      var node = tpl.content.cloneNode(true);
      var row = node.querySelector(".event-row");
      row.dataset.index = idx;
      row.querySelector(".ep-ym").value = toMonthInputValue(ep.year, ep.month);
      row.querySelector(".ep-amount").value = ep.amount.toLocaleString("ja-JP");
      row.querySelector(".ep-method").value = ep.method;
      wrap.appendChild(node);
    });
  }

  function wireLoanCard(key) {
    var card = document.getElementById(key === "A" ? "loanCardA" : "loanCardB");
    var loanRef = function () { return state[key === "A" ? "loanA" : "loanB"]; };

    card.querySelector(".loan-name").addEventListener("input", function (e) {
      loanRef().name = e.target.value || (key === "A" ? "ローンA" : "ローンB");
      scheduleRecompute();
    });
    bindMoneyField(
      card.querySelector(".f-principal"),
      function () { return loanRef().principal; },
      function (v) {
        loanRef().principal = v;
        card.querySelector(".f-principal-hint").textContent = "(" + formatMan(v) + ")";
        scheduleRecompute();
      }
    );
    card.querySelector(".f-rate").addEventListener("input", function (e) {
      loanRef().rate = toNumber(e.target.value);
      scheduleRecompute();
    });
    card.querySelector(".f-term").addEventListener("input", function (e) {
      loanRef().term = toNumber(e.target.value) || 1;
      scheduleRecompute();
    });
    card.querySelector(".f-start-ym").addEventListener("input", function (e) {
      var ym = parseMonthInputValue(e.target.value, null);
      if (!ym) return;
      loanRef().startYear = ym.year;
      loanRef().startMonth = ym.month;
      scheduleRecompute();
    });

    card.querySelector(".add-rate-change").addEventListener("click", function () {
      var loan = loanRef();
      var last = loan.rateChanges[loan.rateChanges.length - 1];
      loan.rateChanges.push({
        year: last ? last.year + 1 : loan.startYear + 1,
        month: last ? last.month : loan.startMonth,
        ratePercent: last ? last.ratePercent : loan.rate
      });
      renderRateChangeRows(key);
      scheduleRecompute();
    });
    card.querySelector(".add-extra-payment").addEventListener("click", function () {
      var loan = loanRef();
      var last = loan.extraPayments[loan.extraPayments.length - 1];
      loan.extraPayments.push({
        year: last ? last.year + 1 : loan.startYear + 1,
        month: last ? last.month : loan.startMonth,
        amount: last ? last.amount : 1000000,
        method: last ? last.method : "shorten"
      });
      renderExtraPaymentRows(key);
      scheduleRecompute();
    });

    card.querySelector(".rate-change-rows").addEventListener("input", function (e) {
      var row = e.target.closest(".event-row");
      if (!row) return;
      var idx = Number(row.dataset.index);
      var rc = loanRef().rateChanges[idx];
      if (e.target.classList.contains("rc-ym")) {
        var ym = parseMonthInputValue(e.target.value, null);
        if (ym) { rc.year = ym.year; rc.month = ym.month; }
      }
      if (e.target.classList.contains("rc-rate")) rc.ratePercent = toNumber(e.target.value);
      scheduleRecompute();
    });
    card.querySelector(".rate-change-rows").addEventListener("click", function (e) {
      if (!e.target.classList.contains("remove-row")) return;
      var row = e.target.closest(".event-row");
      var idx = Number(row.dataset.index);
      loanRef().rateChanges.splice(idx, 1);
      renderRateChangeRows(key);
      scheduleRecompute();
    });

    card.querySelector(".extra-payment-rows").addEventListener("input", function (e) {
      var row = e.target.closest(".event-row");
      if (!row) return;
      var idx = Number(row.dataset.index);
      var ep = loanRef().extraPayments[idx];
      if (e.target.classList.contains("ep-ym")) {
        var ym = parseMonthInputValue(e.target.value, null);
        if (ym) { ep.year = ym.year; ep.month = ym.month; }
      }
      if (e.target.classList.contains("ep-amount")) ep.amount = toInt(e.target.value);
      if (e.target.classList.contains("ep-method")) ep.method = e.target.value;
      scheduleRecompute();
    });
    card.querySelector(".extra-payment-rows").addEventListener("focus", function (e) {
      if (!e.target.classList.contains("ep-amount")) return;
      var row = e.target.closest(".event-row");
      var idx = Number(row.dataset.index);
      var ep = loanRef().extraPayments[idx];
      e.target.value = ep.amount ? String(ep.amount) : "";
    }, true);
    card.querySelector(".extra-payment-rows").addEventListener("blur", function (e) {
      if (!e.target.classList.contains("ep-amount")) return;
      var row = e.target.closest(".event-row");
      var idx = Number(row.dataset.index);
      var ep = loanRef().extraPayments[idx];
      e.target.value = ep.amount.toLocaleString("ja-JP");
    }, true);
    card.querySelector(".extra-payment-rows").addEventListener("click", function (e) {
      if (!e.target.classList.contains("remove-row")) return;
      var row = e.target.closest(".event-row");
      var idx = Number(row.dataset.index);
      loanRef().extraPayments.splice(idx, 1);
      renderExtraPaymentRows(key);
      scheduleRecompute();
    });
  }

  // ---------- 結果タブ ----------
  var showTable = false;

  function renderStatTiles(results) {
    var s = results.combined.summary;
    var totalPrincipal = state.loanA.principal + (state.loanBEnabled ? state.loanB.principal : 0);
    var initialPayment = results.schedA.summary.initialPayment + (results.schedB ? results.schedB.summary.initialPayment : 0);

    var tiles = [
      { label: "借入合計", value: formatYen(totalPrincipal), sub: formatMan(totalPrincipal) },
      { label: "総返済額", value: formatYen(s.totalPayment), sub: "うち繰上返済 " + formatYen(s.totalExtra) },
      { label: "総利息", value: formatYen(s.totalInterest) },
      { label: "完済予定", value: formatYm(s.payoffYear, s.payoffMonth), sub: s.monthsToPayoff + "回（" + (s.monthsToPayoff / 12).toFixed(1) + "年）" },
      { label: "初回の月々返済額", value: formatYen(initialPayment), sub: results.schedB ? (state.loanA.name + " " + formatYen(results.schedA.summary.initialPayment) + " / " + state.loanB.name + " " + formatYen(results.schedB.summary.initialPayment)) : "" }
    ];

    var host = document.getElementById("statTiles");
    host.innerHTML = tiles.map(function (t) {
      return '<div class="stat-tile"><div class="stat-label">' + t.label + '</div>' +
        '<div class="stat-value">' + t.value + '</div>' +
        (t.sub ? '<div class="stat-sub">' + t.sub + '</div>' : "") + '</div>';
    }).join("");
  }

  function toBalancePoints(schedule) {
    return schedule.rows.map(function (r) { return { idx: Charts.monthIndex(r.year, r.month), value: r.balance }; });
  }
  function toCumPoints(schedule, field) {
    var acc = 0;
    return schedule.rows.map(function (r) {
      acc += field === "principal" ? (r.principal + r.extra) : r[field];
      return { idx: Charts.monthIndex(r.year, r.month), value: acc };
    });
  }

  function renderBalanceChart(results) {
    var series = [];
    series.push({ key: "A", label: state.loanA.name, color: resolveColor(PALETTE[0]), points: toBalancePoints(results.schedA), pad: "zero" });
    if (results.schedB) {
      series.push({ key: "B", label: state.loanB.name, color: resolveColor(PALETTE[1]), points: toBalancePoints(results.schedB), pad: "zero" });
      series.push({ key: "T", label: "合計", color: resolveColor(PALETTE[2]), points: toBalancePoints(results.combined), pad: "zero" });
    }
    Charts.renderLineChart(document.getElementById("balanceChart"), {
      series: series,
      yFormat: formatMan
    });
  }

  function renderCumChart(results) {
    Charts.renderStackedArea(document.getElementById("cumChart"), {
      categories: [
        { key: "interest", label: "利息（累計）", color: resolveColor(PALETTE[1]), points: toCumPoints(results.combined, "interest") },
        { key: "principal", label: "元金（累計）", color: resolveColor(PALETTE[0]), points: toCumPoints(results.combined, "principal") }
      ],
      yFormat: formatMan
    });
  }

  function renderScheduleTable(results) {
    var wrap = document.getElementById("scheduleTableWrap");
    if (!showTable) { wrap.hidden = true; return; }
    wrap.hidden = false;

    var select = document.getElementById("scheduleSelect");
    var which = (select && select.value) || "combined";
    var schedule = which === "A" ? results.schedA : which === "B" ? results.schedB : results.combined;
    if (!schedule) schedule = results.combined;

    var selectorHtml = '<div class="btn-row" style="margin-bottom:0.6rem;"><select id="scheduleSelect">' +
      '<option value="combined"' + (which === "combined" ? " selected" : "") + '>合計</option>' +
      '<option value="A"' + (which === "A" ? " selected" : "") + '>' + state.loanA.name + '</option>' +
      (results.schedB ? '<option value="B"' + (which === "B" ? " selected" : "") + '>' + state.loanB.name + '</option>' : "") +
      '</select></div>';

    var lastYear = null;
    var rowsHtml = schedule.rows.map(function (r) {
      var yearHead = "";
      if (r.year !== lastYear) {
        lastYear = r.year;
        yearHead = '<tr class="year-head"><td colspan="6">' + r.year + '年</td></tr>';
      }
      var rowClass = r.extra > 0 ? "event-row-extra" : "";
      return yearHead + '<tr class="' + rowClass + '"><td>' + r.year + "年" + r.month + '月</td>' +
        "<td>" + (r.ratePercent !== undefined ? r.ratePercent.toFixed(3) + "%" : "-") + "</td>" +
        "<td>" + formatYen(r.payment) + "</td>" +
        "<td>" + formatYen(r.interest) + "</td>" +
        "<td>" + formatYen(r.principal + r.extra) + (r.extra > 0 ? "（繰上 " + formatYen(r.extra) + "）" : "") + "</td>" +
        "<td>" + formatYen(r.balance) + "</td></tr>";
    }).join("");

    wrap.innerHTML = selectorHtml +
      '<table class="sched"><thead><tr><th>年月</th><th>金利</th><th>返済額</th><th>利息</th><th>元金</th><th>残高</th></tr></thead><tbody>' +
      rowsHtml + "</tbody></table>";

    document.getElementById("scheduleSelect").addEventListener("change", function () { renderScheduleTable(results); });
  }

  var lastResults = null;
  function renderResults() {
    lastResults = computeSchedules();
    renderStatTiles(lastResults);
    renderBalanceChart(lastResults);
    renderCumChart(lastResults);
    renderScheduleTable(lastResults);
  }
  var scheduleRecompute = debounce(renderResults, 120);

  // ---------- タブ切り替え ----------
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("is-active"); });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("is-active");
      if (btn.dataset.tab === "result") renderResults();
      if (btn.dataset.tab === "compare") renderCompareTab();
    });
  });

  // ---------- 設定タブ: 共通操作 ----------
  document.getElementById("scenarioName").addEventListener("input", function (e) {
    state.scenarioName = e.target.value;
  });

  document.getElementById("enableLoanB").addEventListener("change", function (e) {
    state.loanBEnabled = e.target.checked;
    document.getElementById("loanCardB").hidden = !e.target.checked;
    if (e.target.checked && !state.loanB) {
      state.loanB = defaultLoan("まい", 12800000, 0.675, 35, state.loanA.startYear, state.loanA.startMonth);
      buildLoanCard("B");
    }
    scheduleRecompute();
  });

  document.getElementById("btnLoadSample").addEventListener("click", function () {
    state = sampleState();
    document.getElementById("scenarioName").value = state.scenarioName;
    document.getElementById("enableLoanB").checked = state.loanBEnabled;
    document.getElementById("loanCardB").hidden = !state.loanBEnabled;
    buildLoanCard("A");
    buildLoanCard("B");
    scheduleRecompute();
  });

  document.getElementById("btnToggleTable").addEventListener("click", function () {
    showTable = !showTable;
    document.getElementById("btnToggleTable").textContent = showTable ? "明細を隠す" : "明細を表示";
    renderScheduleTable(lastResults || computeSchedules());
  });

  // ---------- シナリオ保存 / 比較 ----------
  function loadScenarios() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveScenarios(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* noop */ }
  }
  function cloneState() { return JSON.parse(JSON.stringify(state)); }

  var selectedScenarioIds = [];

  document.getElementById("btnSaveScenario").addEventListener("click", function () {
    var list = loadScenarios();
    var snap = cloneState();
    var id = "s_" + Date.now();
    list.push({ id: id, name: snap.scenarioName || "シナリオ", savedAt: new Date().toISOString(), data: snap });
    saveScenarios(list);
    alert("「" + (snap.scenarioName || "シナリオ") + "」を保存しました。");
  });

  function renderScenarioList() {
    var list = loadScenarios();
    var host = document.getElementById("scenarioList");
    if (!list.length) {
      host.innerHTML = '<p class="panel-hint">まだ保存されたシナリオがありません。「設定」タブでシナリオを作成して保存してください。</p>';
      return;
    }
    host.innerHTML = list.map(function (sc) {
      var checked = selectedScenarioIds.indexOf(sc.id) !== -1;
      var colorIdx = selectedScenarioIds.indexOf(sc.id);
      var swatch = checked ? '<span class="scenario-swatch" style="background:' + resolveColor(PALETTE[colorIdx % PALETTE.length]) + '"></span>' : '<span class="scenario-swatch" style="background:var(--gridline)"></span>';
      return '<div class="scenario-item">' +
        '<input type="checkbox" class="sc-check" data-id="' + sc.id + '"' + (checked ? " checked" : "") + '>' +
        swatch +
        '<span class="name">' + escapeHtml(sc.name) + '</span>' +
        '<span class="meta">' + new Date(sc.savedAt).toLocaleDateString("ja-JP") + '</span>' +
        '<button class="btn btn-icon sc-delete" data-id="' + sc.id + '" title="削除">✕</button>' +
        '</div>';
    }).join("");

    host.querySelectorAll(".sc-check").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var id = cb.dataset.id;
        if (cb.checked) {
          if (selectedScenarioIds.length >= 8) { cb.checked = false; alert("比較できるのは最大8件までです。"); return; }
          selectedScenarioIds.push(id);
        } else {
          selectedScenarioIds = selectedScenarioIds.filter(function (x) { return x !== id; });
        }
        renderScenarioList();
        renderCompareChartAndTable();
      });
    });
    host.querySelectorAll(".sc-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        var list2 = loadScenarios().filter(function (x) { return x.id !== id; });
        saveScenarios(list2);
        selectedScenarioIds = selectedScenarioIds.filter(function (x) { return x !== id; });
        renderScenarioList();
        renderCompareChartAndTable();
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function scenarioCombinedSchedule(data) {
    var schedA = Amortization.buildSchedule(toEngineConfig(data.loanA));
    var schedB = data.loanBEnabled ? Amortization.buildSchedule(toEngineConfig(data.loanB)) : null;
    return schedB ? Amortization.combineSchedules(schedA, schedB) : schedA;
  }

  function renderCompareChartAndTable() {
    var list = loadScenarios();
    var selected = list.filter(function (sc) { return selectedScenarioIds.indexOf(sc.id) !== -1; });

    var series = selected.map(function (sc, i) {
      var sched = scenarioCombinedSchedule(sc.data);
      return { key: sc.id, label: sc.name, color: resolveColor(PALETTE[i % PALETTE.length]), points: toBalancePoints(sched), pad: "zero" };
    });
    Charts.renderLineChart(document.getElementById("compareChart"), { series: series, yFormat: formatMan });

    var tableWrap = document.getElementById("compareTableWrap");
    if (!selected.length) {
      tableWrap.innerHTML = '<p class="panel-hint">比較するシナリオを上のリストから選んでください。</p>';
      return;
    }
    var rows = selected.map(function (sc) {
      var sched = scenarioCombinedSchedule(sc.data);
      var s = sched.summary;
      return "<tr><td>" + escapeHtml(sc.name) + "</td><td>" + formatYen(s.totalPayment) + "</td><td>" + formatYen(s.totalInterest) +
        "</td><td>" + formatYm(s.payoffYear, s.payoffMonth) + "</td></tr>";
    }).join("");
    tableWrap.innerHTML = '<table class="sched"><thead><tr><th>シナリオ</th><th>総返済額</th><th>総利息</th><th>完済予定</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  function renderCompareTab() {
    renderScenarioList();
    renderCompareChartAndTable();
  }

  // ---------- 初期化 ----------
  document.getElementById("enableLoanB").checked = state.loanBEnabled;
  document.getElementById("loanCardB").hidden = !state.loanBEnabled;
  buildLoanCard("A");
  buildLoanCard("B");
  renderResults();
})();
