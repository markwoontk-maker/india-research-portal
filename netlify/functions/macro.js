// India macro snapshot via the World Bank Open Data API.
// Free, no key, authoritative. Figures are annual and lagged
// (latest available year is shown next to each metric). Higher
// frequency India data has no reliable free/no-key API.

const IND = [
  ["gdpGrowth", "GDP growth", "NY.GDP.MKTP.KD.ZG", "pct"],
  ["gdp", "GDP (nominal)", "NY.GDP.MKTP.CD", "usd"],
  ["gdpPc", "GDP per capita", "NY.GDP.PCAP.CD", "usd0"],
  ["cpi", "Inflation (CPI)", "FP.CPI.TOTL.ZG", "pct"],
  ["unemp", "Unemployment", "SL.UEM.TOTL.ZS", "pct"],
  ["exports", "Exports (goods & services)", "NE.EXP.GNFS.CD", "usd"],
  ["imports", "Imports (goods & services)", "NE.IMP.GNFS.CD", "usd"],
  ["ca", "Current account balance", "BN.CAB.XOK.CD", "usd"],
  ["caPct", "Current account (% of GDP)", "BN.CAB.XOK.GD.ZS", "pct"],
  ["reserves", "FX reserves (incl. gold)", "FI.RES.TOTL.CD", "usd"],
  ["fdi", "FDI net inflows", "BX.KLT.DINV.CD.WD", "usd"],
  ["govDebt", "Govt debt (% of GDP)", "GC.DOD.TOTL.GD.ZS", "pct"],
];

async function pool(tasks, size) {
  const out = []; let i = 0;
  async function w() { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, w));
  return out;
}

async function wb(code) {
  const url = `https://api.worldbank.org/v2/country/IND/indicator/${code}?format=json&mrnev=1`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const row = Array.isArray(j) && Array.isArray(j[1]) && j[1][0];
    if (!row || row.value == null) return null;
    return { value: Number(row.value), year: row.date };
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
    const res = await pool(IND.map(d => () => wb(d[2])), 6);
    const items = [];
    const map = {};
    IND.forEach((d, idx) => {
      const v = res[idx];
      if (!v) return;
      map[d[0]] = v;
      items.push({ key: d[0], label: d[1], value: v.value, unit: d[3], year: v.year });
    });
    // Derived: trade balance (exports - imports), labelled deficit/surplus.
    if (map.exports && map.imports) {
      const tb = map.exports.value - map.imports.value;
      items.splice(7, 0, {
        key: "tradeBal",
        label: tb < 0 ? "Trade deficit (g&s)" : "Trade surplus (g&s)",
        value: tb, unit: "usd",
        year: map.exports.year === map.imports.year ? map.exports.year :
          `${map.imports.year}/${map.exports.year}`,
      });
    }
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ source: "World Bank Open Data", items, asOf: new Date().toISOString() }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
