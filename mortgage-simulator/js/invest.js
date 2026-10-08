// 繰上返済 vs 積立投資 の比較計算 (UI 非依存)
//
// 比較の考え方:
//  毎月「通常の返済額 + 比較用の資金（一括/毎月）」という同じ予算を、2通りに使った場合を比べる。
//   A. 繰上返済: 資金をローンの繰上返済（期間短縮型）にあてる。完済が早まった後は、
//      浮いた予算（返済額 + 毎月の資金）を同じ利回りで積み立てる。
//   B. 積立投資: ローンは通常どおり返済し、資金を投資信託などで積み立てる。
//  元のローンの完済予定月の時点で、どちらもローンは残っていないので、
//  「手元の運用資産（税引後）」の差がそのまま有利・不利の差になる。

(function (global) {
  "use strict";

  var Amort = (typeof module !== "undefined" && module.exports)
    ? require("./amortization.js")
    : global.Amortization;

  function keyToYm(key) {
    var year = Math.floor((key - 1) / 12);
    return { year: year, month: key - year * 12 };
  }

  function monthlyGrowth(annualPct) {
    return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  }

  function afterTax(value, basis, taxRate) {
    var gain = value - basis;
    return gain > 0 ? value - gain * taxRate : value;
  }

  // 利回りに依存しない部分（2通りの返済スケジュールと毎月のキャッシュフロー）を作る
  // opts = { loanConfig, baseYear, baseMonth, lumpSum, monthly }
  function prepare(opts) {
    var baseline = Amort.buildSchedule(opts.loanConfig);
    var rows = baseline.rows;
    if (!rows.length) return { error: "返済スケジュールを計算できませんでした。" };

    var firstKey = Amort.ymKey(rows[0].year, rows[0].month);
    var endKey = Amort.ymKey(rows[rows.length - 1].year, rows[rows.length - 1].month);
    var baseKey = Math.max(Amort.ymKey(opts.baseYear, opts.baseMonth), firstKey);
    if (baseKey > endKey) return { error: "比較開始の年月には、このローンはすでに完済しています。" };

    var lump = Math.max(0, opts.lumpSum || 0);
    var monthly = Math.max(0, opts.monthly || 0);
    var base = keyToYm(baseKey);

    var prepayConfig = {};
    Object.keys(opts.loanConfig).forEach(function (k) { prepayConfig[k] = opts.loanConfig[k]; });
    prepayConfig.extraPayments = (opts.loanConfig.extraPayments || []).slice();
    if (lump > 0) prepayConfig.extraPayments.push({ year: base.year, month: base.month, amount: lump, method: "shorten" });
    prepayConfig.recurringExtra = monthly > 0 ? { year: base.year, month: base.month, amount: monthly } : null;
    var prepay = Amort.buildSchedule(prepayConfig);

    function byKey(schedule) {
      var map = {};
      schedule.rows.forEach(function (r) { map[Amort.ymKey(r.year, r.month)] = r; });
      return map;
    }
    var baseMap = byKey(baseline);
    var prepMap = byKey(prepay);

    var months = [];
    var interestBase = 0, interestPrepay = 0;
    for (var key = baseKey; key <= endKey; key++) {
      var b = baseMap[key];
      var p = prepMap[key];
      var outB = b ? b.payment + b.extra : 0;
      var outA = p ? p.payment + p.extra : 0;
      var contribB = monthly + (key === baseKey ? lump : 0);
      var budget = outB + contribB;
      months.push({
        key: key,
        contribA: budget - outA,
        contribB: contribB,
        balanceA: p ? p.balance : 0,
        balanceB: b ? b.balance : 0
      });
      interestBase += b ? b.interest : 0;
      interestPrepay += p ? p.interest : 0;
    }

    var prepayLast = prepay.rows[prepay.rows.length - 1];
    var prepayEndKey = Amort.ymKey(prepayLast.year, prepayLast.month);

    return {
      months: months,
      base: base,
      end: keyToYm(endKey),
      prepayEnd: keyToYm(prepayEndKey),
      monthsShortened: endKey - prepayEndKey,
      horizonMonths: months.length,
      remainingInterest: interestBase,
      remainingInterestPrepay: interestPrepay,
      interestSaved: interestBase - interestPrepay,
      totalFunds: lump + monthly * months.length,
      balanceAtBase: baseMap[baseKey] ? baseMap[baseKey].balance + baseMap[baseKey].principal + baseMap[baseKey].extra : 0
    };
  }

  function simulate(prep, annualReturnPct, taxRate) {
    var g = monthlyGrowth(annualReturnPct);
    var vA = 0, bA = 0, vB = 0, bB = 0;
    var series = [];
    prep.months.forEach(function (m) {
      vA = (vA + m.contribA) * (1 + g);
      bA += m.contribA;
      vB = (vB + m.contribB) * (1 + g);
      bB += m.contribB;
      series.push({
        key: m.key,
        netA: afterTax(vA, bA, taxRate) - m.balanceA,
        netB: afterTax(vB, bB, taxRate) - m.balanceB
      });
    });
    var finalA = afterTax(vA, bA, taxRate);
    var finalB = afterTax(vB, bB, taxRate);
    return {
      finalA: finalA,
      finalB: finalB,
      basisA: bA,
      basisB: bB,
      gainA: finalA - bA,
      gainB: finalB - bB,
      diff: finalB - finalA,
      series: series
    };
  }

  // 投資と繰上返済の結果が同じになる年利回り（%）。範囲内に無ければ null
  function breakEvenReturn(prep, taxRate) {
    var lo = -10, hi = 30;
    if (simulate(prep, lo, taxRate).diff > 0 || simulate(prep, hi, taxRate).diff < 0) return null;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (simulate(prep, mid, taxRate).diff < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  var Invest = {
    prepare: prepare,
    simulate: simulate,
    breakEvenReturn: breakEvenReturn
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Invest;
  } else {
    global.Invest = Invest;
  }
})(typeof window !== "undefined" ? window : globalThis);
