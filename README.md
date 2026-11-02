# Taler – Apple-Pay-Ausgaben ohne App Store

Eigener Ersatz für Tael: Ein Kurzbefehl schreibt jede Apple-Pay-Zahlung in eine Textdatei in iCloud Drive,
diese Web-App liest die Datei ein, ordnet Zahlungen über Regeln Kategorien zu und zeigt Monatsübersichten.
Alle Daten bleiben auf dem Gerät (IndexedDB). Kein Server, kein Tracking, auch die Schriften (Asap, Chivo Mono, SIL OFL) liegen in `fonts/`. Gestaltet im Stil Castra · Blei (minimalistisch, mobil zuerst).

## Nutzung

1. Kurzbefehl einrichten: siehe [KURZBEFEHL.md](KURZBEFEHL.md) (auch in der App unter **Einstellungen › Kurzbefehl einrichten**).
2. https://hfpvhrmbfw-alt.github.io/Goldene-Taler/ in Safari öffnen, dann **Teilen › Zum Home-Bildschirm**.
3. Unter Einstellungen **Neue Zahlungen einlesen › iCloud Drive › Shortcuts › ausgaben.txt**. Immer die ganze Datei
   wählen, bekannte Zahlungen werden übersprungen, gelöschte kommen nicht zurück. Wallet-Mitteilungen ohne Betrag
   (Bordkarten, Tickets) werden still übersprungen.
4. **Zahlungen einordnen**: ein Tipp pro Zahlung, über alle Monate. Taler merkt sich den Händler auf Wunsch als Regel
   (vorab angehakt nur, wenn das Muster eindeutig einen Händler mit mehreren Zahlungen trifft).

5. **Kontoauszug einlesen** (Einstellungen): PDF-Kontoauszug von Trade Republic oder ING (Girokonto)
   auswählen. Übernommen wird jede Zeile mit ihrer **Art**: Ausgabe (Karte, Lastschrift, Überweisung, Dauerauftrag),
   Einnahme (Gehalt, Einzahlung, Gutschrift, Zinsen), Sparen (Sparplan, zählt nicht als Ausgabe) oder Umbuchung (zählt
   nirgends). Umbuchung heißt: gleicher Betrag raus und rein auf zwei Konten, höchstens sieben Tage auseinander (auch
   Apple-Pay-Zeilen), oder die Gegenseite ist ein **eigenes Konto** (Einstellungen, vorbelegt mit Trade Republic und ING,
   ergänzbar um Tagesgeld, eigenen Namen oder IBAN; auch aus einer Buchung heraus mit „als eigenes Konto merken“). Die Art lässt sich in jeder
   Buchung ändern. Wer Einnahmen hat, sieht oben in der Übersicht, was nach Einnahmen, Ausgaben und Sparen übrig ist.
   Buchungen lassen sich nach Art, Betrag und Datum sortieren und nach Kategorie und Herkunft filtern. Was der Kurzbefehl schon erfasst hat (gleicher Betrag, Auszug höchstens einen Tag
   früher oder fünf Tage später), kommt nicht doppelt, egal in welcher Reihenfolge eingelesen wird. Das PDF liest
   pdf.js direkt im Browser (`vendor/pdfjs`, nichts aus dem Netz), die Datei selbst wird nicht gespeichert.

Die Übersicht zeigt den **Verlauf** des Monats (aufgelaufene Ausgaben Tag für Tag, Vormonat gestrichelt, Budget als Linie;
antippen oder ziehen zeigt den Stand an einem Tag), darunter die **Kategorien** und **größten Händler** (beide klappbar, der Zustand bleibt gemerkt).
Einlesen und Sichern stehen unter **Einstellungen**, die Sicherungs-Erinnerung als Punkt am Reiter.
Unter den Kategorien zeigt die Übersicht den **Jahresblick** (zwölf Monate, antippbar) und **jeden Monat**
wiederkehrende Zahlungen (gleicher Betrag in drei Monaten hintereinander). Ein Händler führt zu all seinen Zahlungen
mit Summe für das Jahr und insgesamt. In den ersten zehn Tagen eines Monats steht oben ein **Rückblick** auf den Vormonat.
Buchungen, die keine eigene Ausgabe sind (für andere ausgelegt, Kaution), lassen sich auf **nicht mitzählen** stellen.

**Kategorien** (Einstellungen › Kategorien) lassen sich anlegen, umbenennen, beim Einordnen ausblenden und
zusammenlegen, auch direkt beim Einordnen mit „+ neue“. Jede hat eine Art: Ausgabe, Einnahme, **gleicht sich aus**
(z. B. Dienstwagen: Tanken und Kostenabrechnung heben sich auf, zählen nirgends, ein offener Rest steht gelb in der
Übersicht) oder Sparen. Das **Monatsbudget** ist automatisch (Einnahmen minus Sparpläne des Monats, bis das Gehalt da
ist die des Vormonats), ein fester Betrag oder aus.

