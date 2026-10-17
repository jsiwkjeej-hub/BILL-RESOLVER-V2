const ALLOWED_HOSTS = new Set([
  "sfl.gl",
  "safelinku.com",
  "www.safelinku.com",
  "tinyurl.com",
  "bit.ly",
  "j.mp",
  "linkvertise.com",
  "link-to.net",
  "clk.sh",
  "oko.sh",
  "shrinkme.io",
]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

function isAllowedUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !BLOCKED_HOSTS.has(url.hostname.toLowerCase()) &&
      ALLOWED_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Gunakan metode POST.",
    });
  }

  const { url } = req.body || {};

  if (typeof url !== "string" || !isAllowedUrl(url)) {
    return res.status(400).json({
      success: false,
      message: "URL tidak valid atau domain belum didukung.",
    });
  }

  const token = process.env.BROWSERLESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      success: false,
      message: "Konfigurasi browser belum tersedia.",
    });
  }

  let browser;

  try {
    const { chromium } = await import("playwright-core");

    browser = await chromium.connectOverCDP(
      `wss://production-sfo.browserless.io?token=${encodeURIComponent(token)}`
    );

    const context = await browser.newContext();
    const page = await context.newPage();

    page.setDefaultNavigationTimeout(15000);
    page.setDefaultTimeout(5000);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Tunggu sebentar agar redirect JavaScript yang diizinkan
    // mempunyai kesempatan untuk berjalan.
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => ({
      currentUrl: location.href,
      canonical: document.querySelector(
        'link[rel="canonical"]'
      )?.href || null,
    }));

    await context.close();

    if (!isAllowedUrl(result.currentUrl)) {
      return res.status(422).json({
        success: false,
        message:
          "Tujuan berada di luar domain yang diizinkan. Tidak ada link yang dikembalikan.",
      });
    }

    return res.status(200).json({
      success: true,
      final_url: result.currentUrl,
      message: "Halaman berhasil diperiksa.",
    });
  } catch (error) {
    console.error("Resolver error:", error.message);

    return res.status(502).json({
      success: false,
      message:
        "Browser gagal memeriksa halaman. Coba lagi nanti.",
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}
