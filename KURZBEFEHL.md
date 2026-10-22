# Kurzbefehl einrichten (iOS 17 oder neuer)

Apple lässt fertige Kurzbefehle nur signiert teilen, deshalb einmal von Hand anlegen. Dauert etwa drei Minuten.

1. App **Kurzbefehle** öffnen › unten **Automation** › **+** › **Transaktion**.
2. **Karte**: alle Apple-Pay-Karten auswählen. **Kategorie**: alle lassen.
   **Sofort ausführen** wählen (und *Bei Ausführung benachrichtigen* nach Wunsch aus) › **Weiter** › **Neuer leerer Kurzbefehl**.
3. Aktion **Datum formatieren**
   - Datum: *Aktuelles Datum*
   - Datumsformat: **ISO 8601**, **Uhrzeit einschließen** an
4. Aktion **Text**, Inhalt genau so (Teile in Klammern sind Variablen):

   ```
   [Formatiertes Datum];[Betrag];[Händler];[Name]
   ```

   Variablen einfügen: in das Textfeld tippen › über der Tastatur *Kurzbefehl-Eingabe* wählen ›
   die Variable antippen und das Feld (**Betrag**, **Händler**, **Name**) auswählen. *Name* ist der Kartenname,
   je nach iOS-Version heißt das Feld auch *Karte oder Ausweis*. Zwischen den Feldern jeweils ein Semikolon `;`.
5. Aktion **An Textdatei anhängen**
   - Text: *Text* (aus Schritt 4)
   - Dateipfad: `Shortcuts/ausgaben.txt`
   - **Neue Zeile anfangen** an
6. **Fertig**.

Testen: im Kurzbefehl unten auf ▶ tippen geht nicht ohne echte Zahlung. Am einfachsten nach der nächsten
Apple-Pay-Zahlung in der App **Dateien › iCloud Drive › Shortcuts › ausgaben.txt** öffnen. Steht dort eine
Zeile wie `2026-10-20T18:55:41+02:00;42,17 €;REWE;Visa`, ist alles richtig.

Wenn ein Feld leer bleibt oder vertauscht ist (je nach Bank unterschiedlich): Reihenfolge in Schritt 4
anpassen. Die App erwartet immer Datum;Betrag;Händler;Karte.
