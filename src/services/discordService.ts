import axios from 'axios';

interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp?: string;
}

interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

export class DiscordService {
  static async sendTradeNotification(webhookUrl: string, trade: {
    symbol: string;
    entry_price: number;
    quantity: number;
    entry_time: string;
    setup_tag?: string;
  }) {
    const embed: DiscordEmbed = {
      title: `📈 New Trade: ${trade.symbol}`,
      color: 3066993, // Green
      fields: [
        {
          name: 'Entry Price',
          value: `$${trade.entry_price.toFixed(2)}`,
          inline: true,
        },
        {
          name: 'Quantity',
          value: trade.quantity.toString(),
          inline: true,
        },
        {
          name: 'Entry Time',
          value: new Date(trade.entry_time).toLocaleTimeString(),
          inline: true,
        },
      ],
    };

    if (trade.setup_tag) {
      embed.fields!.push({
        name: 'Setup',
        value: trade.setup_tag,
        inline: true,
      });
    }

    await this.sendEmbed(webhookUrl, embed);
  }

  static async sendClosureNotification(webhookUrl: string, trade: {
    symbol: string;
    entry_price: number;
    exit_price: number;
    quantity: number;
    pnl: number;
    exit_time: string;
  }) {
    const isWin = trade.pnl > 0;
    const embed: DiscordEmbed = {
      title: `${isWin ? '✅' : '❌'} Trade Closed: ${trade.symbol}`,
      color: isWin ? 3066993 : 15158332, // Green or Red
      fields: [
        {
          name: 'Entry Price',
          value: `$${trade.entry_price.toFixed(2)}`,
          inline: true,
        },
        {
          name: 'Exit Price',
          value: `$${trade.exit_price.toFixed(2)}`,
          inline: true,
        },
        {
          name: 'Quantity',
          value: trade.quantity.toString(),
          inline: true,
        },
        {
          name: 'P&L',
          value: `$${trade.pnl.toFixed(2)}`,
          inline: true,
        },
        {
          name: 'Exit Time',
          value: new Date(trade.exit_time).toLocaleTimeString(),
          inline: true,
        },
      ],
    };

    await this.sendEmbed(webhookUrl, embed);
  }

  static async sendDailySummary(webhookUrl: string, summary: {
    date: string;
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
    winRate: number;
  }) {
    const embed: DiscordEmbed = {
      title: `📊 Daily Summary - ${summary.date}`,
      color: summary.pnl >= 0 ? 3066993 : 15158332,
      fields: [
        {
          name: 'Total Trades',
          value: summary.trades.toString(),
          inline: true,
        },
        {
          name: 'Wins',
          value: summary.wins.toString(),
          inline: true,
        },
        {
          name: 'Losses',
          value: summary.losses.toString(),
          inline: true,
        },
        {
          name: 'Win Rate',
          value: `${summary.winRate.toFixed(2)}%`,
          inline: true,
        },
        {
          name: 'Daily P&L',
          value: `$${summary.pnl.toFixed(2)}`,
          inline: true,
        },
      ],
    };

    await this.sendEmbed(webhookUrl, embed);
  }

  private static async sendEmbed(webhookUrl: string, embed: DiscordEmbed) {
    try {
      const message: DiscordMessage = {
        embeds: [embed],
        username: 'Trading Journal',
      };

      await axios.post(webhookUrl, message, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Discord webhook error:', error);
    }
  }
}
