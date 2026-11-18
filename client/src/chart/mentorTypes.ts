// Shared types for the mentor school on the market chart.
//   Course      — one mentor's book / video course turned into rules (made in Claude Code
//                 from the book or transcript, imported into the journal), or a built-in one.
//   Analysis    — what price is doing, bar by bar: swings, smart-money phases
//                 (accumulation → manipulation → markup → distribution → markdown) and events.
import type { KLineData } from 'klinecharts';

// ---------------- courses ----------------
/** Where a rule comes from. Every rule from a book or video needs one. */
export interface Source { book?: string; chapter?: string; page?: string; video?: string; time?: string; }
/** STATED = the mentor says it · SHOWN = on his charts · INFERRED = Claude's reading · KA = Kay decided. */
export type Conf = 'STATED' | 'SHOWN' | 'INFERRED' | 'KA';
export interface Rule { text: string; src?: Source; conf?: Conf; }

export interface Strategy {
  id: string;
  name: string;
  summary: string;
  tf?: number;                 // timeframe (minutes) the mentor uses it on
  when: Rule[];                // market context / conditions
  entry: Rule[];               // where to look for the entry
  trigger: Rule[];             // the exact trigger
  stop: Rule[];
  targets: Rule[];
  manage: Rule[];              // management while in the trade
  scaleIn: Rule[];
  scaleOut: Rule[];
  avoid: Rule[];               // when NOT to take it
  psychology: Rule[];
  /** Built-in detector that finds this setup bar by bar (see chart/mentor.ts DETECTORS). */
  detector?: { key: string; params?: Record<string, number | string | boolean> };
  rr?: { stopAtr?: number; t1R?: number; t2R?: number; scaleOutAtT1?: number }; // plan defaults
}
export interface Chapter { id: string; title: string; summary: string; points: Rule[]; psychology?: Rule[]; }
export interface Quiz { q: string; options: string[]; answer: number; explain: string; src?: Source; }
export interface Course {
  id: string;
  version: 1;
  mentor: string;
  title: string;
  kind: 'book' | 'video' | 'builtin';
  description: string;
  chapters: Chapter[];
  strategies: Strategy[];
  glossary?: { term: string; meaning: string }[];
  quizzes?: Quiz[];
  createdAt?: string;
}

// ---------------- market analysis (patterns.ts) ----------------
export type Phase = 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'range';
/** A run of bars (indexes into the bar list, inclusive) in one phase. */
export interface PhaseSpan { from: number; to: number; phase: Phase; hi: number; lo: number; confidence: number; }
export type EventKind =
  | 'SC' | 'AR' | 'ST' | 'SPRING' | 'LPS' | 'SOS'          // accumulation (Wyckoff)
  | 'BC' | 'UT' | 'UTAD' | 'LPSY' | 'SOW'                  // distribution (Wyckoff)
  | 'BOS_UP' | 'BOS_DN'                                    // break of structure
  | 'SWEEP_HI' | 'SWEEP_LO'                                // liquidity grab beyond a swing, closed back inside
  | 'ENGULF_UP' | 'ENGULF_DN' | 'PIN_UP' | 'PIN_DN' | 'INSIDE' | 'DOJI'
  | 'VOL_SPIKE';
export interface MarketEvent {
  i: number;            // bar index where it is CONFIRMED (only bars <= i were used)
  kind: EventKind;
  price: number;        // price the event refers to (level swept, low of spring, …)
  text: string;         // short label for the chart, e.g. "Spring"
  teach: string;        // one or two plain sentences: what big players are doing here
}
export interface Swing { i: number; price: number; type: 'H' | 'L'; }
export interface Analysis {
  swings: Swing[];                          // confirmed swing highs / lows (confirmed at i + lookback)
  phases: PhaseSpan[];
  events: MarketEvent[];
  trend: ('up' | 'down' | 'flat')[];        // per bar, from structure (HH/HL vs LH/LL)
  atr: number[];                            // ATR(14) per bar
}
export type Bars = KLineData[];
