// Extract a lat/lng from map links and plain coordinate text.
// Shared by api/resolve-map.js and the tests; the page has a copy of parseCoord.

export function parseCoord(input) {
  let s = String(input || '');
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(s); if (d === s) break; s = d; } catch { break; } }
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,                         // exact place in Google Maps data
    /[?&](?:q|ll|query|destination|daddr|center|sll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // ?q=lat,lng
    /\/search\/(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/,               // /maps/search/lat,+lng
    /\/place\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/,                   // /maps/place/lat,lng
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,                              // viewport centre
    /geo:(-?\d+\.\d+),(-?\d+\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)\s*$/,                 // the whole text is "lat,lng"
    /(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{2,3}\.\d{3,})/,       // "13.7563, 100.5018"
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = +m[1], lng = +m[2];
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    }
  }
  return null;
}

// The place name/address a Google Maps link searches for (?q=Name, Address…), if it isn't coordinates.
export function placeQuery(u) {
  const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
  const fromPath = (u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/) || [])[1];
  let s = q || (fromPath ? decodeURIComponent(fromPath.replace(/\+/g, ' ')) : '');
  s = s.replace(/\s+/g, ' ').trim();
  return s && !parseCoord(s) ? s.slice(0, 300) : null;
}

// Google's English spellings that differ from the district file's names.
const ALIASES = {
  1007: ['Pathum Wan', 'Pathumwan'], 1034: ['Suan Luang'], 1039: ['Watthana', 'Wattana'], 1015: ['Thonburi'],
  1031: ['Bang Kho Laem'], 1021: ['Bang Khun Thian'], 1030: ['Chatuchak'], 1049: ['Thung Khru'],
  1012: ['Yan Nawa'], 1032: ['Prawet'], 1028: ['Sathorn'], 1033: ['Khlong Toei', 'Klong Toey', 'Khlong Toey'],
  1017: ['Huai Khwang', 'Huay Kwang'], 1042: ['Sai Mai'], 1044: ['Saphan Sung'], 1045: ['Wang Thonglang'],
  1046: ['Khlong Sam Wa'], 1036: ['Don Muang'], 1038: ['Lat Phrao', 'Ladprao'], 1011: ['Lat Krabang', 'Ladkrabang'],
  1006: ['Bang Kapi'], 1047: ['Bang Na', 'Bangna'], 1048: ['Thawi Watthana'], 1024: ['Rat Burana', 'Rasburana'],
};
const norm = s => s.toLowerCase().replace(/[^a-z฀-๿]/g, '');
let districtIndex = null;
async function index() {
  if (districtIndex) return districtIndex;
  const { DISTRICTS } = await import('./_districts.js');
  districtIndex = DISTRICTS.features.map(f => {
    const ring = f.geometry.coordinates[0];
    const lng = ring.reduce((a, p) => a + p[0], 0) / ring.length, lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const names = [f.properties.n, f.properties.e, ...(ALIASES[f.properties.c] || [])].map(norm);
    return { c: f.properties.c, n: f.properties.n, lat, lng, names };
  });
  return districtIndex;
}

// Which Bangkok district an address names. Sub-district parts ("Khwaeng X", "แขวงX") are skipped,
// because a แขวง can share its name with a different เขต (แขวงพระโขนง is in เขตคลองเตย).
export async function districtFromText(text) {
  const idx = await index();
  const segs = String(text).split(/[,،]/).map(s => s.trim()).filter(s => s && !/^(khwaeng|แขวง)/i.test(s));
  for (const seg of segs.reverse()) {
    const k = norm(seg.replace(/^(khet|เขต)\s*/i, ''));
    const hit = idx.find(d => d.names.includes(k));
    if (hit) return hit;
  }
  return null;
}

const ALLOWED = [
  /^maps\.app\.goo\.gl$/, /^goo\.gl$/, /^g\.co$/,
  /^(www\.|maps\.)?google\.(com|co\.th)$/, /^consent\.google\.(com|co\.th)$/,
];
export const allowedHost = h => ALLOWED.some(re => re.test(h));
