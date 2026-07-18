const fs = require("fs");
const path = require("path");

const TOKEN = process.env.GH_TOKEN;
const USERNAME = process.env.GH_USERNAME;

if (!TOKEN) {
  console.error("Missing GH_TOKEN");
  process.exit(1);
}

if (!USERNAME) {
  console.error("Missing GH_USERNAME");
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), "assets");
fs.mkdirSync(OUT_DIR, { recursive: true });

const API_BASE = "https://api.github.com";
const COMMON_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "github-stats-generator",
};

async function ghFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...COMMON_HEADERS,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${text}`);
  }

  return res;
}

async function fetchAllRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const url = new URL(`${API_BASE}/user/repos`);
    url.searchParams.set("visibility", "all");
    url.searchParams.set("affiliation", "owner");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const res = await ghFetch(url);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) break;

    repos.push(...data);
    page += 1;
  }

  return repos;
}

async function fetchUser() {
  const res = await ghFetch(`${API_BASE}/user`);
  return res.json();
}

async function fetchRepoLanguages(languagesUrl) {
  const res = await ghFetch(languagesUrl);
  return res.json();
}

async function fetchContributionCalendar(login) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const res = await ghFetch("https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({
      query,
      variables: { login },
    }),
  });

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .map((d) => ({
      date: d.date,
      count: d.contributionCount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

function topLanguagesFromRepos(repos) {
  return repos.filter((r) => !r.fork && r.languages_url);
}

async function computeLanguageTotals(repos) {
  const totals = new Map();

  for (const repo of topLanguagesFromRepos(repos)) {
    try {
      const langs = await fetchRepoLanguages(repo.languages_url);
      for (const [lang, bytes] of Object.entries(langs)) {
        totals.set(lang, (totals.get(lang) || 0) + bytes);
      }
    } catch {
      // ignore repos that fail language lookup
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, bytes]) => ({ language, bytes }));
}

function computeStreak(days) {
  const map = new Map(days.map((d) => [d.date, d.count]));
  const dates = days.map((d) => d.date);

  if (dates.length === 0) {
    return { current: 0, longest: 0, total: 0, activeDays: 0 };
  }

  const total = days.reduce((sum, d) => sum + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;

  let longest = 0;
  let run = 0;

  for (const d of days) {
    if (d.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let current = 0;
  const today = dates[dates.length - 1];

  let cursor = new Date(`${today}T00:00:00Z`);
  while (true) {
    const iso = cursor.toISOString().slice(0, 10);
    const count = map.get(iso) || 0;
    if (count <= 0) break;
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { current, longest, total, activeDays };
}

function generateStatsSvg({ user, repos }) {
  const totalRepos = repos.length;
  const privateRepos = repos.filter((r) => r.private).length;
  const publicRepos = repos.filter((r) => !r.private).length;
  const stars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const forks = repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);

  return `
<svg width="520" height="220" viewBox="0 0 520 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub stats">
  <rect width="520" height="220" rx="18" fill="#0d1117"/>
  <text x="28" y="42" fill="#ffffff" font-size="24" font-family="Arial, Helvetica, sans-serif" font-weight="700">
    GitHub Stats
  </text>
  <text x="28" y="80" fill="#8b949e" font-size="14" font-family="Arial, Helvetica, sans-serif">
    @${escapeXml(user.login)}
  </text>

  <text x="28" y="118" fill="#58a6ff" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Total Repos: ${formatNumber(totalRepos)}
  </text>
  <text x="28" y="150" fill="#3fb950" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Public: ${formatNumber(publicRepos)}
  </text>
  <text x="28" y="182" fill="#f85149" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Private: ${formatNumber(privateRepos)}
  </text>

  <text x="270" y="118" fill="#d29922" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Stars: ${formatNumber(stars)}
  </text>
  <text x="270" y="150" fill="#a371f7" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Forks: ${formatNumber(forks)}
  </text>
