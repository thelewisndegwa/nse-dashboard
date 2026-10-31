"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PickerItem = {
  code: string;
  name: string;
  hint?: string;
  extra?: string;
  index?: boolean;
};

type Props = {
  label: string;
  items: PickerItem[];
  value: string;
  onChange: (code: string) => void;
};

export function StockPicker({ label, items, value, onChange }: Props) {
  const selected = items.find((item) => item.code === value);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const selectedCode = selected?.code;
  const selectedName = selected?.name;
  useEffect(() => {
    if (selectedName) setText(selectedName);
  }, [selectedCode, selectedName]);

  const matches = useMemo(() => {
    const query = text.trim().toLowerCase();
    const pool = items.filter((item) => {
      if (!query || (selected && text === selected.name)) return true;
      const hay = `${item.code} ${item.name} ${item.extra || ""} ${item.hint || ""}`.toLowerCase();
      return hay.includes(query);
    });
    const equities = pool.filter((item) => !item.index);
    const indexes = pool.filter((item) => item.index);
    const list = [...equities, ...indexes];
    const browsing = !query || (selected != null && text === selected.name);
    return browsing ? list : list.slice(0, 60);
  }, [items, text, selected]);

  useEffect(() => {
    setActive(0);
  }, [text, open]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(code: string) {
    const item = items.find((entry) => entry.code === code);
    onChange(code);
    setText(item?.name || code);
    setOpen(false);
  }

  function closeMenu() {
    setOpen(false);
    if (selected) setText(selected.name);
    // Blur so the next tap/click fires focus again and reopens the list.
    input.current?.blur();
  }

  return (
    <div className="field combo" ref={box}>
      <span>{label}</span>
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={text}
        placeholder="Search name or ticker"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          if (selected) setText(selected.name);
        }}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, Math.max(0, matches.length - 1)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open && matches[active]) {
            event.preventDefault();
            choose(matches[active].code);
          } else if (event.key === "Escape") closeMenu();
        }}
      />
      {open && (
        <div className="menu" role="listbox">
          <div className="menu-bar">
            <span>Pick a stock</span>
            <button
              type="button"
              className="menu-close"
              aria-label="Close stock list"
              onMouseDown={(event) => {
                event.preventDefault();
                closeMenu();
              }}
            >
              Close
            </button>
          </div>
          {matches.length === 0 && <button type="button">No match</button>}
          {matches.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={item.code}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(item.code);
              }}
            >
              <b>{item.name}</b> <small>{item.code}{item.hint ? ` · ${item.hint}` : ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
