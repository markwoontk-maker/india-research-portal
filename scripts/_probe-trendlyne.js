// Quick probe: does a plain-https fetch of trendlyne.com/research-reports/all/
// return the broker-card markup we need? If yes, we can write a scraper that
// doesn't depend on any npm package. If no (heavy JS render), we'll need a
// different fallback.
const https = require("https");

https.get("https://trendlyne.com/research-reports/all/",
  { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } },
  res => {
    console.log("status:", res.statusCode);
    console.log("content-type:", res.headers["content-type"]);
    let data = "";
    res.on("data", c => data += c);
    res.on("end", () => {
      console.log("length:", data.length);
      // Look for indicators of broker cards vs. SPA shell.
      const markers = [
        "research-reports", "Target Price", "TP ₹", "TP Rs", "broker",
        "get-document/post/pdf", "Motilal", "Prabhudas", "ICICI Direct",
        "div id=\"app\"", "vue", "react"
      ];
      markers.forEach(m => {
        const n = (data.match(new RegExp(m, "gi")) || []).length;
        console.log(("  " + m).padEnd(35), n);
      });
      // Dump first/last 600 chars of body so we can eyeball structure.
      console.log("--- body[0..600] ---");
      console.log(data.slice(0, 600));
      console.log("--- body[-600..end] ---");
      console.log(data.slice(-600));
    });
  }
).on("error", e => console.error("err:", e.message));
