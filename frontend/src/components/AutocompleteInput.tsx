"use client";

import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  label: string;
}

export default function AutocompleteInput({ value, onChange, options, placeholder, label }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [filtered, setFiltered] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    
    if (!val) {
      setFiltered(options);
      setIsOpen(true);
      return;
    }

    const lowerVal = val.toLowerCase();
    const matches = options.filter(opt => opt.toLowerCase().includes(lowerVal));
    setFiltered(matches);
    setIsOpen(true);
  };

  const handleSelect = (opt: string) => {
    onChange(opt);
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }} ref={wrapperRef}>
      <label className="form-label" style={{ marginBottom: '8px' }}>{label}</label>
      <input 
        value={value}
        onChange={handleInputChange}
        onFocus={() => {
          if (!value) setFiltered(options);
          else setFiltered(options.filter(opt => opt.toLowerCase().includes(value.toLowerCase())));
          setIsOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => {
            const currentVal = valueRef.current.trim();
            if (currentVal && currentVal.length !== 3 && !options.some(opt => opt.toLowerCase().trim() === currentVal.toLowerCase())) {
              onChange("");
            }
          }, 150);
        }}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
      {isOpen && filtered.length > 0 && (
        <ul style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius)',
          marginTop: '4px',
          maxHeight: '200px',
          overflowY: 'auto',
          zIndex: 50,
          listStyle: 'none',
          padding: 0,
          backdropFilter: 'blur(10px)'
        }}>
          {filtered.map((opt, i) => (
            <li 
              key={i} 
              onClick={() => handleSelect(opt)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--card-border)' : 'none'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--card-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
