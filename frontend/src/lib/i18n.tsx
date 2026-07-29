"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'it';

interface Translations {
  [key: string]: string;
}

// Train station names are NEVER translated: the Trenitalia/LeFrecce location API
// only matches italian names, so an english label ("Milan Central") would make the
// train search fail or resolve to the wrong station. Shared by both dictionaries.
const TRAIN_STATION_OPTIONS = "Torino ( Tutte Le Stazioni ),Alessandria,Zurigo HB,Bari Centrale,Lecce,Milano Centrale,Roma Termini,Napoli Centrale,Venezia S. Lucia,Bologna Centrale,Deiva Marina";

const en: Translations = {
  // Navigation
  teletransport: "TeleTransport",
  subtitle: "Time is money",
  settings: "Settings",

  // Guide
  guide_title: "TeleTransport Complete Guide",
  guide_intro: "TeleTransport is designed to find the best travel solutions by calculating an 'Adjusted Cost'. This cost is the sum of the actual ticket price and various time-based penalties, converting your lost time and inconvenience into a monetary value. The app works by scraping real-time data: it uses the SerpApi app to scrape Google Flights for flight options, and it directly scrapes the official Trenitalia website for train options.\n\nNote: the results and total costs shown include both the outbound and return trips if 'Include Return' is selected.\n\n📅 Date Ranges: The 'Outbound Range' and 'Return Range' fields are flexibility options. They allow you to select a multi-day interval (e.g., from the 3rd to the 5th of the month). The system will search for flights/trains across all those days simultaneously to find you the absolute best option based on the Adjusted Cost. If you only want to search for one specific day, just double-click that exact day.\n\nHere is exactly how each setting works:",
  guide_serpapi_title: "🔑 SerpApi Key (Required for Flights)",
  guide_serpapi_desc1: "To search for flights, you need a free SerpApi key. It takes 1 minute: go to ",
  guide_serpapi_desc2: ", create an account, copy your API Key from the dashboard, and paste it into the TeleTransport Settings.",
  guide_trains: "🚆 Trains Scoring",
  guide_flights: "✈️ Flights Scoring",
  time_value: "Time Value",
  time_value_desc: "The monetary value of one hour of your time. If a trip takes 3 hours and your time value is 20 €/h, 60 € is added to the ticket price. A higher value strongly penalizes slower travel options.",
  early_penalty: "Early Departure Penalty",
  early_penalty_desc: "Waking up early has a cost. If your reference 'Early Departure Time' is 09:00, and a train leaves at 07:00, you are 2 hours early. This difference is multiplied by the 'Early Departure Penalty' (€/h) and added to the cost.",
  late_penalty: "Late Arrival / Overnight Penalty",
  late_penalty_desc: "Arriving late is inconvenient. Any arrival after your 'Late Arrival Time' (e.g., 22:00) incurs a penalty. If it extends past midnight into the 'Overnight End Time' (e.g., 05:00), the penalty is applied per hour for the duration of the delay. The total hours are multiplied by the 'Late Arrival Penalty' (€/h).",
  change_penalty: "Change/Connection Penalty",
  change_penalty_desc: "Each train change or flight connection adds a fixed monetary penalty to the adjusted cost, representing the stress and risk of missing the connection.",
  airport_extras: "Airport Extra Costs",
  airport_extras_desc: "Getting to the airport costs money and time. You can assign specific extra costs to IATA codes (e.g., fuel costs, driving time). The driving time is multiplied by your Time Value, and the fuel cost is added directly to the total adjusted cost of the flight.",
  companions_time: "Companions Time",
  companions_time_desc: "If you travel with others, their time also has value. This acts as an additional Time Value applied to the total duration of the trip.",
  close: "Close",

  // Main Page
  trains_btn: "Trains",
  flights_btn: "Flights",
  origin: "Origin",
  origin_placeholder_train: "e.g., Zurigo HB (italian name)",
  origin_placeholder_flight: "e.g., Zurich",
  destination: "Destination",
  dest_placeholder_train: "e.g., Roma Termini (italian name)",
  dest_placeholder_flight: "e.g., Rome",
  swap_btn: "Swap",
  outbound_range: "Outbound Range",
  outbound_placeholder: "Select outbound dates",
  return_range: "Return Range",
  return_placeholder: "Select return dates",
  include_return: "Include Return",
  open_trenitalia: "Open Trenitalia",
  open_google_flights: "Open Google Flights",
  search_solutions: "Search Solutions",
  searching: "Searching...",
  stop_search: "Stop Search",
  no_solutions: "No solutions found for the selected criteria. Try changing dates or destinations.",
  route: "Route",
  departure: "Departure",
  arrival: "Arrival",
  duration: "Duration",
  price: "Price",
  adj_cost: "Adj Cost",
  return_label: "Return",
  results_to_show: "Results to show:",
  copy_table: "Copy Table (Markdown)",
  sort_best: "Sort by best",
  sort_day: "Group by day, best first within each day",
  exclude_row: "Hide this solution",
  restore_last: "Bring back the last hidden solution",
  restore_all: "Bring back every hidden solution",
  err_outbound: "You must enter an outbound date (start).",
  err_return: "You must enter a return date or check 'One-way'.",
  err_max_range: "The maximum allowed date range is {days} days. Please select a shorter range to prevent system overload.",
  err_api_key: "To search flights, you must enter your SerpApi Key in the Settings.",
  err_generic: "Error during search",

  // Settings
  theme_system: "Theme: Follow system",
  serpapi_label: "SerpApi Key (Google Flights)",
  serpapi_placeholder: "Enter your API key",
  scoring_trains: "Trains Scoring",
  scoring_flights: "Flights Scoring",
  val_time: "Time value (€/h)",
  early_ref: "Early Departure Time (e.g., 9)",
  early_pen: "Early Departure Penalty (€/h)",
  late_ref: "Late Arrival Time (e.g., 22)",
  overnight_ref: "Overnight End Time (e.g., 5)",
  late_pen: "Late Arrival Penalty (€/h)",
  change_pen: "Change Penalty (€)",
  conn_pen: "Connection Penalty (€)",
  comp_time: "Companions Time Value (€/h)",
  reminders_title: "Text Reminders",
  add_reminder: "+ Add Reminder",
  remove: "Remove",
  target_flights: "Flights Only",
  target_trains: "Trains Only",
  target_both: "Both",
  target_disabled: "Disabled",
  airport_extras_title: "Airport Extra Costs",
  airport_extras_info: "Add transfer costs (fuel and driving time) specific to each airport. They will be added to the total flight cost if the airport is part of the route.",
  iata_code: "IATA Code",
  fuel_eur: "Fuel (€)",
  your_time: "Your Time (h)",
  comp_time_h: "Comp. Time (h)",
  add_airport: "+ Add Airport Cost",
  ui_settings: "User Interface (Customize your Menus)",
  default_origin: "Default Origin",
  default_dest: "Default Destination",
  dropdown_options: "Dropdown Options (comma-separated)",
  iata_mapping: "IATA Codes Mapping (one per line, e.g.: linate=LIN)",
  save_settings: "Save Settings",
  saved_local: "Saved in LocalStorage!",
  language: "Language",
  language_en: "English",
  language_it: "Italiano",
  settings_origin_train: "e.g., Roma Termini",
  settings_dest_train: "e.g., Milano Centrale",
  settings_origin_flight: "e.g., Rome",
  settings_dest_flight: "e.g., Milan",
  settings_id_placeholder: "ID (e.g., booking)",
  reminder_text_placeholder: "Reminder text",
  options_trains: TRAIN_STATION_OPTIONS,
  options_flights: "Zurich,Bari,Brindisi,Turin,Milan Linate,Milan Malpensa,Genoa,Rome,Naples,Catania,Palermo,Venice,Bologna",
  export_btn: "Export",
  import_btn: "Import",
  export_error: "Error during export.",
  import_success: "Settings imported successfully! The page will reload to apply changes.",
  import_invalid: "The file does not contain valid settings for TeleTransport.",
  import_corrupted: "Invalid or corrupted file.",
  start_end: "(Start - End)",
  save_destinations: "Save destinations",
  save_btn: "Save",
  add_origin: "Add origin",
  add_dest: "Add destination"
};

