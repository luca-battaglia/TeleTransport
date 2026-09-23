"use client";

import { useEffect, useState } from 'react';
import { Save, X, Download, Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { fetchConfig, type AppConfig } from '@/lib/api';
import { localizeFlightPlace, useLanguage } from '@/lib/i18n';
import {
  AIRPORT_LIST,
  DEFAULT_FLIGHT_SCORING,
  DEFAULT_TRAIN_SCORING,
  SETTINGS_KEY,
  loadSettings,
  migrateSettings,
  saveSettings,
  type AirportExtra,
  type FlightScoring,
  type ReminderTarget,
  type Settings,
  type TrainScoring,
} from '@/lib/settings';
import { readThemePreference, setThemePreference } from './ThemeToggle';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Field<K> = { key: K; label: string; hour?: boolean };

const TRAIN_FIELDS: Field<keyof TrainScoring>[] = [
  { key: 'time_value_eur_per_hour', label: 'val_time' },
  { key: 'early_departure_ref_hour', label: 'early_ref', hour: true },
  { key: 'early_departure_penalty_eur_per_hour', label: 'early_pen' },
  { key: 'late_arrival_start_hour', label: 'late_ref', hour: true },
  { key: 'overnight_end_hour', label: 'overnight_ref', hour: true },
  { key: 'late_arrival_penalty_eur_per_hour', label: 'late_pen' },
  { key: 'change_penalty_eur', label: 'change_pen' },
];

const FLIGHT_FIELDS: Field<keyof FlightScoring>[] = [
  { key: 'time_value_eur_per_hour', label: 'val_time' },
  { key: 'early_departure_ref_hour', label: 'early_ref', hour: true },
  { key: 'early_departure_penalty_eur_per_hour', label: 'early_pen' },
  { key: 'late_arrival_start_hour', label: 'late_ref', hour: true },
  { key: 'overnight_end_hour', label: 'overnight_ref', hour: true },
  { key: 'late_arrival_penalty_eur_per_hour', label: 'late_pen' },
  { key: 'connection_penalty_eur', label: 'conn_pen' },
  { key: 'companions_time_value_eur_per_hour', label: 'comp_time' },
];

// Mirrors the bounds the backend enforces, so a saved value is never rejected there.
const MAX_AMOUNT = 10_000;
const MAX_DRIVE_HOURS = 48;

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

// An empty field means "use the default"; 0 is a real value and is kept.
function parseNumber(text: string, fallback: number, max: number, integer = false): number {
  if (text.trim() === '') return fallback;
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value)) return fallback;
  return clamp(integer ? Math.round(value) : value, max);
}

const asStrings = <T extends object>(values: T) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])) as Record<keyof T, string>;

const splitList = (text: string) => text.split(',').map(s => s.trim()).filter(Boolean);

const formatMapping = (mapping: Record<string, string>) => Object.entries(mapping).map(([k, v]) => `${k}=${v}`).join('\n');

const sameMapping = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

// Flight places come from the server in English and are shown in the interface language.
const flightPlaceNames = (place: string) => [place, localizeFlightPlace(place, 'en'), localizeFlightPlace(place, 'it')];

type ReminderRow = { id: string; text: string; target: ReminderTarget };
type AirportRow = { iata: string } & Record<keyof AirportExtra, string>;