**Konten** (eigener Reiter): Banken mit ihren Konten, Tagesgeldern und Depots, für ING, Trade Republic und Scalable
Capital als Vorlage zum Anhaken, jede andere Bank von Hand. Oben steht das **Vermögen** (Konten, Tagesgeld, Depots), Konten
für jemand anderen (Kinderdepot) stehen dabei, zählen aber nicht mit. Den **Stand** liest Taler aus dem Kontoauszug
(Saldo am Ende) oder du trägst ihn ein; Buchungen danach rechnet Taler dazu, bei Konten ohne Auszug die Umbuchungen
dorthin („geschätzt“). Jede Buchung gehört zu einem Konto (erkannt am Kartennamen, z. B. „ING Visa“ → ING Girokonto),
Umbuchungen und Sparpläne haben ein Gegenkonto (erkannt am Namen, sonst in der Buchung „an“ wählen). Daraus entstehen
der **Geldfluss** des Monats und beim **Eingangskonto** „frei für den Monat“: Eingang minus Fixkosten minus das, was an
eigene Konten weitergeht. Die frühere Liste „eigene Konten“ wurde beim ersten Start zu Konten (ING, Trade Republic),
weitere Namen (eigener Name, IBAN) bleiben in den Einstellungen.

**Depots**: Aktien, ETFs und Fonds mit Stück, Kaufwert und Kurs eintragen; der Wert des Depots ist dann die Summe der
Positionen, mit Gewinn oder Verlust seit Kauf. Sparplan-Ausführungen aus dem Kontoauszug (gleiche ISIN) zählen künftig
zu Kaufwert und Stück dazu, wenn die Zeile die Stückzahl nennt (Trade Republic: „quantity“). Sparpläne ohne Position
stehen im Depot zum Eintragen bereit. Ein Depot ohne Positionen hat einen Wert von Hand.

**Kurse aus dem Netz**: Mit einem kostenlosen Schlüssel von [EODHD](https://eodhd.com/register) (Einstellungen →
„kurse aus dem netz“) holt Taler einmal am Tag beim Öffnen die Schlusskurse aller Positionen mit ISIN, bevorzugt von Xetra,
nur in der App-Währung. Ins Netz geht nur die ISIN, nie ein Betrag; der Schlüssel bleibt auf dem Gerät und steht nicht
in der Sicherung. Gratis sind 20 Abrufe am Tag, einer je Wertpapier. Ohne Schlüssel, für Positionen ohne ISIN oder wenn
der Abruf scheitert, gehen Kurse wie bisher von Hand (alle Positionen auf einer Seite); ein neuerer Kurs von Hand wird
nicht überschrieben.

Fast alles lässt sich direkt danach mit **rückgängig** zurücknehmen (Löschen, Einordnen, Import, Regeln, Budget).
Beispieldaten haben eine eigene Quelle und lassen sich getrennt von echten Daten entfernen.

## Dateiformat des Kurzbefehls

Eine Zeile pro Zahlung, Felder mit Semikolon getrennt:

```
2026-10-20T18:55:41+02:00;42,17 €;REWE Markt GmbH;Visa
```

Datum (ISO 8601 oder `20.10.26, 18:55`) · Betrag (deutsch oder englisch, Währung optional, `-` = Erstattung) · Händler · Karte.
Der Kurzbefehl schreibt heute die Wallet-Mitteilung (`Datum;Titel;Untertitel;Text`); Taler sucht den Betrag in allen Feldern.
Ein Semikolon im Händlernamen trennt ihn, dann zählt nur der Teil davor.
Die ID einer Zahlung ist ein Hash der Zeile, deshalb ist der Import beliebig wiederholbar.

## Aufbau

| Datei | Schicht |
|---|---|
| `src/model.js` | Datenmodell, Kategorie-IDs, Validierung, Export/Import, Migration |
| `src/logic.js` | Reine Logik: Zeilen lesen, Beträge parsen, Regeln, Monatsauswertung |
| `src/accounts.js` | Reine Logik: Konto einer Buchung, Kontostände, Vermögen, Geldfluss, frei für den Monat |
| `src/prices.js` | Reine Logik für Kurse aus dem Netz: Adresse, passender Kurs je ISIN, Eintragen |
| `src/statement.js` | Reine Logik: Kontoauszüge (Textstücke mit Position) von Trade Republic und ING lesen |
| `src/pdf.js` | Adapter zu pdf.js (`vendor/pdfjs`, Apache-2.0), wird erst beim ersten PDF geladen |
| `src/catalog.js` | Startregeln für häufige Händler (vom Assistenten zusammengestellt, ohne Gewähr) |
| `src/storage.js` | IndexedDB |
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

- Summen werden in der eingestellten Währung gerechnet. Zahlungen in Fremdwährung zählen erst mit, wenn in der
  Buchung der abgerechnete Euro-Betrag steht; bis dahin nennt die Übersicht sie nur als „nicht eingerechnet“.
- Vergleiche mit dem Vormonat oder Vorjahr erscheinen erst, wenn dieser Zeitraum ab seinem Anfang erfasst ist.
- Die Schrift folgt auf dem iPhone der Textgröße aus den Einstellungen (`-apple-system-body`); auf dem Gerät noch zu prüfen.
- Die Zahl am App-Symbol (Zahlungen ohne Kategorie) aktualisiert sich nur, während Taler offen ist.
- iOS kann Speicher von Web-Apps löschen, wenn sie wochenlang nicht geöffnet werden. Die Textdatei aus dem
  Kurzbefehl bleibt aber vollständig, ein erneuter Import stellt die Zahlungen wieder her. Für Regeln,
  Kategorien und Notizen ab und zu **Sicherung speichern**.
