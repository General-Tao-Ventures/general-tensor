import type { VercelRequest, VercelResponse } from "@vercel/node";

const allowedOrigins = [
  "https://general-tensor.webflow.io",
  "https://generaltensor.io",
  "https://www.generaltensor.io",
];

// Survives across invocations on the same warm Lambda instance. Lets us
// serve the last good response if CMC errors out (e.g. credit limit hit).
let lastGoodPayload: Record<string, unknown> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const apiKey = process.env.CMC_API_KEY;
  if (!apiKey) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "Missing CMC_API_KEY" });
  }

  try {
    const url =
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=TAO&convert=USD";

    const response = await fetch(url, {
      headers: {
        "X-CMC_PRO_API_KEY": apiKey,
        Accept: "application/json",
      },
    });

    const data = await response.json();

    const tao = data?.data?.TAO;
    const usd = tao?.quote?.USD;

    const price = usd?.price;
    const change = usd?.percent_change_24h;

    if (!usd || !Number.isFinite(price) || !Number.isFinite(change)) {
      console.error("Invalid CMC response", data?.status ?? data);
      if (lastGoodPayload) {
        res.setHeader(
          "Cache-Control",
          "s-maxage=300, stale-while-revalidate=600"
        );
        return res.status(200).json({ ...lastGoodPayload, stale: true });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(500).json({ error: "Invalid CMC response" });
    }

    const priceFormatted = `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    const changeFormatted = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;

    const payload = {
      name: tao.name,
      symbol: tao.symbol,
      price: priceFormatted,
      change_24h: changeFormatted,
      change_24h_label: `${changeFormatted} (24h)`,
      price_raw: price,
      change_24h_raw: change,
      last_updated: usd.last_updated,
    };

    lastGoodPayload = payload;

    res.setHeader(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600"
    );
    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    if (lastGoodPayload) {
      res.setHeader(
        "Cache-Control",
        "s-maxage=300, stale-while-revalidate=600"
      );
      return res.status(200).json({ ...lastGoodPayload, stale: true });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "Failed to fetch TAO data" });
  }
}
