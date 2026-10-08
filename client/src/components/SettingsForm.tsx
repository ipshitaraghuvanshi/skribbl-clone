import { useEffect, useState } from 'react';
import { socket } from '../socket';
import { RoomSettings } from '../types';

const CATEGORIES = ['all', 'animals', 'food', 'objects', 'actions', 'places', 'nature', 'vehicles', 'sports'];
const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const DRAW_TIMES = [15, 30, 45, 60, 80, 100, 120, 150, 180, 210, 240];

interface Props {
  settings: RoomSettings;
  editable: boolean;
  playerCount: number;
}

export default function SettingsForm({ settings, editable, playerCount }: Props) {
  const [customText, setCustomText] = useState(settings.customWords.join(', '));

  // keep the textarea in sync when the host is someone else
  useEffect(() => {
    if (!editable) setCustomText(settings.customWords.join(', '));
  }, [settings.customWords, editable]);

  const update = (patch: Partial<RoomSettings>) => socket.emit('update_settings', { settings: { ...settings, ...patch } });

  const select = <K extends keyof RoomSettings>(key: K, label: string, options: { value: string | number; label: string }[]) => (
    <label className="setting">
      <span>{label}</span>
      <select
        disabled={!editable}
        value={String(settings[key])}
        onChange={(e) => {
          const raw = e.target.value;
          const value = typeof settings[key] === 'number' ? Number(raw) : raw;
          update({ [key]: value } as Partial<RoomSettings>);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const nums = (values: number[], suffix = '') => values.map((v) => ({ value: v, label: `${v}${suffix}` }));

  return (
    <div className="settings">
      {select('maxPlayers', 'Players', nums(range(Math.max(2, playerCount), 20)))}
      {select('rounds', 'Rounds', nums(range(2, 10)))}
      {select('drawTime', 'Draw time', nums(DRAW_TIMES, 's'))}
      {select('wordCount', 'Word count', nums(range(1, 5)))}
      {select('hints', 'Hints', [{ value: 0, label: 'Disabled' }, ...nums(range(1, 5))])}
      {select('wordMode', 'Word mode', [
        { value: 'normal', label: 'Normal' },
        { value: 'hidden', label: 'Hidden' },
        { value: 'combination', label: 'Combination' },
      ])}
      {select('category', 'Category', CATEGORIES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })))}
      <label className="setting">
        <span>Visibility</span>
        <select disabled={!editable} value={settings.isPrivate ? 'private' : 'public'} onChange={(e) => update({ isPrivate: e.target.value === 'private' })}>
          <option value="private">Private (invite only)</option>
          <option value="public">Public</option>
        </select>
      </label>

      <label className="setting setting-wide">
        <span>Custom words (comma separated)</span>
        <textarea
          disabled={!editable}
          rows={3}
          value={customText}
          placeholder="e.g. taj mahal, chai, cricket bat"
          onChange={(e) => setCustomText(e.target.value)}
          onBlur={() => update({ customWords: customText.split(',').map((w) => w.trim()).filter(Boolean) })}
        />
      </label>
      <label className="checkbox setting-wide">
        <input
          type="checkbox"
          disabled={!editable}
          checked={settings.customWordsOnly}
          onChange={(e) => update({ customWordsOnly: e.target.checked })}
        />
        Use custom words only
      </label>
    </div>
  );
}
