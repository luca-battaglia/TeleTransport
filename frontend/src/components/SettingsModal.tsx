"use client";

import { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { fetchConfig } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t, language, setLanguage } = useLanguage();
  const [serpapiKey, setSerpapiKey] = useState('');
  
  // Treni
  const [treniTimeValue, setTreniTimeValue] = useState('20.0');
  const [treniEarlyRef, setTreniEarlyRef] = useState('9');
  const [treniEarlyPen, setTreniEarlyPen] = useState('20.0');
  const [treniLateStart, setTreniLateStart] = useState('22');
  const [treniOvernightEnd, setTreniOvernightEnd] = useState('5');
  const [treniLatePen, setTreniLatePen] = useState('15.0');
  const [treniChangePen, setTreniChangePen] = useState('5.0');

  // Voli
  const [voliTimeValue, setVoliTimeValue] = useState('20.0');
  const [voliEarlyRef, setVoliEarlyRef] = useState('9');
  const [voliEarlyPen, setVoliEarlyPen] = useState('20.0');
  const [voliLateStart, setVoliLateStart] = useState('22');
  const [voliOvernightEnd, setVoliOvernightEnd] = useState('5');
  const [voliLatePen, setVoliLatePen] = useState('15.0');
  const [voliConnPen, setVoliConnPen] = useState('5.0');
  const [voliCompanionsTime, setVoliCompanionsTime] = useState('8.0');

  // UI Settings (Treni)
  const [uiTreniOrigin, setUiTreniOrigin] = useState('');
  const [uiTreniDest, setUiTreniDest] = useState('');
  const [uiTreniOptions, setUiTreniOptions] = useState('');

  // UI Settings (Voli)
  const [uiVoliOrigin, setUiVoliOrigin] = useState('');
  const [uiVoliDest, setUiVoliDest] = useState('');
  const [uiVoliOptions, setUiVoliOptions] = useState('');
  const [uiIataMapping, setUiIataMapping] = useState('');

  const [reminders, setReminders] = useState<{key: string, text: string, target?: string}[]>([]);

  const [airportExtras, setAirportExtras] = useState<{iata: string, fuel_eur: string, personal_drive_hours: string, companions_drive_hours: string}[]>([
    {iata: 'BDS', fuel_eur: '30.0', personal_drive_hours: '1.5', companions_drive_hours: '3.0'}
  ]);

  const [isSystemTheme, setIsSystemTheme] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const data = localStorage.getItem('teletransport_settings');
    const tPref = localStorage.getItem('theme_preference');
    if (tPref === 'system' || !tPref) setIsSystemTheme(true);
    else setIsSystemTheme(false);
    
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.serpapiKey) setSerpapiKey(parsed.serpapiKey);
        
        const ts = parsed.treni?.scoring;
        if (ts) {
          if (ts.time_value_eur_per_hour) setTreniTimeValue(String(ts.time_value_eur_per_hour));
          if (ts.early_departure_ref_hour) setTreniEarlyRef(String(ts.early_departure_ref_hour));
          if (ts.early_departure_penalty_eur_per_hour) setTreniEarlyPen(String(ts.early_departure_penalty_eur_per_hour));
          if (ts.late_arrival_start_hour) setTreniLateStart(String(ts.late_arrival_start_hour));
          if (ts.overnight_end_hour) setTreniOvernightEnd(String(ts.overnight_end_hour));
          if (ts.late_arrival_penalty_eur_per_hour) setTreniLatePen(String(ts.late_arrival_penalty_eur_per_hour));
          if (ts.change_penalty_eur) setTreniChangePen(String(ts.change_penalty_eur));
        }

        const vs = parsed.voli?.scoring;
        if (vs) {
          if (vs.time_value_eur_per_hour) setVoliTimeValue(String(vs.time_value_eur_per_hour));
          if (vs.early_departure_ref_hour) setVoliEarlyRef(String(vs.early_departure_ref_hour));
          if (vs.early_departure_penalty_eur_per_hour) setVoliEarlyPen(String(vs.early_departure_penalty_eur_per_hour));
          if (vs.late_arrival_start_hour) setVoliLateStart(String(vs.late_arrival_start_hour));
          if (vs.overnight_end_hour) setVoliOvernightEnd(String(vs.overnight_end_hour));
          if (vs.late_arrival_penalty_eur_per_hour) setVoliLatePen(String(vs.late_arrival_penalty_eur_per_hour));
          if (vs.connection_penalty_eur) setVoliConnPen(String(vs.connection_penalty_eur));
          if (vs.companions_time_value_eur_per_hour) setVoliCompanionsTime(String(vs.companions_time_value_eur_per_hour));
        }

        if (parsed.reminders) {
          const loadedReminders = Object.entries(parsed.reminders).map(([k, v]: [string, any]) => {
            if (typeof v === 'string') {
              return { key: k, text: v, target: 'voli' };
            } else if (v && typeof v === 'object') {
              return { key: k, text: String(v.text || ''), target: v.target || 'voli' };
            }
            return { key: k, text: '', target: 'voli' };
          });
          if (loadedReminders.length > 0) setReminders(loadedReminders);
        }

        if (parsed.voli?.airport_extras) {
          const loadedExtras = Object.entries(parsed.voli.airport_extras).map(([k, v]: [string, any]) => ({
            iata: k,
            fuel_eur: String(v.fuel_eur || '0'),
            personal_drive_hours: String(v.personal_drive_hours || '0'),
            companions_drive_hours: String(v.companions_drive_hours || '0')
          }));
          if (loadedExtras.length > 0) setAirportExtras(loadedExtras);
        }

        if (parsed.ui) {
          const ui = parsed.ui;
          if (ui.treni) {
            if (ui.treni.default_origin) setUiTreniOrigin(ui.treni.default_origin);
            if (ui.treni.default_destination) setUiTreniDest(ui.treni.default_destination);
            if (ui.treni.options && Array.isArray(ui.treni.options)) setUiTreniOptions(ui.treni.options.join(', '));
          }
          if (ui.voli) {
            if (ui.voli.default_origin) setUiVoliOrigin(ui.voli.default_origin);
            if (ui.voli.default_destination) setUiVoliDest(ui.voli.default_destination);
            if (ui.voli.options && Array.isArray(ui.voli.options)) setUiVoliOptions(ui.voli.options.join(', '));
            if (ui.voli.iata_mapping) {
              const mappingLines = Object.entries(ui.voli.iata_mapping).map(([k, v]) => `${k}=${v}`).join('\n');
              setUiIataMapping(mappingLines);
            }
          }
        }
      } catch (e) {}
    }
    
    fetchConfig().then(cfg => {
      if (cfg) {
         try {
           const parsed = JSON.parse(localStorage.getItem('teletransport_settings') || '{}');
           if (!parsed.ui?.treni?.default_origin && cfg.treni?.default_origin) setUiTreniOrigin(cfg.treni.default_origin);
           if (!parsed.ui?.treni?.default_destination && cfg.treni?.default_destination) setUiTreniDest(cfg.treni.default_destination);
           if (!parsed.ui?.treni?.options && cfg.treni?.options) setUiTreniOptions(cfg.treni.options.join(', '));

           if (!parsed.ui?.voli?.default_origin && cfg.voli?.default_origin) setUiVoliOrigin(cfg.voli.default_origin);
           if (!parsed.ui?.voli?.default_destination && cfg.voli?.default_destination) setUiVoliDest(cfg.voli.default_destination);
           if (!parsed.ui?.voli?.options && cfg.voli?.options) setUiVoliOptions(cfg.voli.options.join(', '));
           if (!parsed.ui?.voli?.iata_mapping && cfg.voli?.iata_mapping) {
              setUiIataMapping(Object.entries(cfg.voli.iata_mapping).map(([k,v]) => `${k}=${v}`).join('\n'));
           }
         } catch(e) {}
      }
    });
  }, [isOpen]);

  const handleSave = () => {
    const remindersObj = reminders.reduce((acc, r) => {
      if (r.key.trim()) acc[r.key.trim()] = { text: r.text, target: r.target || 'voli' };
      return acc;
    }, {} as Record<string, any>);

    const airportExtrasObj = airportExtras.reduce((acc, a) => {
      if (a.iata.trim()) {
        acc[a.iata.trim().toUpperCase()] = {
          fuel_eur: parseFloat(a.fuel_eur) || 0,
          personal_drive_hours: parseFloat(a.personal_drive_hours) || 0,
          companions_drive_hours: parseFloat(a.companions_drive_hours) || 0
        };
      }
      return acc;
    }, {} as Record<string, any>);

    const iataMappingObj = uiIataMapping.split('\n').reduce((acc, line) => {
      const parts = line.split('=');
      if (parts.length === 2) {
        const k = parts[0].trim();
        const v = parts[1].trim();
        if (k && v) acc[k] = v;
      }
      return acc;
    }, {} as Record<string, string>);

    const uiObj = {
      treni: {
        default_origin: uiTreniOrigin.trim(),
        default_destination: uiTreniDest.trim(),
        options: uiTreniOptions.split(',').map(s => s.trim()).filter(Boolean)
      },
      voli: {
        default_origin: uiVoliOrigin.trim(),
        default_destination: uiVoliDest.trim(),
        options: uiVoliOptions.split(',').map(s => s.trim()).filter(Boolean),
        iata_mapping: iataMappingObj
      }
    };

    const settings = {
      serpapiKey,
      reminders: remindersObj,
      ui: uiObj,
      treni: {
        scoring: {
          time_value_eur_per_hour: parseFloat(treniTimeValue) || 20.0,
          early_departure_ref_hour: parseInt(treniEarlyRef) || 9,
          early_departure_penalty_eur_per_hour: parseFloat(treniEarlyPen) || 20.0,
          late_arrival_start_hour: parseInt(treniLateStart) || 22,
          overnight_end_hour: parseInt(treniOvernightEnd) || 5,
          late_arrival_penalty_eur_per_hour: parseFloat(treniLatePen) || 15.0,
          change_penalty_eur: parseFloat(treniChangePen) || 5.0
        }
      },
      voli: {
        scoring: {
          time_value_eur_per_hour: parseFloat(voliTimeValue) || 20.0,
          early_departure_ref_hour: parseInt(voliEarlyRef) || 9,
          early_departure_penalty_eur_per_hour: parseFloat(voliEarlyPen) || 20.0,
          late_arrival_start_hour: parseInt(voliLateStart) || 22,
          overnight_end_hour: parseInt(voliOvernightEnd) || 5,
          late_arrival_penalty_eur_per_hour: parseFloat(voliLatePen) || 15.0,
          connection_penalty_eur: parseFloat(voliConnPen) || 5.0,
          companions_time_value_eur_per_hour: parseFloat(voliCompanionsTime) || 8.0
        },
        airport_extras: airportExtrasObj
      }
    };
    
    localStorage.setItem('teletransport_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isOpen) return null;

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
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
        >
          <X size={24} />
        </button>

        <h2 style={{ marginBottom: '24px' }}>{t("settings")}</h2>
        
        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="form-label">{t("language")}</label>
          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value as any)}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--bg)', color: 'var(--text)' }}
          >
            <option value="en">{t("language_en")}</option>
            <option value="it">{t("language_it")}</option>
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500 }}>
            <input 
              type="checkbox" 
              checked={isSystemTheme}
              onChange={(e) => {
                const val = e.target.checked;
                setIsSystemTheme(val);
                if (val) {
                  localStorage.setItem('theme_preference', 'system');
                } else {
                  localStorage.setItem('theme_preference', 'dark');
                }
                window.dispatchEvent(new Event('themechange'));
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
            value={serpapiKey}
            onChange={(e) => setSerpapiKey(e.target.value)}
            placeholder={t("serpapi_placeholder")}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px' }}>
          {/* TRENI */}
          <div style={{ flex: '1 1 300px' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--accent)' }}>{t("scoring_trains")}</h3>
            <div className="form-group"><label className="form-label">{t("val_time")}</label><input type="number" step="0.5" value={treniTimeValue} onChange={(e) => setTreniTimeValue(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("early_ref")}</label><input type="number" value={treniEarlyRef} onChange={(e) => setTreniEarlyRef(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("early_pen")}</label><input type="number" step="0.5" value={treniEarlyPen} onChange={(e) => setTreniEarlyPen(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("late_ref")}</label><input type="number" value={treniLateStart} onChange={(e) => setTreniLateStart(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("overnight_ref")}</label><input type="number" value={treniOvernightEnd} onChange={(e) => setTreniOvernightEnd(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("late_pen")}</label><input type="number" step="0.5" value={treniLatePen} onChange={(e) => setTreniLatePen(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("change_pen")}</label><input type="number" step="0.5" value={treniChangePen} onChange={(e) => setTreniChangePen(e.target.value)} style={{ width: '100%' }} /></div>
          </div>

          {/* VOLI */}
          <div style={{ flex: '1 1 300px' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--accent)' }}>{t("scoring_flights")}</h3>
            <div className="form-group"><label className="form-label">{t("val_time")}</label><input type="number" step="0.5" value={voliTimeValue} onChange={(e) => setVoliTimeValue(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("early_ref")}</label><input type="number" value={voliEarlyRef} onChange={(e) => setVoliEarlyRef(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("early_pen")}</label><input type="number" step="0.5" value={voliEarlyPen} onChange={(e) => setVoliEarlyPen(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("late_ref")}</label><input type="number" value={voliLateStart} onChange={(e) => setVoliLateStart(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("overnight_ref")}</label><input type="number" value={voliOvernightEnd} onChange={(e) => setVoliOvernightEnd(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("late_pen")}</label><input type="number" step="0.5" value={voliLatePen} onChange={(e) => setVoliLatePen(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("conn_pen")}</label><input type="number" step="0.5" value={voliConnPen} onChange={(e) => setVoliConnPen(e.target.value)} style={{ width: '100%' }} /></div>
            <div className="form-group"><label className="form-label">{t("comp_time")}</label><input type="number" step="0.5" value={voliCompanionsTime} onChange={(e) => setVoliCompanionsTime(e.target.value)} style={{ width: '100%' }} /></div>
          </div>
        </div>

        <h3 style={{ marginTop: '32px', marginBottom: '16px', color: 'var(--accent)' }}>{t("reminders_title")}</h3>
        {reminders.map((r, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
            <input type="text" placeholder={t("settings_id_placeholder")} value={r.key} onChange={(e) => { const nr = [...reminders]; nr[idx].key = e.target.value; setReminders(nr); }} style={{ flex: '1 1 100px', minWidth: '100px' }} />
            <input type="text" placeholder={t("reminder_text_placeholder")} value={r.text} onChange={(e) => { const nr = [...reminders]; nr[idx].text = e.target.value; setReminders(nr); }} style={{ flex: '2 1 200px', minWidth: '200px' }} />
            <select value={r.target || 'voli'} onChange={(e) => { const nr = [...reminders]; nr[idx].target = e.target.value; setReminders(nr); }} style={{ flex: '1 1 120px', minWidth: '120px', padding: '0 8px' }}>
              <option value="voli">{t("target_flights")}</option>
              <option value="treni">{t("target_trains")}</option>
              <option value="both">{t("target_both")}</option>
              <option value="disabled">{t("target_disabled")}</option>
            </select>
            <button className="btn-secondary" onClick={() => setReminders(reminders.filter((_, i) => i !== idx))} style={{ flex: '0 0 auto' }}>{t("remove")}</button>
          </div>
        ))}
        <button className="btn-secondary" onClick={() => setReminders([...reminders, {key: '', text: '', target: 'voli'}])} style={{ marginTop: '8px' }}>{t("add_reminder")}</button>

        <h3 style={{ marginTop: '32px', marginBottom: '8px', color: 'var(--accent)' }}>{t("airport_extras_title")}</h3>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          {t("airport_extras_info")}
        </p>
        {airportExtras.map((a, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 80px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t("iata_code")}</label>
              <input type="text" placeholder="IATA" value={a.iata} onChange={(e) => { const na = [...airportExtras]; na[idx].iata = e.target.value; setAirportExtras(na); }} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 100px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t("fuel_eur")}</label>
              <input type="number" step="0.5" placeholder="0" value={a.fuel_eur} onChange={(e) => { const na = [...airportExtras]; na[idx].fuel_eur = e.target.value; setAirportExtras(na); }} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 100px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t("your_time")}</label>
              <input type="number" step="0.5" placeholder="0" value={a.personal_drive_hours} onChange={(e) => { const na = [...airportExtras]; na[idx].personal_drive_hours = e.target.value; setAirportExtras(na); }} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 120px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t("comp_time_h")}</label>
              <input type="number" step="0.5" placeholder="0" value={a.companions_drive_hours} onChange={(e) => { const na = [...airportExtras]; na[idx].companions_drive_hours = e.target.value; setAirportExtras(na); }} style={{ width: '100%' }} />
            </div>
            <button className="btn-secondary" onClick={() => setAirportExtras(airportExtras.filter((_, i) => i !== idx))} style={{ marginBottom: '2px', flex: '0 0 auto' }}>{t("remove")}</button>
          </div>
        ))}
        <button className="btn-secondary" onClick={() => setAirportExtras([...airportExtras, {iata: '', fuel_eur: '0', personal_drive_hours: '0', companions_drive_hours: '0'}])} style={{ marginTop: '8px' }}>{t("add_airport")}</button>

        <div style={{ marginTop: '32px', borderTop: '1px solid var(--card-border)', paddingTop: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--accent)' }}>{t("ui_settings")}</h3>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px' }}>
            <div style={{ flex: '1 1 300px' }}>
              <h4 style={{ marginBottom: '8px', color: 'var(--text)' }}>{t("trains_btn")}</h4>
              <div className="form-group">
                <label className="form-label">{t("default_origin")}</label>
                <input type="text" value={uiTreniOrigin} onChange={e => setUiTreniOrigin(e.target.value)} placeholder={t("settings_origin_train")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("default_dest")}</label>
                <input type="text" value={uiTreniDest} onChange={e => setUiTreniDest(e.target.value)} placeholder={t("settings_dest_train")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("dropdown_options")}</label>
                <textarea value={uiTreniOptions} onChange={e => setUiTreniOptions(e.target.value)} rows={3} placeholder="Roma Termini, Milano Centrale, Napoli Centrale..." style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--bg)', color: 'var(--text)' }} />
              </div>
            </div>
            
            <div style={{ flex: '1 1 300px' }}>
              <h4 style={{ marginBottom: '8px', color: 'var(--text)' }}>{t("flights_btn")}</h4>
              <div className="form-group">
                <label className="form-label">{t("default_origin")}</label>
                <input type="text" value={uiVoliOrigin} onChange={e => setUiVoliOrigin(e.target.value)} placeholder={t("settings_origin_flight")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("default_dest")}</label>
                <input type="text" value={uiVoliDest} onChange={e => setUiVoliDest(e.target.value)} placeholder={t("settings_dest_flight")} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("dropdown_options")}</label>
                <textarea value={uiVoliOptions} onChange={e => setUiVoliOptions(e.target.value)} rows={3} placeholder="Roma, Milano Linate, Napoli..." style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--bg)', color: 'var(--text)' }} />
              </div>
              <div className="form-group">
                <label className="form-label">{t("iata_mapping")}</label>
                <textarea value={uiIataMapping} onChange={e => setUiIataMapping(e.target.value)} rows={4} placeholder="roma=ROM&#10;linate=LIN&#10;malpensa=MXP" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--bg)', color: 'var(--text)' }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '32px', display: 'flex', alignItems: 'center', gap: '16px', borderTop: '1px solid var(--card-border)', paddingTop: '24px' }}>
          <button className="btn-primary" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Save size={16} />
            {t("save_settings")}
          </button>
          {saved && <span style={{ color: '#4ade80', fontSize: '14px', fontWeight: 500 }}>{t("saved_local")}</span>}
        </div>
      </motion.div>
    </div>
  );
}
