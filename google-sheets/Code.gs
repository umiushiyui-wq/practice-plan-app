const SHEETS = {
  responses: "フォームの回答 1",
  members: "設定_奏者",
  practiceDays: "設定_練習日",
  pieces: "設定_曲",
  availability: "集計_参加可能時間",
  plan: "練習計画"
};

const PARTS = [
  "ふるぼえ",
  "クラリネット",
  "サックス",
  "ホルン",
  "トランペット",
  "トロンボーン",
  "低音",
  "パーカス"
];

const HOURS = Array.from({ length: 15 }, (_, index) => index + 8);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("練習計画")
    .addItem("初期シート作成", "setupPracticeSheets")
    .addItem("参加可能時間表を更新", "refreshAvailabilitySheet")
    .addItem("練習計画表を整える", "setupPlanSheet")
    .addToUi();
}

function setupPracticeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const members = getOrCreateSheet_(ss, SHEETS.members);
  const practiceDays = getOrCreateSheet_(ss, SHEETS.practiceDays);
  const pieces = getOrCreateSheet_(ss, SHEETS.pieces);

  setupHeader_(members, ["名前", "パート"]);
  setupHeader_(practiceDays, ["練習日", "開始", "終了"]);
  setupHeader_(pieces, ["曲名", "指揮者", "目標分", "1日上限分"]);

  const partRule = SpreadsheetApp.newDataValidation().requireValueInList(PARTS, true).build();
  members.getRange("B2:B").setDataValidation(partRule);

  formatPracticeDaySheet_(practiceDays);
  setupPlanSheet();
  refreshAvailabilitySheet();
}

function setupPlanSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const plan = getOrCreateSheet_(ss, SHEETS.plan);
  plan.clear();
  setupHeader_(plan, ["練習日", "開始", "終了", "分", "曲", "メモ"]);
  plan.getRange("A2:A").setNumberFormat("yyyy/mm/dd");
  plan.getRange("B2:C").setNumberFormat("hh:mm");
  plan.getRange("D2:D").setNumberFormat("0");
  plan.getRange("A2:A").setDataValidation(dateRule_());
  plan.getRange("B2:C").setDataValidation(timeRule_());
  plan.setFrozenRows(1);
  plan.autoResizeColumns(1, 6);
}

function formatPracticeDaySheet_(sheet) {
  sheet.getRange("A2:A").setNumberFormat("yyyy/mm/dd");
  sheet.getRange("B2:C").setNumberFormat("hh:mm");
  sheet.getRange("A2:A").setDataValidation(dateRule_());
  sheet.getRange("B2:C").setDataValidation(timeRule_());
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 1, 120);
  sheet.setColumnWidths(2, 2, 80);
}

function dateRule_() {
  return SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText("日付は 2026/04/12 のように入力してください。")
    .build();
}

function timeRule_() {
  return SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, 1)
    .setAllowInvalid(false)
    .setHelpText("時刻は 18:00 のように入力してください。")
    .build();
}

function refreshAvailabilitySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const output = getOrCreateSheet_(ss, SHEETS.availability);
  const memberRows = readRows_(ss, SHEETS.members);
  const practiceDayRows = readRows_(ss, SHEETS.practiceDays);
  const responseRows = readRows_(ss, SHEETS.responses);

  output.clear();

  const members = memberRows
    .map((row) => ({
      name: String(row["名前"] || "").trim(),
      part: String(row["パート"] || "").trim()
    }))
    .filter((member) => member.name);

  const practiceDays = practiceDayRows
    .map((row) => ({
      date: normalizeDate_(row["練習日"]),
      start: normalizeTime_(row["開始"]),
      end: normalizeTime_(row["終了"])
    }))
    .filter((day) => day.date);

  const latestResponses = new Map();
  for (const row of responseRows) {
    const name = String(row["名前"] || "").trim();
    const part = String(row["パート"] || "").trim();
    const date = normalizeDate_(row["練習日"]);
    if (!name || !date) continue;

    latestResponses.set(`${date}__${name}`, {
      name,
      part,
      date,
      attendance: String(row["出欠"] || "").trim(),
      start: normalizeTime_(row["参加可能開始"]),
      end: normalizeTime_(row["参加可能終了"]),
      pieces: String(row["出演できる曲"] || "").trim()
    });
  }

  let rowIndex = 1;
  for (const day of practiceDays) {
    output.getRange(rowIndex, 1).setValue(`${day.date} 参加可能時間`);
    output.getRange(rowIndex, 1, 1, 3 + HOURS.length).mergeAcross();
    output.getRange(rowIndex, 1).setFontWeight("bold").setBackground("#dfe8ef");
    rowIndex++;

    const header = ["名前", "パート", "状態", ...HOURS.map((hour) => `${hour}:00`)];
    output.getRange(rowIndex, 1, 1, header.length).setValues([header]).setFontWeight("bold");
    output.getRange(rowIndex, 1, 1, header.length).setBackground("#eef3f7");
    rowIndex++;

    const tableStartRow = rowIndex;
    for (const member of members) {
      const response = latestResponses.get(`${day.date}__${member.name}`);
      const isAbsent = !response || response.attendance === "欠席";
      const status = !response ? "未回答（欠席扱い）" : isAbsent ? "欠席" : `${response.start}-${response.end}`;
      const rowValues = [member.name, member.part || response?.part || "", status, ...HOURS.map(() => "")];
      output.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);

      for (let i = 0; i < HOURS.length; i++) {
        const hour = HOURS[i];
        const cell = output.getRange(rowIndex, 4 + i);
        cell.setNote("");
        cell.setBackground("#ffffff");

        if (!isAbsent && response?.start && response?.end && overlapsHour_(response.start, response.end, hour)) {
          cell.setBackground("#2f9e44");
          cell.setNote(`${member.name}\n${day.date}\n${response.start}-${response.end}\n${hour}:00`);
        }
      }

      rowIndex++;
    }

    if (members.length > 0) {
      output.getRange(tableStartRow, 1, members.length, 3 + HOURS.length).setBorder(true, true, true, true, true, true);
    }
    rowIndex += 2;
  }

  output.setFrozenRows(0);
  output.setColumnWidths(1, 1, 120);
  output.setColumnWidths(2, 1, 100);
  output.setColumnWidths(3, 1, 130);
  output.setColumnWidths(4, HOURS.length, 44);
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setupHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#dfe8ef");
}

function readRows_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((value) => String(value).trim());
  return values.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]]))
  );
}

function normalizeDate_(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy/MM/dd");
  }
  return String(value).trim().replaceAll("-", "/");
}

function normalizeTime_(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }
  const text = String(value).trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!match) return text;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function toMinutes_(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function overlapsHour_(start, end, hour) {
  const slotStart = hour * 60;
  const slotEnd = hour === 22 ? slotStart : slotStart + 60;
  const startMinutes = toMinutes_(start);
  const endMinutes = toMinutes_(end);
  return hour === 22
    ? startMinutes <= slotStart && endMinutes >= slotStart
    : startMinutes < slotEnd && slotStart < endMinutes;
}
