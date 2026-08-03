import React from 'react';
import { money, num } from '../utils/format';
import '../styles/Calendar.css';

interface DailySummary {
  account_id: number;
  trade_date: string;
  daily_pnl?: number;
  trade_count: number;
  blown?: boolean;
}

interface CalendarProps {
  month: number;
  year: number;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  dailySummaries: DailySummary[];
  selectedDate: string | null;
  onDateClick: (date: string) => void;
}

export default function Calendar({
  month,
  year,
  onMonthChange,
  onYearChange,
  dailySummaries,
  selectedDate,
  onDateClick
}: CalendarProps) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const days = [];

  // Empty cells before month starts
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null);
  }

  // Days of month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const getPnLColor = (pnl?: number) => {
    if (pnl === null || pnl === undefined) return '';
    if (pnl > 0) return 'positive';
    if (pnl < 0) return 'negative';
    return 'neutral';
  };

  // Heatmap: scale cell shade by |pnl| relative to the month's biggest day
  const maxAbs = Math.max(1, ...dailySummaries.map(d => Math.abs(num(d.daily_pnl))));
  const heatStyle = (pnl?: number): React.CSSProperties => {
    const v = num(pnl);
    if (v === 0) return {};
    const alpha = 0.10 + 0.45 * Math.min(1, Math.abs(v) / maxAbs);
    const rgb = v > 0 ? '34,197,94' : '239,68,68';
    return { background: `rgba(${rgb},${alpha.toFixed(3)})`, borderColor: `rgba(${rgb},${(alpha + 0.2).toFixed(3)})` };
  };

  const getDayData = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return dailySummaries.find(d => d.trade_date === dateStr);
  };

  const handlePrevMonth = () => {
    if (month === 1) {
      onMonthChange(12);
      onYearChange(year - 1);
    } else {
      onMonthChange(month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      onMonthChange(1);
      onYearChange(year + 1);
    } else {
      onMonthChange(month + 1);
    }
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const thisYear = new Date().getFullYear();
  const YEARS: number[] = [];
  for (let y = 2020; y <= thisYear + 1; y++) YEARS.push(y);

  const handleJumpDate = (val: string) => {
    if (!val) return;
    const [y, m] = val.split('-').map(Number);
    onYearChange(y);
    onMonthChange(m);
    onDateClick(val); // select the exact day
  };

  return (
    <div className="calendar">
      <div className="calendar-filters">
        <button className="cal-nav" onClick={handlePrevMonth}>&lt;</button>
        <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))} className="cal-select">
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => onYearChange(Number(e.target.value))} className="cal-select">
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="cal-nav" onClick={handleNextMonth}>&gt;</button>
        <div className="cal-spacer" />
        <label className="cal-jump">
          Jump to:
          <input type="date" onChange={(e) => handleJumpDate(e.target.value)} className="cal-date" />
        </label>
        <button className="cal-today" onClick={() => { onYearChange(thisYear); onMonthChange(new Date().getMonth() + 1); }}>
          Today
        </button>
      </div>

      <div className="calendar-weekdays">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="weekday">{day}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day, idx) => {
          const dayData = day ? getDayData(day) : null;
          const dateStr = day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
          const isSelected = dateStr === selectedDate;

          return (
            <div
              key={idx}
              className={`calendar-day ${!day ? 'empty' : ''} ${getPnLColor(dayData?.daily_pnl)} ${isSelected ? 'selected' : ''} ${dayData?.blown ? 'blown' : ''}`}
              style={dayData ? heatStyle(dayData.daily_pnl) : undefined}
              onClick={() => day && onDateClick(dateStr)}
            >
              {day && (
                <>
                  <div className="day-number">{day}</div>
                  {dayData?.blown && <div className="day-blown">💥 blown</div>}
                  {dayData && (
                    <>
                      <div className="day-pnl">{money(dayData.daily_pnl, 0)}</div>
                      <div className="trade-count">{dayData.trade_count} trades</div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
