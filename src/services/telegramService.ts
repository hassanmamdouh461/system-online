/**
 * Shared Telegram Bot Messaging Service
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Escape the three characters Telegram's HTML parser treats as markup (& < >)
 * so dynamic values (store / customer / company / item names, units, …) can be
 * safely embedded inside a parse_mode:'HTML' message. Without this, a value that
 * contains '&', '<' or '>' (e.g. a customer named "A & B") makes Telegram reject
 * the ENTIRE message with `400: can't parse entities`, so the whole report fails
 * to send.
 *
 * Only escape dynamic text — never the <b>/<code> tags we add on purpose. '&'
 * must be replaced first so the '&' we introduce is not re-escaped.
 */
export function escapeTelegramHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const telegramService = {
  getStoredConfig(): TelegramConfig | null {
    const botToken = localStorage.getItem('brewmaster_telegram_bot_token') || '';
    const chatId = localStorage.getItem('brewmaster_telegram_chat_id') || '';
    if (!botToken.trim() || !chatId.trim()) return null;
    return { botToken: botToken.trim(), chatId: chatId.trim() };
  },

  async sendMessage(botToken: string, chatId: string, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<{ ok: boolean; description?: string }> {
    if (!botToken || !chatId) {
      throw new Error('Telegram Bot Token and Chat ID are required');
    }

    const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: text,
        parse_mode: parseMode
      })
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || 'Failed to send Telegram message');
    }
    return data;
  },

  async sendTestMessage(botToken: string, chatId: string): Promise<boolean> {
    const testText = `🧪 <b>رسالة تجريبية من نظام BrewMaster POS</b>\n\nتم إعداد البوت ومحادثة تليجرام بنجاح! ستصلك التقارير اليومية هنا في الموعد المحدد.`;
    const res = await this.sendMessage(botToken, chatId, testText, 'HTML');
    return res.ok;
  }
};
