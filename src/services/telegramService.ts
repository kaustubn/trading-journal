import axios from 'axios';

export class TelegramService {
  static async sendTradeNotification(botToken: string, chatId: string, trade: {
    symbol: string;
    entry_price: number;
    quantity: number;
    entry_time: string;
    setup_tag?: string;
  }) {
    const message = `
📈 <b>New Trade</b>
Symbol: <code>${trade.symbol}</code>
Entry: $${trade.entry_price.toFixed(2)}
Quantity: ${trade.quantity}
Time: ${new Date(trade.entry_time).toLocaleTimeString()}
${trade.setup_tag ? `Setup: ${trade.setup_tag}` : ''}
    `.trim();

    await this.sendMessage(botToken, chatId, message);
  }

  static async sendClosureNotification(botToken: string, chatId: string, trade: {
    symbol: string;
    entry_price: number;
    exit_price: number;
    quantity: number;
    pnl: number;
    exit_time: string;
  }) {
    const emoji = trade.pnl > 0 ? '✅' : '❌';
    const message = `
${emoji} <b>Trade Closed</b>
Symbol: <code>${trade.symbol}</code>
Entry: $${trade.entry_price.toFixed(2)}
Exit: $${trade.exit_price.toFixed(2)}
Quantity: ${trade.quantity}
<b>P&L: $${trade.pnl.toFixed(2)}</b>
Time: ${new Date(trade.exit_time).toLocaleTimeString()}
    `.trim();

    await this.sendMessage(botToken, chatId, message);
  }

  static async sendDailySummary(botToken: string, chatId: string, summary: {
    date: string;
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
    winRate: number;
  }) {
    const emoji = summary.pnl >= 0 ? '📊' : '⚠️';
    const message = `
${emoji} <b>Daily Summary - ${summary.date}</b>
Total Trades: ${summary.trades}
Wins: ${summary.wins}
Losses: ${summary.losses}
Win Rate: ${summary.winRate.toFixed(2)}%
<b>Daily P&L: $${summary.pnl.toFixed(2)}</b>
    `.trim();

    await this.sendMessage(botToken, chatId, message);
  }

  static async sendAlert(botToken: string, chatId: string, alert: {
    type: 'loss' | 'milestone' | 'warning';
    message: string;
  }) {
    const emojiMap = {
      loss: '⚠️',
      milestone: '🎉',
      warning: '🔔',
    };

    const fullMessage = `${emojiMap[alert.type]} <b>${alert.type.toUpperCase()}</b>\n${alert.message}`;
    await this.sendMessage(botToken, chatId, fullMessage);
  }

  private static async sendMessage(botToken: string, chatId: string, message: string) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        }
      );
    } catch (error) {
      console.error('Telegram webhook error:', error);
    }
  }
}
