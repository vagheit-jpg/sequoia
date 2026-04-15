import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.DART_API_KEY;
const publicDir = path.join(__dirname, '../public');
const outPath = path.join(publicDir, 'corplist.json');

if (!API_KEY) {
  fs.mkdirSync(publicDir, { recursive: true });
  if (!fs.existsSync(outPath)) {
    fs.writeFileSync(outPath, '[]', 'utf8');
  }
  console.warn('DART_API_KEY가 없어 빈 corplist.json을 유지합니다.');
  process.exit(0);
}

const ZIP_URL = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${API_KEY}`;
const TMP_DIR = path.join(__dirname, '../tmp_dart');
const TMP_ZIP = path.join(TMP_DIR, 'corpcode.zip');

function download(url, dest, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error('리다이렉트가 너무 많습니다.'));
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error('리다이렉트 위치가 없습니다.'));
        return download(location, dest, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function parseCorpXml(xmlStr) {
  const corps = [];
  const itemRe = /<list>([\s\S]*?)<\/list>/g;
  let match;
  while ((match = itemRe.exec(xmlStr)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`);
      return (block.match(regex) || [])[1]?.trim() || '';
    };
    const stockCode = get('stock_code').trim();
    if (/^\d{6}$/.test(stockCode)) {
      corps.push({
        code: get('corp_code'),
        name: get('corp_name'),
        stock: stockCode,
      });
    }
  }
  return corps.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  await download(ZIP_URL, TMP_ZIP);
  execSync(`unzip -o "${TMP_ZIP}" -d "${TMP_DIR}"`, { stdio: 'pipe' });
  const xmlFile = fs.readdirSync(TMP_DIR).find((name) => name.toLowerCase().includes('corpcode') && name.endsWith('.xml'));
  if (!xmlFile) throw new Error('corpCode XML 파일이 없습니다.');
  const xmlStr = fs.readFileSync(path.join(TMP_DIR, xmlFile), 'utf8');
  const corps = parseCorpXml(xmlStr);
  fs.writeFileSync(outPath, JSON.stringify(corps), 'utf8');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

main().catch((error) => {
  console.error('corplist.json 생성 실패:', error.message);
  process.exit(1);
});
