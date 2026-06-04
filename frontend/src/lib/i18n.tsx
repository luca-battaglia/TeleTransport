"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'it';

interface Translations {
  [key: string]: string;
}

const en: Translations = {
  // Navigation
  teletransport: "TeleTransport",
  subtitle: "Time is money",
  settings: "Settings",

  // Guide
  guide_title: "TeleTransport Complete Guide",
  guide_intro: "TeleTransport is designed to find the best travel solutions by calculating an 'Adjusted Cost'. This cost is the sum of the actual ticket price and various time-based penalties, converting your lost time and inconvenience into a monetary value. Here is exactly how each setting works:",
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
  origin_placeholder_train: "e.g., Zurich",
  origin_placeholder_flight: "e.g., Zurich",
  destination: "Destination",
  dest_placeholder_train: "e.g., Rome",
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
  err_outbound: "You must enter an outbound date (start).",
  err_return: "You must enter a return date or check 'One-way'.",
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
  settings_origin_train: "e.g., Rome Termini",
  settings_dest_train: "e.g., Milan Central",
  settings_origin_flight: "e.g., Rome",
  settings_dest_flight: "e.g., Milan",
  settings_id_placeholder: "ID (e.g., booking)",
  reminder_text_placeholder: "Reminder text"
};

const it: Translations = {
  // Navigation
  teletransport: "TeleTransport",
  subtitle: "Il tempo è denaro",
  settings: "Impostazioni",

  // Guide
  guide_title: "Guida Completa TeleTransport",
  guide_intro: "TeleTransport è progettato per trovare le migliori soluzioni di viaggio calcolando un 'Costo Adjusted'. Questo costo è la somma del prezzo effettivo del biglietto e di varie penalità basate sul tempo, convertendo il tempo perso e i disagi in un valore monetario. Ecco esattamente come funziona ogni impostazione:",
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
  err_outbound: "Devi inserire una data di andata (inizio).",
  err_return: "Devi inserire una data di ritorno o spuntare 'Solo Andata'.",
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
  reminder_text_placeholder: "Testo del promemoria"
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
