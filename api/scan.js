const ALLOWED_HOSTS = [
  "sfl.gl",
  "safelinku.com",
  "tinyurl.com",
  "bit.ly",
  "j.mp",
  "linkvertise.com",
  "link-to.net",
  "clk.sh",
  "oko.sh",
  "shrinkme.io"
];

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();

  return ALLOWED_HOSTS.some(
    domain => host === domain || host.endsWith("." + domain)
  );
}

function validateUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Format URL tidak valid.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Hanya URL HTTP dan HTTPS yang didukung.");
  }

  if (url.username || url.password) {
    throw new Error("URL dengan username atau password tidak didukung.");
  }

  if (!isAllowedHost(url.hostname)) {
    throw new Error("Domain belum termasuk daftar provider yang didukung.");
  }

  return url;
}

async function resolveRedirect(input) {
  let current = validateUrl(input);
  const chain = [current.href];
  const maxRedirects = 8;

  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(current.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(7000),
      headers: {
        "User-Agent": "BillResolver/2.0",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const status = response.status;
    const location = response.headers.get("location");

    if (REDIRECT_CODES.has(status) && location) {
      const next = new URL(location, current);

      // Hanya ikuti redirect menuju HTTPS/HTTP.
      if (!["http:", "https:"].includes(next.protocol)) {
        await response.body?.cancel();
        throw new Error("Redirect menuju protokol yang tidak didukung.");
      }

      // Jangan izinkan redirect menuju alamat internal atau jaringan privat.
      const hostname = next.hostname.toLowerCase();

      if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.")
      ) {
        await response.body?.cancel();
        throw new Error("Redirect menuju host lokal ditolak.");
      }

      chain.push(next.href);
      await response.body?.cancel();

      // Validasi provider untuk setiap hop agar endpoint tidak menjadi
      // proxy bebas menuju domain lain.
      current = validateUrl(next.href);
      continue;
    }

    await response.body?.cancel();

    return {
      final_url: current.href,
      redirect_chain: chain,
      http_status: status,
      resolved: chain.length > 1,
      message: chain.length > 1
        ? "Redirect HTTP berhasil ditemukan."
        : "Belum ditemukan redirect HTTP. Layanan mungkin memerlukan JavaScript atau langkah tambahan."
    };
  }

  throw new Error("Batas redirect terlampaui.");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Gunakan metode POST."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const raw = String(body.url || "").trim();

    if (!raw) {
      return res.status(400).json({
        error: "Masukkan link terlebih dahulu."
      });
    }

    if (raw.length > 2048) {
      return res.status(400).json({
        error: "URL terlalu panjang."
      });
    }

    const normalized = /^https?:\/\//i.test(raw)
      ? raw
      : "https://" + raw;

    const result = await resolveRedirect(normalized);

    return res.status(200).json({
      input_url: raw,
      ...result
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Link tidak dapat diproses."
    });
  }
          }
