import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_DATABASE_PATH = path.join(process.cwd(), "data", "materials.sqlite");
const DEFAULT_BACKUP_DIR = path.join(process.cwd(), "backups");
const DEFAULT_EMAIL_TO = "kerorosen@gmail.com";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}。`);
  return value;
}

function optionalEnv(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function getAppInfo() {
  const source = readFileSync(path.join(process.cwd(), "lib", "version.ts"), "utf8");
  const title = source.match(/APP_TITLE\s*=\s*"([^"]+)"/)?.[1] ?? "科研开发部物料管理系统";
  const version = source.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "UNKNOWN";
  return { title, version };
}

function getShanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getBackupStamp() {
  const parts = getShanghaiParts();
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function getDisplayTime() {
  const parts = getShanghaiParts();
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} 中国时间`;
}

function quoteSqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function readRows(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function createSqliteSnapshot(databasePath, outputPath) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`VACUUM INTO ${quoteSqlString(outputPath)};`);
  } finally {
    db.close();
  }
}

function exportJsonBackup(sqlitePath, generatedAt, appInfo) {
  const db = new DatabaseSync(sqlitePath);
  try {
    const materials = readRows(db, "materials");
    const usageRecords = readRows(db, "usage_records");
    const reservationRecords = readRows(db, "reservation_records");

    return {
      metadata: {
        appTitle: appInfo.title,
        appVersion: appInfo.version,
        generatedAt,
        timeZone: SHANGHAI_TIME_ZONE,
        source: "weekly-email-backup",
        counts: {
          materials: materials.length,
          usageRecords: usageRecords.length,
          reservationRecords: reservationRecords.length,
        },
      },
      materials,
      usageRecords,
      reservationRecords,
    };
  } finally {
    db.close();
  }
}

function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapBase64(buffer) {
  return buffer.toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function buildMimeMessage({ from, to, subject, text, attachments }) {
  const boundary = `backup-${randomUUID()}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(text, "utf8")),
  ];

  for (const attachment of attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      wrapBase64(readFileSync(attachment.path)),
    );
  }

  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let response = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP 服务器响应超时。"));
    }, 30000);

    function cleanup() {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      response += chunk.toString("utf8");
      const lines = response.split(/\r?\n/).filter(Boolean);
      const lastLine = lines.at(-1);
      if (lastLine && /^\d{3} /.test(lastLine)) {
        cleanup();
        resolve({ code: Number(lastLine.slice(0, 3)), message: lines.join("\n") });
      }
    }

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendCommand(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP 命令失败：${command}\n${response.message}`);
  }
  return response;
}

function dotStuff(message) {
  return message.replace(/^\./gm, "..");
}

async function sendMail({ host, port, user, pass, from, to, subject, text, attachments }) {
  const socket = tls.connect({
    host,
    port,
    servername: host,
  });

  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  try {
    const greeting = await readSmtpResponse(socket);
    if (greeting.code !== 220) throw new Error(`SMTP 连接失败：${greeting.message}`);

    await sendCommand(socket, "EHLO localhost", [250]);
    await sendCommand(socket, "AUTH LOGIN", [334]);
    await sendCommand(socket, Buffer.from(user, "utf8").toString("base64"), [334]);
    await sendCommand(socket, Buffer.from(pass, "utf8").toString("base64"), [235]);
    await sendCommand(socket, `MAIL FROM:<${from}>`, [250]);
    await sendCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await sendCommand(socket, "DATA", [354]);

    const message = buildMimeMessage({ from, to, subject, text, attachments });
    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    const dataResponse = await readSmtpResponse(socket);
    if (dataResponse.code !== 250) throw new Error(`邮件发送失败：${dataResponse.message}`);

    await sendCommand(socket, "QUIT", [221]);
  } finally {
    socket.end();
  }
}

export async function runDatabaseBackup(options = {}) {
  const dryRun = options.dryRun ?? process.env.BACKUP_DRY_RUN === "1";
  const databasePath = path.resolve(optionalEnv("DATABASE_PATH", DEFAULT_DATABASE_PATH));
  if (!existsSync(databasePath)) {
    throw new Error(`数据库文件不存在：${databasePath}`);
  }

  const appInfo = getAppInfo();
  const generatedAt = getDisplayTime();
  const stamp = getBackupStamp();
  const backupDir = path.resolve(optionalEnv("BACKUP_OUTPUT_DIR", DEFAULT_BACKUP_DIR));
  mkdirSync(backupDir, { recursive: true });

  const baseName = `materials-backup-${stamp}`;
  const sqliteBackupPath = path.join(backupDir, `${baseName}.sqlite`);
  const jsonBackupPath = path.join(backupDir, `${baseName}.json`);

  createSqliteSnapshot(databasePath, sqliteBackupPath);
  const jsonBackup = exportJsonBackup(sqliteBackupPath, generatedAt, appInfo);
  await writeFile(jsonBackupPath, `${JSON.stringify(jsonBackup, null, 2)}\n`, "utf8");

  const sqliteSize = statSync(sqliteBackupPath).size;
  const jsonSize = statSync(jsonBackupPath).size;

  if (dryRun) {
    return {
      sent: false,
      to: "",
      generatedAt,
      sqliteBackupPath,
      jsonBackupPath,
      sqliteSize,
      jsonSize,
      counts: jsonBackup.metadata.counts,
    };
  }

  const host = requiredEnv("BACKUP_SMTP_HOST");
  const port = Number(optionalEnv("BACKUP_SMTP_PORT", "465"));
  if (!Number.isInteger(port) || port <= 0) throw new Error("BACKUP_SMTP_PORT 必须是有效端口。");

  const user = requiredEnv("BACKUP_SMTP_USER");
  const pass = requiredEnv("BACKUP_SMTP_PASS");
  const from = optionalEnv("BACKUP_EMAIL_FROM", user);
  const to = optionalEnv("BACKUP_EMAIL_TO", DEFAULT_EMAIL_TO);
  const subject = `${appInfo.title} ${appInfo.version} 数据库备份 ${stamp}`;
  const text = [
    `${appInfo.title} ${appInfo.version} 的数据库备份已生成。`,
    "",
    `备份时间：${generatedAt}`,
    `数据库来源：${databasePath}`,
    "",
    "附件包含：",
    `- ${path.basename(sqliteBackupPath)}：可用于恢复的 SQLite 快照`,
    `- ${path.basename(jsonBackupPath)}：可人工查看的 JSON 数据`,
  ].join("\n");

  await sendMail({
    host,
    port,
    user,
    pass,
    from,
    to,
    subject,
    text,
    attachments: [
      {
        filename: path.basename(sqliteBackupPath),
        path: sqliteBackupPath,
        contentType: "application/vnd.sqlite3",
      },
      {
        filename: path.basename(jsonBackupPath),
        path: jsonBackupPath,
        contentType: "application/json",
      },
    ],
  });

  return {
    sent: true,
    to,
    generatedAt,
    sqliteBackupPath,
    jsonBackupPath,
    sqliteSize,
    jsonSize,
    counts: jsonBackup.metadata.counts,
  };
}

async function main() {
  const result = await runDatabaseBackup();
  if (result.sent) {
    console.log(`备份邮件已发送至 ${result.to}。`);
  } else {
    console.log(`备份文件已生成，未发送邮件：`);
    console.log(`- ${result.sqliteBackupPath} (${result.sqliteSize} bytes)`);
    console.log(`- ${result.jsonBackupPath} (${result.jsonSize} bytes)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
