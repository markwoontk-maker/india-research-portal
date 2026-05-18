// Free serverless proxy for Yahoo Finance public endpoints.
// Locked to Yahoo hosts so it can't be abused as an open proxy.
// Runs on Netlify's free tier — no API key, no paid service.

const ALLOWED = /^https:\/\/query[12]\.finance\.yahoo\.com\//;

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const target = event.queryStringParameters && event.queryStringParameters.u;
  if (!target || !ALLOWED.test(target)) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: "Only Yahoo Finance query endpoints are allowed." }),
    };
  }

  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
    const body = await r.text();
    return { statusCode: r.status, headers: cors, body };
  } catch (e) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({ error: "Upstream fetch failed", detail: String(e) }),
    };
  }
};
