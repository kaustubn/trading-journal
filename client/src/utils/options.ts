import { useEffect, useState } from 'react';
import axios from 'axios';

export type Option = { id: number; value: string };
export type OptionMap = Record<string, Option[]>;

// Module-level cache so every picker shares one fetch and stays in sync after edits.
let cache: OptionMap | null = null;
let inflight: Promise<OptionMap> | null = null;
const listeners = new Set<(m: OptionMap) => void>();

function emit() { if (cache) listeners.forEach(fn => fn(cache!)); }

export function loadOptions(force = false): Promise<OptionMap> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  inflight = axios.get('/api/options')
    .then(r => { cache = r.data.data || {}; emit(); return cache!; })
    .catch(() => { cache = cache || {}; return cache!; })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function addOption(field: string, value: string) {
  const v = value.trim();
  if (!v) return;
  try {
    const r = await axios.post('/api/options', { field, value: v });
    if (cache && r.data?.data) {
      cache = { ...cache, [field]: [...(cache[field] || []), { id: r.data.data.id, value: r.data.data.value }] };
      emit();
    }
  } catch { /* duplicate or invalid — ignore */ }
}

export async function removeOption(field: string, id: number) {
  try {
    await axios.delete(`/api/options/${id}`);
    if (cache) {
      cache = { ...cache, [field]: (cache[field] || []).filter(o => o.id !== id) };
      emit();
    }
  } catch { /* ignore */ }
}

// Subscribe a component to the shared option lists.
export function useOptions(): OptionMap {
  const [map, setMap] = useState<OptionMap>(cache || {});
  useEffect(() => {
    listeners.add(setMap);
    loadOptions().then(setMap);
    return () => { listeners.delete(setMap); };
  }, []);
  return map;
}

export const values = (m: OptionMap, field: string): string[] => (m[field] || []).map(o => o.value);
