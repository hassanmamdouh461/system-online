/**
 * Shared Telegram Bot Messaging Service
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
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
