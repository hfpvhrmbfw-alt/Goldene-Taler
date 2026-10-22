# Kurzbefehl einrichten (iOS 17 oder neuer)

Apple lässt fertige Kurzbefehle nur signiert teilen, deshalb einmal von Hand anlegen. Dauert etwa drei Minuten.

1. App **Kurzbefehle** öffnen › unten **Automation** › **+** › **Transaktion**.
2. **Karte**: alle Apple-Pay-Karten auswählen. **Kategorie**: alle lassen.
   **Sofort ausführen** wählen (und *Bei Ausführung benachrichtigen* nach Wunsch aus) › **Weiter** › **Neuer leerer Kurzbefehl**.
3. Aktion **Datum formatieren**
   - Datum: *Aktuelles Datum*
   - Datumsformat: **ISO 8601**, **Uhrzeit einschließen** an
4. Aktion **Text**. Nichts in Klammern abtippen: Jeder Teil unten ist eine blaue Variablen-Blase,
   dazwischen tippst du nur das Semikolon `;`.

   ```
   (Formatiertes Datum) ; (Währungsbetrag) ; (Händler) ; (Name)
   ```

   - Ins Textfeld tippen, über der Tastatur **Formatiertes Datum** wählen, `;` tippen.
   - Über der Tastatur **Kurzbefehleingabe** wählen, dann die neue blaue Blase antippen und **Währungsbetrag**
     auswählen (heißt je nach iOS-Version auch *Betrag*). `;` tippen.
   - Genauso mit **Händler**, `;`, und **Name** (Kartenname, je nach iOS-Version auch *Karte oder Ausweis*).
   - Am Ende stehen vier blaue Blasen mit drei Semikolons dazwischen.
5. Aktion **An Textdatei anhängen**
   - Text: *Text* (aus Schritt 4)
   - Dateipfad: `Shortcuts/ausgaben.txt`
   - **Neue Zeile anfangen** an
6. **Fertig**.

Testen: im Kurzbefehl unten auf ▶ tippen geht nicht ohne echte Zahlung. Am einfachsten nach der nächsten
Apple-Pay-Zahlung in der App **Dateien › iCloud Drive › Shortcuts › ausgaben.txt** öffnen. Steht dort eine
Zeile wie `2026-10-20T18:55:41+02:00;42,17 €;REWE;Visa`, ist alles richtig.

Wenn ein Feld leer bleibt oder vertauscht ist (je nach Bank unterschiedlich): Das Datum muss vorne stehen.
Den Betrag findet die App in jedem Feld; vom Rest gilt das erste Feld als Händler und das letzte als Karte.
