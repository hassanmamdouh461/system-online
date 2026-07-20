const https = require('https');
const db = require('./database.cjs');
const orderRepository = require('./OrderRepository.cjs');

/**
 * Send a generic message to Telegram using Bot API
 */
function sendTelegramMessage(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(responseBody));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Compile and send the daily sales report for the current branch to Telegram
 */
async function sendDailyReport() {
  const settings = db.getSettings();
  
  // 1. Check if Telegram configuration exists
  const telegramConfigRaw = settings['brewmaster_telegram_config'];
  if (!telegramConfigRaw) {
    throw new Error('Telegram is not configured in settings');
  }

  let config;
  try {
    config = JSON.parse(telegramConfigRaw);
  } catch (e) {
    throw new Error('Failed to parse Telegram configuration');
  }

  const { botToken, chatId, enabled } = config;
  if (!botToken || !chatId) {
    throw new Error('Telegram Bot Token or Chat ID is missing');
  }

  // 2. Fetch branch configuration for report header
  let branchName = 'Main Branch';
  const branchConfigRaw = settings['brewmaster_branch_config'];
  if (branchConfigRaw) {
    try {
      const branchConfig = JSON.parse(branchConfigRaw);
      branchName = branchConfig.branchName || branchName;
    } catch (e) {}
  }

  // 3. Retrieve daily statistics from SQLite database
  const stats = orderRepository.getDailyReportStats();

  // 4. Format the Telegram report in Arabic
  let message = `📅 <b>تقرير المبيعات اليومي لفرع: ${branchName}</b>\n`;
  message += `⏱️ تاريخ التقرير: <code>${stats.date}</code>\n\n`;

  message += `📊 <b>الملخص المالي لليوم:</b>\n`;
  message += `• عدد الطلبات الكلي: <b>${stats.totalOrders}</b> طلب\n`;
  message += `• إجمالي المبيعات (المحصلة): <b>${stats.totalRevenue.toFixed(2)}</b> ج.م\n`;
  message += `• إجمالي الآجل (غير مدفوع): <b>${stats.totalUnpaid.toFixed(2)}</b> / ج.م\n\n`;

  message += `💳 <b>تفاصيل طرق الدفع (المدفوعة):</b>\n`;
  message += `• نقدي (Cash): <b>${stats.cashRevenue.toFixed(2)}</b> ج.م 💵\n`;
  message += `• شبكة/بطاقة (Card): <b>${stats.cardRevenue.toFixed(2)}</b> ج.م 💳\n\n`;

  if (stats.itemsSold && stats.itemsSold.length > 0) {
    message += `☕ <b>الأصناف المباعة اليوم:</b>\n`;
    // Sort items by quantity sold descending
    const sortedItems = [...stats.itemsSold].sort((a, b) => b.quantity - a.quantity);
    for (const item of sortedItems) {
      message += `• ${item.name}: عدد <b>${item.quantity}</b>\n`;
    }
    message += `\n`;
  } else {
    message += `☕ <b>الأصناف المباعة اليوم:</b> لا توجد مبيعات مسجلة اليوم.\n\n`;
  }

  message += `✅ تم إرسال التقرير بنجاح من نظام <b>BrewMaster POS</b>`;

  // 5. Send message to Telegram
  return await sendTelegramMessage(botToken, chatId, message);
}

module.exports = {
  sendTelegramMessage,
  sendDailyReport
};
