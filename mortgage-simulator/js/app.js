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

  function defaultInvest() {
    var now = new Date();
    return {
      loanKey: "A",
      baseYear: now.getFullYear(),
      baseMonth: now.getMonth() + 1,
      lumpSum: 0,
      monthly: 30000,
      returnPct: 4,
      taxRate: 0
    };
  }

  function sampleState() {
    return {
      scenarioName: "ベースシナリオ",
      loanBEnabled: true,
      loanA: defaultLoan("とも", 26000000, 0.775, 35, 2016, 1),
      loanB: defaultLoan("まい", 12800000, 0.675, 35, 2016, 1),
      invest: defaultInvest()
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

  var activeTab = "setup";
  var scheduleRecompute = debounce(function () {
    renderResults();
    if (activeTab === "invest") renderInvest();
  }, 120);

  // ---------- 繰上返済 vs 投資 ----------
  function formatDuration(months) {
    var y = Math.floor(months / 12), m = months % 12;
    if (!y) return m + "か月";
    return m ? y + "年" + m + "か月" : y + "年";
  }
  function formatSigned(v) {
    if (Math.abs(v) < 0.5) return "±0円";
    return (v > 0 ? "+" : "−") + formatYen(Math.abs(v));
  }
  function formatPct(v) { return (Math.round(v * 100) / 100).toFixed(2) + "%"; }

  function syncInvestInputs() {
    var inv = state.invest;
    document.getElementById("invBaseYm").value = toMonthInputValue(inv.baseYear, inv.baseMonth);
    document.getElementById("invLump").value = inv.lumpSum.toLocaleString("ja-JP");
    document.getElementById("invMonthly").value = inv.monthly.toLocaleString("ja-JP");
    document.getElementById("invReturn").value = inv.returnPct;
    document.getElementById("invReturnRange").value = inv.returnPct;
    document.getElementById("invTax").value = String(inv.taxRate);
  }

  function renderInvestLoanOptions() {
    var inv = state.invest;
    var options = [{ key: "A", loan: state.loanA }];
    if (state.loanBEnabled && state.loanB) options.push({ key: "B", loan: state.loanB });
    if (!options.some(function (o) { return o.key === inv.loanKey; })) inv.loanKey = "A";
    document.getElementById("invLoan").innerHTML = options.map(function (o) {
      return '<option value="' + o.key + '"' + (o.key === inv.loanKey ? " selected" : "") + ">" +
        escapeHtml(o.loan.name) + "（当初金利 " + o.loan.rate + "%）</option>";
    }).join("");
  }

  function renderInvest() {
    var inv = state.invest;
    renderInvestLoanOptions();
    var loan = inv.loanKey === "B" ? state.loanB : state.loanA;

    var errBox = document.getElementById("invError");
    var resBox = document.getElementById("invResult");
    function showError(msg) {
      errBox.textContent = msg;
      errBox.hidden = false;
      resBox.hidden = true;
    }

    var prep = Invest.prepare({
      loanConfig: toEngineConfig(loan),
      baseYear: inv.baseYear,
      baseMonth: inv.baseMonth,
      lumpSum: inv.lumpSum,
      monthly: inv.monthly
    });
    if (prep.error) return showError(prep.error);
    if (prep.totalFunds <= 0) return showError("「一括で使えるお金」か「毎月使えるお金」を入力すると比較できます。");
    errBox.hidden = true;
    resBox.hidden = false;

    var sim = Invest.simulate(prep, inv.returnPct, inv.taxRate);
    var be = Invest.breakEvenReturn(prep, inv.taxRate);
    var beSim = be !== null ? Invest.simulate(prep, be, inv.taxRate) : null;

    renderInvestVerdict(loan, prep, sim, be);
    renderInvestTiles(prep, sim, be, beSim);
    renderInvestChart(prep, sim);
    renderInvestTable(prep);
  }

  function renderInvestVerdict(loan, prep, sim, be) {
    var inv = state.invest;
    var colorA = resolveColor(PALETTE[0]), colorB = resolveColor(PALETTE[1]);
    var diff = sim.diff;
    var diffText;
    if (Math.abs(diff) < 0.5) diffText = "どちらも同じ金額です";
    else if (diff > 0) diffText = '積立投資のほうが <span class="num">' + formatYen(diff) + "</span> 多くなります";
    else diffText = '繰上返済のほうが <span class="num">' + formatYen(-diff) + "</span> 多くなります";

    var beHtml = be === null
      ? "損益分岐の利回り <strong>—</strong><span>年 −10%〜30% の範囲では結果が逆転しません</span>"
      : "損益分岐の利回り <strong>年 " + formatPct(be) + "</strong><span>これより高い利回りなら積立投資、低ければ繰上返済のほうが手元資産が多くなります</span>";

    var aSub = prep.monthsShortened > 0
      ? formatYm(prep.prepayEnd.year, prep.prepayEnd.month) + "に完済し、その後は浮いた返済額を積立"
      : "完済時期は変わりません";

    document.getElementById("invVerdict").innerHTML =
      '<div class="verdict-head">' + escapeHtml(loan.name) + "のローン・元の完済予定 " +
      formatYm(prep.end.year, prep.end.month) + " 時点の手元資産（税引後）／想定利回り 年 " + inv.returnPct + "%</div>" +
      '<div class="verdict-cols">' +
        '<div class="verdict-col' + (diff < -0.5 ? " is-larger" : "") + '">' +
          '<div class="verdict-col-label"><span class="key" style="background:' + colorA + '"></span>A. 繰上返済</div>' +
          '<div class="verdict-col-value">' + formatYen(sim.finalA) + "</div>" +
          '<div class="verdict-col-sub">' + aSub + "</div>" +
        "</div>" +
        '<div class="verdict-col' + (diff > 0.5 ? " is-larger" : "") + '">' +
          '<div class="verdict-col-label"><span class="key" style="background:' + colorB + '"></span>B. 積立投資</div>' +
          '<div class="verdict-col-value">' + formatYen(sim.finalB) + "</div>" +
          '<div class="verdict-col-sub">ローンは通常どおり返済し、お金は積立</div>' +
        "</div>" +
      "</div>" +
      '<div class="verdict-diff">' + diffText + "</div>" +
      '<div class="verdict-be">' + beHtml + "</div>";
  }

  function renderInvestTiles(prep, sim, be, beSim) {
    var tiles = [
      {
        label: "残りの利息（このまま返済）",
        value: formatYen(prep.remainingInterest),
        sub: formatYm(prep.base.year, prep.base.month) + "〜" + formatYm(prep.end.year, prep.end.month)
      },
      {
        label: "繰上返済で減る利息",
        value: formatYen(prep.interestSaved),
        sub: prep.monthsShortened > 0 ? "完済が " + formatDuration(prep.monthsShortened) + " 早まる" : "完済時期は同じ"
      },
      {
        label: "積立投資の運用益（税引後）",
        value: formatYen(sim.gainB),
        sub: "積立元本 " + formatYen(sim.basisB)
      },
      {
        label: "ペイするのに必要な運用益",
        value: beSim ? formatYen(beSim.gainB) : "—",
        sub: beSim ? "年 " + formatPct(be) + " で運用した場合。これを超えれば積立投資が上回る" : ""
      }
    ];
    document.getElementById("invTiles").innerHTML = tiles.map(function (t) {
      return '<div class="stat-tile"><div class="stat-label">' + t.label + "</div>" +
        '<div class="stat-value">' + t.value + "</div>" +
        (t.sub ? '<div class="stat-sub">' + t.sub + "</div>" : "") + "</div>";
    }).join("");
  }

  function renderInvestChart(prep, sim) {
    var markers = [];
    if (prep.monthsShortened > 0) {
      markers.push({
        idx: Amortization.ymKey(prep.prepayEnd.year, prep.prepayEnd.month),
        label: "A 完済 " + formatYm(prep.prepayEnd.year, prep.prepayEnd.month)
      });
    }
    Charts.renderLineChart(document.getElementById("invChart"), {
      series: [
        { key: "A", label: "A. 繰上返済", color: resolveColor(PALETTE[0]), points: sim.series.map(function (p) { return { idx: p.key, value: p.netA }; }), pad: "hold" },
        { key: "B", label: "B. 積立投資", color: resolveColor(PALETTE[1]), points: sim.series.map(function (p) { return { idx: p.key, value: p.netB }; }), pad: "hold" }
      ],
      markers: markers,
      yFormat: formatMan
    });
  }

  function renderInvestTable(prep) {
    var inv = state.invest;
    var rates = [0, 1, 2, 3, 4, 5, 6, 7];
    if (rates.indexOf(inv.returnPct) === -1) rates.push(inv.returnPct);
    rates.sort(function (a, b) { return a - b; });

    var rows = rates.map(function (r) {
      var s = Invest.simulate(prep, r, inv.taxRate);
      var note = Math.abs(s.diff) < 0.5 ? "" : (s.diff > 0 ? "投資が多い" : "返済が多い");
      return '<tr class="' + (r === inv.returnPct ? "is-current" : "") + '">' +
        "<td>年 " + r + "%" + (r === inv.returnPct ? "（想定）" : "") + "</td>" +
        "<td>" + formatYen(s.finalA) + "</td>" +
        "<td>" + formatYen(s.finalB) + "</td>" +
        "<td>" + formatSigned(s.diff) + '<span class="diff-note">' + note + "</span></td></tr>";
    }).join("");

    document.getElementById("invTable").innerHTML =
      '<table class="sched"><thead><tr><th>利回り</th><th>A. 繰上返済</th><th>B. 積立投資</th><th>差（B − A）</th></tr></thead><tbody>' +
      rows + "</tbody></table>";
  }

  var scheduleInvest = debounce(renderInvest, 40);

  function wireInvest() {
    document.getElementById("invLoan").addEventListener("change", function (e) {
      state.invest.loanKey = e.target.value;
      scheduleInvest();
    });
    document.getElementById("invBaseYm").addEventListener("input", function (e) {
      var ym = parseMonthInputValue(e.target.value, null);
      if (!ym) return;
      state.invest.baseYear = ym.year;
      state.invest.baseMonth = ym.month;
      scheduleInvest();
    });
    bindMoneyField(document.getElementById("invLump"),
      function () { return state.invest.lumpSum; },
      function (v) { state.invest.lumpSum = v; scheduleInvest(); });
    bindMoneyField(document.getElementById("invMonthly"),
      function () { return state.invest.monthly; },
      function (v) { state.invest.monthly = v; scheduleInvest(); });
    document.getElementById("invReturn").addEventListener("input", function (e) {
      state.invest.returnPct = toNumber(e.target.value);
      document.getElementById("invReturnRange").value = state.invest.returnPct;
      scheduleInvest();
    });
    document.getElementById("invReturnRange").addEventListener("input", function (e) {
      state.invest.returnPct = toNumber(e.target.value);
      document.getElementById("invReturn").value = state.invest.returnPct;
      scheduleInvest();
    });
    document.getElementById("invTax").addEventListener("change", function (e) {
      state.invest.taxRate = toNumber(e.target.value);
      scheduleInvest();
    });
  }

  // ---------- タブ切り替え ----------
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("is-active"); });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("is-active");
      activeTab = btn.dataset.tab;
      if (activeTab === "result") renderResults();
      if (activeTab === "invest") renderInvest();
      if (activeTab === "compare") renderCompareTab();
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
    syncInvestInputs();
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

  var lastWidth = window.innerWidth;
  window.addEventListener("resize", debounce(function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    if (activeTab === "result") renderResults();
    if (activeTab === "invest") renderInvest();
    if (activeTab === "compare") renderCompareChartAndTable();
  }, 200));

  // ---------- 初期化 ----------
  document.getElementById("enableLoanB").checked = state.loanBEnabled;
  document.getElementById("loanCardB").hidden = !state.loanBEnabled;
  buildLoanCard("A");
  buildLoanCard("B");
  wireInvest();
  syncInvestInputs();
  renderResults();
})();