const it: Translations = {
  // Navigation
  teletransport: "TeleTransport",
  subtitle: "Il tempo è denaro",
  settings: "Impostazioni",

  // Guide
  guide_title: "Guida Completa TeleTransport",
  guide_intro: "TeleTransport è progettato per trovare le migliori soluzioni di viaggio calcolando un 'Costo Adjusted'. Questo costo è la somma del prezzo effettivo del biglietto e di varie penalità basate sul tempo, convertendo il tempo perso e i disagi in un valore monetario. L'app funziona eseguendo lo scraping di dati in tempo reale: utilizza l'app SerpApi per fare lo scraping di Google Flights per i voli, e fa lo scraping direttamente dal sito ufficiale di Trenitalia per i treni.\n\nNota: i risultati e i costi totali mostrati includono sia l'andata che il ritorno se l'opzione 'Includi Ritorno' è selezionata.\n\n📅 Range di Date: I campi 'Range Andata' e 'Range Ritorno' sono opzioni di flessibilità. Ti permettono di selezionare un intervallo di più giorni (es. dal 3 al 5 del mese). Il sistema cercherà voli/treni su tutti quei giorni contemporaneamente per trovarti l'opzione migliore in assoluto in base al Costo Adjusted. Se vuoi cercare per un solo giorno specifico, fai semplicemente doppio click su quel giorno esatto.\n\nEcco esattamente come funziona ogni impostazione:",
  guide_serpapi_title: "🔑 API Key SerpApi (Richiesta per i Voli)",
  guide_serpapi_desc1: "Per cercare i voli è necessaria una chiave SerpApi gratuita. Ci vuole 1 minuto: vai su ",
  guide_serpapi_desc2: ", crea un account, copia la tua API Key dalla dashboard e incollala nelle Impostazioni di TeleTransport.",
  guide_trains: "🚆 Scoring Treni",
  guide_flights: "✈️ Scoring Voli",
  time_value: "Valore del Tempo",
  time_value_desc: "Il valore monetario di un'ora del tuo tempo. Se un viaggio dura 3 ore e il valore del tempo è 20 €/h, vengono aggiunti 60 € al costo del biglietto. Un valore alto penalizza fortemente le soluzioni più lente.",
  early_penalty: "Penalità Partenza Presto",
  early_penalty_desc: "Svegliarsi presto ha un costo. Se l'Ora di Partenza Presto di riferimento è le 09:00 e un treno parte alle 07:00, sei in anticipo di 2 ore. Questa differenza viene moltiplicata per la 'Penalità Partenza Presto' (€/h) e aggiunta al costo totale.",
  late_penalty: "Penalità Arrivo Tardi e Notturno",
  late_penalty_desc: "Arrivare tardi è scomodo. Qualsiasi arrivo dopo l'Ora Arrivo Tardi (es. 22:00) subisce una penalità. Se l'arrivo si protrae oltre la mezzanotte fino all'Ora Fine Arrivo Notturno (es. 05:00), la penalità viene applicata per ogni ora. Le ore totali sono moltiplicate per la 'Penalità Arrivo Tardi' (€/h).",
  change_penalty: "Penalità per Cambi e Scali",
  change_penalty_desc: "Ogni cambio di treno o scalo aereo aggiunge una penalità fissa al costo adjusted, che rappresenta lo stress e il rischio di perdere la coincidenza.",
  airport_extras: "Costi Extra Aeroporti",
  airport_extras_desc: "Raggiungere l'aeroporto costa tempo e denaro. Puoi assegnare costi extra specifici ai codici IATA (es. costi carburante, tempo di guida). Il tempo di guida viene moltiplicato per il tuo Valore del Tempo e il costo del carburante viene sommato direttamente al costo totale del volo.",
  companions_time: "Tempo Accompagnatori",
  companions_time_desc: "Se viaggi con altre persone, anche il loro tempo ha un valore. Questo funge da Valore del Tempo aggiuntivo applicato alla durata totale del viaggio.",
  close: "Chiudi",

  // Main Page
  trains_btn: "Treni",
  flights_btn: "Voli",
  origin: "Origine",
  origin_placeholder_train: "es. Torino",
  origin_placeholder_flight: "es. Zurigo",
  destination: "Destinazione",
  dest_placeholder_train: "es. Zurigo",
  dest_placeholder_flight: "es. Bari",
  swap_btn: "Inverti",
  outbound_range: "Range Andata",
  outbound_placeholder: "Seleziona date andata",
  return_range: "Range Ritorno",
  return_placeholder: "Seleziona date ritorno",
  include_return: "Includi Ritorno",
  open_trenitalia: "Apri Trenitalia",
  open_google_flights: "Apri Google Flights",
  search_solutions: "Cerca Soluzioni",
  searching: "Ricerca in corso...",
  stop_search: "Interrompi Ricerca",
  no_solutions: "Nessuna soluzione trovata per i criteri selezionati. Prova a cambiare date o destinazioni.",
  route: "Rotta",
  departure: "Partenza",
  arrival: "Arrivo",
  duration: "Durata",
  price: "Prezzo",
  adj_cost: "Costo Adj",
  return_label: "Ritorno",
  results_to_show: "Risultati da mostrare:",
  copy_table: "Copia Tabella (Markdown)",
  sort_best: "Ordina per migliore",
  sort_day: "Raggruppa per giorno, migliori prima dentro ogni giorno",
  exclude_row: "Nascondi questa soluzione",
  restore_last: "Ripristina l'ultima soluzione nascosta",
  restore_all: "Ripristina tutte le soluzioni nascoste",
  err_outbound: "Devi inserire una data di andata (inizio).",
  err_return: "Devi inserire una data di ritorno o spuntare 'Solo Andata'.",
  err_max_range: "L'intervallo massimo consentito per il range di date è di {days} giorni. Seleziona un range più breve per non sovraccaricare il sistema.",
  err_api_key: "Per cercare voli è necessario inserire la propria API Key di SerpApi nelle Impostazioni.",
  err_generic: "Errore durante la ricerca",

  // Settings
  theme_system: "Tema: Segui il sistema",
  serpapi_label: "SerpApi Key (Google Flights)",
  serpapi_placeholder: "Inserisci la tua API key",
  scoring_trains: "Scoring Treni",
  scoring_flights: "Scoring Voli",
  val_time: "Valore del tempo (€/h)",
  early_ref: "Ora Partenza Presto (es. 9)",
  early_pen: "Penalità Partenza Presto (€/h)",
  late_ref: "Ora Arrivo Tardi (es. 22)",
  overnight_ref: "Ora Fine Arrivo Notturno (es. 5)",
  late_pen: "Penalità Arrivo Tardi (€/h)",
  change_pen: "Penalità per Cambio (€)",
  conn_pen: "Penalità per Scalo/Connessione (€)",
  comp_time: "Valore Tempo Accompagnatori (€/h)",
  reminders_title: "Promemoria Testuali",
  add_reminder: "+ Aggiungi Promemoria",
  remove: "Rimuovi",
  target_flights: "Solo Voli",
  target_trains: "Solo Treni",
  target_both: "Entrambi",
  target_disabled: "Disattivo",
  airport_extras_title: "Costi Extra Aeroporti",
  airport_extras_info: "Aggiungi i costi di trasferimento (carburante e tempo di guida) specifici per ogni aeroporto. Verranno sommati al costo totale del volo se l'aeroporto fa parte della tratta.",
  iata_code: "Codice IATA",
  fuel_eur: "Carburante (€)",
  your_time: "Tuo Tempo (h)",
  comp_time_h: "Tempo Accomp. (h)",
  add_airport: "+ Aggiungi Costo Aeroporto",
  ui_settings: "Interfaccia Utente (Personalizza i tuoi Menu)",
  default_origin: "Origine di Default",
  default_dest: "Destinazione di Default",
  dropdown_options: "Opzioni Menu a tendina (separate da virgola)",
  iata_mapping: "Mappatura Codici IATA (uno per riga, es: linate=LIN)",
  save_settings: "Salva Impostazioni",
  saved_local: "Salvato nel LocalStorage!",
  language: "Lingua",
  language_en: "English",
  language_it: "Italiano",
  settings_origin_train: "es. Roma Termini",
  settings_dest_train: "es. Milano Centrale",
  settings_origin_flight: "es. Roma",
  settings_dest_flight: "es. Milano",
  settings_id_placeholder: "ID (es. booking)",
  reminder_text_placeholder: "Testo del promemoria",
  options_trains: TRAIN_STATION_OPTIONS,
  options_flights: "Zurigo,Bari,Brindisi,Torino,Milano Linate,Milano Malpensa,Genova,Roma,Napoli,Catania,Palermo,Venezia,Bologna",
  export_btn: "Esporta",
  import_btn: "Importa",
  export_error: "Errore durante l'esportazione.",
  import_success: "Impostazioni importate con successo! La pagina verrà ricaricata per applicare le modifiche.",
  import_invalid: "Il file non contiene impostazioni valide per TeleTransport.",
  import_corrupted: "File non valido o corrotto.",
  start_end: "(Inizio - Fine)",
  save_destinations: "Salva destinazioni",
  save_btn: "Salva",
  add_origin: "Aggiungi origine",
  add_dest: "Aggiungi destinazione"
};

const dictionaries = { en, it };

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextProps>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string) => key
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    const savedLang = localStorage.getItem('app_language') as Language;
    if (savedLang && (savedLang === 'en' || savedLang === 'it')) {
      setLanguageState(savedLang);
    }
  }, []);

  // Keep <html lang> in sync so screen readers and search engines see the
  // language actually on screen. The boot script in layout.tsx covers the
  // first paint; this covers switching language during the session.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (key: string) => {
    return dictionaries[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
