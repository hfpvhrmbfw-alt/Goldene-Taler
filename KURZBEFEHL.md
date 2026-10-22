# Kurzbefehl einrichten (iOS 26)

Apple lässt fertige Kurzbefehle nur signiert teilen, deshalb einmal von Hand anlegen. Dauert etwa drei Minuten.

Wie bei Tael löst die **Mitteilung von Wallet** den Kurzbefehl aus. Sie kommt nach jeder Apple-Pay-Zahlung
und enthält Händler, Betrag und Karte in den Feldern *Titel*, *Untertitel* und *Text*. Welches Feld was
enthält, unterscheidet sich je nach Bank. Das ist egal, die App findet den Betrag selbst.

1. App **Kurzbefehle** › **Automation** › **+** › **Mitteilung**.
   App: **Wallet**. **Sofort ausführen** wählen › **Weiter** › **Neuer leerer Kurzbefehl**.
2. Aktion **Datum formatieren**
   - Datum: *Aktuelles Datum*
   - Datumsformat: **ISO 8601**, **Uhrzeit einschließen** an
3. Aktion **Text**. Nichts abtippen außer den Semikolons: Jeder Teil ist eine blaue Variablen-Blase.

   ```
   (Formatiertes Datum) ; (Titel) ; (Untertitel) ; (Text)
   ```

   - Ins Textfeld tippen, über der Tastatur **Formatiertes Datum** wählen, `;` tippen.
   - Über der Tastatur **Kurzbefehleingabe** wählen, die blaue Blase antippen und unter „Laden“ **Titel** wählen.
     Falls die Liste das nicht anbietet: bei *Typ* zuerst **Mitteilung** einstellen. `;` tippen.
   - Genauso mit **Untertitel**, `;`, und **Text** (der Mitteilungstext).
4. Aktion **An Textdatei anhängen**
   - Text: die gelbe Variable **Text** aus Schritt 3
   - Ordner **Shortcuts**, Dateipfad `ausgaben.txt`
   - **Neue Zeile erstellen** an
5. **Fertig**.

Testen: nach der nächsten Apple-Pay-Zahlung in **Dateien › iCloud Drive › Shortcuts** die Datei
`ausgaben.txt` öffnen. Dort steht dann eine Zeile wie
`2026-10-22T15:50:00+02:00;REWE Markt;;42,17 € mit Visa`.

Andere Wallet-Mitteilungen ohne Betrag (Bordkarten, Tickets) landen auch in der Datei. Die App überspringt sie
beim Einlesen.

Die App liest: Datum vorne, den Betrag in irgendeinem Feld, vom Rest das erste Feld als Händler und das letzte als Karte.
