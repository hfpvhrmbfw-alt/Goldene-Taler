# Goldene Taler – Apple-Pay-Ausgaben ohne App Store

Eigener Ersatz für Tael: Ein Kurzbefehl schreibt jede Apple-Pay-Zahlung in eine Textdatei in iCloud Drive,
diese Web-App liest die Datei ein, ordnet Zahlungen über Regeln Kategorien zu und zeigt Monatsübersichten.
Alle Daten bleiben auf dem Gerät (IndexedDB). Kein Server, kein Tracking. Gestaltet im Stil Castra · Blei (minimalistisch, mobil zuerst).

## Nutzung

1. Kurzbefehl einrichten: siehe [KURZBEFEHL.md](KURZBEFEHL.md) (auch in der App unter **Daten**).
2. https://hfpvhrmbfw-alt.github.io/Goldene-Taler/ in Safari öffnen, dann **Teilen › Zum Home-Bildschirm**.
3. In der App **Daten › Datei wählen › iCloud Drive › Shortcuts › ausgaben.txt**. Immer die ganze Datei
   importieren, bekannte Zahlungen werden übersprungen, gelöschte kommen nicht zurück.

## Dateiformat des Kurzbefehls

Eine Zeile pro Zahlung, Felder mit Semikolon getrennt:

```
2026-10-20T18:55:41+02:00;42,17 €;REWE Markt GmbH;Visa
```

Datum (ISO 8601 oder `20.10.26, 18:55`) · Betrag (deutsch oder englisch, Währung optional, `-` = Erstattung) · Händler · Karte.
Die ID einer Zahlung ist ein Hash der Zeile, deshalb ist der Import beliebig wiederholbar.

## Aufbau

| Datei | Schicht |
|---|---|
| `src/model.js` | Datenmodell, Kategorie-IDs, Validierung, Export/Import, Migration |
| `src/logic.js` | Reine Logik: Zeilen lesen, Beträge parsen, Regeln, Monatsauswertung |
| `src/catalog.js` | Startregeln für häufige Händler (vom Assistenten zusammengestellt, ohne Gewähr) |
| `src/storage.js` | IndexedDB mit localStorage-Fallback |
| `src/texts.js` | Beschriftungen und Meldungen |
| `src/ui.js`, `src/main.js` | Oberfläche, Ereignisse, einzige Stelle mit Uhrzeit |

## Entwickeln

ES-Module brauchen einen Server, `file://` geht nicht:

```
npx serve .        # oder: python3 -m http.server
npm test           # Logik-Tests, ohne Abhängigkeiten
```

Nach jeder Änderung `VERSION` in `sw.js` hochzählen, sonst laden installierte Apps alte Dateien.

## Grenzen

- Summen werden in der eingestellten Währung gerechnet, Beträge in Fremdwährung fließen unverändert ein.
- iOS kann Speicher von Web-Apps löschen, wenn sie wochenlang nicht geöffnet werden. Die Textdatei aus dem
  Kurzbefehl bleibt aber vollständig, ein erneuter Import stellt die Zahlungen wieder her. Für Regeln,
  Kategorien und Notizen ab und zu **Sicherung speichern**.
