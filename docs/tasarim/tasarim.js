/* Taslak davranışları: tema (Açık/Koyu/Sistem), durum geçişi, diyalog, sekme, anahtar, kopyala.
 * URL: ?tema=acik|koyu|sistem  ?durum=grup:deger,grup2:deger  ?dialog=id  (ekran görüntüsü için) */
(function () {
  var q = new URLSearchParams(location.search);
  var root = document.documentElement;
  var mq = matchMedia("(prefers-color-scheme: dark)");
  function pref() { return q.get("tema") || localStorage.getItem("rs-tema") || root.dataset.temaVarsayilan || "sistem"; }
  function apply(p) {
    root.dataset.theme = p === "koyu" || (p === "sistem" && mq.matches) ? "dark" : "light";
    document.querySelectorAll("[data-tema]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tema === p)); });
  }
  apply(pref());
  mq.addEventListener("change", function () { apply(pref()); });

  var state = {};
  function setState(g, v) {
    state[g] = v;
    root.setAttribute("data-s-" + g, v);
    document.querySelectorAll('[data-set^="' + g + ':"]').forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.set === g + ":" + v)); });
    document.querySelectorAll("[data-when]").forEach(function (el) {
      el.hidden = !el.dataset.when.split(" ").every(function (c) {
        var p = c.split(":"); return (state[p[0]] || "") && p[1].split("|").indexOf(state[p[0]]) > -1;
      });
    });
  }
  var t;
  function toast(msg) {
    var el = document.querySelector(".toast") || document.body.appendChild(document.createElement("div"));
    el.className = "toast"; el.setAttribute("role", "status");
    el.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-circle-check"/></svg><span></span>';
    el.lastChild.textContent = msg; el.hidden = false;
    clearTimeout(t); t = setTimeout(function () { el.hidden = true; }, 2600);
  }
  window.rsToast = toast;

  document.addEventListener("DOMContentLoaded", function () {
    apply(pref());
    var groups = {};
    document.querySelectorAll("[data-set]").forEach(function (b) { var g = b.dataset.set.split(":")[0]; if (!groups[g]) groups[g] = b.dataset.set.split(":")[1]; });
    (q.get("durum") || "").split(",").forEach(function (p) { if (p) { var a = p.split(":"); groups[a[0]] = a[1]; } });
    Object.keys(groups).forEach(function (g) { setState(g, groups[g]); });
    if (q.get("dialog")) { var d = document.getElementById(q.get("dialog")); if (d) d.showModal(); }
  });

  function syncAll(grp) {
    var m = document.querySelectorAll('.switch[data-grp="' + grp + '"]:not(:disabled)');
    var on = Array.prototype.filter.call(m, function (s) { return s.getAttribute("aria-checked") === "true"; }).length;
    var all = document.querySelector('.switch[data-all="' + grp + '"]');
    if (all) all.setAttribute("aria-checked", on === 0 ? "false" : on === m.length ? "true" : "mixed");
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button, a");
    if (!b) return;
    if (b.dataset.tema) { localStorage.setItem("rs-tema", b.dataset.tema); apply(b.dataset.tema); }
    if (b.dataset.set) { var p = b.dataset.set.split(":"); setState(p[0], p[1]); }
    if (b.dataset.open) { document.getElementById(b.dataset.open).showModal(); }
    if (b.hasAttribute("data-close")) { b.closest("dialog").close(); }
    if (b.dataset.copy) { navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy).catch(function () {}); toast(b.dataset.copyMsg || "Panoya kopyalandı"); }
    if (b.dataset.toast) { toast(b.dataset.toast); }
    if (b.getAttribute("role") === "tab") {
      b.parentElement.querySelectorAll('[role="tab"]').forEach(function (x) {
        var on = x === b; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1;
        document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
      });
    }
    if (b.classList.contains("switch") && !b.disabled) {
      var next = b.getAttribute("aria-checked") === "true" ? "false" : "true";
      if (b.dataset.all) {
        document.querySelectorAll('.switch[data-grp="' + b.dataset.all + '"]:not(:disabled)').forEach(function (s) { s.setAttribute("aria-checked", next); });
      } else { b.setAttribute("aria-checked", next); }
      syncAll(b.dataset.all || b.dataset.grp);
      if (state.form !== undefined) setState("form", "degisti");
    }
  });
})();