</svg>`.trim();
}

function generateTopLangsSvg(languages) {
  const width = 520;
  const height = 260;
  const cx = 120;
  const cy = 140;
  const r = 72;
  const strokeWidth = 28;

  const palette = [
    "#58a6ff",
    "#3fb950",
    "#d29922",
    "#f85149",
    "#a371f7",
    "#ff7b72",
    "#2ea043",
    "#7ee787",
  ];

  const top = languages.slice(0, 6);
  const total = top.reduce((sum, x) => sum + x.bytes, 0) || 1;

  let start = -90;
  const rings = [];

  top.forEach((item, index) => {
    const pct = item.bytes / total;
    const dash = 2 * Math.PI * r;
    const segment = dash * pct;
    const gap = dash - segment;
    const color = palette[index % palette.length];

    rings.push(`
      <circle
        cx="${cx}"
        cy="${cy}"
        r="${r}"
        fill="none"
        stroke="${color}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${segment} ${gap}"
        stroke-dashoffset="${(-dash * start) / 360}"
        transform="rotate(-90 ${cx} ${cy})"
        stroke-linecap="round"
      />`);

    start += pct * 360;
  });

  const legend = top
    .map((item, index) => {
      const y = 78 + index * 28;
      const pct = ((item.bytes / total) * 100).toFixed(1);
      return `
        <rect x="250" y="${y - 12}" width="12" height="12" rx="3" fill="${palette[index % palette.length]}"/>
        <text x="272" y="${y}" fill="#ffffff" font-size="15" font-family="Arial, Helvetica, sans-serif">
          ${escapeXml(item.language)} — ${pct}%
        </text>`;
    })
    .join("");

  return `
<svg width="520" height="260" viewBox="0 0 520 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Top languages">
  <rect width="520" height="260" rx="18" fill="#0d1117"/>
  <text x="28" y="40" fill="#ffffff" font-size="24" font-family="Arial, Helvetica, sans-serif" font-weight="700">
    Top Languages
  </text>
  <text x="28" y="64" fill="#8b949e" font-size="13" font-family="Arial, Helvetica, sans-serif">
    by language bytes across your owned repos
  </text>

  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#21262d" stroke-width="${strokeWidth}"/>

  ${rings.join("")}
  <circle cx="${cx}" cy="${cy}" r="${r - 30}" fill="#0d1117"/>

  <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#ffffff" font-size="18" font-family="Arial, Helvetica, sans-serif" font-weight="700">
    ${top.length ? escapeXml(top[0].language) : "No data"}
  </text>
  <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="#8b949e" font-size="12" font-family="Arial, Helvetica, sans-serif">
    top language
  </text>

  ${legend}
</svg>`.trim();
}

function generateStreakSvg(streak) {
  return `
<svg width="520" height="220" viewBox="0 0 520 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub streak">
  <rect width="520" height="220" rx="18" fill="#0d1117"/>
  <text x="28" y="42" fill="#ffffff" font-size="24" font-family="Arial, Helvetica, sans-serif" font-weight="700">
    Streak
  </text>

  <text x="28" y="94" fill="#58a6ff" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Current: ${formatNumber(streak.current)} days
  </text>
  <text x="28" y="128" fill="#3fb950" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Longest: ${formatNumber(streak.longest)} days
  </text>
  <text x="28" y="162" fill="#d29922" font-size="18" font-family="Arial, Helvetica, sans-serif">
    Total contributions: ${formatNumber(streak.total)}
  </text>
  <text x="28" y="196" fill="#8b949e" font-size="14" font-family="Arial, Helvetica, sans-serif">
    Active days in last year: ${formatNumber(streak.activeDays)}
  </text>
</svg>`.trim();
}

async function main() {
  const user = await fetchUser();
  const repos = await fetchAllRepos();
  const languages = await computeLanguageTotals(repos);
  const contributionDays = await fetchContributionCalendar(USERNAME);
  const streak = computeStreak(contributionDays);

  fs.writeFileSync(path.join(OUT_DIR, "top-langs.svg"), generateTopLangsSvg(languages));
  fs.writeFileSync(path.join(OUT_DIR, "github-stats.svg"), generateStatsSvg({ user, repos }));
  fs.writeFileSync(path.join(OUT_DIR, "streak.svg"), generateStreakSvg(streak));

  console.log("Generated:");
  console.log("assets/top-langs.svg");
  console.log("assets/github-stats.svg");
  console.log("assets/streak.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
