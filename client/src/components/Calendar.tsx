import React from 'react';
import '../styles/Calendar.css';

interface DailySummary {
  account_id: number;
  trade_date: string;
  daily_pnl?: number;
  trade_count: number;
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

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button onClick={handlePrevMonth}>&lt;</button>
        <h2>{new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
        <button onClick={handleNextMonth}>&gt;</button>
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
              className={`calendar-day ${!day ? 'empty' : ''} ${getPnLColor(dayData?.daily_pnl)} ${isSelected ? 'selected' : ''}`}
              onClick={() => day && onDateClick(dateStr)}
            >
              {day && (
                <>
                  <div className="day-number">{day}</div>
                  {dayData && (
                    <>
                      <div className="day-pnl">{dayData.daily_pnl?.toFixed(2) || '0.00'}</div>
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
