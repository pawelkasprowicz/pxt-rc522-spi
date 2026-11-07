// Program testowy biblioteki RC522 SPI
// BBC micro:bit V2

rc522.initialize();

basic.showIcon(IconNames.Yes);

// Przycisk A - zapis PAWEL
input.onButtonPressed(Button.A, function () {
    basic.showString("A");

    if (rc522.writeText("PAWEL", 4)) {
        basic.showIcon(IconNames.Yes);
        serial.writeLine("Zapisano: PAWEL");
    } else {
        basic.showIcon(IconNames.No);
        serial.writeLine("Blad zapisu");
    }
});

// Przycisk B - zapis MICROBIT
input.onButtonPressed(Button.B, function () {
    basic.showString("B");

    if (rc522.writeText("MICROBIT", 4)) {
        basic.showIcon(IconNames.Yes);
        serial.writeLine("Zapisano: MICROBIT");
    } else {
        basic.showIcon(IconNames.No);
        serial.writeLine("Blad zapisu");
    }
});

// Przyciski A+B - odczyt danych
input.onButtonPressed(Button.AB, function () {
    let tekst = rc522.readText(4);

    if (tekst.length > 0) {
        serial.writeLine("Odczyt: " + tekst);
        basic.showString(tekst);
    } else {
        basic.showIcon(IconNames.No);
        serial.writeLine("Blad odczytu");
    }
});

// Automatyczny odczyt UID
basic.forever(function () {
    let uid = rc522.readUID();

    if (uid.length > 0) {
        serial.writeLine("UID: " + uid);
        basic.showIcon(IconNames.Yes);
    }

    basic.pause(1000);
});
