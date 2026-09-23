import { describe, expect, it } from 'vitest';
import { configOverrides, migrateSettings } from './settings';

describe('configOverrides', () => {
  it('keeps cities mapped to several airports and drops what the backend would reject', () => {
    const settings = { ui: { flights: { iata_mapping: { rome: 'FCO,CIA', linate: 'LIN', typo: 'ROME', ' ': 'ZRH' } } } };
    expect(configOverrides(settings, 'flights')).toEqual({
      ui: { flights: { iata_mapping: { rome: 'FCO,CIA', linate: 'LIN' } } },
    });
  });

  it('sends nothing when nothing is customized', () => {
    expect(configOverrides({}, 'flights')).toBeNull();
    expect(configOverrides({ ui: { flights: { iata_mapping: {} } } }, 'flights')).toBeNull();
  });

  it('sends only the settings of the mode searched', () => {
    const settings = { trains: { scoring: { change_penalty_eur: 0 } }, flights: { scoring: { connection_penalty_eur: 9 } } };
    expect(configOverrides(settings, 'trains')).toEqual({ trains: { scoring: { change_penalty_eur: 0 } } });
  });
});

describe('migrateSettings', () => {
  it('renames the Italian keys of old versions', () => {
    const migrated = migrateSettings({ treni: { scoring: { change_penalty_eur: 1 } }, reminders: { a: 'voucher' } });
    expect(migrated.trains?.scoring?.change_penalty_eur).toBe(1);
    expect(migrated.reminders?.a).toEqual({ text: 'voucher', target: 'flights' });
  });
});
