const ExcelJS = require('exceljs');
const TEXT = require('./text');
const { COLORS } = TEXT.VISUALS;

// ── palette ──────────────────────────────────────────────────────────────
// exceljs wants ARGB hex strings; our shared palette is 0xRRGGBB numbers.
function argb(hex) {
  return 'FF' + hex.toString(16).padStart(6, '0').toUpperCase();
}
const OCEAN = argb(COLORS.brand); // header block + title band blue
const TURQUOISE = argb(COLORS.approved); // "approved" status chip
const CORAL = argb(COLORS.denied); // "denied" status chip
const SAND = argb(COLORS.sand); // subtitle band
const NAVY = argb(COLORS.navy); // deep text / column-header fill
const DEEP_BLUE = 'FF1D6FA3'; // "claimed" chip — a deeper ocean blue, on-theme
const WHITE = 'FFFFFFFF';
const ROW_A = WHITE; // banded rows: crest white...
const ROW_B = 'FFEAF7F8'; // ...and a pale sea-foam tint
const GRIDLINE = { style: 'thin', color: { argb: 'FFCFE7EC' } }; // soft foam grid

// One themed chip per status: fill + text color + a matching event emoji.
// Keys are the capitalized status strings sendBountyExport() passes in.
const STATUS_CHIP = {
  Approved: { fill: TURQUOISE, font: WHITE, emoji: '✅' },
  Claimed: { fill: DEEP_BLUE, font: WHITE, emoji: '🏁' },
  Pending: { fill: OCEAN, font: WHITE, emoji: '⏳' },
  Denied: { fill: CORAL, font: WHITE, emoji: '⛔' },
};

const COLUMNS = [
  { header: '🏴‍☠️ Bounty Name', key: 'name', width: 32 },
  { header: 'Status', key: 'status', width: 15 },
  { header: '💰 Reward', key: 'reward', width: 14 },
  { header: 'Requester', key: 'requester', width: 17 },
  { header: 'Approved By', key: 'approver', width: 17 },
  { header: 'Approved', key: 'approvedDate', width: 13 },
  { header: 'Claimed By', key: 'claimant', width: 17 },
  { header: 'Claimed', key: 'claimedDate', width: 13 },
  { header: 'Description', key: 'description', width: 60 },
];

// Excel column-width units → on-screen pixels — used only to estimate how
// many lines the Description column will wrap to (see estLines below).
const colToPx = (w) => Math.round(w * 7) + 5;

// Builds a themed .xlsx (Buffer) for /allbounties' export. `entries` are
// already display-ready plain objects (usernames resolved, dates formatted);
// this module only handles layout/styling, no Discord or DB calls.
async function buildBountiesWorkbook({ entries, label, order, generatedBy }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Lumi-chan';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`${label} Bounties`.slice(0, 31), {
    properties: { tabColor: { argb: OCEAN } },
  });
  const colCount = COLUMNS.length;
  COLUMNS.forEach((col, i) => (sheet.getColumn(i + 1).width = col.width));

  let r = 1; // running row cursor

  // ── row 1: empty spacer, no image, no text — just very small ───────────
  sheet.mergeCells(r, 1, r, colCount);
  sheet.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OCEAN } };
  sheet.getRow(r).height = 4;
  r += 1;

  // ── title band ─────────────────────────────────────────────────────────
  sheet.mergeCells(r, 1, r, colCount);
  const title = sheet.getCell(r, 1);
  title.value = `🌊  Coastal Clash  —  ${label} Bounties  🏁`;
  title.font = { name: 'Calibri', bold: true, size: 18, color: { argb: WHITE } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OCEAN } };
  sheet.getRow(r).height = 34;
  r += 1;

  // ── subtitle band (export metadata) ──────────────────────────────────────
  sheet.mergeCells(r, 1, r, colCount);
  const subtitle = sheet.getCell(r, 1);
  const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  subtitle.value = `Exported ${when}${generatedBy ? ` by ${generatedBy}` : ''}  •  ${entries.length} total  •  sorted ${order}`;
  subtitle.font = { name: 'Calibri', italic: true, size: 11, color: { argb: NAVY } };
  subtitle.alignment = { horizontal: 'center', vertical: 'middle' };
  subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAND } };
  sheet.getRow(r).height = 22;
  r += 1;

  // ── header row ───────────────────────────────────────────────────────────
  const headerRowIndex = r;
  const headerRow = sheet.getRow(r);
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: GRIDLINE, bottom: GRIDLINE, left: GRIDLINE, right: GRIDLINE };
  });
  headerRow.height = 24;
  r += 1;

  // ── data rows ─────────────────────────────────────────────────────────────
  // Each row's height is computed from how many lines its Description wraps to
  // at the Description column's width — so nothing gets clipped, no matter how
  // the viewer (Excel / Google Sheets / Numbers) handles auto-fit.
  const descColWidth = COLUMNS.find((c) => c.key === 'description').width;
  const charsPerLine = Math.max(1, Math.floor(colToPx(descColWidth) / 7));
  const estLines = (text) =>
    String(text ?? '')
      .split('\n')
      .reduce((sum, seg) => sum + Math.max(1, Math.ceil(seg.length / charsPerLine)), 0);

  entries.forEach((entry, i) => {
    const row = sheet.getRow(r + i);
    const band = i % 2 === 0 ? ROW_A : ROW_B;
    row.height = Math.min(300, Math.max(24, estLines(entry.description) * 15));

    COLUMNS.forEach((col, c) => {
      const cell = row.getCell(c + 1);
      const centered = col.key !== 'name' && col.key !== 'description';
      cell.alignment = {
        vertical: col.key === 'description' ? 'top' : 'middle',
        horizontal: centered ? 'center' : 'left',
        wrapText: col.key === 'description',
      };
      cell.border = { top: GRIDLINE, bottom: GRIDLINE, left: GRIDLINE, right: GRIDLINE };

      if (col.key === 'status') {
        const chip = STATUS_CHIP[entry.status] ?? { fill: band, font: NAVY, emoji: '' };
        cell.value = `${chip.emoji} ${entry.status}`.trim();
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: chip.fill } };
        cell.font = { name: 'Calibri', bold: true, color: { argb: chip.font } };
      } else {
        cell.value = entry[col.key] ?? '';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band } };
        cell.font = { name: 'Calibri', bold: col.key === 'name', color: { argb: NAVY } };
      }
    });
  });

  // Frozen header + filter, and hide the default gridlines so our own foam
  // borders carry the structure — reads as designed, not raw.
  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: colCount },
  };
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex, showGridLines: false }];

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildBountiesWorkbook };
