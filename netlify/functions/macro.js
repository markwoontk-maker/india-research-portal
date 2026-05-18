// India monthly macro via DBnomics (free, no key) — IMF IFS + BIS.
// Returns, per indicator, the last 12 monthly observations (oldest →
// latest) and the latest reported period. IFS data lags a few months;
// the "as of" period is shown so it is never misleading. Truly
// real-time India macro has no reliable free/no-key API.

const SERIES = [
  // key, label, unit, DBnomics provider/dataset/series
  { key: "cpi", label: "CPI inflation (YoY)", unit: "pct", id: "IMF/IFS/M.IN.PCPI_IX", yoy: true },
  { key: "exports", label: "Exports (goods, FOB)", unit: "usdb", id: "IMF/IFS/M.IN.TXG_FOB_USD" },
  { key: "imports", label: "Imports (goods, CIF)", unit: "usdb", id: "IMF/IFS/M.IN.TMG_CIF_USD" },
  { key: "reserves", label: "FX reserves (total)", unit: "usdb", id: "IMF/IFS/M.IN.RAFA_USD" },
  { key: "repo", label: "Policy rate", unit: "pct", id: "BIS/cbpol/M.IN" },
];

async function pool(tasks, size) {
  const out = []; let i = 0;
  async function w() { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, w));
  return out;
}

async function fetchSeries(id) {
  const url = `https://api.db.nomics.world/v22/series/${id}?observations=1`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const doc = j && j.series && j.series.docs && j.series.docs[0];
    if (!doc || !doc.period || !doc.value) return null;
    const pts = [];
    for (let i = 0; i < doc.period.length; i++) {
      const v = doc.value[i];
      if (v == null || v === "NA" || !isFinite(Number(v))) continue;
      pts.push({ period: doc.period[i], value: Number(v) });
    }
    pts.sort((a, b) => a.period < b.period ? -1 : 1);
    return pts;
  } catch (e) { return null; }
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=21600, s-maxage=21600",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  try {
    const raw = await pool(SERIES.map(s => () => fetchSeries(s.id)), 5);
    const byKey = {};
    const items = [];
    SERIES.forEach((s, idx) => {
      let pts = raw[idx];
      if (!pts || !pts.length) return;
      if (s.yoy) {
        const y = [];
        for (let i = 12; i < pts.length; i++) {
          const prev = pts[i - 12];
          if (prev && prev.value) y.push({ period: pts[i].period, value: (pts[i].value / prev.value - 1) * 100 });
        }
        pts = y;
      }
      if (!pts.length) return;
      const last = pts.slice(-10);
      byKey[s.key] = last;
      items.push({
        key: s.key, label: s.label, unit: s.unit,
        points: last,
        latest: last[last.length - 1],
      });
    });
    // Derived monthly trade balance = exports − imports (aligned periods).
    if (byKey.exports && byKey.imports) {
      const imp = {}; byKey.imports.forEach(p => imp[p.period] = p.value);
      const tb = byKey.exports
        .filter(p => imp[p.period] != null)
        .map(p => ({ period: p.period, value: p.value - imp[p.period] }))
        .slice(-10);
      if (tb.length) {
        const last = tb[tb.length - 1];
        items.splice(3, 0, {
          key: "tradeBal",
          label: last.value < 0 ? "Trade deficit (goods)" : "Trade surplus (goods)",
          unit: "usdb", points: tb, latest: last,
        });
      }
    }
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ source: "DBnomics · IMF IFS / BIS", items, asOf: new Date().toISOString() }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
