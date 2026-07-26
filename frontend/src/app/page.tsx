"use client";

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchTrains, fetchFlights, fetchConfig } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { Search, Train, Plane, Loader2, Calendar, ArrowLeftRight, Square, Copy, X, Plus, Bookmark, Clock } from 'lucide-react';
import AutocompleteInput from '@/components/AutocompleteInput';
import HistoryModal, { HistoryEntry } from '@/components/HistoryModal';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { it } from 'date-fns/locale/it';
import { differenceInCalendarDays } from 'date-fns';

registerLocale('it', it);

// Mesi renderizzati nel popup date: il calendario scorre verticalmente (vedi globals.css).
const MONTHS_SHOWN = 12;
const MAX_RANGE_DAYS = 14;

export default function Dashboard() {
  const { t, language } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'trains' | 'flights'>('trains');
  
  const [appConfig, setAppConfig] = useState<any>(null);
  const appConfigRef = useRef<any>(null);
  const [origins, setOrigins] = useState<string[]>(['']);
  const [destinations, setDestinations] = useState<string[]>(['']);
  const [depDateRange, setDepDateRange] = useState<[Date | null, Date | null]>([new Date(), null]);
  const [depDatePristine, setDepDatePristine] = useState(true);
  const [retDateRange, setRetDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [oneWay, setOneWay] = useState(true);
  const [savedSearches, setSavedSearches] = useState<{trains: {origins: string[], destinations: string[]}[], flights: {origins: string[], destinations: string[]}[]}>({ trains: [], flights: [] });
  
  const [trainLoading, setTrainLoading] = useState(false);
  const [flightLoading, setFlightLoading] = useState(false);
  const [trainSearched, setTrainSearched] = useState(false);
  const [flightSearched, setFlightSearched] = useState(false);
  const [trainResults, setTrainResults] = useState<any[]>([]);
  const [flightResults, setFlightResults] = useState<any[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [flightError, setFlightError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<{key: string, text: string, target?: string}[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const trainAbortControllerRef = useRef<AbortController | null>(null);
  const flightAbortControllerRef = useRef<AbortController | null>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [trainHistory, setTrainHistory] = useState<HistoryEntry[]>([]);
  const [flightHistory, setFlightHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        if (formRef.current) formRef.current.requestSubmit();
      }
      if (e.altKey && e.key === '1') {
        setMode('trains');
        const cfg = appConfigRef.current?.treni || {};
        setOrigins([cfg.default_origin || 'Zurigo HB']);
        setDestinations([cfg.default_destination || 'Alessandria']);
      }
      if (e.altKey && e.key === '2') {
        setMode('flights');
        const cfg = appConfigRef.current?.voli || {};
        setOrigins([cfg.default_origin || 'Zurigo']);
        setDestinations([cfg.default_destination || 'Bari']);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

    const handleCopyTable = () => {
    const res = mode === 'trains' ? trainResults : flightResults;
    if (res.length === 0) return;
    
    let text = "| Route | Departure | Arrival | Duration | Price | Adj Cost |\n";
    text += "|---|---|---|---|---|---|\n";
    res.slice(0, itemsPerPage).forEach(r => {
      const route = r.route || `${r.origin} -> ${r.destination}`;
      const depTime = r.out_dep || r.dep;
      const arrTime = r.out_arr || r.arr;
      const dep = depTime ? new Date(depTime).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      const arr = arrTime ? new Date(arrTime).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      const durMin = r.duration_min || r.total_duration_min || 0;
      const dur = `${Math.floor(durMin / 60)}h ${durMin % 60}m`;
      const price = `${r.price_eur || 0} €`;
      const adj = `${r.adjusted_cost || 0} €`;
      text += `| ${route} | ${dep} | ${arr} | ${dur} | ${price} | ${adj} |\n`;
    });
    
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(err => console.error("Clipboard error", err));
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleStop = () => {
    if (mode === 'trains') {
      if (trainAbortControllerRef.current) trainAbortControllerRef.current.abort();
      setTrainLoading(false);
    } else {
      if (flightAbortControllerRef.current) flightAbortControllerRef.current.abort();
      setFlightLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const controller = new AbortController();
    if (mode === 'trains') {
      if (trainAbortControllerRef.current) trainAbortControllerRef.current.abort();
      trainAbortControllerRef.current = controller;
      setTrainLoading(true);
    } else {
      if (flightAbortControllerRef.current) flightAbortControllerRef.current.abort();
      flightAbortControllerRef.current = controller;
      setFlightLoading(true);
    }
    if (mode === 'trains') {
      setTrainSearched(false);
      setTrainError(null);
      setTrainResults([]);
    } else {
      setFlightSearched(false);
      setFlightError(null);
      setFlightResults([]);
    }

    const formatDate = (date: Date | null) => {
      if (!date) return '';
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const depStartStr = formatDate(depDateRange[0]);
    const depEndStr = formatDate(depDateRange[1]);
    const retStartStr = formatDate(retDateRange[0]);
    const retEndStr = formatDate(retDateRange[1]);

    if (!depStartStr) {
      if (mode === 'trains') setTrainError(t("err_outbound")); else setFlightError(t("err_outbound"));
      mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
      return;
    }
    
    if (!oneWay && !retStartStr) {
      if (mode === 'trains') setTrainError(t("err_return")); else setFlightError(t("err_return"));
      mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
      return;
    }

    const rangeError = t("err_max_range").replace('{days}', String(MAX_RANGE_DAYS));
    
    if (depDateRange[0] && depDateRange[1]) {
      if (differenceInCalendarDays(depDateRange[1], depDateRange[0]) > MAX_RANGE_DAYS) {
        if (mode === 'trains') setTrainError(rangeError); else setFlightError(rangeError);
        mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
        return;
      }
    }
    
    if (!oneWay && retDateRange[0] && retDateRange[1]) {
      if (differenceInCalendarDays(retDateRange[1], retDateRange[0]) > MAX_RANGE_DAYS) {
        if (mode === 'trains') setTrainError(rangeError); else setFlightError(rangeError);
        mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
        return;
      }
    }

    if (mode === 'flights') {
      try {
        const localData = localStorage.getItem('teletransport_settings');
        const parsedLocal = localData ? JSON.parse(localData) : {};
        if (!parsedLocal.serpapiKey) {
          setFlightError(t("err_api_key"));
          setFlightLoading(false);
          return;
        }
      } catch (e) {}
    }

    try {
      const payload = {
        origins: origins.filter(Boolean),
        destinations: destinations.filter(Boolean),
        dep_start: depStartStr,
        dep_end: depEndStr || depStartStr,
        ret_start: retStartStr || undefined,
        ret_end: (retEndStr || retStartStr) || undefined,
        one_way: oneWay
      };

      const res = mode === 'trains' 
        ? await fetchTrains(payload, controller.signal) 
        : await fetchFlights(payload, controller.signal);
        
      if (mode === 'trains') {
        setTrainResults(res.data || []);
        setTrainSearched(true);
        if (res.data && res.data.length > 0) {
          const entry: HistoryEntry = {
            timestamp: Date.now(), origin: origins[0], destination: destinations[0],
            depStartStr, depEndStr, retStartStr, retEndStr, oneWay, results: res.data
          };
          setTrainHistory(prev => {
            const next = [entry, ...prev].slice(0, 10);
            localStorage.setItem('teletransport_train_history', JSON.stringify(next));
            return next;
          });
        }
      } else {
        setFlightResults(res.data || []);
        setFlightSearched(true);
        if (res.data && res.data.length > 0) {
          const entry: HistoryEntry = {
            timestamp: Date.now(), origin: origins[0], destination: destinations[0],
            depStartStr, depEndStr, retStartStr, retEndStr, oneWay, results: res.data
          };
          setFlightHistory(prev => {
            const next = [entry, ...prev].slice(0, 10);
            localStorage.setItem('teletransport_flight_history', JSON.stringify(next));
            return next;
          });
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (mode === 'trains') {
        setTrainError(err.message || t("err_generic"));
        setTrainSearched(true);
      } else {
        setFlightError(err.message || t("err_generic"));
        setFlightSearched(true);
      }
    } finally {
      if (mode === 'trains' && trainAbortControllerRef.current === controller) {
        setTrainLoading(false);
      } else if (mode === 'flights' && flightAbortControllerRef.current === controller) {
        setFlightLoading(false);
      }
    }
  };

  useEffect(() => {
    try {
      const settings = localStorage.getItem('teletransport_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        if (parsed.reminders) {
           setReminders(Object.entries(parsed.reminders).map(([k, v]: [string, any]) => {
             if (typeof v === 'string') return { key: k, text: v, target: 'voli' };
             return { key: k, text: String(v.text || ''), target: v.target || 'voli' };
           }));
        }
      }
    } catch (e) {}

    try {
      const localSaved = localStorage.getItem('teletransport_saved_searches');
      if (localSaved) {
        setSavedSearches(JSON.parse(localSaved));
      }
      const savedTrain = localStorage.getItem('teletransport_train_history');
      if (savedTrain) setTrainHistory(JSON.parse(savedTrain));
      const savedFlight = localStorage.getItem('teletransport_flight_history');
      if (savedFlight) setFlightHistory(JSON.parse(savedFlight));
    } catch (e) {}

    try {
      const state = sessionStorage.getItem('dashboard_state');
      if (state) {
        const parsed = JSON.parse(state);
        if (parsed.mode) setMode(parsed.mode);
        if (parsed.origins) setOrigins(parsed.origins);
        if (parsed.destinations) setDestinations(parsed.destinations);
        if (parsed.itemsPerPage) setItemsPerPage(parsed.itemsPerPage);
        if (parsed.oneWay !== undefined) setOneWay(parsed.oneWay);
        if (parsed.trainSearched !== undefined) setTrainSearched(parsed.trainSearched);
        if (parsed.flightSearched !== undefined) setFlightSearched(parsed.flightSearched);
        if (parsed.trainResults) setTrainResults(parsed.trainResults);
        if (parsed.flightResults) setFlightResults(parsed.flightResults);
        if (parsed.trainError !== undefined) setTrainError(parsed.trainError);
        if (parsed.flightError !== undefined) setFlightError(parsed.flightError);
        
        if (parsed.depDateRange) {
          setDepDateRange([
            parsed.depDateRange[0] ? new Date(parsed.depDateRange[0]) : null,
            parsed.depDateRange[1] ? new Date(parsed.depDateRange[1]) : null
          ]);
          setDepDatePristine(false);
        }
        if (parsed.retDateRange) {
          setRetDateRange([
            parsed.retDateRange[0] ? new Date(parsed.retDateRange[0]) : null,
            parsed.retDateRange[1] ? new Date(parsed.retDateRange[1]) : null
          ]);
        }
      }
    } catch (e) {}

    fetchConfig().then(baseCfg => {
      let cfg = baseCfg || {};
      try {
        const localData = localStorage.getItem('teletransport_settings');
        if (localData) {
          const parsedLocal = JSON.parse(localData);
          if (parsedLocal.ui) {
            cfg = {
              ...cfg,
              treni: { ...(cfg.treni || {}), ...parsedLocal.ui.treni },
              voli: { ...(cfg.voli || {}), ...parsedLocal.ui.voli }
            };
          }
        }
      } catch (e) {}

      if (Object.keys(cfg).length > 0) {
        setAppConfig(cfg);
        appConfigRef.current = cfg;
        const state = sessionStorage.getItem('dashboard_state');
        if (!state) {
          setOrigins([cfg.treni?.default_origin || 'Zurigo HB']);
          setDestinations([cfg.treni?.default_destination || 'Alessandria']);
        }
      } else {
        const state = sessionStorage.getItem('dashboard_state');
        if (!state) {
          setOrigins(['Zurigo HB']);
          setDestinations(['Alessandria']);
        }
      }
      setMounted(true);
    });
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem('teletransport_saved_searches', JSON.stringify(savedSearches));
  }, [savedSearches, mounted]);

  const handleSaveSearch = () => {
    const current = savedSearches[mode] || [];
    const cleanOrigins = origins.filter(o => o.trim());
    const cleanDestinations = destinations.filter(d => d.trim());
    if (cleanOrigins.length === 0 || cleanDestinations.length === 0) return;

    const isDuplicate = current.some(s => 
      JSON.stringify(s.origins) === JSON.stringify(cleanOrigins) && 
      JSON.stringify(s.destinations) === JSON.stringify(cleanDestinations)
    );

    if (isDuplicate) return;

    const newSaved = [...current, { origins: cleanOrigins, destinations: cleanDestinations }];
    if (newSaved.length > 10) newSaved.shift();

    setSavedSearches(prev => ({ ...prev, [mode]: newSaved }));
  };

  const removeSavedSearch = (idx: number) => {
    setSavedSearches(prev => {
      const newMode = [...prev[mode]];
      newMode.splice(idx, 1);
      return { ...prev, [mode]: newMode };
    });
  };

  useEffect(() => {
    if (!mounted) return;
    const stateToSave = {
      mode, origins, destinations, itemsPerPage, oneWay,
      trainSearched, flightSearched,
      trainResults, flightResults,
      trainError, flightError,
      depDateRange: [
        depDateRange[0] ? depDateRange[0].toISOString() : null,
        depDateRange[1] ? depDateRange[1].toISOString() : null
      ],
      retDateRange: [
        retDateRange[0] ? retDateRange[0].toISOString() : null,
        retDateRange[1] ? retDateRange[1].toISOString() : null
      ]
    };
    sessionStorage.setItem('dashboard_state', JSON.stringify(stateToSave));
  }, [mounted, mode, origins, destinations, itemsPerPage, oneWay, trainSearched, flightSearched, trainResults, flightResults, trainError, flightError, depDateRange, retDateRange]);

  if (!mounted) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '64px' }}><Loader2 className="animate-spin" size={32} /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* Type Toggle */}
      <div className="flex justify-center" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'inline-flex', gap: '12px' }}>
          <button 
            type="button"
            className={mode === 'trains' ? 'btn-primary' : 'btn-outline'} 
            title={`${t("trains_btn")} (Alt+1)`}
            onClick={() => { 
              setMode('trains'); 
              const cfg = appConfig?.treni || {};
              setOrigins([cfg.default_origin || 'Zurigo HB']); 
              setDestinations([cfg.default_destination || 'Alessandria']); 
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', border: mode === 'trains' ? 'none' : '1px solid var(--card-border)', padding: '10px 24px' }}
          >
            <Train size={18} /> {t("trains_btn")}
          </button>
          <button 
            type="button"
            className={mode === 'flights' ? 'btn-primary' : 'btn-outline'} 
            title={`${t("flights_btn")} (Alt+2)`}
            onClick={() => { 
              setMode('flights'); 
              const cfg = appConfig?.voli || {};
              setOrigins([cfg.default_origin || 'Zurigo']); 
              setDestinations([cfg.default_destination || 'Bari']); 
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', border: mode === 'flights' ? 'none' : '1px solid var(--card-border)', padding: '10px 24px' }}
          >
            <Plane size={18} /> {t("flights_btn")}
          </button>
        </div>
      </div>

      {(() => {
        const activeReminders = reminders.filter(r => 
          r.target === 'both' || 
          (mode === 'flights' && r.target === 'voli') || 
          (mode === 'trains' && r.target === 'treni')
        );
        if (activeReminders.length === 0) return null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activeReminders.map((r, i) => (
              <div key={i} style={{ padding: '12px 16px', background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '8px', color: '#ca8a04', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>💡</span>
                {r.text}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Search Form */}
      <motion.form 
        ref={formRef}
        onSubmit={handleSearch} 
        className="glass-panel" 
        style={{ padding: '32px' }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="form-grid">
          {savedSearches[mode] && savedSearches[mode].length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
              {savedSearches[mode].map((s, i) => (
                <div 
                  key={i} 
                  onClick={() => { setOrigins(s.origins); setDestinations(s.destinations); }} 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '6px 12px', borderRadius: '16px', fontSize: '13px', transition: 'all 0.2s' }}
                >
                  <span>{s.origins.join(', ')} <ArrowLeftRight size={12} style={{display: 'inline', margin: '0 4px'}} /> {s.destinations.join(', ')}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeSavedSearch(i); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0', display: 'flex', marginLeft: '4px' }} title={t("remove")}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {origins.map((orig, idx) => (
                  <div key={`orig-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <AutocompleteInput 
                        label={idx === 0 ? t("origin") : `${t("origin")} ${idx + 1}`}
                        value={orig}
                        onChange={(val) => {
                          const newOrigins = [...origins];
                          newOrigins[idx] = val;
                          setOrigins(newOrigins);
                        }}
                        options={t(mode === 'trains' ? 'options_trains' : 'options_flights').split(',')}
                        placeholder={mode === 'trains' ? t("origin_placeholder_train") : t("origin_placeholder_flight")}
                      />
                    </div>
                    {origins.length > 1 && (
                      <button type="button" className="btn-outline" onClick={() => setOrigins(origins.filter((_, i) => i !== idx))} style={{ padding: '10px', height: '42px', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t("remove")}>
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
                {origins.length < 5 && (
                  <button type="button" className="btn-outline" onClick={() => setOrigins([...origins, ''])} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={14} /> {t("add_origin")}
                  </button>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                <button 
                  type="button" 
                  className="btn-outline"
                  onClick={() => {
                    const temp = [...origins];
                    setOrigins(destinations);
                    setDestinations(temp);
                  }}
                  style={{ padding: '10px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title={t("swap_btn")}
                >
                  <ArrowLeftRight size={18} />
                </button>
              </div>

              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {destinations.map((dest, idx) => (
                  <div key={`dest-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <AutocompleteInput 
                        label={idx === 0 ? t("destination") : `${t("destination")} ${idx + 1}`}
                        value={dest}
                        onChange={(val) => {
                          const newDests = [...destinations];
                          newDests[idx] = val;
                          setDestinations(newDests);
                        }}
                        options={t(mode === 'trains' ? 'options_trains' : 'options_flights').split(',')}
                        placeholder={mode === 'trains' ? t("dest_placeholder_train") : t("dest_placeholder_flight")}
                      />
                    </div>
                    {destinations.length > 1 && (
                      <button type="button" className="btn-outline" onClick={() => setDestinations(destinations.filter((_, i) => i !== idx))} style={{ padding: '10px', height: '42px', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t("remove")}>
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
                {destinations.length < 5 && (
                  <button type="button" className="btn-outline" onClick={() => setDestinations([...destinations, ''])} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={14} /> {t("add_dest")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <label className="form-label" style={{ marginBottom: '8px' }}>{t("outbound_range")}</label>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                <Calendar size={18} style={{ position: 'absolute', left: '10px', color: 'var(--muted)', zIndex: 1 }} />
                <DatePicker
                  selectsRange={true}
                  monthsShown={MONTHS_SHOWN}
                  locale={language === 'it' ? 'it' : undefined}
                  startDate={depDateRange[0] || undefined}
                  endDate={depDateRange[1] || undefined}
                  onChange={(update: [Date | null, Date | null]) => {
                    if (depDatePristine && update[0] && update[1]) {
                      setDepDateRange([update[1], null]);
                    } else {
                      setDepDateRange(update);
                    }
                    setDepDatePristine(false);
                  }}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t("outbound_placeholder")}
                  className="w-full pl-8"
                  isClearable={true}
                  customInput={<input style={{ paddingLeft: '36px' }} />}
                />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', paddingLeft: '4px' }}>{t("start_end")}</div>
            </div>
          </div>
          
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>{t("return_range")}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={!oneWay}
                  onChange={e => setOneWay(!e.target.checked)}
                  style={{ width: 'auto', cursor: 'pointer' }}
                />
                {t("include_return")}
              </label>
            </div>
            <div style={{ opacity: oneWay ? 0.5 : 1, pointerEvents: oneWay ? 'none' : 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                <Calendar size={18} style={{ position: 'absolute', left: '10px', color: 'var(--muted)', zIndex: 1 }} />
                <DatePicker
                  selectsRange={true}
                  monthsShown={MONTHS_SHOWN}
                  locale={language === 'it' ? 'it' : undefined}
                  startDate={retDateRange[0] || undefined}
                  endDate={retDateRange[1] || undefined}
                  onChange={(update: [Date | null, Date | null]) => setRetDateRange(update)}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t("return_placeholder")}
                  className="w-full pl-8"
                  disabled={oneWay}
                  isClearable={true}
                  customInput={<input style={{ paddingLeft: '36px' }} />}
                />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', paddingLeft: '4px' }}>{t("start_end")}</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          <button 
            type="button" 
            className="btn-outline"
            onClick={handleSaveSearch}
            title={t("save_destinations")}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Bookmark size={16} /> {t("save_btn")}
          </button>
          
          <button 
            type="button" 
            className="btn-outline"
            onClick={() => {
              if (mode === 'trains') {
                window.open('https://www.trenitalia.com/it.html', '_blank');
              } else {
                const mapIata = (n: string) => {
                  n = n.toLowerCase();
                  const mapping = appConfig?.voli?.iata_mapping || {
                    "zurigo": "ZRH", "zurich": "ZRH", "bari": "BRI", "brindisi": "BDS",
                    "torino": "TRN", "linate": "LIN", "malpensa": "MXP", "milan": "MIL",
                    "roma": "ROM", "rome": "ROM", "napol": "NAP", "naples": "NAP",
                    "catania": "CTA", "palermo": "PMO", "venezia": "VCE", "venice": "VCE",
                    "bologna": "BLQ"
                  };
                  for (const key in mapping) {
                    if (n.includes(key)) return mapping[key];
                  }
                  return n;
                };
                const o = mapIata(origins[0] || '');
                const d = mapIata(destinations[0] || '');
                
                const formatDate = (date: Date | null) => {
                  if (!date) return '';
                  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                };
                const depStr = formatDate(depDateRange[0]);
                const retStr = formatDate(retDateRange[0]);
                
                let url = `https://www.google.com/travel/flights?q=Flights%20to%20${d}%20from%20${o}%20on%20${depStr}`;
                if (!oneWay && retStr) {
                  url += `%20through%20${retStr}`;
                } else {
                  url += `%20one-way`;
                }
                window.open(url, '_blank');
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {mode === 'trains' ? t("open_trenitalia") : t("open_google_flights")}
          </button>
          
          <button type="button" className="btn-outline" onClick={() => setIsHistoryOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px' }} title={language === 'it' ? 'Cronologia' : 'History'}>
            <Clock size={18} />
          </button>
          
          <button type="submit" className="btn-primary" disabled={mode === 'trains' ? trainLoading : flightLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title={`${t("search_solutions")} (Ctrl+Enter)`}>
            {(mode === 'trains' ? trainLoading : flightLoading) ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {(mode === 'trains' ? trainLoading : flightLoading) ? t("searching") : t("search_solutions")}
          </button>
          {(mode === 'trains' ? trainLoading : flightLoading) && (
            <div 
              onClick={handleStop}
              title={t("stop_search")}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '8px', color: 'var(--primary)' }}
            >
              <Square size={20} fill="currentColor" />
            </div>
          )}
        </div>
      </motion.form>

      {/* Results */}
      {(mode === 'trains' ? trainError : flightError) && (
        <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171' }}>
          {mode === 'trains' ? trainError : flightError}
        </div>
      )}

      {!(mode === 'trains' ? trainLoading : flightLoading) && (mode === 'trains' ? trainSearched : flightSearched) && !(mode === 'trains' ? trainError : flightError) && (mode === 'trains' ? trainResults : flightResults).length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', background: 'var(--card-bg)', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
          {t("no_solutions")}
        </div>
      )}

      <AnimatePresence>
        {(mode === 'trains' ? trainResults : flightResults).length > 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
              <button 
                type="button"
                className="btn-outline"
                onClick={handleCopyTable}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px' }}
                title={t("copy_table")}
              >
                <Copy size={18} />
              </button>
            </div>
            <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>{t("route")}</th>
                  <th>{t("departure")}</th>
                  <th>{t("arrival")}</th>
                  <th>{t("duration")}</th>
                  <th>{t("price")}</th>
                  <th>{t("adj_cost")}</th>
                </tr>
              </thead>
              <tbody>
                {(mode === 'trains' ? trainResults : flightResults).slice(0, itemsPerPage).map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ fontWeight: 500 }}>
                        {r.route || `${r.origin} → ${r.destination}`}
                      </span>
                      {!oneWay && r.in_dep && <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px' }}>{t("return_label")}: {r.destination} → {r.origin}</div>}
                    </td>
                    <td>{new Date(r.out_dep || r.dep).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{new Date(r.out_arr || r.arr).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{Math.floor((r.duration_min || r.total_duration_min) / 60)}h {(r.duration_min || r.total_duration_min) % 60}m</td>
                    <td style={{ fontWeight: 600 }}>{r.price_eur} €</td>
                    <td style={{ color: 'var(--accent)' }}>{r.adjusted_cost} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(mode === 'trains' ? trainResults : flightResults).length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{t("results_to_show")}</span>
          <select 
            value={itemsPerPage} 
            onChange={e => setItemsPerPage(Number(e.target.value))}
            style={{ width: '80px', padding: '6px 10px', background: 'var(--card-bg)' }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={15}>15</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      )}
      
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        mode={mode}
        history={mode === 'trains' ? trainHistory : flightHistory}
        onSelect={(entry) => {
          setOrigins([entry.origin]);
          setDestinations([entry.destination]);
          setDepDateRange([entry.depStartStr ? new Date(entry.depStartStr) : null, entry.depEndStr ? new Date(entry.depEndStr) : null]);
          setRetDateRange([entry.retStartStr ? new Date(entry.retStartStr) : null, entry.retEndStr ? new Date(entry.retEndStr) : null]);
          setOneWay(entry.oneWay);
          if (mode === 'trains') {
            setTrainResults(entry.results);
            setTrainSearched(true);
            setTrainError(null);
          } else {
            setFlightResults(entry.results);
            setFlightSearched(true);
            setFlightError(null);
          }
        }}
      />
    </div>
  );
}
