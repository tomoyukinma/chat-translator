// 依存ライブラリなしの軽量 SVG チャート描画ユーティリティ
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    }
    return e;
  }

  function monthIndex(year, month) { return year * 12 + month; }

  function formatYen(v) {
    var n = Math.round(v);
    return n.toLocaleString("ja-JP") + "円";
  }
  function formatManYen(v) {
    var man = v / 10000;
    if (Math.abs(man) >= 1000) return (man / 10000).toFixed(2) + "億円";
    return Math.round(man).toLocaleString("ja-JP") + "万円";
  }
  function formatYm(idx) {
    var y = Math.floor((idx - 1) / 12);
    var m = idx - y * 12;
    return y + "年" + m + "月";
  }

  // 描画単位 = 実際の表示幅にして、狭い画面でも文字が縮まないようにする
  function chartWidth(container, opts) {
    if (opts.width) return opts.width;
    var w = container.clientWidth;
    return w > 0 ? Math.max(300, Math.min(w, 1200)) : 860;
  }

  function niceStep(max) {
    if (max <= 0) return 1;
    var raw = max / 5;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  // series: [{key,label,color,points:[{idx,value}], pad:'zero'|'hold'}]
  function renderLineChart(container, opts) {
    container.innerHTML = "";
    var series = opts.series.filter(function (s) { return s.points && s.points.length; });
    if (!series.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">データがありません。</p>';
      return;
    }

    var minIdx = Math.min.apply(null, series.map(function (s) { return s.points[0].idx; }));
    var maxIdx = Math.max.apply(null, series.map(function (s) { return s.points[s.points.length - 1].idx; }));

    function valueAt(s, idx) {
      var pts = s.points;
      if (idx <= pts[pts.length - 1].idx) {
        // 二分探索なしの線形探索（データ量は数百件程度なので十分）
        for (var i = 0; i < pts.length; i++) {
          if (pts[i].idx >= idx) return pts[i].value;
        }
      }
      return s.pad === "hold" ? pts[pts.length - 1].value : 0;
    }

    var maxVal = 0, minVal = 0;
    series.forEach(function (s) {
      s.points.forEach(function (p) {
        if (p.value > maxVal) maxVal = p.value;
        if (p.value < minVal) minVal = p.value;
      });
    });
    if (maxVal - minVal <= 0) maxVal = 1;

    var W = chartWidth(container, opts), H = opts.height || Math.min(300, Math.round(W * 0.75));
    var padL = 76, padR = 16, padT = 16, padB = 32;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var step = niceStep(maxVal - minVal);
    var yMax = Math.ceil(maxVal / step) * step;
    var yMin = Math.floor(minVal / step) * step;

    function xPos(idx) { return padL + (idx - minIdx) / Math.max(1, (maxIdx - minIdx)) * plotW; }
    function yPos(v) { return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

    // gridlines + y labels
    var gridCount = Math.round((yMax - yMin) / step);
    for (var g = 0; g <= gridCount; g++) {
      var gv = yMin + g * step;
      var gy = yPos(gv);
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "var(--gridline)", "stroke-width": 1 }));
      var label = el("text", { x: padL - 8, y: gy + 3, "text-anchor": "end", class: "chart-axis-label" });
      label.textContent = opts.yFormat ? opts.yFormat(gv) : gv;
      svg.appendChild(label);
    }
    // zero line (baseline)
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: yPos(0), y2: yPos(0), stroke: "var(--baseline)", "stroke-width": 1 }));

    // x labels: start, mid, end
    [minIdx, Math.round((minIdx + maxIdx) / 2), maxIdx].forEach(function (idx, n) {
      var t = el("text", { x: xPos(idx), y: H - 8, "text-anchor": ["start", "middle", "end"][n], class: "chart-axis-label" });
      t.textContent = formatYm(idx);
      svg.appendChild(t);
    });

    (opts.markers || []).forEach(function (mk) {
      if (mk.idx < minIdx || mk.idx > maxIdx) return;
      var mx = xPos(mk.idx);
      svg.appendChild(el("line", { x1: mx, x2: mx, y1: padT, y2: padT + plotH, stroke: "var(--text-muted)", "stroke-width": 1, opacity: 0.6 }));
      var anchor = mx > W - padR - 120 ? "end" : "start";
      var t = el("text", { x: anchor === "end" ? mx - 6 : mx + 6, y: padT + 10, "text-anchor": anchor, class: "chart-axis-label" });
      t.textContent = mk.label;
      svg.appendChild(t);
    });

    series.forEach(function (s) {
      var d = "";
      s.points.forEach(function (p, i) {
        var cmd = i === 0 ? "M" : "L";
        d += cmd + xPos(p.idx).toFixed(1) + "," + yPos(p.value).toFixed(1) + " ";
      });
      svg.appendChild(el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));

      var last = s.points[s.points.length - 1];
      svg.appendChild(el("circle", { cx: xPos(last.idx), cy: yPos(last.value), r: 4, fill: s.color, stroke: "var(--card-bg)", "stroke-width": 2 }));
    });

    // hover crosshair + tooltip
    var hoverLine = el("line", { x1: 0, x2: 0, y1: padT, y2: padT + plotH, stroke: "var(--text-muted)", "stroke-width": 1, opacity: 0 });
    svg.appendChild(hoverLine);

    var wrap = document.createElement("div");
    wrap.style.position = "relative";
    var tooltip = document.createElement("div");
    tooltip.className = "tooltip-box";
    tooltip.style.display = "none";
    wrap.appendChild(svg);
    wrap.appendChild(tooltip);
    container.appendChild(wrap);

    var hitRect = el("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" });
    svg.appendChild(hitRect);

    hitRect.addEventListener("mousemove", function (evt) {
      var rect = svg.getBoundingClientRect();
      var scale = W / rect.width;
      var mx = (evt.clientX - rect.left) * scale;
      var idx = Math.round(minIdx + (mx - padL) / plotW * (maxIdx - minIdx));
      idx = Math.max(minIdx, Math.min(maxIdx, idx));
      hoverLine.setAttribute("x1", xPos(idx)); hoverLine.setAttribute("x2", xPos(idx));
      hoverLine.setAttribute("opacity", 1);

      var lines = [formatYm(idx)];
      series.forEach(function (s) {
        lines.push(s.label + ": " + (opts.yFormat ? opts.yFormat(valueAt(s, idx)) : Math.round(valueAt(s, idx))));
      });
      tooltip.innerHTML = lines.map(function (l, i) { return i === 0 ? "<strong>" + l + "</strong>" : l; }).join("<br>");
      tooltip.style.display = "block";
      var left = (evt.clientX - rect.left) + 12;
      if (left + 160 > rect.width) left = (evt.clientX - rect.left) - 172;
      tooltip.style.left = left + "px";
      tooltip.style.top = (evt.clientY - rect.top) - 10 + "px";
    });
    hitRect.addEventListener("mouseleave", function () {
      hoverLine.setAttribute("opacity", 0);
      tooltip.style.display = "none";
    });

    if (opts.legend !== false && series.length >= 1) {
      var legend = document.createElement("div");
      legend.className = "legend";
      series.forEach(function (s) {
        var item = document.createElement("span");
        item.className = "legend-item";
        item.innerHTML = '<span class="legend-swatch" style="background:' + s.color + '"></span>' + s.label;
        legend.appendChild(item);
      });
      container.appendChild(legend);
    }
  }

  // categories: [{key,label,color, cumPoints:[{idx,value}]}]  (積み上げ・累計を想定, 下から順に描画)
  function renderStackedArea(container, opts) {
    container.innerHTML = "";
    var categories = opts.categories.filter(function (c) { return c.points && c.points.length; });
    if (!categories.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">データがありません。</p>';
      return;
    }
    var minIdx = Math.min.apply(null, categories.map(function (c) { return c.points[0].idx; }));
    var maxIdx = Math.max.apply(null, categories.map(function (c) { return c.points[c.points.length - 1].idx; }));

    // 各 idx における合計（積み上げ）の最大値を求める
    var idxList = [];
    for (var i = minIdx; i <= maxIdx; i++) idxList.push(i);

    function valueAt(c, idx) {
      var pts = c.points;
      for (var j = 0; j < pts.length; j++) if (pts[j].idx >= idx) return pts[j].value;
      return pts[pts.length - 1].value;
    }

    var maxTotal = 0;
    idxList.forEach(function (idx) {
      var total = 0;
      categories.forEach(function (c) { total += valueAt(c, idx); });
      if (total > maxTotal) maxTotal = total;
    });
    if (maxTotal <= 0) maxTotal = 1;

    var W = chartWidth(container, opts), H = opts.height || Math.min(260, Math.round(W * 0.7));
    var padL = 64, padR = 16, padT = 16, padB = 32;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var step = niceStep(maxTotal);
    var yMax = Math.ceil(maxTotal / step) * step;

    function xPos(idx) { return padL + (idx - minIdx) / Math.max(1, (maxIdx - minIdx)) * plotW; }
    function yPos(v) { return padT + plotH - (v / yMax) * plotH; }

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H });

    var gridCount = Math.round(yMax / step);
    for (var g = 0; g <= gridCount; g++) {
      var gv = g * step;
      var gy = yPos(gv);
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "var(--gridline)", "stroke-width": 1 }));
      var label = el("text", { x: padL - 8, y: gy + 3, "text-anchor": "end", class: "chart-axis-label" });
      label.textContent = opts.yFormat ? opts.yFormat(gv) : gv;
      svg.appendChild(label);
    }
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: padT + plotH, y2: padT + plotH, stroke: "var(--baseline)", "stroke-width": 1 }));

    [minIdx, Math.round((minIdx + maxIdx) / 2), maxIdx].forEach(function (idx, n) {
      var t = el("text", { x: xPos(idx), y: H - 8, "text-anchor": ["start", "middle", "end"][n], class: "chart-axis-label" });
      t.textContent = formatYm(idx);
      svg.appendChild(t);
    });

    var runningBottom = idxList.map(function () { return 0; });
    categories.forEach(function (c) {
      var topLine = [];
      var bottomLine = [];
      idxList.forEach(function (idx, i) {
        var v = valueAt(c, idx);
        bottomLine.push(runningBottom[i]);
        runningBottom[i] += v;
        topLine.push(runningBottom[i]);
      });
      var d = "M" + xPos(idxList[0]) + "," + yPos(bottomLine[0]);
      idxList.forEach(function (idx, i) { d += " L" + xPos(idx) + "," + yPos(topLine[i]); });
      for (var i2 = idxList.length - 1; i2 >= 0; i2--) { d += " L" + xPos(idxList[i2]) + "," + yPos(bottomLine[i2]); }
      d += " Z";
      svg.appendChild(el("path", { d: d, fill: c.color, opacity: 0.75 }));
    });

    var wrap = document.createElement("div");
    wrap.style.position = "relative";
    var tooltip = document.createElement("div");
    tooltip.className = "tooltip-box";
    tooltip.style.display = "none";
    wrap.appendChild(svg);
    wrap.appendChild(tooltip);
    container.appendChild(wrap);

    var hoverLine = el("line", { x1: 0, x2: 0, y1: padT, y2: padT + plotH, stroke: "var(--text-muted)", "stroke-width": 1, opacity: 0 });
    svg.appendChild(hoverLine);
    var hitRect = el("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" });
    svg.appendChild(hitRect);

    hitRect.addEventListener("mousemove", function (evt) {
      var rect = svg.getBoundingClientRect();
      var scale = W / rect.width;
      var mx = (evt.clientX - rect.left) * scale;
      var idx = Math.round(minIdx + (mx - padL) / plotW * (maxIdx - minIdx));
      idx = Math.max(minIdx, Math.min(maxIdx, idx));
      hoverLine.setAttribute("x1", xPos(idx)); hoverLine.setAttribute("x2", xPos(idx));
      hoverLine.setAttribute("opacity", 1);
      var lines = [formatYm(idx)];
      categories.forEach(function (c) {
        lines.push(c.label + ": " + (opts.yFormat ? opts.yFormat(valueAt(c, idx)) : Math.round(valueAt(c, idx))));
      });
      tooltip.innerHTML = lines.map(function (l, i) { return i === 0 ? "<strong>" + l + "</strong>" : l; }).join("<br>");
      tooltip.style.display = "block";
      var left = (evt.clientX - rect.left) + 12;
      if (left + 160 > rect.width) left = (evt.clientX - rect.left) - 172;
      tooltip.style.left = left + "px";
      tooltip.style.top = (evt.clientY - rect.top) - 10 + "px";
    });
    hitRect.addEventListener("mouseleave", function () {
      hoverLine.setAttribute("opacity", 0);
      tooltip.style.display = "none";
    });

    var legend = document.createElement("div");
    legend.className = "legend";
    categories.forEach(function (c) {
      var item = document.createElement("span");
      item.className = "legend-item";
      item.innerHTML = '<span class="legend-swatch" style="background:' + c.color + '"></span>' + c.label;
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  global.Charts = {
    monthIndex: monthIndex,
    formatYen: formatYen,
    formatManYen: formatManYen,
    formatYm: formatYm,
    renderLineChart: renderLineChart,
    renderStackedArea: renderStackedArea
  };
})(typeof window !== "undefined" ? window : globalThis);
