-- Seed bank mappings with pre-configured detection rules
INSERT INTO bank_mapping (
  bank_name,
  booking_date,
  amount,
  booking_text,
  booking_type,
  booking_date_parse_format,
  without_header,
  detection_hints
) VALUES
  (
    'comdirect',
    '{"Wertstellung (Valuta)"}',
    '{"Umsatz in EUR"}',
    '{Buchungstext}',
    '{Vorgang}',
    'dd.MM.yyyy',
    false,
    '{"header_signature": ["Buchungstag", "Wertstellung (Valuta)", "Vorgang", "Buchungstext", "Umsatz in EUR"]}'
  ),
  (
    'PayCenter (Test)',
    '{Datum}',
    '{Betrag}',
    '{Zahlungspartner,Verwendungszweck}',
    '{Type}',
    'yyyy-MM-dd HH:mm:ss.SSSSSS',
    false,
    '{"header_signature": ["Datum", "Betrag", "Verwendungszweck", "Zahlungspartner", "Type"]}'
  ),
  (
    'Sparkasse (700)',
    '{$1}',
    '{$3}',
    '{$2}',
    '{}',
    'dd.MM.yyyy',
    true,
    '{"without_header": {"column_count": 6, "column_markers": ["date", "text", "number", "empty", "empty", "text"]}}'
  ),
  (
    'apo bank test 2',
    '{Datum}',
    '{"Betrag (EUR)"}',
    '{Name,Verwendungszweck}',
    '{Auftragsart}',
    'dd.MM.yyyy',
    false,
    '{"header_signature": ["Datum", "Name", "Verwendungszweck", "Auftragsart", "Betrag (EUR)", "Saldo (EUR)"]}'
  ),
  (
    'PayCenter (VIMpay)',
    '{Datum}',
    '{Betrag}',
    '{"Absender / Empfänger",Verwendungszweck}',
    '{}',
    'dd.MM.yyyy',
    false,
    '{"header_signature": ["Datum", "Kontoinhaber", "IBAN des Kontoinhabers", "Verwendungszweck", "Absender / Empfänger", "IBAN des Absenders / Empfängers", "Betrag", "Währung"]}'
  )
ON CONFLICT DO NOTHING;