const inputStyle = { width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--bg)', color: 'var(--text)' };

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Mounted only while open, so every opening starts from what is stored.
  return isOpen ? <SettingsForm onClose={onClose} /> : null;
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const { t, language, setLanguage } = useLanguage();
  const [initial] = useState(loadSettings);

  const [serpapiKey, setSerpapiKey] = useState(initial.serpapiKey ?? '');
  const [trainScoring, setTrainScoring] = useState(() => asStrings({ ...DEFAULT_TRAIN_SCORING, ...initial.trains?.scoring }));
  const [flightScoring, setFlightScoring] = useState(() => asStrings({ ...DEFAULT_FLIGHT_SCORING, ...initial.flights?.scoring }));
  const [reminders, setReminders] = useState<ReminderRow[]>(() =>
    Object.entries(initial.reminders ?? {}).map(([id, r]) => ({ id, ...r }))
  );
  const [airportExtras, setAirportExtras] = useState<AirportRow[]>(() =>
    Object.entries(initial.flights?.airport_extras ?? {}).map(([iata, extra]) => ({ iata, ...asStrings(extra) }))
  );
  const [ui, setUi] = useState(() => ({
    trainOrigin: initial.ui?.trains?.default_origin ?? '',
    trainDest: initial.ui?.trains?.default_destination ?? '',
    trainOptions: (initial.ui?.trains?.options ?? []).join(', '),
    flightOrigin: initial.ui?.flights?.default_origin ?? '',
    flightDest: initial.ui?.flights?.default_destination ?? '',
    flightOptions: (initial.ui?.flights?.options ?? []).join(', '),
    iataMapping: formatMapping(initial.ui?.flights?.iata_mapping ?? {}),
  }));
  const [followSystemTheme, setFollowSystemTheme] = useState(() => readThemePreference() === 'system');
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [serverConfig, setServerConfig] = useState<AppConfig | null>(null);

  // Fields the user never customized show the server's defaults.
  useEffect(() => {
    fetchConfig().then(cfg => {
      if (!cfg) return;
      setServerConfig(cfg);
      setUi(prev => ({
        ...prev,
        trainOrigin: prev.trainOrigin || cfg.trains.default_origin,
        trainDest: prev.trainDest || cfg.trains.default_destination,
        flightOrigin: prev.flightOrigin || localizeFlightPlace(cfg.flights.default_origin, language),
        flightDest: prev.flightDest || localizeFlightPlace(cfg.flights.default_destination, language),
        iataMapping: prev.iataMapping || formatMapping(cfg.flights.iata_mapping),
      }));
    });
  }, [language]);

  const handleSave = () => {
    const iataMapping: Record<string, string> = {};
    for (const line of ui.iataMapping.split('\n')) {
      const [name, code] = line.split('=').map(part => part?.trim());
      const codes = code?.toUpperCase().replace(/\s+/g, '');
      if (name && codes && AIRPORT_LIST.test(codes)) iataMapping[name] = codes;
    }

    // What still equals the server's defaults is not stored as the user's own,
    // so later changes on the server keep reaching this browser, and default
    // places keep following the interface language.
    const own = (value: string, serverNames: string[] = []) => {
      const trimmed = value.trim();
      return serverNames.includes(trimmed) ? '' : trimmed;
    };
    const ownMapping = serverConfig && sameMapping(iataMapping, serverConfig.flights.iata_mapping) ? {} : iataMapping;

    const extras: Record<string, AirportExtra> = {};
    for (const row of airportExtras) {
      const code = row.iata.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      extras[code] = {
        fuel_eur: parseNumber(row.fuel_eur, 0, MAX_AMOUNT),
        personal_drive_hours: parseNumber(row.personal_drive_hours, 0, MAX_DRIVE_HOURS),
        companions_drive_hours: parseNumber(row.companions_drive_hours, 0, MAX_DRIVE_HOURS),
      };
    }

    const scoring = <K extends string>(fields: Field<K>[], values: Record<K, string>, defaults: Record<K, number>) =>
      Object.fromEntries(fields.map(f => [f.key, parseNumber(values[f.key], defaults[f.key], f.hour ? 24 : MAX_AMOUNT, f.hour)])) as Record<K, number>;

    const trainOptions = splitList(ui.trainOptions);
    const flightOptions = splitList(ui.flightOptions);

    const settings: Settings = {
      serpapiKey: serpapiKey.trim(),
      reminders: Object.fromEntries(
        reminders.filter(r => r.id.trim()).map(r => [r.id.trim(), { text: r.text, target: r.target }])
      ),
      ui: {
        trains: {
          default_origin: own(ui.trainOrigin, serverConfig ? [serverConfig.trains.default_origin] : []),
          default_destination: own(ui.trainDest, serverConfig ? [serverConfig.trains.default_destination] : []),
          ...(trainOptions.length ? { options: trainOptions } : {}),
        },
        flights: {
          default_origin: own(ui.flightOrigin, serverConfig ? flightPlaceNames(serverConfig.flights.default_origin) : []),
          default_destination: own(ui.flightDest, serverConfig ? flightPlaceNames(serverConfig.flights.default_destination) : []),
          ...(flightOptions.length ? { options: flightOptions } : {}),
          ...(Object.keys(ownMapping).length ? { iata_mapping: ownMapping } : {}),
        },
      },
      trains: { scoring: scoring(TRAIN_FIELDS, trainScoring, DEFAULT_TRAIN_SCORING) },
      flights: { scoring: scoring(FLIGHT_FIELDS, flightScoring, DEFAULT_FLIGHT_SCORING), airport_extras: extras },
    };

    const ok = saveSettings(settings);
    setSaveState(ok ? 'saved' : 'failed');
    if (ok) setTimeout(() => setSaveState('idle'), 2000);
  };

  const handleExport = () => {
    try {
      const searches = localStorage.getItem('teletransport_saved_searches');
      const exportData = {
        teletransport_settings: loadSettings(),
        teletransport_saved_searches: searches ? JSON.parse(searches) : null,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teletransport_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
      alert(t("export_error"));
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(String(event.target?.result ?? ''));
        let imported = false;
        if (data.teletransport_settings) {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrateSettings(data.teletransport_settings)));
          imported = true;
        }
        if (data.teletransport_saved_searches) {
          localStorage.setItem('teletransport_saved_searches', JSON.stringify(data.teletransport_saved_searches));
          imported = true;
        }
        if (imported) {
          alert(t("import_success"));
          window.location.reload();
        } else {
          alert(t("import_invalid"));
        }
      } catch (err) {
        console.error('Import failed', err);
        alert(t("import_corrupted"));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const updateReminder = (idx: number, patch: Partial<ReminderRow>) =>
    setReminders(rows => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const updateAirport = (idx: number, patch: Partial<AirportRow>) =>
    setAirportExtras(rows => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const scoringColumn = <K extends string>(title: string, fields: Field<K>[], values: Record<K, string>, update: (key: K, value: string) => void) => (
    <div style={{ flex: '1 1 300px' }}>
      <h3 style={{ marginBottom: '16px', color: 'var(--accent)' }}>{title}</h3>
      {fields.map(f => (
        <div className="form-group" key={f.key}>
          <label className="form-label">{t(f.label)}</label>
          <input
            type="number"
            min={0}
            max={f.hour ? 24 : undefined}
            step={f.hour ? 1 : 0.5}
            value={values[f.key]}
            onChange={e => update(f.key, e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'var(--modal-overlay)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px'
    }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel"
        style={{ width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', padding: '32px', position: 'relative' }}
      >
        <button
          onClick={onClose}
          aria-label={t('close')}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
        >
          <X size={24} />
        </button>

        <h2 style={{ marginBottom: '24px' }}>{t("settings")}</h2>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="form-label">{t("language")}</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value === 'it' ? 'it' : 'en')}
            style={inputStyle}
          >
            <option value="en">{t("language_en")}</option>
            <option value="it">{t("language_it")}</option>
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={followSystemTheme}
              onChange={e => {
                setFollowSystemTheme(e.target.checked);
                // Leaving "system" keeps whatever theme is on screen right now.
                setThemePreference(e.target.checked ? 'system' : document.body.classList.contains('dark') ? 'dark' : 'light');
              }}
              style={{ width: 'auto' }}
            />
            {t("theme_system")}
          </label>
        </div>

        <div className="form-group" style={{ marginBottom: '32px' }}>
          <label className="form-label">{t("serpapi_label")}</label>
          <input
            type="password"
            autoComplete="off"
            value={serpapiKey}
            onChange={e => setSerpapiKey(e.target.value)}
            placeholder={t("serpapi_placeholder")}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px' }}>
          {scoringColumn(t("scoring_trains"), TRAIN_FIELDS, trainScoring, (key, value) => setTrainScoring(prev => ({ ...prev, [key]: value })))}
          {scoringColumn(t("scoring_flights"), FLIGHT_FIELDS, flightScoring, (key, value) => setFlightScoring(prev => ({ ...prev, [key]: value })))}
        </div>

        <h3 style={{ marginTop: '32px', marginBottom: '16px', color: 'var(--accent)' }}>{t("reminders_title")}</h3>
        {reminders.map((r, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
            <input type="text" placeholder={t("settings_id_placeholder")} value={r.id} onChange={e => updateReminder(idx, { id: e.target.value })} style={{ flex: '1 1 100px', minWidth: '100px' }} />
            <input type="text" placeholder={t("reminder_text_placeholder")} value={r.text} onChange={e => updateReminder(idx, { text: e.target.value })} style={{ flex: '2 1 200px', minWidth: '200px' }} />
            <select value={r.target} onChange={e => updateReminder(idx, { target: e.target.value as ReminderTarget })} style={{ flex: '1 1 120px', minWidth: '120px', padding: '0 8px' }}>
              <option value="flights">{t("target_flights")}</option>
              <option value="trains">{t("target_trains")}</option>
              <option value="both">{t("target_both")}</option>
              <option value="disabled">{t("target_disabled")}</option>
            </select>
            <button className="btn-outline" onClick={() => setReminders(rows => rows.filter((_, i) => i !== idx))} style={{ flex: '0 0 auto' }}>{t("remove")}</button>
          </div>
        ))}
        <button className="btn-outline" onClick={() => setReminders(rows => [...rows, { id: '', text: '', target: 'flights' }])} style={{ marginTop: '8px' }}>{t("add_reminder")}</button>

        <h3 style={{ marginTop: '32px', marginBottom: '8px', color: 'var(--accent)' }}>{t("airport_extras_title")}</h3>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          {t("airport_extras_info")}
        </p>
        {airportExtras.map((a, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 80px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t("iata_code")}</label>
              <input type="text" placeholder="IATA" maxLength={3} value={a.iata} onChange={e => updateAirport(idx, { iata: e.target.value })} style={{ width: '100%' }} />
            </div>
            {([['fuel_eur', 'fuel_eur'], ['personal_drive_hours', 'your_time'], ['companions_drive_hours', 'comp_time_h']] as const).map(([key, label]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 100px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t(label)}</label>
                <input type="number" min={0} step={0.5} placeholder="0" value={a[key]} onChange={e => updateAirport(idx, { [key]: e.target.value })} style={{ width: '100%' }} />
              </div>
            ))}
            <button className="btn-outline" onClick={() => setAirportExtras(rows => rows.filter((_, i) => i !== idx))} style={{ marginBottom: '2px', flex: '0 0 auto' }}>{t("remove")}</button>
          </div>
        ))}
        <button className="btn-outline" onClick={() => setAirportExtras(rows => [...rows, { iata: '', fuel_eur: '0', personal_drive_hours: '0', companions_drive_hours: '0' }])} style={{ marginTop: '8px' }}>{t("add_airport")}</button>

        <div style={{ marginTop: '32px', borderTop: '1px solid var(--card-border)', paddingTop: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--accent)' }}>{t("ui_settings")}</h3>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px' }}>
            <div style={{ flex: '1 1 300px' }}>
              <h4 style={{ marginBottom: '8px', color: 'var(--text)' }}>{t("trains_btn")}</h4>
              <div className="form-group">
                <label className="form-label">{t("default_origin")}</label>
                <input type="text" value={ui.trainOrigin} onChange={e => setUi(prev => ({ ...prev, trainOrigin: e.target.value }))} placeholder={t("settings_origin_train")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("default_dest")}</label>
                <input type="text" value={ui.trainDest} onChange={e => setUi(prev => ({ ...prev, trainDest: e.target.value }))} placeholder={t("settings_dest_train")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("dropdown_options")}</label>
                <textarea value={ui.trainOptions} onChange={e => setUi(prev => ({ ...prev, trainOptions: e.target.value }))} rows={3} placeholder={t("dropdown_placeholder")} style={inputStyle} />
              </div>
            </div>

            <div style={{ flex: '1 1 300px' }}>
              <h4 style={{ marginBottom: '8px', color: 'var(--text)' }}>{t("flights_btn")}</h4>
              <div className="form-group">
                <label className="form-label">{t("default_origin")}</label>
                <input type="text" value={ui.flightOrigin} onChange={e => setUi(prev => ({ ...prev, flightOrigin: e.target.value }))} placeholder={t("settings_origin_flight")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("default_dest")}</label>
                <input type="text" value={ui.flightDest} onChange={e => setUi(prev => ({ ...prev, flightDest: e.target.value }))} placeholder={t("settings_dest_flight")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("dropdown_options")}</label>
                <textarea value={ui.flightOptions} onChange={e => setUi(prev => ({ ...prev, flightOptions: e.target.value }))} rows={3} placeholder={t("dropdown_placeholder")} style={inputStyle} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("iata_mapping")}</label>
                <textarea value={ui.iataMapping} onChange={e => setUi(prev => ({ ...prev, iataMapping: e.target.value }))} rows={4} placeholder={"linate=LIN\nmalpensa=MXP\nroma=FCO,CIA"} style={inputStyle} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '32px', display: 'flex', alignItems: 'center', gap: '16px', borderTop: '1px solid var(--card-border)', paddingTop: '24px', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Save size={16} />
            {t("save_settings")}
          </button>
          {saveState === 'saved' && <span style={{ color: '#4ade80', fontSize: '14px', fontWeight: 500 }}>{t("saved_local")}</span>}
          {saveState === 'failed' && <span role="alert" style={{ color: '#f87171', fontSize: '14px', fontWeight: 500 }}>{t("save_failed")}</span>}

          <div style={{ flex: 1, minWidth: '20px' }}></div>

          <button className="btn-outline" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={16} /> {t("export_btn")}
          </button>

          <label className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
            <Upload size={16} /> {t("import_btn")}
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>
      </motion.div>
    </div>
  );
}
