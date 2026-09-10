// 住宅ローン返済計算エンジン (元利均等返済 / 依存ライブラリなし)
//
// 元スプレッドシートとの違い:
//  - 金利変更時、元本と当初期間から再計算するのではなく、
//    「その時点の残高」と「残り回数」から返済額を再計算します（実際の銀行の再計算方法）。
//  - 一部繰上返済は「期間短縮型」(返済額そのまま・期間短縮)と
//    「返済額低減型」(残り期間そのまま・返済額を下げる)を選べます。

(function (global) {
  "use strict";

  function addMonths(year, month, n) {
    var total = (year * 12 + (month - 1)) + n;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
  }

  function ymKey(year, month) {
    return year * 12 + month;
  }

  // 月次金利・残り回数・残高から毎月返済額(円未満切り捨て)を計算
  function calcPayment(monthlyRate, remainingMonths, balance) {
    if (remainingMonths <= 0) return Math.max(0, balance);
    if (balance <= 0) return 0;
    var payment;
    if (Math.abs(monthlyRate) < 1e-12) {
      payment = balance / remainingMonths;
    } else {
      payment = (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -remainingMonths));
    }
    return Math.floor(payment);
  }

  // config = {
  //   principal, annualRatePercent, termYears, startYear, startMonth,
  //   rateChanges: [{year, month, ratePercent}],
  //   extraPayments: [{year, month, amount, method: 'shorten'|'reduce'}]
  // }
  function buildSchedule(config) {
    var totalMonths = Math.max(1, Math.round(config.termYears * 12));
    var rateChanges = (config.rateChanges || [])
      .slice()
      .sort(function (a, b) { return ymKey(a.year, a.month) - ymKey(b.year, b.month); });
    var extraPayments = (config.extraPayments || [])
      .slice()
      .sort(function (a, b) { return ymKey(a.year, a.month) - ymKey(b.year, b.month); });

    var balance = config.principal;
    var currentRate = config.annualRatePercent;
    var payment = calcPayment(currentRate / 100 / 12, totalMonths, balance);

    var y = config.startYear;
    var m = config.startMonth;
    var rows = [];
    var rateIdx = 0;
    var extraIdx = 0;
    var monthsElapsed = 0;
    var safetyCap = totalMonths + 1200;
    var payoffFailed = false;

    while (balance > 0.5 && monthsElapsed < safetyCap) {
      monthsElapsed += 1;
      if (monthsElapsed > 1) {
        var next = addMonths(y, m, 1);
        y = next.year;
        m = next.month;
      }

      var remainingMonths = totalMonths - monthsElapsed + 1;

      while (rateIdx < rateChanges.length && ymKey(rateChanges[rateIdx].year, rateChanges[rateIdx].month) === ymKey(y, m)) {
        currentRate = rateChanges[rateIdx].ratePercent;
        payment = calcPayment(currentRate / 100 / 12, Math.max(remainingMonths, 1), balance);
        rateIdx++;
      }

      var monthlyRate = currentRate / 100 / 12;
      var interest = balance * monthlyRate;
      var principalPaid = payment - interest;
      var extra = 0;
      var extraMethod = null;

      if (extraIdx < extraPayments.length && ymKey(extraPayments[extraIdx].year, extraPayments[extraIdx].month) === ymKey(y, m)) {
        extra = extraPayments[extraIdx].amount;
        extraMethod = extraPayments[extraIdx].method || "shorten";
        extraIdx++;
      }

      if (principalPaid < 0) principalPaid = 0;

      if (principalPaid + extra >= balance) {
        // 完済月: 過不足を調整
        if (principalPaid >= balance) {
          principalPaid = balance;
          extra = 0;
        } else {
          extra = balance - principalPaid;
        }
        payment = principalPaid + interest;
        balance = 0;
      } else {
        balance = balance - principalPaid - extra;
      }

      rows.push({
        year: y,
        month: m,
        ratePercent: currentRate,
        payment: payment,
        interest: interest,
        principal: principalPaid,
        extra: extra,
        balance: balance
      });

      if (extra > 0 && balance > 0.5 && extraMethod === "reduce") {
        var remainingAfter = totalMonths - monthsElapsed;
        if (remainingAfter > 0) {
          payment = calcPayment(monthlyRate, remainingAfter, balance);
        }
      }
    }

    if (balance > 0.5) payoffFailed = true;

    var totalPayment = 0, totalInterest = 0, totalPrincipal = 0, totalExtra = 0;
    for (var i = 0; i < rows.length; i++) {
      totalPayment += rows[i].payment + rows[i].extra;
      totalInterest += rows[i].interest;
      totalPrincipal += rows[i].principal;
      totalExtra += rows[i].extra;
    }

    var last = rows[rows.length - 1];

    return {
      rows: rows,
      summary: {
        totalPayment: totalPayment,
        totalInterest: totalInterest,
        totalPrincipal: totalPrincipal,
        totalExtra: totalExtra,
        monthsToPayoff: rows.length,
        originalTermMonths: totalMonths,
        payoffYear: last ? last.year : config.startYear,
        payoffMonth: last ? last.month : config.startMonth,
        initialPayment: rows.length ? rows[0].payment : 0,
        payoffFailed: payoffFailed
      }
    };
  }

  // 2つのローンのスケジュールを年月で合算
  function combineSchedules(scheduleA, scheduleB) {
    var map = {};
    function add(schedule, key) {
      if (!schedule) return;
      schedule.rows.forEach(function (r) {
        var k = ymKey(r.year, r.month);
        if (!map[k]) map[k] = { year: r.year, month: r.month, payment: 0, interest: 0, principal: 0, extra: 0, balance: 0 };
        map[k].payment += r.payment;
        map[k].interest += r.interest;
        map[k].principal += r.principal;
        map[k].extra += r.extra;
        map[k].balance += r.balance;
      });
    }
    add(scheduleA);
    add(scheduleB);
    var keys = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    var rows = keys.map(function (k) { return map[k]; });

    var totalPayment = 0, totalInterest = 0, totalPrincipal = 0, totalExtra = 0;
    rows.forEach(function (r) {
      totalPayment += r.payment + r.extra;
      totalInterest += r.interest;
      totalPrincipal += r.principal;
      totalExtra += r.extra;
    });
    var last = rows[rows.length - 1];

    return {
      rows: rows,
      summary: {
        totalPayment: totalPayment,
        totalInterest: totalInterest,
        totalPrincipal: totalPrincipal,
        totalExtra: totalExtra,
        monthsToPayoff: rows.length,
        payoffYear: last ? last.year : null,
        payoffMonth: last ? last.month : null
      }
    };
  }

  var Amortization = {
    addMonths: addMonths,
    ymKey: ymKey,
    calcPayment: calcPayment,
    buildSchedule: buildSchedule,
    combineSchedules: combineSchedules
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Amortization;
  } else {
    global.Amortization = Amortization;
  }
})(typeof window !== "undefined" ? window : globalThis);
